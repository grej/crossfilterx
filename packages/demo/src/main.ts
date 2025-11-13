import { crossfilterX } from '@crossfilterx/core';

type Flight = {
  carrier: number;
  distance: number;
  departure: number;
};

type Scale = {
  min: number;
  max: number;
};

const CARRIERS = ['AA', 'DL', 'UA', 'WN', 'B6', 'AS'];
const ROW_COUNT = Number(import.meta.env?.VITE_ROWS ?? 200_000);
const COLUMNAR_MODE = import.meta.env?.VITE_COLUMNAR === '1';
const BINS = 1024;

const distanceScale: Scale = { min: 50, max: 3000 };
const departureScale: Scale = { min: 0, max: 23 };

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing app container');

app.innerHTML = `
  <h1>CrossfilterX Airline Demo</h1>
  <section class="summary">
    <div class="summary-card" data-summary="rows">
      <span>Total Flights</span>
      <strong>–</strong>
    </div>
    <div class="summary-card" data-summary="filter">
      <span>Active Flights</span>
      <strong>–</strong>
    </div>
    <div class="summary-card" data-summary="delay">
      <span>Average Departure Hour</span>
      <strong>–</strong>
    </div>
    <div class="summary-card" data-summary="ingest">
      <span>Ingest Time</span>
      <strong>–</strong>
    </div>
    <div class="summary-card" data-summary="simd-cost">
      <span>SIMD Cost/Row</span>
      <strong>–</strong>
    </div>
    <div class="summary-card" data-summary="recompute-cost">
      <span>Recompute Cost/Row</span>
      <strong>–</strong>
    </div>
  </section>
  <section class="controls">
    <label>Distance Range</label>
    <input type="range" min="0" max="100" value="0" data-slider="min" />
    <input type="range" min="0" max="100" value="100" data-slider="max" />
    <button data-action="reset">Reset</button>
  </section>
  <section class="chart-wrapper">
    <div>
      <canvas width="640" height="220" data-chart="distance"></canvas>
      <div class="legend"><span>Short-haul</span><span>Long-haul</span></div>
    </div>
    <div>
      <canvas width="640" height="220" data-chart="carrier"></canvas>
      <div class="legend"><span>Carriers</span><span>Flights</span></div>
    </div>
  </section>
`;

const summaries = {
  rows: app.querySelector<HTMLDivElement>('[data-summary="rows"] strong')!,
  filter: app.querySelector<HTMLDivElement>('[data-summary="filter"] strong')!,
  delay: app.querySelector<HTMLDivElement>('[data-summary="delay"] strong')!,
  ingest: app.querySelector<HTMLDivElement>('[data-summary="ingest"] strong')!,
  simdCost: app.querySelector<HTMLDivElement>('[data-summary="simd-cost"] strong')!,
  recomputeCost: app.querySelector<HTMLDivElement>('[data-summary="recompute-cost"] strong')!,
};

const sliders = {
  min: app.querySelector<HTMLInputElement>('[data-slider="min"]')!,
  max: app.querySelector<HTMLInputElement>('[data-slider="max"]')!,
};
const resetButton = app.querySelector<HTMLButtonElement>('[data-action="reset"]')!;

const canvases = {
  distance: app.querySelector<HTMLCanvasElement>('[data-chart="distance"]')!,
  carrier: app.querySelector<HTMLCanvasElement>('[data-chart="carrier"]')!,
};
const overrideColumnar = Boolean((window as Record<string, unknown>).VITE_COLUMNAR_OVERRIDE);
const columnarActive = COLUMNAR_MODE || overrideColumnar;
const dataset = columnarActive ? generateFlightsColumnar(ROW_COUNT) : generateFlights(ROW_COUNT);
const ingestStart = performance.now();
const cf = crossfilterX(dataset, { bins: BINS });
const distanceDim = cf.dimension('distance');
const distanceGroup = cf.group('distance', { coarseTargetBins: 64 });
const carrierGroup = cf.group('carrier');
const departureGroup = cf.group('departure');

await cf.whenIdle();
const ingestDuration = performance.now() - ingestStart;
render();

