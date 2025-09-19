import { spawnSync } from 'node:child_process';
import { rmSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(rootDir, '..');
const coreDist = path.join(projectRoot, 'packages/core/dist');
const benchReports = path.join(projectRoot, 'packages/bench/reports');
const comparisonPath = path.join(benchReports, `comparison-${Date.now()}.json`);
const keepDist = process.env.COMPARE_KEEP_DIST === 'true';
const useColumnar = process.argv.includes('--columnar') || process.env.COMPARE_COLUMNAR === '1';
const CARRIERS = ['AA', 'DL', 'UA', 'WN', 'B6', 'AS'];

if (process.argv.includes('--help')) {
  console.log(`Usage: node compare-crossfilter.mjs [--columnar]

Options:
  --columnar        Feed crossfilterX typed columns (legacy crossfilter still sees row objects).
  COMPARE_KEEP_DIST=true   Skip cleaning dist output.
  COMPARE_COLUMNAR=1       Same as --columnar.
`);
  process.exit(0);
}

const require = createRequire(import.meta.url);
const legacyCrossfilterPath = path.resolve(projectRoot, '../crossfilter-community');
const legacyCrossfilter = require(legacyCrossfilterPath);

function logStep(message) {
  console.log(`\n➡️  ${message}`);
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, ...options.env },
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(' ')}`);
  }
}

function patchModuleImports(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      patchModuleImports(full);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      const text = readFileSync(full, 'utf8');
      const updated = text.replace(/from '([^']+)'/g, (match, target) => {
        if (!target.startsWith('./') && !target.startsWith('../')) return match;
        if (target.endsWith('.js')) return match;
        return `from '${target}.js'`;
      });
      if (updated !== text) {
        writeFileSync(full, updated);
      }
    }
  }
}

function clean() {
  if (existsSync(coreDist) && !keepDist) {
    rmSync(coreDist, { recursive: true, force: true });
  }
  const tsbuild = path.join(projectRoot, 'packages/core/tsconfig.tsbuildinfo');
  if (existsSync(tsbuild) && !keepDist) {
    rmSync(tsbuild, { force: true });
  }
}

async function main() {
  try {
    clean();
    logStep('Building @crossfilterx/core for comparison');
    run('npx', ['tsc', '--project', 'packages/core/tsconfig.json']);
    patchModuleImports(coreDist);

    logStep('Loading crossfilterX bundle');
    const coreModule = await import(pathToFileURL(path.join(coreDist, 'index.js')).href);
    const { crossfilterX } = coreModule;

    const sizes = [100_000, 200_000, 500_000];
    const results = [];

    for (const rows of sizes) {
      const datasetRows = generateFlights(rows);
      const datasetX = useColumnar ? toColumnar(datasetRows) : datasetRows;
      const rangeMin = 0;
      const rangeMax = 3_000;
      const loValue = rangeMin + (rangeMax - rangeMin) * 0.25;
      const hiValue = rangeMin + (rangeMax - rangeMin) * 0.75;
      const bins = 1024;

      // crossfilterX timings
      const ingestStartX = performance.now();
      const cfX = crossfilterX(datasetX, { bins });
      await cfX.whenIdle();
      const ingestMsX = performance.now() - ingestStartX;

      const buildStartX = performance.now();
      await cfX.buildIndex('distance');
      const buildMsX = performance.now() - buildStartX;

      const loBin = quantizeValue(loValue, rangeMin, rangeMax, bins);
      const hiBin = quantizeValue(hiValue, rangeMin, rangeMax, bins);
      const filterStartX = performance.now();
      cfX.dimension('distance').filter([loBin, hiBin]);
      await cfX.whenIdle();
      const filterMsX = performance.now() - filterStartX;

      const clearStartX = performance.now();
      cfX.dimension('distance').clear();
      await cfX.whenIdle();
      const clearMsX = performance.now() - clearStartX;
      cfX.dispose();

      // legacy crossfilter timings
      const ingestStartLegacy = performance.now();
      const cfLegacy = legacyCrossfilter(datasetRows);
      const ingestMsLegacy = performance.now() - ingestStartLegacy;

      const distanceDim = cfLegacy.dimension((row) => row.distance);
      const groupAll = cfLegacy.groupAll();

      const filterStartLegacy = performance.now();
      distanceDim.filterRange([loValue, hiValue]);
      const activeLegacy = groupAll.value();
      const filterMsLegacy = performance.now() - filterStartLegacy;

      const clearStartLegacy = performance.now();
      distanceDim.filterAll();
      groupAll.value();
      const clearMsLegacy = performance.now() - clearStartLegacy;

      results.push({
        rows,
        range: [loValue, hiValue],
        mode: useColumnar ? 'columnar' : 'rows',
        crossfilterX: {
          ingestMs: ingestMsX,
          indexMs: buildMsX,
          filterMs: filterMsX,
          clearMs: clearMsX,
        },
        legacyCrossfilter: {
          ingestMs: ingestMsLegacy,
          filterMs: filterMsLegacy,
          clearMs: clearMsLegacy,
          activeCount: activeLegacy,
        },
      });
    }

    if (!existsSync(benchReports)) {
      mkdirSync(benchReports, { recursive: true });
    }
    writeFileSync(comparisonPath, JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2));

    console.log('\nComparison results saved to', comparisonPath);
    results.forEach((entry) => {
      console.log(`\nRows: ${entry.rows}`);
      console.log(`  mode: ${entry.mode}`);
      console.log('  crossfilterX:', entry.crossfilterX);
      console.log('  legacy crossfilter:', entry.legacyCrossfilter);
    });
  } catch (error) {
    console.error('Comparison failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    if (!keepDist) {
      clean();
    }
  }
}

function generateFlights(count) {
  const flights = new Array(count);
  for (let i = 0; i < count; i++) {
    const carrier = Math.floor(Math.random() * CARRIERS.length);
    const distance = clamp(randomNormal(900, 450), 50, 3000);
    const departure = clamp(Math.round(randomNormal(12, 4)), 0, 23);
    flights[i] = {
      carrier,
      distance,
      departure,
    };
  }
  return flights;
}

function toColumnar(rows) {
  const length = rows.length;
  const carriers = new Uint16Array(length);
  const distances = new Float32Array(length);
  const departures = new Uint16Array(length);
  for (let i = 0; i < length; i++) {
    const row = rows[i];
    carriers[i] = row.carrier ?? 0;
    distances[i] = row.distance ?? 0;
    departures[i] = row.departure ?? 0;
  }
  return {
    columns: {
      carrier: carriers,
      distance: distances,
      departure: departures
    },
    categories: {
      carrier: CARRIERS
    },
    length
  };
}


function randomNormal(mean, std) {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + std * num;
}

function quantizeValue(value, min, max, bits) {
  if (max <= min) return 0;
  const range = (1 << bits) - 1;
  const clamped = Math.min(Math.max(value, min), max);
  const normalized = (clamped - min) / (max - min);
  return Math.round(normalized * range);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

await main();
