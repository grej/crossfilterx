/**
 * Side-by-side Comparison: CrossfilterX vs Original Crossfilter
 *
 * This demo compares CrossfilterX against the original Crossfilter library
 * to validate drop-in replacement compatibility and performance.
 */

import { crossfilterX } from '@crossfilterx/core';
import { drawHistogram, downsample, sumBins } from './charts';

type Flight = {
  hour: number;
  delay: number;
};

const ROW_COUNT = 50_000;
const BINS = 1024;

// Generate test data
const flights: Flight[] = [];
for (let i = 0; i < ROW_COUNT; i++) {
  flights[i] = {
    hour: Math.floor(randomNormal(12, 4, 0, 23)),
    delay: Math.floor(randomNormal(5, 25, -60, 150)),
  };
}

// Test results tracking
const testResults: Array<{ name: string; passed: boolean; message: string }> = [];

// Initialize CrossfilterX
console.log('Initializing CrossfilterX...');
const cfxStart = performance.now();
const cfx = crossfilterX(flights, { bins: BINS });
const cfxHourDim = cfx.dimension('hour');
const cfxDelayDim = cfx.dimension('delay');
const cfxHourGroup = cfx.group('hour', { coarseTargetBins: 24 });
const cfxDelayGroup = cfx.group('delay', { coarseTargetBins: 60 });

await cfx.whenIdle();
const cfxIngestTime = performance.now() - cfxStart;

console.log(`CrossfilterX ingest: ${cfxIngestTime.toFixed(2)}ms`);

// Update UI elements
const ui = {
  cfxIngest: document.querySelector('[data-metric="cfx-ingest"]')!,
  cfxFilter: document.querySelector('[data-metric="cfx-filter"]')!,
  cfxTotal: document.querySelector('[data-summary="cfx-total"]')!,
  cfxActive: document.querySelector('[data-summary="cfx-active"]')!,
  cfxHourCanvas: document.querySelector<HTMLCanvasElement>('[data-chart="cfx-hour"]')!,
  cfxDelayCanvas: document.querySelector<HTMLCanvasElement>('[data-chart="cfx-delay"]')!,

  cfIngest: document.querySelector('[data-metric="cf-ingest"]')!,
  cfFilter: document.querySelector('[data-metric="cf-filter"]')!,
  cfTotal: document.querySelector('[data-summary="cf-total"]')!,
  cfActive: document.querySelector('[data-summary="cf-active"]')!,
  cfHourCanvas: document.querySelector<HTMLCanvasElement>('[data-chart="cf-hour"]')!,
  cfDelayCanvas: document.querySelector<HTMLCanvasElement>('[data-chart="cf-delay"]')!,

  testResults: document.getElementById('test-results-container')!,
};

ui.cfxIngest.textContent = `${cfxIngestTime.toFixed(1)} ms`;
ui.cfxTotal.textContent = formatNumber(ROW_COUNT);

// Original Crossfilter (if available)
let cfAvailable = false;
let cf: any = null;
let cfHourDim: any = null;
let cfDelayDim: any = null;
let cfHourGroup: any = null;
let cfDelayGroup: any = null;

// Try to load original crossfilter
try {
  // @ts-ignore - checking for crossfilter in window
  if (typeof window.crossfilter !== 'undefined') {
    // @ts-ignore
    const crossfilterLib = window.crossfilter;

    console.log('Initializing Crossfilter...');
    const cfStart = performance.now();
    cf = crossfilterLib(flights);
    cfHourDim = cf.dimension((d: Flight) => d.hour);
    cfDelayDim = cf.dimension((d: Flight) => d.delay);
    cfHourGroup = cfHourDim.group();
    cfDelayGroup = cfDelayDim.group();
    const cfIngestTime = performance.now() - cfStart;

    console.log(`Crossfilter ingest: ${cfIngestTime.toFixed(2)}ms`);

    ui.cfIngest.textContent = `${cfIngestTime.toFixed(1)} ms`;
    ui.cfTotal.textContent = formatNumber(ROW_COUNT);

    cfAvailable = true;

    // Highlight faster implementation
    if (cfxIngestTime < cfIngestTime) {
      document.getElementById('cfx-ingest-metric')?.classList.add('winner');
    } else {
      document.getElementById('cf-ingest-metric')?.classList.add('winner');
    }
  } else {
    console.warn('Original Crossfilter not available. Add it to test comparison.');
    ui.cfIngest.textContent = 'N/A';
    ui.cfTotal.textContent = 'N/A';
    ui.cfActive.textContent = 'N/A';
    ui.cfFilter.textContent = 'N/A';
  }
} catch (e) {
  console.error('Failed to initialize Crossfilter:', e);
}