sliders.min.addEventListener('input', () => updateDistanceFilter(true));
sliders.max.addEventListener('input', () => updateDistanceFilter(true));
sliders.min.addEventListener('change', () => updateDistanceFilter(false));
sliders.max.addEventListener('change', () => updateDistanceFilter(false));
resetButton.addEventListener('click', () => {
  sliders.min.value = '0';
  sliders.max.value = '100';
  distanceDim.clear();
  void cf.whenIdle().then(() => {
    const summaryLabel = document.querySelector<HTMLLabelElement>('label');
    if (summaryLabel) summaryLabel.textContent = 'Distance Range: 0 - 3,000 mi';
    render();
  });
});

function updateDistanceFilter(isCoarse = false) {
  const minPct = Math.min(Number(sliders.min.value), Number(sliders.max.value));
  const maxPct = Math.max(Number(sliders.min.value), Number(sliders.max.value));
  sliders.min.value = String(minPct);
  sliders.max.value = String(maxPct);
  const rangeDisplay = {
    min: Math.round(distanceScale.min + (minPct / 100) * (distanceScale.max - distanceScale.min)),
    max: Math.round(distanceScale.min + (maxPct / 100) * (distanceScale.max - distanceScale.min))
  };
  const label = document.querySelector<HTMLLabelElement>('label');
  if (label) {
    label.textContent = `Distance Range: ${formatNumber(rangeDisplay.min)} - ${formatNumber(
      rangeDisplay.max
    )} mi`;
  }
  const lo = scalePercentToBin(minPct / 100, distanceScale, BINS);
  const hi = scalePercentToBin(maxPct / 100, distanceScale, BINS);
  distanceDim.filter([lo, hi]);
  void cf.whenIdle().then(() => render(isCoarse));
}

function render(isCoarse = false) {
  const activeCount = sumBins(carrierGroup.bins());
  summaries.rows.textContent = formatNumber(ROW_COUNT);
  summaries.filter.textContent = `${formatNumber(activeCount)} (${((
    activeCount / ROW_COUNT
  ) * 100).toFixed(1)}%)`;
  summaries.delay.textContent = renderAverageHour();
  summaries.ingest.textContent = `${ingestDuration.toFixed(1)} ms (${columnarActive ? 'columnar' : 'rows'})`;
  updatePlannerSummary();

  const distanceBins = isCoarse ? distanceGroup.coarse()?.bins() : distanceGroup.bins();
  if (distanceBins) {
    drawHistogram(canvases.distance, downsample(distanceBins, 64), '#38bdf8');
  }
  drawBars(canvases.carrier, extractCarriers(), '#f97316');
}

let lastPlannerKey = '';
function updatePlannerSummary() {
  if (typeof cf.clearPlannerSnapshot !== 'function') {
    summaries.simdCost.textContent = '–';
    summaries.recomputeCost.textContent = '–';
    return;
  }
  const snapshot = cf.clearPlannerSnapshot();
  const key = `${snapshot.simdCostPerRow}:${snapshot.recomputeCostPerRow}:${snapshot.simdSamples}:${snapshot.recomputeSamples}`;
  if (key === lastPlannerKey) {
    if (snapshot.simdSamples === 0 || snapshot.recomputeSamples === 0) {
      setTimeout(updatePlannerSummary, 200);
    }
    return;
  }
  lastPlannerKey = key;
  summaries.simdCost.textContent = snapshot.simdSamples
    ? `${snapshot.simdCostPerRow.toExponential(2)} (${snapshot.simdSamples})`
    : '…';
  summaries.recomputeCost.textContent = snapshot.recomputeSamples
    ? `${snapshot.recomputeCostPerRow.toExponential(2)} (${snapshot.recomputeSamples})`
    : '…';
  if (snapshot.simdSamples === 0 || snapshot.recomputeSamples === 0) {
    setTimeout(updatePlannerSummary, 200);
  }
}

function renderAverageHour() {
  const bins = departureGroup.bins();
  let total = 0;
  let count = 0;
  for (let i = 0; i < bins.length; i++) {
    const value = bins[i];
    if (!value) continue;
    const hour = mapBinToValue(i, departureScale, BINS);
    total += hour * value;
    count += value;
  }
  const avg = count === 0 ? 0 : total / count;
  return `${avg.toFixed(1)}h`;
}

function extractCarriers() {
  const bins = carrierGroup.bins();
  const result: Array<{ label: string; value: number }> = [];
  for (let i = 0; i < bins.length; i++) {
    const count = bins[i];
    if (!count) continue;
    const carrierIndex = Math.round(mapBinToValue(i, { min: 0, max: CARRIERS.length - 1 }, BINS));
    const label = CARRIERS[carrierIndex] ?? `#${carrierIndex}`;
    const existing = result.find((entry) => entry.label === label);
    if (existing) existing.value += count;
    else result.push({ label, value: count });
  }
  return result;
}

