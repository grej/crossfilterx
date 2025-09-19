#!/usr/bin/env node
/**
 * Drives the histogram microbenchmark end-to-end: (1) build the core and bench
 * workspaces, (2) patch the emitted ESM imports with `.js` extensions for
 * Node.js resolution, and (3) execute `packages/bench/dist/micro/histogram.js`.
 * The script mirrors `scripts/run-bench.mjs` but focuses exclusively on the
 * clear-path microbench used by the SIMD plan. Environment variables such as
 * `BENCH_ROWS`, `MICRO_ITERATIONS`, `MICRO_HIST_MODES`, and `MICRO_OUTPUT` are
 * forwarded to the child process.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(rootDir, '..');
const coreDist = path.join(projectRoot, 'packages/core/dist');
const benchDist = path.join(projectRoot, 'packages/bench/dist');
const wasmSrcDir = path.join(projectRoot, 'packages/core/src/wasm/pkg');
const wasmDistDir = path.join(projectRoot, 'packages/core/dist/wasm/pkg');
const infoFiles = [
  path.join(projectRoot, 'packages/core/tsconfig.tsbuildinfo'),
  path.join(projectRoot, 'packages/bench/tsconfig.tsbuildinfo')
];
const keepDist = process.env.MICRO_KEEP_DIST === 'true';

function logStep(message) {
  console.log(`\n➡️  ${message}`);
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, ...options.env }
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(' ')}`);
  }
}

function clean() {
  for (const target of [coreDist, benchDist]) {
    if (existsSync(target)) {
      rmSync(target, { recursive: true, force: true });
    }
  }
  for (const info of infoFiles) {
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
    rmSync(path.join(wasmDistDir, entry.name), { recursive: true, force: true });
  }
  for (const entry of readdirSync(wasmSrcDir, { withFileTypes: true })) {
    const src = path.join(wasmSrcDir, entry.name);
    const dest = path.join(wasmDistDir, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(dest, { recursive: true });
      for (const nested of readdirSync(src)) {
        writeFileSync(path.join(dest, nested), readFileSync(path.join(src, nested)));
      }
    } else {
      writeFileSync(dest, readFileSync(src));
    }
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
// NOTE: This helper duplicates the one inside run-bench.mjs; consolidate when the
// wasm/SIMD build step lands so both scripts share a common utility.

try {
  if (!keepDist) {
    clean();
  } else {
    mkdirSync(coreDist, { recursive: true });
    mkdirSync(benchDist, { recursive: true });
  }

  logStep('Building @crossfilterx/core');
  run('npx', ['tsc', '--build', 'packages/core/tsconfig.json']);
  syncWasmPackage();

  logStep('Building @crossfilterx/bench');
  run('npx', ['tsc', '--build', 'packages/bench/tsconfig.json']);

  logStep('Patching ESM import specifiers');
  patchModuleImports(coreDist);
  patchModuleImports(benchDist);

  const microScript = path.join('packages', 'bench', 'dist', 'micro', 'histogram.js');
  logStep('Running histogram microbenchmark');
  run('node', [microScript]);
  console.log('\n✅ Histogram microbenchmark finished.');
} catch (error) {
  console.error('\n❌ Histogram microbenchmark failed');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
