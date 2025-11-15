/**
 * Performance baseline benchmarks
 * These tests measure current performance to validate optimization gains
 */

import { describe, it } from 'vitest';
import { crossfilterX } from '../src/index';
import type { ColumnarData } from '../src/types';

// Generate synthetic data
function generateColumnarData(rows: number, dims: number): ColumnarData {
  const columns: Record<string, Uint16Array> = {};

  for (let d = 0; d < dims; d++) {
    const data = new Uint16Array(rows);
    for (let i = 0; i < rows; i++) {
      data[i] = Math.floor(Math.random() * 4096);
    }
    columns[`dim${d}`] = data;
  }

  return { columns, length: rows };
}

describe('Performance Baseline (100K rows)', () => {
  const SIZE = 100_000;
  const DIMS = 10;

  it('ingest columnar', async () => {
    const data = generateColumnarData(SIZE, DIMS);
    const start = performance.now();

    const cf = crossfilterX(data, { bins: 4096 });
    await cf.whenIdle();

    const elapsed = performance.now() - start;
    console.log(`[BASELINE] Ingest ${SIZE.toLocaleString()} rows: ${elapsed.toFixed(2)}ms`);

    cf.dispose();
  });

  it('filter with index', async () => {
    const data = generateColumnarData(SIZE, DIMS);
    const cf = crossfilterX(data);
    await cf.whenIdle();

    const dim = cf.dimension('dim0');
    await dim;
    await cf.buildIndex('dim0');
    await cf.whenIdle();

    const start = performance.now();
    dim.filter([100, 200]);
    await cf.whenIdle();
    const elapsed = performance.now() - start;

    console.log(`[BASELINE] Filter ${SIZE.toLocaleString()} rows: ${elapsed.toFixed(2)}ms`);
    cf.dispose();
  });

  it('clear filter (delta)', async () => {
    const data = generateColumnarData(SIZE, DIMS);
    const cf = crossfilterX(data);
    await cf.whenIdle();

    const dim = cf.dimension('dim0');
    await dim;
    await cf.buildIndex('dim0');
    dim.filter([100, 200]);
    await cf.whenIdle();

    const start = performance.now();
    dim.clear();
    await cf.whenIdle();
    const elapsed = performance.now() - start;

    console.log(`[BASELINE] Clear delta ${SIZE.toLocaleString()} rows: ${elapsed.toFixed(2)}ms`);
    cf.dispose();
  });

  it('clear filter (recompute path)', async () => {
    const data = generateColumnarData(SIZE, DIMS);
    const cf = crossfilterX(data);
    await cf.whenIdle();

    const dim0 = cf.dimension('dim0');
    const dim1 = cf.dimension('dim1');
    await Promise.all([dim0, dim1]);

    dim0.filter([100, 200]);
    dim1.filter([300, 400]);
    await cf.whenIdle();

    const start = performance.now();
    dim0.clear();
    await cf.whenIdle();
    const elapsed = performance.now() - start;

    console.log(`[BASELINE] Clear recompute ${SIZE.toLocaleString()} rows: ${elapsed.toFixed(2)}ms`);
    cf.dispose();
  });
});

describe('Performance Baseline (1M rows)', () => {
  const SIZE = 1_000_000;
  const DIMS = 10;

  it('ingest columnar - 1M rows', async () => {
    const data = generateColumnarData(SIZE, DIMS);
    const start = performance.now();

    const cf = crossfilterX(data, { bins: 4096 });
    await cf.whenIdle();

    const elapsed = performance.now() - start;
    console.log(`[BASELINE] Ingest ${SIZE.toLocaleString()} rows: ${elapsed.toFixed(2)}ms`);

    cf.dispose();
  });

  it('filter with index - 1M rows', async () => {
    const data = generateColumnarData(SIZE, DIMS);
    const cf = crossfilterX(data);
    await cf.whenIdle();

    const dim = cf.dimension('dim0');
    await dim;
    await cf.buildIndex('dim0');
    await cf.whenIdle();

    const start = performance.now();
    dim.filter([100, 200]);
    await cf.whenIdle();
    const elapsed = performance.now() - start;

    console.log(`[BASELINE] Filter ${SIZE.toLocaleString()} rows: ${elapsed.toFixed(2)}ms`);
    cf.dispose();
  });

  it('clear filter (recompute) - 1M rows', async () => {
    const data = generateColumnarData(SIZE, DIMS);
    const cf = crossfilterX(data);
    await cf.whenIdle();

    const dim0 = cf.dimension('dim0');
    const dim1 = cf.dimension('dim1');
    await Promise.all([dim0, dim1]);

    dim0.filter([100, 200]);
    dim1.filter([300, 400]);
    await cf.whenIdle();

    const start = performance.now();
    dim0.clear();
    await cf.whenIdle();
    const elapsed = performance.now();

    console.log(`[BASELINE] Clear recompute ${SIZE.toLocaleString()} rows: ${elapsed.toFixed(2)}ms`);
    cf.dispose();
  });
});
