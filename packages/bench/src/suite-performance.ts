/**
 * @fileoverview Comprehensive performance benchmark suite for CrossfilterX
 * Tests various operations at different dataset sizes to validate optimizations
 */

import { crossfilterX } from '../../core/src/index';
import type { ColumnarData } from '../../core/src/types';

// Benchmark configuration
const SIZES = [100_000, 500_000, 1_000_000];
const DIMENSIONS = 10;
const ITERATIONS = 5; // Run each test multiple times for stable results

// Results tracking
type BenchmarkResult = {
  operation: string;
  size: number;
  iteration: number;
  timeMs: number;
  memoryMB?: number;
};

const results: BenchmarkResult[] = [];

// Utility: Generate synthetic dataset
function generateColumnarData(rows: number, dims: number): ColumnarData {
  const columns: Record<string, Uint16Array> = {};

  for (let d = 0; d < dims; d++) {
    const data = new Uint16Array(rows);
    for (let i = 0; i < rows; i++) {
      // Generate somewhat realistic distribution
      data[i] = Math.floor(Math.random() * 4096);
    }
    columns[`dim${d}`] = data;
  }

  return { columns, length: rows };
}

// Utility: Measure memory if available
function getMemoryMB(): number | undefined {
  if (typeof performance !== 'undefined' && (performance as any).memory) {
    return (performance as any).memory.usedJSHeapSize / 1_048_576;
  }
  return undefined;
}

// Utility: Force GC if available (Node.js)
function tryGC() {
  if (typeof global !== 'undefined' && (global as any).gc) {
    (global as any).gc();
  }
}

// Utility: Format results
function formatResults(results: BenchmarkResult[]) {
  const byOperation = new Map<string, BenchmarkResult[]>();

  for (const result of results) {
    const key = `${result.operation}_${result.size}`;
    if (!byOperation.has(key)) {
      byOperation.set(key, []);
    }
    byOperation.get(key)!.push(result);
  }

  console.log('\n========================================');
  console.log('BENCHMARK RESULTS');
  console.log('========================================\n');

  for (const [key, values] of byOperation) {
    const times = values.map(v => v.timeMs);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);
    const stdDev = Math.sqrt(
      times.map(t => Math.pow(t - avg, 2)).reduce((a, b) => a + b, 0) / times.length
    );

    const memoryValues = values.map(v => v.memoryMB).filter(m => m !== undefined);
    const avgMemory = memoryValues.length > 0
      ? memoryValues.reduce((a, b) => a! + b!, 0)! / memoryValues.length
      : undefined;

    console.log(`${key}:`);
    console.log(`  avg: ${avg.toFixed(2)}ms ± ${stdDev.toFixed(2)}ms`);
    console.log(`  min: ${min.toFixed(2)}ms`);
    console.log(`  max: ${max.toFixed(2)}ms`);
    if (avgMemory !== undefined) {
      console.log(`  memory: ${avgMemory.toFixed(2)} MB`);
    }
    console.log('');
  }
}

// Benchmark 1: Ingest (columnar)
async function benchIngestColumnar(size: number, iteration: number) {
  tryGC();
  const data = generateColumnarData(size, DIMENSIONS);
  const memBefore = getMemoryMB();

  const start = performance.now();
  const cf = crossfilterX(data, { bins: 4096 });
  await cf.whenIdle();
  const elapsed = performance.now() - start;

  const memAfter = getMemoryMB();
  const memDelta = memBefore && memAfter ? memAfter - memBefore : undefined;

  results.push({
    operation: 'ingest_columnar',
    size,
    iteration,
    timeMs: elapsed,
    memoryMB: memDelta
  });

  cf.dispose();
  console.log(`  [${iteration + 1}/${ITERATIONS}] Ingest ${size.toLocaleString()} rows: ${elapsed.toFixed(2)}ms`);
}

// Benchmark 2: Filter (delta path with index)
async function benchFilterDelta(size: number, iteration: number) {
  const data = generateColumnarData(size, DIMENSIONS);
  const cf = crossfilterX(data, { bins: 4096 });
  await cf.whenIdle();

  const dim = cf.dimension('dim0');
  await dim;

  // Pre-build index
  await cf.buildIndex('dim0');
  await cf.whenIdle();

  tryGC();
  const start = performance.now();
  dim.filter([100, 200]);
  await cf.whenIdle();
  const elapsed = performance.now() - start;

  results.push({
    operation: 'filter_delta',
    size,
    iteration,
    timeMs: elapsed
  });

  cf.dispose();
  console.log(`  [${iteration + 1}/${ITERATIONS}] Filter delta ${size.toLocaleString()} rows: ${elapsed.toFixed(2)}ms`);
}

// Benchmark 3: Clear filter (delta path)
async function benchClearDelta(size: number, iteration: number) {
  const data = generateColumnarData(size, DIMENSIONS);
  const cf = crossfilterX(data, { bins: 4096 });
  await cf.whenIdle();

  const dim = cf.dimension('dim0');
  await dim;

  // Pre-build index
  await cf.buildIndex('dim0');
  await cf.whenIdle();

  // Apply filter first
  dim.filter([100, 200]);
  await cf.whenIdle();

  tryGC();
  const start = performance.now();
  dim.clear();
  await cf.whenIdle();
  const elapsed = performance.now() - start;

  results.push({
    operation: 'clear_delta',
    size,
    iteration,
    timeMs: elapsed
  });

  cf.dispose();
  console.log(`  [${iteration + 1}/${ITERATIONS}] Clear delta ${size.toLocaleString()} rows: ${elapsed.toFixed(2)}ms`);
}

