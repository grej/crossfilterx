#!/usr/bin/env node

/**
 * Node.js Benchmark Runner
 * Compares CrossfilterX vs Crossfilter2 performance
 */

const crossfilter = require('crossfilter2');
const fs = require('fs').promises;
const path = require('path');

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

// Benchmark Crossfilter2 only (CrossfilterX needs browser environment)
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
function displayResults(size, dimensions, cfResults) {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`  CROSSFILTER2 BASELINE (${size.toLocaleString()} rows, ${dimensions} dimensions)`);
  console.log('═══════════════════════════════════════════════════════════\n');

  const metrics = [
    { name: 'Ingest Time', value: cfResults.ingestTime, unit: 'ms' },
    { name: 'First Filter', value: cfResults.firstFilterTime, unit: 'ms' },
    { name: 'Avg Filter (20 ops)', value: cfResults.avgFilterTime, unit: 'ms' },
    { name: 'Group All Time', value: cfResults.groupAllTime, unit: 'ms' },
    { name: 'Throughput', value: cfResults.throughput, unit: 'rows/s' },
  ];

  console.log('Metric                  Value             Target for CFX');
  console.log('─────────────────────── ───────────────── ─────────────────────────');

  for (const metric of metrics) {
    const valueStr = `${metric.value.toFixed(2)} ${metric.unit}`.padEnd(17);
    let target = '';
    if (metric.name === 'Avg Filter (20 ops)') {
      const targetTime = (metric.value * 0.5).toFixed(2);
      target = `< ${targetTime} ms (2x faster)`;
    } else if (metric.name === 'Ingest Time') {
      const targetTime = (metric.value * 2).toFixed(2);
      target = `< ${targetTime} ms (within 2x)`;
    } else if (metric.name === 'Throughput') {
      const targetThroughput = (metric.value * 1.5).toFixed(0);
      target = `> ${targetThroughput} rows/s (1.5x faster)`;
    }

    console.log(`${metric.name.padEnd(23)} ${valueStr} ${target}`);
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`  Use these as baseline targets for CrossfilterX`);
  console.log('═══════════════════════════════════════════════════════════\n');

  return {
    config: { size, dimensions },
    crossfilter2: cfResults,
    timestamp: new Date().toISOString()
  };
}

// Main benchmark runner
async function runBenchmark(size, dimensions) {
  const data = generateData(size, dimensions);
  const cfResults = benchmarkCrossfilter2(data, dimensions);
  return displayResults(size, dimensions, cfResults);
}

// Run benchmarks
async function main() {
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║  Crossfilter2 Baseline Performance Measurement            ║');
  console.log('║  (CrossfilterX requires browser/WASM environment)         ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');

  const configs = [
    { size: 10000, dimensions: 4, name: 'Small Dataset (10K rows)' },
    { size: 50000, dimensions: 4, name: 'Medium Dataset (50K rows)' },
    { size: 100000, dimensions: 4, name: 'Large Dataset (100K rows)' },
  ];

  const allResults = [];

  for (const config of configs) {
    console.log(`\n\n▶ Running: ${config.name}`);
    const result = await runBenchmark(config.size, config.dimensions);
    allResults.push(result);

    // Give a moment between benchmarks
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║  SUMMARY - CROSSFILTER2 BASELINE                          ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  console.log('Dataset        Ingest    Avg Filter  Throughput');
  console.log('────────────── ───────── ─────────── ──────────────');
  for (const result of allResults) {
    const size = `${(result.config.size / 1000).toFixed(0)}K`.padEnd(14);
    const ingest = `${result.crossfilter2.ingestTime.toFixed(0)}ms`.padEnd(9);
    const filter = `${result.crossfilter2.avgFilterTime.toFixed(2)}ms`.padEnd(11);
    const throughput = `${result.crossfilter2.throughput.toLocaleString()} rows/s`;
    console.log(`${size} ${ingest} ${filter} ${throughput}`);
  }

  const avgFilterTime = (allResults.reduce((sum, r) => sum + r.crossfilter2.avgFilterTime, 0) / allResults.length).toFixed(2);
  console.log(`\nAvg Filter Time: ${avgFilterTime}ms (CrossfilterX should beat this)\n`);

  // Save results
  const resultsFile = path.join(__dirname, '..', 'crossfilter2-baseline.json');
  await fs.writeFile(resultsFile, JSON.stringify(allResults, null, 2));
  console.log(`✅ Baseline saved to ${path.basename(resultsFile)}`);
  console.log('\n📝 To compare with CrossfilterX, open:');
  console.log('   http://localhost:5173/standalone-benchmark.html\n');
}

main().catch(console.error);
