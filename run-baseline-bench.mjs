/**
 * Simple baseline benchmark runner
 * Runs before and after optimization to measure gains
 */

import { crossfilterX } from './packages/core/src/index.js';
import { writeFileSync } from 'fs';

// Generate synthetic data
function generateColumnarData(rows, dims) {
  const columns = {};

  for (let d = 0; d < dims; d++) {
    const data = new Uint16Array(rows);
    for (let i = 0; i < rows; i++) {
      data[i] = Math.floor(Math.random() * 4096);
    }
    columns[`dim${d}`] = data;
  }

  return { columns, length: rows };
}

const results = [];

async function bench(name, size, fn) {
  const start = performance.now();
  await fn();
  const elapsed = performance.now() - start;
  const result = `${name} (${size.toLocaleString()} rows): ${elapsed.toFixed(2)}ms`;
  console.log(result);
  results.push({ name, size, timeMs: elapsed });
  return elapsed;
}

async function runBaseline() {
  console.log('========================================');
  console.log('CrossfilterX Baseline Performance');
  console.log('========================================\n');

  const DIMS = 10;

  // 100K rows
  console.log('--- 100,000 rows ---\n');

  await bench('Ingest (columnar)', 100_000, async () => {
    const data = generateColumnarData(100_000, DIMS);
    const cf = crossfilterX(data, { bins: 4096 });
    await cf.whenIdle();
    cf.dispose();
  });

  await bench('Filter (delta)', 100_000, async () => {
    const data = generateColumnarData(100_000, DIMS);
    const cf = crossfilterX(data);
    await cf.whenIdle();
    const dim = cf.dimension('dim0');
    await dim;
    await cf.buildIndex('dim0');
    await cf.whenIdle();
    dim.filter([100, 200]);
    await cf.whenIdle();
    cf.dispose();
  });

  await bench('Clear (delta)', 100_000, async () => {
    const data = generateColumnarData(100_000, DIMS);
    const cf = crossfilterX(data);
    await cf.whenIdle();
    const dim = cf.dimension('dim0');
    await dim;
    await cf.buildIndex('dim0');
    dim.filter([100, 200]);
    await cf.whenIdle();
    dim.clear();
    await cf.whenIdle();
    cf.dispose();
  });

  await bench('Clear (recompute)', 100_000, async () => {
    const data = generateColumnarData(100_000, DIMS);
    const cf = crossfilterX(data);
    await cf.whenIdle();
    const dim0 = cf.dimension('dim0');
    const dim1 = cf.dimension('dim1');
    await Promise.all([dim0, dim1]);
    dim0.filter([100, 200]);
    dim1.filter([300, 400]);
    await cf.whenIdle();
    dim0.clear();
    await cf.whenIdle();
    cf.dispose();
  });

  // 1M rows
  console.log('\n--- 1,000,000 rows ---\n');

  await bench('Ingest (columnar)', 1_000_000, async () => {
    const data = generateColumnarData(1_000_000, DIMS);
    const cf = crossfilterX(data, { bins: 4096 });
    await cf.whenIdle();
    cf.dispose();
  });

  await bench('Filter (delta)', 1_000_000, async () => {
    const data = generateColumnarData(1_000_000, DIMS);
    const cf = crossfilterX(data);
    await cf.whenIdle();
    const dim = cf.dimension('dim0');
    await dim;
    await cf.buildIndex('dim0');
    await cf.whenIdle();
    dim.filter([100, 200]);
    await cf.whenIdle();
    cf.dispose();
  });

  await bench('Clear (recompute)', 1_000_000, async () => {
    const data = generateColumnarData(1_000_000, DIMS);
    const cf = crossfilterX(data);
    await cf.whenIdle();
    const dim0 = cf.dimension('dim0');
    const dim1 = cf.dimension('dim1');
    await Promise.all([dim0, dim1]);
    dim0.filter([100, 200]);
    dim1.filter([300, 400]);
    await cf.whenIdle();
    dim0.clear();
    await cf.whenIdle();
    cf.dispose();
  });

  // Save results
  const timestamp = new Date().toISOString();
  const output = {
    timestamp,
    results
  };

  writeFileSync('baseline-results.json', JSON.stringify(output, null, 2));
  console.log('\n========================================');
  console.log('Results saved to baseline-results.json');
  console.log('========================================');
}

runBaseline().catch(console.error);
