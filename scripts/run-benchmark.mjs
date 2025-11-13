#!/usr/bin/env node

/**
 * Node.js Benchmark Runner
 * Compares CrossfilterX vs Crossfilter2 performance
 */

import { crossfilterX } from '../packages/core/src/index.ts';
import crossfilter from 'crossfilter2';

// Random normal distribution
function randomNormal(mean, std, min, max) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  let result = mean + std * num;
  if (min !== undefined) result = Math.max(min, result);
  if (max !== undefined) result = Math.min(max, result);
  return result;
}

// Generate test data
function generateData(size, dimensions) {
  console.log(`\nGenerating ${size.toLocaleString()} rows with ${dimensions} dimensions...`);
  const baseSize = Math.min(size, 10000);
  const baseData = [];

  for (let i = 0; i < baseSize; i++) {
    const row = { id: i };
    for (let d = 0; d < dimensions; d++) {
      if (d % 4 === 0) {
        row[`dim${d}`] = Math.floor(Math.random() * 24);
      } else if (d % 4 === 1) {
        row[`dim${d}`] = Math.floor(randomNormal(5, 25, -60, 150));
      } else if (d % 4 === 2) {
        row[`dim${d}`] = Math.floor(randomNormal(700, 400, 50, 2000));
      } else {
        row[`dim${d}`] = Math.floor((i / baseSize) * 90 + Math.random() * 10);
      }
    }
    baseData.push(row);
  }

  if (size > baseSize) {
    const data = [];
    const copies = Math.ceil(size / baseSize);
    for (let c = 0; c < copies; c++) {
      for (let i = 0; i < baseSize && data.length < size; i++) {
        data.push({ ...baseData[i], id: data.length });
      }
    }
    return data;
  }
  return baseData;
}

// Benchmark CrossfilterX
async function benchmarkCrossfilterX(data, dimensionCount) {
  console.log('\n🚀 Benchmarking CrossfilterX...');

  const ingestStart = Date.now();
  const cfx = crossfilterX(data, { bins: 1024 });
  const dimensions = [];
  const groups = [];
  for (let i = 0; i < dimensionCount; i++) {
    dimensions.push(cfx.dimension(`dim${i}`));
    groups.push(cfx.group(`dim${i}`));
  }
  await cfx.whenIdle();
  const ingestTime = Date.now() - ingestStart;

  const firstFilterStart = Date.now();
  dimensions[0].filter([200, 800]);
  await cfx.whenIdle();
  const firstFilterTime = Date.now() - firstFilterStart;

  const filterTimings = [];
  for (let i = 0; i < 20; i++) {
    const dim = dimensions[i % dimensionCount];
    const start = Date.now();
    dim.filter([Math.random() * 500, 500 + Math.random() * 500]);
    await cfx.whenIdle();
    filterTimings.push(Date.now() - start);
    dim.clear();
    await cfx.whenIdle();
  }
  const avgFilterTime = filterTimings.reduce((a, b) => a + b, 0) / filterTimings.length;

  const groupAllStart = Date.now();
  const bins = groups[0].bins();
  const count = bins.reduce((sum, val) => sum + val, 0);
  const groupAllTime = Date.now() - groupAllStart;

  return {
    ingestTime,
    firstFilterTime,
    avgFilterTime,
    groupAllTime,
    dimensionSize: count,
    throughput: Math.round(data.length / (ingestTime / 1000))
  };
}

// Benchmark Crossfilter2
function benchmarkCrossfilter2(data, dimensionCount) {
  console.log('📊 Benchmarking Crossfilter2...');

  const ingestStart = Date.now();
  const cf = crossfilter(data);
  const dimensions = [];
  const groups = [];
  for (let i = 0; i < dimensionCount; i++) {
    dimensions.push(cf.dimension(d => d[`dim${i}`]));
    groups.push(dimensions[i].group());
  }
  const ingestTime = Date.now() - ingestStart;

  const firstFilterStart = Date.now();
  dimensions[0].filter([200, 800]);
  const firstFilterTime = Date.now() - firstFilterStart;

  const filterTimings = [];
  for (let i = 0; i < 20; i++) {
    const dim = dimensions[i % dimensionCount];
    const start = Date.now();
    const minVal = Math.random() * 500;
    const maxVal = 500 + Math.random() * 500;
    dim.filter([minVal, maxVal]);
    filterTimings.push(Date.now() - start);
    dim.filterAll();
  }
  const avgFilterTime = filterTimings.reduce((a, b) => a + b, 0) / filterTimings.length;

  const groupAllStart = Date.now();
  const allData = groups[0].all();
  const count = cf.groupAll().value();
  const groupAllTime = Date.now() - groupAllStart;

  return {
    ingestTime,
    firstFilterTime,
    avgFilterTime,
    groupAllTime,
    dimensionSize: count,
    throughput: Math.round(data.length / (ingestTime / 1000))
  };
}

