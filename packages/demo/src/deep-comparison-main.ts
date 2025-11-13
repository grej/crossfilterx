/**
 * Deep Comparison: CrossfilterX vs Crossfilter2
 *
 * Comprehensive benchmarking across different dataset sizes and dimensionalities
 */

import { crossfilterX } from '@crossfilterx/core';

// @ts-ignore - crossfilter2 is loaded via CDN
const crossfilter = window.crossfilter;

interface BenchmarkConfig {
  size: number;
  dimensions: number;
}

interface BenchmarkMetrics {
  ingestTime: number;
  firstFilterTime: number;
  avgFilterTime: number;
  groupAllTime: number;
  dimensionSize: number;
  memoryUsed: number | null;
  throughput: number;
}

interface BenchmarkResult {
  config: BenchmarkConfig;
  crossfilterX: BenchmarkMetrics;
  crossfilter2: BenchmarkMetrics;
  timestamp: string;
}

const allResults: BenchmarkResult[] = [];

// Expose results for testing
(window as any).allResults = allResults;

// UI Elements
const runBenchmarkBtn = document.getElementById('run-benchmark')!;
const runAllSizesBtn = document.getElementById('run-all-sizes')!;
const runAllDimensionsBtn = document.getElementById('run-all-dimensions')!;
const exportResultsBtn = document.getElementById('export-results')!;
const statusBar = document.getElementById('status-bar')!;
const statusText = document.getElementById('status-text')!;
const resultsDiv = document.getElementById('results')!;
const cfxMetricsTable = document.getElementById('cfx-metrics')!;
const cfMetricsTable = document.getElementById('cf-metrics')!;
const summaryGrid = document.getElementById('summary-grid')!;
const cfxResults = document.getElementById('cfx-results')!;
const cfResults = document.getElementById('cf-results')!;
const cfxBadge = document.getElementById('cfx-badge')!;

// Event Listeners
runBenchmarkBtn.addEventListener('click', async () => {
  const config = getCurrentConfig();
  await runSingleBenchmark(config);
});

runAllSizesBtn.addEventListener('click', async () => {
  const sizes = [1000, 10000, 50000, 100000, 250000, 500000];
  const dimensions = getCurrentConfig().dimensions;

  disableButtons();

  for (const size of sizes) {
    await runSingleBenchmark({ size, dimensions });
    await sleep(1000); // Brief pause between benchmarks
  }

  enableButtons();
  updateStatus('Completed all size benchmarks', true);
});

runAllDimensionsBtn.addEventListener('click', async () => {
  const dimensionCounts = [2, 4, 8, 16];
  const size = getCurrentConfig().size;

  disableButtons();

  for (const dimensions of dimensionCounts) {
    await runSingleBenchmark({ size, dimensions });
    await sleep(1000);
  }

  enableButtons();
  updateStatus('Completed all dimension benchmarks', true);
});

