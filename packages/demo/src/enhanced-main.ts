/**
 * Enhanced CrossfilterX Demo
 * Matches the official crossfilter demo with 4 interactive charts and flight table
 */

import { crossfilterX } from '@crossfilterx/core';
import { drawHistogram, sumBins, downsample, valueToBin, type ChartBrush } from './charts';

type Flight = {
  date: number;      // Days since epoch
  hour: number;      // Hour of day (0-23)
  delay: number;     // Arrival delay in minutes (-60 to 150)
  distance: number;  // Flight distance in miles
  origin: string;
  destination: string;
  carrierIndex: number;  // Carrier as index (for crossfilter)
  carrier: string;   // Carrier code for display
};

const BINS = 1024;
const BITS = 10; // log2(1024) = 10 bits
const ROW_COUNT = Number(import.meta.env?.VITE_ROWS ?? 50_000);
const COLUMNAR_MODE = import.meta.env?.VITE_COLUMNAR === '1';

const scales = {
  hour: { min: 0, max: 23 },
  delay: { min: -60, max: 150 },
  distance: { min: 0, max: 2000 },
  date: { min: 0, max: 89 }, // Jan-Mar 2001 (90 days)
};

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing app container');

app.innerHTML = `
  <h1>CrossfilterX Enhanced Demo</h1>

  <section class="summary">
    <div class="summary-card">
      <span>Total Flights</span>
      <strong data-summary="total">–</strong>
    </div>
    <div class="summary-card">
      <span>Active Flights</span>
      <strong data-summary="active">–</strong>
    </div>
    <div class="summary-card">
      <span>Avg Delay</span>
      <strong data-summary="delay">–</strong>
    </div>
    <div class="summary-card">
      <span>Ingest Time</span>
      <strong data-summary="ingest">–</strong>
    </div>
  </section>

  <section class="charts-grid">
    <div class="chart-container">
      <div class="chart-header">
        <h3>Time of Day</h3>
        <button class="reset-btn" data-reset="hour">Reset</button>
      </div>
      <canvas width="480" height="180" data-chart="hour"></canvas>
      <div class="chart-legend"><span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>12am</span></div>
    </div>

    <div class="chart-container">
      <div class="chart-header">
        <h3>Arrival Delay (minutes)</h3>
        <button class="reset-btn" data-reset="delay">Reset</button>
      </div>
      <canvas width="480" height="180" data-chart="delay"></canvas>
      <div class="chart-legend"><span>-60</span><span>0</span><span>60</span><span>120</span><span>150</span></div>
    </div>

    <div class="chart-container">
      <div class="chart-header">
        <h3>Distance (miles)</h3>
        <button class="reset-btn" data-reset="distance">Reset</button>
      </div>
      <canvas width="480" height="180" data-chart="distance"></canvas>
      <div class="chart-legend"><span>0</span><span>500</span><span>1000</span><span>1500</span><span>2000</span></div>
    </div>

    <div class="chart-container">
      <div class="chart-header">
        <h3>Date (2001)</h3>
        <button class="reset-btn" data-reset="date">Reset</button>
      </div>
      <canvas width="480" height="180" data-chart="date"></canvas>
      <div class="chart-legend"><span>Jan 1</span><span>Feb 1</span><span>Mar 1</span><span>Mar 31</span></div>
    </div>
  </section>

  <section class="flight-table-section">
    <h3>Recent Flights (Top 40)</h3>
    <div class="table-wrapper">
      <table class="flight-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Time</th>
            <th>Carrier</th>
            <th>Origin</th>
            <th>Dest</th>
            <th>Distance</th>
            <th>Delay</th>
          </tr>
        </thead>
        <tbody data-table="flights"></tbody>
      </table>
    </div>
  </section>
`;

const summaries = {
  total: app.querySelector<HTMLElement>('[data-summary="total"]')!,
  active: app.querySelector<HTMLElement>('[data-summary="active"]')!,
  delay: app.querySelector<HTMLElement>('[data-summary="delay"]')!,
  ingest: app.querySelector<HTMLElement>('[data-summary="ingest"]')!,
};