function drawHistogram(canvas: HTMLCanvasElement, data: number[], color: string) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, width, height);
  const max = Math.max(...data, 1);
  const barWidth = width / data.length;
  ctx.fillStyle = color;
  data.forEach((value, index) => {
    const barHeight = (value / max) * (height - 12);
    ctx.fillRect(index * barWidth, height - barHeight, barWidth - 1, barHeight);
  });
}

function drawBars(canvas: HTMLCanvasElement, data: Array<{ label: string; value: number }>, color: string) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, width, height);
  const max = Math.max(...data.map((d) => d.value), 1);
  const barWidth = width / Math.max(data.length, 1);
  ctx.fillStyle = color;
  ctx.font = '12px system-ui';
  ctx.textAlign = 'center';
  ctx.fillStyle = color;
  data.forEach((row, index) => {
    const barHeight = (row.value / max) * (height - 24);
    const x = index * barWidth;
    ctx.globalAlpha = 0.9;
    ctx.fillRect(x + 4, height - barHeight - 16, barWidth - 8, barHeight);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(row.label, x + barWidth / 2, height - 4);
    ctx.fillStyle = color;
  });
}

function sumBins(bins: Uint32Array) {
  let total = 0;
  for (let i = 0; i < bins.length; i++) total += bins[i];
  return total;
}

function downsample(bins: Uint32Array, target: number) {
  const chunk = Math.max(1, Math.floor(bins.length / target));
  const output = new Array(Math.ceil(bins.length / chunk)).fill(0);
  for (let i = 0; i < bins.length; i++) {
    const index = Math.floor(i / chunk);
    output[index] += bins[i];
  }
  return output;
}

function scalePercentToBin(percent: number, scale: Scale, bits: number) {
  const value = scale.min + percent * (scale.max - scale.min);
  return quantizeValue(value, scale.min, scale.max, bits);
}

function mapBinToValue(bin: number, scale: Scale, bits: number) {
  const maxBin = (1 << bits) - 1;
  return scale.min + (bin / maxBin) * (scale.max - scale.min);
}

function generateFlights(count: number): Flight[] {
  const flights: Flight[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const carrier = Math.floor(Math.random() * CARRIERS.length);
    const distance = distanceScale.min + randomNormal(900, 450);
    const departure = Math.floor(
      clamp(
        departureScale.min + randomNormal(12, 4),
        departureScale.min,
        departureScale.max
      )
    );
    flights[i] = {
      carrier,
      distance: clamp(distance, distanceScale.min, distanceScale.max),
      departure,
    };
  }
  return flights;
}

function generateFlightsColumnar(count: number) {
  const carriers = new Uint16Array(count);
  const distances = new Float32Array(count);
  const departures = new Uint16Array(count);
  for (let i = 0; i < count; i++) {
    const carrier = Math.floor(Math.random() * CARRIERS.length);
    const distance = clamp(distanceScale.min + randomNormal(900, 450), distanceScale.min, distanceScale.max);
    const departure = Math.floor(
      clamp(
        departureScale.min + randomNormal(12, 4),
        departureScale.min,
        departureScale.max
      )
    );
    carriers[i] = carrier;
    distances[i] = distance;
    departures[i] = departure;
  }
  return {
    columns: {
      carrier: carriers,
      distance: distances,
      departure: departures
    },
    length: count
  };
}

function randomNormal(mean: number, std: number) {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + std * num;
}


function quantizeValue(value: number, min: number, max: number, bits: number) {
  if (max <= min) return 0;
  const range = (1 << bits) - 1;
  const clamped = Math.min(Math.max(value, min), max);
  const normalized = (clamped - min) / (max - min);
  return Math.round(normalized * range);
}
function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
}
const modeToggle = document.createElement('button');
modeToggle.textContent = `Switch to ${COLUMNAR_MODE ? 'row' : 'columnar'} mode`;
modeToggle.className = 'mode-toggle';
modeToggle.addEventListener('click', () => {
  if (COLUMNAR_MODE) {
    delete (window as Record<string, unknown>).VITE_COLUMNAR_OVERRIDE;
  } else {
    (window as Record<string, unknown>).VITE_COLUMNAR_OVERRIDE = true;
  }
  window.location.reload();
});
app.append(modeToggle);