// Benchmark 4: Clear filter (force recompute path)
async function benchClearRecompute(size: number, iteration: number) {
  const data = generateColumnarData(size, DIMENSIONS);
  const cf = crossfilterX(data, { bins: 4096 });
  await cf.whenIdle();

  const dim0 = cf.dimension('dim0');
  const dim1 = cf.dimension('dim1');
  await Promise.all([dim0, dim1]);

  // Apply multiple filters to force recompute path
  dim0.filter([100, 200]);
  dim1.filter([300, 400]);
  await cf.whenIdle();

  tryGC();
  const start = performance.now();
  dim0.clear();
  await cf.whenIdle();
  const elapsed = performance.now() - start;

  results.push({
    operation: 'clear_recompute',
    size,
    iteration,
    timeMs: elapsed
  });

  cf.dispose();
  console.log(`  [${iteration + 1}/${ITERATIONS}] Clear recompute ${size.toLocaleString()} rows: ${elapsed.toFixed(2)}ms`);
}

// Benchmark 5: Index build
async function benchIndexBuild(size: number, iteration: number) {
  const data = generateColumnarData(size, DIMENSIONS);
  const cf = crossfilterX(data, { bins: 4096 });
  await cf.whenIdle();

  const dim = cf.dimension('dim0');
  await dim;

  tryGC();
  const start = performance.now();
  await cf.buildIndex('dim0');
  const elapsed = performance.now() - start;

  results.push({
    operation: 'index_build',
    size,
    iteration,
    timeMs: elapsed
  });

  cf.dispose();
  console.log(`  [${iteration + 1}/${ITERATIONS}] Index build ${size.toLocaleString()} rows: ${elapsed.toFixed(2)}ms`);
}

// Benchmark 6: Multiple filters (multi-dimension interaction)
async function benchMultiFilter(size: number, iteration: number) {
  const data = generateColumnarData(size, DIMENSIONS);
  const cf = crossfilterX(data, { bins: 4096 });
  await cf.whenIdle();

  const dims = [];
  for (let i = 0; i < 5; i++) {
    dims.push(cf.dimension(`dim${i}`));
  }
  await Promise.all(dims);

  // Build indexes
  for (let i = 0; i < 5; i++) {
    await cf.buildIndex(`dim${i}`);
  }
  await cf.whenIdle();

  tryGC();
  const start = performance.now();

  // Apply 5 filters
  for (let i = 0; i < 5; i++) {
    dims[i].filter([i * 100, i * 100 + 50]);
  }
  await cf.whenIdle();

  const elapsed = performance.now() - start;

  results.push({
    operation: 'multi_filter',
    size,
    iteration,
    timeMs: elapsed
  });

  cf.dispose();
  console.log(`  [${iteration + 1}/${ITERATIONS}] Multi-filter (5 dims) ${size.toLocaleString()} rows: ${elapsed.toFixed(2)}ms`);
}

// Main benchmark runner
async function runBenchmarks() {
  console.log('========================================');
  console.log('CrossfilterX Performance Benchmark Suite');
  console.log('========================================\n');
  console.log(`Sizes: ${SIZES.map(s => s.toLocaleString()).join(', ')} rows`);
  console.log(`Dimensions: ${DIMENSIONS}`);
  console.log(`Iterations: ${ITERATIONS} per test\n`);

  for (const size of SIZES) {
    console.log(`\n--- Size: ${size.toLocaleString()} rows ---\n`);

    console.log('1. Ingest (columnar):');
    for (let i = 0; i < ITERATIONS; i++) {
      await benchIngestColumnar(size, i);
    }

    console.log('\n2. Filter (delta path):');
    for (let i = 0; i < ITERATIONS; i++) {
      await benchFilterDelta(size, i);
    }

    console.log('\n3. Clear (delta path):');
    for (let i = 0; i < ITERATIONS; i++) {
      await benchClearDelta(size, i);
    }

    console.log('\n4. Clear (recompute path):');
    for (let i = 0; i < ITERATIONS; i++) {
      await benchClearRecompute(size, i);
    }

    console.log('\n5. Index build:');
    for (let i = 0; i < ITERATIONS; i++) {
      await benchIndexBuild(size, i);
    }

    console.log('\n6. Multi-filter (5 dimensions):');
    for (let i = 0; i < ITERATIONS; i++) {
      await benchMultiFilter(size, i);
    }
  }

  formatResults(results);
  saveResults();
}

// Save results to JSON for comparison
function saveResults() {
  const summary = {
    timestamp: new Date().toISOString(),
    platform: typeof process !== 'undefined' ? 'node' : 'browser',
    results: results
  };

  if (typeof process !== 'undefined') {
    const fs = require('fs');
    const path = require('path');
    const filename = path.join(__dirname, `../../../benchmark-results-${Date.now()}.json`);
    fs.writeFileSync(filename, JSON.stringify(summary, null, 2));
    console.log(`\nResults saved to: ${filename}`);
  }
}

// Run if executed directly
if (typeof require !== 'undefined' && require.main === module) {
  runBenchmarks().catch(console.error);
}

export { runBenchmarks };