const canvases = {
  hour: app.querySelector<HTMLCanvasElement>('[data-chart="hour"]')!,
  delay: app.querySelector<HTMLCanvasElement>('[data-chart="delay"]')!,
  distance: app.querySelector<HTMLCanvasElement>('[data-chart="distance"]')!,
  date: app.querySelector<HTMLCanvasElement>('[data-chart="date"]')!,
};

const brushes: Record<string, ChartBrush> = {
  hour: { active: false, startX: 0, currentX: 0 },
  delay: { active: false, startX: 0, currentX: 0 },
  distance: { active: false, startX: 0, currentX: 0 },
  date: { active: false, startX: 0, currentX: 0 },
};

const flightTableBody = app.querySelector<HTMLTableSectionElement>('[data-table="flights"]')!;

// Generate flight data
const flights = generateFlights(ROW_COUNT);
const ingestStart = performance.now();
const cf = crossfilterX(flights, { bins: BINS });

const dimensions = {
  hour: cf.dimension('hour'),
  delay: cf.dimension('delay'),
  distance: cf.dimension('distance'),
  date: cf.dimension('date'),
  carrier: cf.dimension('carrierIndex'), // Never filtered, used for counting
};

const groups = {
  hour: cf.group('hour', { coarseTargetBins: 24 }),
  delay: cf.group('delay', { coarseTargetBins: 60 }),
  distance: cf.group('distance', { coarseTargetBins: 50 }),
  date: cf.group('date', { coarseTargetBins: 30 }),
  carrier: cf.group('carrierIndex'), // For reliable active count
};

await cf.whenIdle();
const ingestDuration = performance.now() - ingestStart;

// Setup interactive brushing
setupBrushing('hour', canvases.hour, scales.hour, '#38bdf8');
setupBrushing('delay', canvases.delay, scales.delay, '#f97316');
setupBrushing('distance', canvases.distance, scales.distance, '#8b5cf6');
setupBrushing('date', canvases.date, scales.date, '#10b981');

// Setup reset buttons
app.querySelectorAll<HTMLButtonElement>('[data-reset]').forEach(btn => {
  const dim = btn.dataset.reset!;
  btn.addEventListener('click', async () => {
    dimensions[dim as keyof typeof dimensions].clear();
    brushes[dim] = { active: false, startX: 0, currentX: 0 };
    await cf.whenIdle();
    render();
  });
});

render();

function setupBrushing(
  dimName: string,
  canvas: HTMLCanvasElement,
  scale: { min: number; max: number },
  color: string
) {
  const brush = brushes[dimName];

  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    brush.active = true;
    brush.startX = e.clientX - rect.left;
    brush.currentX = brush.startX;
  });

  canvas.addEventListener('mousemove', (e) => {
    if (!brush.active) return;
    const rect = canvas.getBoundingClientRect();
    brush.currentX = e.clientX - rect.left;
    render();
  });

  canvas.addEventListener('mouseup', async () => {
    if (!brush.active) return;
    brush.active = false;
    await applyBrush(dimName, canvas, scale);
  });

  canvas.addEventListener('mouseleave', async () => {
    if (!brush.active) return;
    brush.active = false;
    await applyBrush(dimName, canvas, scale);
  });

  canvas.addEventListener('dblclick', async () => {
    dimensions[dimName as keyof typeof dimensions].clear();
    brushes[dimName] = { active: false, startX: 0, currentX: 0 };
    await cf.whenIdle();
    render();
  });
}

async function applyBrush(dimName: string, canvas: HTMLCanvasElement, scale: { min: number; max: number }) {
  const brush = brushes[dimName];
  const x1 = Math.min(brush.startX, brush.currentX);
  const x2 = Math.max(brush.startX, brush.currentX);

  const width = canvas.width;
  const min = scale.min + (x1 / width) * (scale.max - scale.min);
  const max = scale.min + (x2 / width) * (scale.max - scale.min);

  const minBin = valueToBin(min, scale, BITS);
  const maxBin = valueToBin(max, scale, BITS);

  dimensions[dimName as keyof typeof dimensions].filter([minBin, maxBin]);
  await cf.whenIdle();
  render();
}

