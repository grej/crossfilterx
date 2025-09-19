
import { spawnSync } from 'node:child_process';
import { rmSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(rootDir, '..');

const coreDist = path.join(projectRoot, 'packages/core/dist');
const benchDist = path.join(projectRoot, 'packages/bench/dist');
const coreInfo = path.join(projectRoot, 'packages/core/tsconfig.tsbuildinfo');
const benchInfo = path.join(projectRoot, 'packages/bench/tsconfig.tsbuildinfo');
const wasmSrcDir = path.join(projectRoot, 'packages/core/src/wasm/pkg');
const wasmDistDir = path.join(projectRoot, 'packages/core/dist/wasm/pkg');

const defaultOutput = path.join(
  projectRoot,
  'packages/bench/reports',
  `baseline-${Date.now()}.json`
);
const benchOutput = process.env.BENCH_OUTPUT ?? defaultOutput;
const keepArtifacts = process.env.BENCH_KEEP_DIST === 'true';

function logStep(message) {
  console.log(`
➡️  ${message}`);
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
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      patchModuleImports(entryPath);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      const text = readFileSync(entryPath, 'utf8');
      const importRegex = /from '([^']+)'/g;
      const updated = text.replace(importRegex, (match, target) => {
        if (!target.startsWith('./') && !target.startsWith('../')) return match;
        if (target.endsWith('.js')) return match;
        return `from '${target}.js'`;
      });
      if (updated !== text) {
        writeFileSync(entryPath, updated);
      }
    }
  }
}

function clean() {
  for (const target of [coreDist, benchDist]) {
    if (existsSync(target)) {
      rmSync(target, { recursive: true, force: true });
    }
  }
  for (const info of [coreInfo, benchInfo]) {
    if (existsSync(info)) {
      rmSync(info, { force: true });
    }
  }
}

function syncWasmPackage() {
  if (!existsSync(wasmSrcDir)) return;
  if (!existsSync(wasmDistDir)) {
    mkdirSync(wasmDistDir, { recursive: true });
  }
  for (const entry of readdirSync(wasmDistDir, { withFileTypes: true })) {
    const entryPath = path.join(wasmDistDir, entry.name);
    rmSync(entryPath, { recursive: true, force: true });
  }
  for (const entry of readdirSync(wasmSrcDir, { withFileTypes: true })) {
    const srcPath = path.join(wasmSrcDir, entry.name);
    const destPath = path.join(wasmDistDir, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(destPath, { recursive: true });
      // shallow copy for nested folders (none expected now)
      for (const nested of readdirSync(srcPath)) {
        const nestedSrc = path.join(srcPath, nested);
        const nestedDest = path.join(destPath, nested);
        writeFileSync(nestedDest, readFileSync(nestedSrc));
      }
    } else {
      writeFileSync(destPath, readFileSync(srcPath));
    }
  }
}

try {
  if (!keepArtifacts) {
    clean();
  }

  logStep('Building @crossfilterx/core');
  run('npx', ['tsc', '--build', 'packages/core/tsconfig.json']);
  syncWasmPackage();
  patchModuleImports(coreDist);

  logStep('Building @crossfilterx/bench');
  run('npx', ['tsc', '--build', 'packages/bench/tsconfig.json']);

  const reportsDir = path.dirname(benchOutput);
  if (!existsSync(reportsDir)) {
    mkdirSync(reportsDir, { recursive: true });
  }

  logStep('Running benchmark');
  run('node', ['packages/bench/dist/runner.js'], {
    env: { BENCH_OUTPUT: benchOutput },
  });

  console.log(`\n✅ Benchmark written to ${benchOutput}`);
} catch (error) {
  console.error(`\n❌ Benchmark failed: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  if (!keepArtifacts) {
    clean();
  }
}