// Display results
function displayResults(size, dimensions, cfxResults, cfResults) {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`  BENCHMARK RESULTS (${size.toLocaleString()} rows, ${dimensions} dimensions)`);
  console.log('═══════════════════════════════════════════════════════════\n');

  const metrics = [
    { name: 'Ingest Time', cfx: cfxResults.ingestTime, cf: cfResults.ingestTime, unit: 'ms', lower: true },
    { name: 'First Filter', cfx: cfxResults.firstFilterTime, cf: cfResults.firstFilterTime, unit: 'ms', lower: true },
    { name: 'Avg Filter (20 ops)', cfx: cfxResults.avgFilterTime, cf: cfResults.avgFilterTime, unit: 'ms', lower: true },
    { name: 'Group All Time', cfx: cfxResults.groupAllTime, cf: cfResults.groupAllTime, unit: 'ms', lower: true },
    { name: 'Throughput', cfx: cfxResults.throughput, cf: cfResults.throughput, unit: 'rows/s', lower: false },
  ];

  console.log('Metric                  CrossfilterX      Crossfilter2      Winner');
  console.log('─────────────────────── ───────────────── ───────────────── ─────────');

  for (const metric of metrics) {
    const cfxStr = `${metric.cfx.toFixed(2)} ${metric.unit}`.padEnd(17);
    const cfStr = `${metric.cf.toFixed(2)} ${metric.unit}`.padEnd(17);
    const winner = metric.lower
      ? (metric.cfx < metric.cf ? '✅ CFX' : '✅ CF2')
      : (metric.cfx > metric.cf ? '✅ CFX' : '✅ CF2');
    const speedup = metric.lower
      ? (metric.cf / metric.cfx).toFixed(2) + 'x'
      : (metric.cfx / metric.cf).toFixed(2) + 'x';

    console.log(`${metric.name.padEnd(23)} ${cfxStr} ${cfStr} ${winner} (${speedup})`);
  }

  const avgSpeedup = (cfResults.avgFilterTime / cfxResults.avgFilterTime).toFixed(2);
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`  Overall Filter Speedup: ${avgSpeedup}x ${avgSpeedup >= 1 ? '🚀' : '⚠️'}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  return {
    config: { size, dimensions },
    crossfilterX: cfxResults,
    crossfilter2: cfResults,
    speedup: parseFloat(avgSpeedup),
    timestamp: new Date().toISOString()
  };
}

// Main benchmark runner
async function runBenchmark(size, dimensions) {
  const data = generateData(size, dimensions);

  const cfxResults = await benchmarkCrossfilterX(data, dimensions);
  const cfResults = benchmarkCrossfilter2(data, dimensions);

  return displayResults(size, dimensions, cfxResults, cfResults);
}

// Run benchmarks
async function main() {
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║  CrossfilterX vs Crossfilter2 Performance Comparison     ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');

  const configs = [
    { size: 10000, dimensions: 4, name: 'Small Dataset' },
    { size: 50000, dimensions: 4, name: 'Medium Dataset (Default)' },
    { size: 100000, dimensions: 4, name: 'Large Dataset' },
  ];

  const allResults = [];

  for (const config of configs) {
    console.log(`\n\n▶ Running: ${config.name}`);
    const result = await runBenchmark(config.size, config.dimensions);
    allResults.push(result);

    // Give a moment between benchmarks
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║  SUMMARY ACROSS ALL TESTS                                 ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  for (const result of allResults) {
    const speedup = result.speedup >= 1 ? '🚀 FASTER' : '⚠️ SLOWER';
    console.log(`${result.config.size.toLocaleString().padStart(7)} rows: ${result.speedup.toFixed(2)}x ${speedup}`);
  }

  const avgSpeedup = (allResults.reduce((sum, r) => sum + r.speedup, 0) / allResults.length).toFixed(2);
  console.log(`\nAverage Speedup: ${avgSpeedup}x ${avgSpeedup >= 1 ? '🚀' : '⚠️'}\n`);

  // Save results
  const fs = await import('fs');
  const resultsFile = 'benchmark-results.json';
  fs.promises.writeFile(resultsFile, JSON.stringify(allResults, null, 2));
  console.log(`\n✅ Results saved to ${resultsFile}\n`);
}

main().catch(console.error);