function render() {
  // IMPORTANT: For active count, use a dimension that isn't filtered
  // This demonstrates coordinated filtering - when you filter dimension A,
  // dimension B's bins show the filtered results
  // We use carrier as a stable reference dimension (never filtered)
  const activeBins = groups.carrier.bins();
  const activeCount = sumBins(activeBins);
  summaries.total.textContent = formatNumber(ROW_COUNT);
  summaries.active.textContent = formatNumber(activeCount);
  summaries.delay.textContent = calculateAvgDelay();
  summaries.ingest.textContent = `${ingestDuration.toFixed(1)} ms`;

  // Render charts - each shows data filtered by OTHER dimensions
  const hourBins = downsample(groups.hour.bins(), 48);
  const delayBins = downsample(groups.delay.bins(), 60);
  const distanceBins = downsample(groups.distance.bins(), 50);
  const dateBins = downsample(groups.date.bins(), 30);

  drawHistogram(canvases.hour, hourBins, '#38bdf8', brushes.hour);
  drawHistogram(canvases.delay, delayBins, '#f97316', brushes.delay);
  drawHistogram(canvases.distance, distanceBins, '#8b5cf6', brushes.distance);
  drawHistogram(canvases.date, dateBins, '#10b981', brushes.date);

  // Update flight table
  renderFlightTable();
}

function calculateAvgDelay(): string {
  const bins = groups.delay.bins();
  let totalDelay = 0;
  let count = 0;

  for (let i = 0; i < bins.length; i++) {
    const binCount = bins[i];
    if (!binCount) continue;

    const delay = scales.delay.min + (i / ((1 << BINS) - 1)) * (scales.delay.max - scales.delay.min);
    totalDelay += delay * binCount;
    count += binCount;
  }

  return count > 0 ? `${(totalDelay / count).toFixed(1)} min` : '–';
}

function renderFlightTable() {
  // For demo purposes, show a subset of flights
  // In real implementation, would use dimension.top(40)
  const sampleFlights = flights.slice(0, 40);

  flightTableBody.innerHTML = sampleFlights
    .map(flight => {
      const delayClass = flight.delay < -5 ? 'early' : flight.delay > 15 ? 'late' : 'ontime';
      return `
        <tr>
          <td>${formatDate(flight.date)}</td>
          <td>${formatHour(flight.hour)}</td>
          <td>${flight.carrier}</td>
          <td>${flight.origin}</td>
          <td>${flight.destination}</td>
          <td>${Math.round(flight.distance)}</td>
          <td class="${delayClass}">${flight.delay > 0 ? '+' : ''}${flight.delay}</td>
        </tr>
      `;
    })
    .join('');
}

function generateFlights(count: number): Flight[] {
  const carriers = ['AA', 'DL', 'UA', 'WN', 'B6', 'AS', 'NK', 'F9'];
  const airports = ['ATL', 'DFW', 'DEN', 'ORD', 'LAX', 'CLT', 'LAS', 'PHX', 'MCO', 'SEA'];

  const flights: Flight[] = new Array(count);

  for (let i = 0; i < count; i++) {
    const carrierIdx = Math.floor(Math.random() * carriers.length);
    flights[i] = {
      date: Math.floor(Math.random() * 90), // Jan-Mar (90 days)
      hour: Math.floor(randomNormal(12, 4, 0, 23)),
      delay: Math.floor(randomNormal(5, 25, -60, 150)),
      distance: Math.floor(randomNormal(700, 400, 50, 2000)),
      origin: airports[Math.floor(Math.random() * airports.length)],
      destination: airports[Math.floor(Math.random() * airports.length)],
      carrierIndex: carrierIdx,
      carrier: carriers[carrierIdx],
    };
  }

  return flights;
}

function randomNormal(mean: number, std: number, min?: number, max?: number): number {
  let u = 0, v = 0;
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

function formatDate(daysSinceEpoch: number): string {
  const months = ['Jan', 'Feb', 'Mar'];
  const month = Math.floor(daysSinceEpoch / 30);
  const day = (daysSinceEpoch % 30) + 1;
  return `${months[month]} ${day}`;
}

function formatHour(hour: number): string {
  const h = hour % 12 || 12;
  const ampm = hour < 12 ? 'am' : 'pm';
  return `${h}${ampm}`;
}