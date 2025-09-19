import { spawnSync } from 'node:child_process';
import path from 'node:path';

const projectRoot = path.resolve(new URL('.', import.meta.url).pathname, '..');

const variants = [
  { label: 'rows', env: { BENCH_ROWS: '1000000' } },
  { label: 'columnar', env: { BENCH_ROWS: '1000000', BENCH_COLUMNAR: '1' } }
];

function runBenchmark(variant) {
  console.log(`\n➡️  Running 1M benchmark (${variant.label})`);
  const result = spawnSync('npm', ['run', 'bench'], {
    cwd: projectRoot,
    env: { ...process.env, ...variant.env },
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    throw new Error(`Benchmark failed for ${variant.label}`);
  }
}

function main() {
  for (const variant of variants) {
    runBenchmark(variant);
  }
  console.log('\n1M benchmarks completed. Reports saved under packages/bench/reports/.');
}

try {
  main();
} catch (error) {
  console.error('1M benchmark script failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
