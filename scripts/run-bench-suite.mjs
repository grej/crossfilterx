#!/usr/bin/env node
/**
 * Orchestrates the full CrossfilterX benchmark pipeline. The script rebuilds
 * the core and bench workspaces on demand (delegated to nested commands), runs
 * baseline single-range benches, legacy comparisons, 1 M suites, multi-filter
 * stress tests, the histogram microbench, and finally regenerates
 * `packages/bench/reports-summary.json`. Consumers include the manual GitHub
 * Action workflow and local development sessions that need reproducible perf
 * numbers.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';

const projectRoot = path.resolve(new URL('.', import.meta.url).pathname, '..');

const reportsDir = path.join(projectRoot, 'packages', 'bench', 'reports');

function reportPath(prefix) {
  return path.join(reportsDir, `${prefix}-${Date.now()}.json`);
}

function run(label, command, args, extraEnv = {}) {
  console.log(`\n➡️  ${label}`);
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed`);
  }
}

function main() {
  run('Baseline 100k rows', 'npm', ['run', 'bench'] , { BENCH_OUTPUT: reportPath('baseline') });
  run('Baseline 100k columnar', 'npm', ['run', 'bench'], {
    BENCH_COLUMNAR: '1',
    BENCH_OUTPUT: reportPath('baseline')
  });
  run('Comparison (rows)', 'node', ['scripts/compare-crossfilter.mjs']);
  run('Comparison (columnar)', 'node', ['scripts/compare-crossfilter.mjs', '--columnar']);
  run('1M benchmarks', 'node', ['scripts/run-1m-bench.mjs']);
  run('Multi-filter 1M rows', 'npm', ['run', 'bench'], {
    BENCH_SCENARIO: 'multi',
    BENCH_ROWS: '1000000',
    BENCH_OUTPUT: reportPath('multi-rows')
  });
  run('Multi-filter 5M columnar', 'npm', ['run', 'bench'], {
    BENCH_SCENARIO: 'multi',
    BENCH_ROWS: '5000000',
    BENCH_COLUMNAR: '1',
    BENCH_OUTPUT: reportPath('multi-columnar')
  });
  run('Histogram microbench', 'npm', ['run', 'bench:micro'], {
    MICRO_OUTPUT: reportPath('micro-histogram')
  });
  run('Generating benchmark summary', 'node', ['scripts/generate-bench-summary.mjs']);
  console.log('\nBench suite complete.');
}

try {
  main();
} catch (error) {
  console.error('Bench suite failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