// Render initial state
renderCrossfilterX();
if (cfAvailable) {
  renderCrossfilter();
}

// Test Controls
document.getElementById('test-rapid-filter')?.addEventListener('click', async () => {
  await runRapidFilterTest();
  displayTestResults();
});

document.getElementById('test-concurrent')?.addEventListener('click', async () => {
  await runConcurrentOpsTest();
  displayTestResults();
});

document.getElementById('test-memory')?.addEventListener('click', async () => {
  await runMemoryTest();
  displayTestResults();
});

document.getElementById('reset-all')?.addEventListener('click', async () => {
  cfxHourDim.clear();
  cfxDelayDim.clear();
  if (cfAvailable) {
    cfHourDim.filterAll();
    cfDelayDim.filterAll();
  }
  await cfx.whenIdle();
  renderCrossfilterX();
  if (cfAvailable) {
    renderCrossfilter();
  }
});

// Rendering functions
function renderCrossfilterX() {
  const hourBins = downsample(cfxHourGroup.bins(), 24);
  const delayBins = downsample(cfxDelayGroup.bins(), 60);

  drawHistogram(ui.cfxHourCanvas, hourBins, '#38bdf8');
  drawHistogram(ui.cfxDelayCanvas, delayBins, '#f97316');

  const active = sumBins(cfxHourGroup.bins());
  ui.cfxActive.textContent = formatNumber(active);
}

function renderCrossfilter() {
  if (!cfAvailable) return;

  // Get bins from crossfilter groups
  const hourData = cfHourGroup.all();
  const delayData = cfDelayGroup.all();

  // Convert to histogram format
  const hourBins = new Array(24).fill(0);
  hourData.forEach((d: any) => {
    const bin = Math.min(23, Math.max(0, Math.floor(d.key)));
    hourBins[bin] = d.value;
  });

  const delayBins = new Array(60).fill(0);
  delayData.forEach((d: any) => {
    const bin = Math.min(59, Math.max(0, Math.floor((d.key + 60) / 3.5)));
    delayBins[bin] = d.value;
  });

  drawHistogram(ui.cfHourCanvas, hourBins, '#38bdf8');
  drawHistogram(ui.cfDelayCanvas, delayBins, '#f97316');

  const active = cf.groupAll().value();
  ui.cfActive.textContent = formatNumber(active);
}

// Test implementations
async function runRapidFilterTest(): Promise<void> {
  console.log('Running rapid filter test...');

  // Test CrossfilterX
  const cfxTimings = [];
  for (let i = 0; i < 50; i++) {
    const start = performance.now();
    cfxHourDim.filter([100 + i * 20, 900 - i * 10]);
    await cfx.whenIdle();
    cfxTimings.push(performance.now() - start);
  }

  cfxHourDim.clear();
  await cfx.whenIdle();

  const cfxAvg = cfxTimings.reduce((a, b) => a + b, 0) / cfxTimings.length;
  console.log(`CrossfilterX rapid filter avg: ${cfxAvg.toFixed(2)}ms`);
  ui.cfxFilter.textContent = `${cfxAvg.toFixed(1)} ms`;

  // Test original Crossfilter
  let cfAvg = 0;
  if (cfAvailable) {
    const cfTimings = [];
    for (let i = 0; i < 50; i++) {
      const start = performance.now();
      const minHour = (100 + i * 20) / 1024 * 23;
      const maxHour = (900 - i * 10) / 1024 * 23;
      cfHourDim.filter([minHour, maxHour]);
      cfTimings.push(performance.now() - start);
    }

    cfHourDim.filterAll();
    cfAvg = cfTimings.reduce((a, b) => a + b, 0) / cfTimings.length;
    console.log(`Crossfilter rapid filter avg: ${cfAvg.toFixed(2)}ms`);
    ui.cfFilter.textContent = `${cfAvg.toFixed(1)} ms`;

    // Highlight winner
    if (cfxAvg < cfAvg) {
      document.getElementById('cfx-filter-metric')?.classList.add('winner');
    } else {
      document.getElementById('cf-filter-metric')?.classList.add('winner');
    }
  }

  testResults.push({
    name: 'Rapid Filter Test (50 operations)',
    passed: cfAvailable ? cfxAvg < cfAvg * 1.5 : true,
    message: cfAvailable
      ? `CrossfilterX: ${cfxAvg.toFixed(2)}ms, Crossfilter: ${cfAvg.toFixed(2)}ms`
      : `CrossfilterX: ${cfxAvg.toFixed(2)}ms (no comparison available)`,
  });

  renderCrossfilterX();
  if (cfAvailable) renderCrossfilter();
}