exportResultsBtn.addEventListener('click', () => {
  if (allResults.length === 0) {
    alert('No results to export. Run some benchmarks first!');
    return;
  }

  const json = JSON.stringify(allResults, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `crossfilterx-comparison-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

// Helper Functions
function getCurrentConfig(): BenchmarkConfig {
  const sizeInput = document.querySelector<HTMLInputElement>('input[name="size"]:checked')!;
  const dimInput = document.querySelector<HTMLInputElement>('input[name="dimensions"]:checked')!;

  return {
    size: parseInt(sizeInput.value),
    dimensions: parseInt(dimInput.value),
  };
}

function updateStatus(message: string, complete: boolean = false) {
  statusBar.style.display = 'block';
  statusText.textContent = message;
  statusBar.className = complete ? 'status-bar complete' : 'status-bar running';
}

function disableButtons() {
  runBenchmarkBtn.disabled = true;
  runAllSizesBtn.disabled = true;
  runAllDimensionsBtn.disabled = true;
}

function enableButtons() {
  runBenchmarkBtn.disabled = false;
  runAllSizesBtn.disabled = false;
  runAllDimensionsBtn.disabled = false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Data Generation
function generateData(size: number, dimensions: number): any[] {
  console.log(`Generating ${size} rows with ${dimensions} dimensions...`);

  const baseSize = Math.min(size, 10000); // Generate base data
  const baseData: any[] = [];

  for (let i = 0; i < baseSize; i++) {
    const row: any = { id: i };

    for (let d = 0; d < dimensions; d++) {
      // Create different value distributions for different dimensions
      if (d % 4 === 0) {
        // Uniform distribution (hour-like)
        row[`dim${d}`] = Math.floor(Math.random() * 24);
      } else if (d % 4 === 1) {
        // Normal distribution (delay-like)
        row[`dim${d}`] = Math.floor(randomNormal(5, 25, -60, 150));
      } else if (d % 4 === 2) {
        // Skewed distribution (distance-like)
        row[`dim${d}`] = Math.floor(randomNormal(700, 400, 50, 2000));
      } else {
        // Date-like (sequential with noise)
        row[`dim${d}`] = Math.floor((i / baseSize) * 90 + Math.random() * 10);
      }
    }

    baseData.push(row);
  }

  // If we need more rows, copy base data (as user suggested)
  if (size > baseSize) {
    const data: any[] = [];
    const copies = Math.ceil(size / baseSize);

    for (let c = 0; c < copies; c++) {
      for (let i = 0; i < baseSize && data.length < size; i++) {
        const row = { ...baseData[i], id: data.length };
        data.push(row);
      }
    }

    console.log(`Generated ${data.length} rows by copying base data`);
    return data;
  }

  return baseData;
}

function randomNormal(mean: number, std: number, min?: number, max?: number): number {
  let u = 0,
    v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  let result = mean + std * num;
  if (min !== undefined) result = Math.max(min, result);
  if (max !== undefined) result = Math.min(max, result);
  return result;
}

// Benchmarking
async function runSingleBenchmark(config: BenchmarkConfig): Promise<void> {
  updateStatus(`Running benchmark: ${config.size.toLocaleString()} rows, ${config.dimensions} dimensions`);
  disableButtons();

  // Generate data
  const data = generateData(config.size, config.dimensions);

  // Run CrossfilterX benchmark
  updateStatus(`Testing CrossfilterX (${config.size.toLocaleString()} rows, ${config.dimensions} dims)...`);
  const cfxMetrics = await benchmarkCrossfilterX(data, config.dimensions);

  // Run Crossfilter2 benchmark
  updateStatus(`Testing Crossfilter2 (${config.size.toLocaleString()} rows, ${config.dimensions} dims)...`);
  const cfMetrics = await benchmarkCrossfilter2(data, config.dimensions);

  // Store results
  const result: BenchmarkResult = {
    config,
    crossfilterX: cfxMetrics,
    crossfilter2: cfMetrics,
    timestamp: new Date().toISOString(),
  };

  allResults.push(result);

  // Display results
  displayResults(result);

  enableButtons();
  updateStatus(
    `Completed: ${config.size.toLocaleString()} rows, ${config.dimensions} dimensions`,
    true
  );

  console.log('Benchmark Result:', result);
}

async function benchmarkCrossfilterX(data: any[], dimensionCount: number): Promise<BenchmarkMetrics> {
  const getMemory = () => {
    if ('memory' in performance) {
      return (performance as any).memory.usedJSHeapSize;
    }
    return null;
  };

  const initialMemory = getMemory();

  // Ingest
  const ingestStart = performance.now();
  const cfx = crossfilterX(data, { bins: 1024 });

  // Create dimensions
  const dimensions: any[] = [];
  const groups: any[] = [];

  for (let i = 0; i < dimensionCount; i++) {
    dimensions.push(cfx.dimension(`dim${i}`));
    groups.push(cfx.group(`dim${i}`));
  }

  await cfx.whenIdle();
  const ingestTime = performance.now() - ingestStart;

  // First filter
  const firstFilterStart = performance.now();
  dimensions[0].filter([200, 800]);
  await cfx.whenIdle();
  const firstFilterTime = performance.now() - firstFilterStart;

  dimensions[0].clear();
  await cfx.whenIdle();

  // Average filter time (20 operations)
  const filterTimings: number[] = [];
  for (let i = 0; i < 20; i++) {
    const dim = dimensions[i % dimensionCount];
    const start = performance.now();
    dim.filter([Math.random() * 500, 500 + Math.random() * 500]);
    await cfx.whenIdle();
    filterTimings.push(performance.now() - start);
    dim.clear();
    await cfx.whenIdle();
  }

  const avgFilterTime = filterTimings.reduce((a, b) => a + b, 0) / filterTimings.length;

  // Group all time
  const groupAllStart = performance.now();
  const bins = groups[0].bins();
  const count = bins.reduce((sum, val) => sum + val, 0);
  const groupAllTime = performance.now() - groupAllStart;

  const finalMemory = getMemory();
  const memoryUsed = finalMemory && initialMemory ? finalMemory - initialMemory : null;

  return {
    ingestTime,
    firstFilterTime,
    avgFilterTime,
    groupAllTime,
    dimensionSize: count,
    memoryUsed,
    throughput: data.length / (ingestTime / 1000),
  };
}

async function benchmarkCrossfilter2(data: any[], dimensionCount: number): Promise<BenchmarkMetrics> {
  const getMemory = () => {
    if ('memory' in performance) {
      return (performance as any).memory.usedJSHeapSize;
    }
    return null;
  };

  const initialMemory = getMemory();

  // Ingest
  const ingestStart = performance.now();
  const cf = crossfilter(data);

  // Create dimensions
  const dimensions: any[] = [];
  const groups: any[] = [];

  for (let i = 0; i < dimensionCount; i++) {
    dimensions.push(cf.dimension((d: any) => d[`dim${i}`]));
    groups.push(dimensions[i].group());
  }

  const ingestTime = performance.now() - ingestStart;

  // First filter
  const firstFilterStart = performance.now();
  dimensions[0].filter([200, 800]);
  const firstFilterTime = performance.now() - firstFilterStart;

  dimensions[0].filterAll();

  // Average filter time (20 operations)
  const filterTimings: number[] = [];
  for (let i = 0; i < 20; i++) {
    const dim = dimensions[i % dimensionCount];
    const start = performance.now();
    dim.filter([Math.random() * 500, 500 + Math.random() * 500]);
    filterTimings.push(performance.now() - start);
    dim.filterAll();
  }

  const avgFilterTime = filterTimings.reduce((a, b) => a + b, 0) / filterTimings.length;

  // Group all time
  const groupAllStart = performance.now();
  const count = cf.groupAll().value();
  const groupAllTime = performance.now() - groupAllStart;

  const finalMemory = getMemory();
  const memoryUsed = finalMemory && initialMemory ? finalMemory - initialMemory : null;

  return {
    ingestTime,
    firstFilterTime,
    avgFilterTime,
    groupAllTime,
    dimensionSize: count,
    memoryUsed,
    throughput: data.length / (ingestTime / 1000),
  };
}

// Display Results
function displayResults(result: BenchmarkResult): void {
  resultsDiv.style.display = 'block';

  // Clear previous results
  cfxMetricsTable.innerHTML = '';
  cfMetricsTable.innerHTML = '';

  // CrossfilterX metrics
  addMetricRow(cfxMetricsTable, 'Ingest Time', formatTime(result.crossfilterX.ingestTime), '');
  addMetricRow(cfxMetricsTable, 'Throughput', formatThroughput(result.crossfilterX.throughput), '');
  addMetricRow(
    cfxMetricsTable,
    'First Filter',
    formatTime(result.crossfilterX.firstFilterTime),
    ''
  );
  addMetricRow(
    cfxMetricsTable,
    'Avg Filter (20 ops)',
    formatTime(result.crossfilterX.avgFilterTime),
    ''
  );
  addMetricRow(
    cfxMetricsTable,
    'Group All Time',
    formatTime(result.crossfilterX.groupAllTime),
    ''
  );
  if (result.crossfilterX.memoryUsed !== null) {
    addMetricRow(
      cfxMetricsTable,
      'Memory Used',
      formatMemory(result.crossfilterX.memoryUsed),
      ''
    );
  }

  // Crossfilter2 metrics
  addMetricRow(
    cfMetricsTable,
    'Ingest Time',
    formatTime(result.crossfilter2.ingestTime),
    getComparison(result.crossfilter2.ingestTime, result.crossfilterX.ingestTime, false)
  );
  addMetricRow(
    cfMetricsTable,
    'Throughput',
    formatThroughput(result.crossfilter2.throughput),
    getComparison(result.crossfilter2.throughput, result.crossfilterX.throughput, true)
  );
  addMetricRow(
    cfMetricsTable,
    'First Filter',
    formatTime(result.crossfilter2.firstFilterTime),
    getComparison(result.crossfilter2.firstFilterTime, result.crossfilterX.firstFilterTime, false)
  );
  addMetricRow(
    cfMetricsTable,
    'Avg Filter (20 ops)',
    formatTime(result.crossfilter2.avgFilterTime),
    getComparison(result.crossfilter2.avgFilterTime, result.crossfilterX.avgFilterTime, false)
  );
  addMetricRow(
    cfMetricsTable,
    'Group All Time',
    formatTime(result.crossfilter2.groupAllTime),
    getComparison(result.crossfilter2.groupAllTime, result.crossfilterX.groupAllTime, false)
  );
  if (result.crossfilter2.memoryUsed !== null) {
    addMetricRow(
      cfMetricsTable,
      'Memory Used',
      formatMemory(result.crossfilter2.memoryUsed),
      getComparison(result.crossfilter2.memoryUsed, result.crossfilterX.memoryUsed || 0, false)
    );
  }

  // Determine overall winner
  const cfxFaster =
    result.crossfilterX.avgFilterTime < result.crossfilter2.avgFilterTime &&
    result.crossfilterX.ingestTime < result.crossfilter2.ingestTime * 1.1; // Allow 10% margin on ingest

  if (cfxFaster) {
    cfxResults.classList.add('winner');
    cfResults.classList.remove('winner');
    cfxBadge.textContent = '🏆 WINNER';
    cfxBadge.className = 'badge winner';
  } else {
    cfResults.classList.add('winner');
    cfxResults.classList.remove('winner');
    cfxBadge.textContent = 'NEW';
    cfxBadge.className = 'badge';
  }

  // Summary
  displaySummary(result);
}

function addMetricRow(table: HTMLElement, label: string, value: string, diff: string): void {
  const row = document.createElement('tr');
  row.innerHTML = `
    <td>${label}</td>
    <td class="metric-value">${value}</td>
    <td style="font-size: 0.8rem; opacity: 0.8;">${diff}</td>
  `;
  table.appendChild(row);
}

function displaySummary(result: BenchmarkResult): void {
  summaryGrid.innerHTML = '';

  // Ingest speedup
  const ingestSpeedup =
    result.crossfilter2.ingestTime / result.crossfilterX.ingestTime;
  addSummaryCard(
    'Ingest Speedup',
    `${ingestSpeedup.toFixed(2)}x`,
    ingestSpeedup >= 1 ? 'positive' : 'negative',
    ingestSpeedup >= 1 ? 'CrossfilterX faster' : 'Crossfilter2 faster'
  );

  // Filter speedup
  const filterSpeedup =
    result.crossfilter2.avgFilterTime / result.crossfilterX.avgFilterTime;
  addSummaryCard(
    'Filter Speedup',
    `${filterSpeedup.toFixed(2)}x`,
    filterSpeedup >= 1 ? 'positive' : 'negative',
    filterSpeedup >= 1 ? 'CrossfilterX faster' : 'Crossfilter2 faster'
  );

  // Throughput advantage
  const throughputAdvantage =
    ((result.crossfilterX.throughput - result.crossfilter2.throughput) /
      result.crossfilter2.throughput) *
    100;
  addSummaryCard(
    'Throughput Advantage',
    `${throughputAdvantage >= 0 ? '+' : ''}${throughputAdvantage.toFixed(1)}%`,
    throughputAdvantage >= 0 ? 'positive' : 'negative',
    'CrossfilterX vs Crossfilter2'
  );

  // Memory comparison
  if (result.crossfilterX.memoryUsed !== null && result.crossfilter2.memoryUsed !== null) {
    const memoryDiff =
      ((result.crossfilterX.memoryUsed - result.crossfilter2.memoryUsed) /
        result.crossfilter2.memoryUsed) *
      100;
    addSummaryCard(
      'Memory Difference',
      `${memoryDiff >= 0 ? '+' : ''}${memoryDiff.toFixed(1)}%`,
      memoryDiff <= 0 ? 'positive' : 'negative',
      'CrossfilterX vs Crossfilter2'
    );
  }
}

function addSummaryCard(
  label: string,
  value: string,
  diffClass: 'positive' | 'negative',
  description: string
): void {
  const card = document.createElement('div');
  card.className = 'summary-card';
  card.innerHTML = `
    <span class="label">${label}</span>
    <div class="value">${value}</div>
    <div class="diff ${diffClass}">${description}</div>
  `;
  summaryGrid.appendChild(card);
}

function getComparison(cfValue: number, cfxValue: number, higherBetter: boolean): string {
  const diff = higherBetter ? cfValue - cfxValue : cfxValue - cfValue;
  const percent = (Math.abs(diff) / cfValue) * 100;

  if (Math.abs(percent) < 1) return '~same';

  const better = diff < 0;
  const sign = better ? '↓' : '↑';
  const className = better ? 'better' : 'worse';

  return `<span class="${className}">${sign} ${percent.toFixed(1)}%</span>`;
}

function formatTime(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}μs`;
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatThroughput(rowsPerSec: number): string {
  if (rowsPerSec > 1000000) return `${(rowsPerSec / 1000000).toFixed(2)}M rows/s`;
  if (rowsPerSec > 1000) return `${(rowsPerSec / 1000).toFixed(2)}K rows/s`;
  return `${rowsPerSec.toFixed(0)} rows/s`;
}

function formatMemory(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return `${mb.toFixed(2)} MB`;
}

console.log('Deep Comparison Tool Ready');
console.log('Crossfilter2 available:', typeof crossfilter !== 'undefined');