async function runConcurrentOpsTest(): Promise<void> {
  console.log('Running concurrent operations test...');

  // CrossfilterX - concurrent filter operations
  const cfxStart = performance.now();
  const ops = [
    cfxHourDim.filter([200, 800]),
    cfxDelayDim.filter([300, 700]),
  ];

  await Promise.all(ops);
  await cfx.whenIdle();
  const cfxTime = performance.now() - cfxStart;

  const cfxActive = sumBins(cfxHourGroup.bins());

  cfxHourDim.clear();
  cfxDelayDim.clear();
  await cfx.whenIdle();

  console.log(`CrossfilterX concurrent ops: ${cfxTime.toFixed(2)}ms`);

  // Original Crossfilter
  let cfTime = 0;
  let cfActive = 0;
  if (cfAvailable) {
    const cfStart = performance.now();
    cfHourDim.filter([200 / 1024 * 23, 800 / 1024 * 23]);
    cfDelayDim.filter([300 / 1024 * 210 - 60, 700 / 1024 * 210 - 60]);
    cfTime = performance.now() - cfStart;
    cfActive = cf.groupAll().value();

    cfHourDim.filterAll();
    cfDelayDim.filterAll();

    console.log(`Crossfilter concurrent ops: ${cfTime.toFixed(2)}ms`);
  }

  const dataConsistent = !cfAvailable || Math.abs(cfxActive - cfActive) / cfActive < 0.01;

  testResults.push({
    name: 'Concurrent Operations Test',
    passed: dataConsistent,
    message: cfAvailable
      ? `Data consistency: ${dataConsistent ? 'PASS' : 'FAIL'} (CFX: ${cfxActive}, CF: ${cfActive})`
      : `CrossfilterX: ${cfxTime.toFixed(2)}ms, ${cfxActive} rows`,
  });

  renderCrossfilterX();
  if (cfAvailable) renderCrossfilter();
}

async function runMemoryTest(): Promise<void> {
  console.log('Running memory test...');

  // Check if memory API is available
  const hasMemoryAPI = 'memory' in performance;

  if (!hasMemoryAPI) {
    testResults.push({
      name: 'Memory Test',
      passed: true,
      message: 'Memory API not available in this browser',
    });
    return;
  }

  const getMemory = () => (performance as any).memory.usedJSHeapSize;

  // CrossfilterX memory test
  const cfxInitial = getMemory();

  for (let i = 0; i < 100; i++) {
    cfxHourDim.filter([Math.random() * 500, 500 + Math.random() * 500]);
    await cfx.whenIdle();
  }

  cfxHourDim.clear();
  await cfx.whenIdle();

  const cfxFinal = getMemory();
  const cfxGrowth = (cfxFinal - cfxInitial) / 1024 / 1024;

  console.log(`CrossfilterX memory growth: ${cfxGrowth.toFixed(2)}MB`);

  // Original Crossfilter memory test
  let cfGrowth = 0;
  if (cfAvailable) {
    const cfInitial = getMemory();

    for (let i = 0; i < 100; i++) {
      const min = Math.random() * 500 / 1024 * 23;
      const max = (500 + Math.random() * 500) / 1024 * 23;
      cfHourDim.filter([min, max]);
    }

    cfHourDim.filterAll();

    const cfFinal = getMemory();
    cfGrowth = (cfFinal - cfInitial) / 1024 / 1024;

    console.log(`Crossfilter memory growth: ${cfGrowth.toFixed(2)}MB`);
  }

  const memoryHealthy = cfxGrowth < 20; // Less than 20MB growth is reasonable

  testResults.push({
    name: 'Memory Stability Test (100 operations)',
    passed: memoryHealthy,
    message: cfAvailable
      ? `CrossfilterX: ${cfxGrowth.toFixed(2)}MB, Crossfilter: ${cfGrowth.toFixed(2)}MB`
      : `CrossfilterX: ${cfxGrowth.toFixed(2)}MB`,
  });

  renderCrossfilterX();
  if (cfAvailable) renderCrossfilter();
}

function displayTestResults() {
  const html = testResults
    .map(
      (test) => `
    <div class="test-item">
      <span>${test.name}</span>
      <span class="status ${test.passed ? 'pass' : 'fail'}">
        ${test.passed ? '✓ PASS' : '✗ FAIL'}
      </span>
    </div>
    <div style="padding: 0.5rem 0.75rem; font-size: 0.8rem; opacity: 0.8;">
      ${test.message}
    </div>
  `
    )
    .join('');

  ui.testResults.innerHTML = html;
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

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}
