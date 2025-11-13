/**
 * Chart rendering utilities for interactive crossfilter demo
 * Provides histogram and bar chart implementations with brush-based filtering
 */

export type ChartBrush = {
  active: boolean;
  startX: number;
  currentX: number;
};

export type ChartConfig = {
  canvas: HTMLCanvasElement;
  data: number[];
  scale: { min: number; max: number };
  color: string;
  onBrush?: (range: [number, number] | null) => void;
  label?: string;
};

/**
 * Draw histogram with optional brush overlay
 */
export function drawHistogram(
  canvas: HTMLCanvasElement,
  data: number[],
  color: string,
  brush?: ChartBrush
) {
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

  // Draw brush overlay
  if (brush && brush.active) {
    const x1 = Math.min(brush.startX, brush.currentX);
    const x2 = Math.max(brush.startX, brush.currentX);
    ctx.fillStyle = 'rgba(56, 189, 248, 0.2)';
    ctx.fillRect(x1, 0, x2 - x1, height);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.strokeRect(x1, 0, x2 - x1, height);
  }
}

/**
 * Draw bar chart with labels
 */
export function drawBars(
  canvas: HTMLCanvasElement,
  data: Array<{ label: string; value: number }>,
  color: string
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, width, height);

  const max = Math.max(...data.map(d => d.value), 1);
  const barWidth = width / Math.max(data.length, 1);

  ctx.font = '12px system-ui';
  ctx.textAlign = 'center';

  data.forEach((row, index) => {
    const barHeight = (row.value / max) * (height - 24);
    const x = index * barWidth;

    ctx.globalAlpha = 0.9;
    ctx.fillStyle = color;
    ctx.fillRect(x + 4, height - barHeight - 16, barWidth - 8, barHeight);

    ctx.globalAlpha = 1;
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(row.label, x + barWidth / 2, height - 4);
  });
}

/**
 * Create interactive chart with brush-based filtering
 */
export class InteractiveChart {
  private canvas: HTMLCanvasElement;
  private brush: ChartBrush = { active: false, startX: 0, currentX: 0 };
  private scale: { min: number; max: number };
  private onBrush?: (range: [number, number] | null) => void;

  constructor(config: ChartConfig) {
    this.canvas = config.canvas;
    this.scale = config.scale;
    this.onBrush = config.onBrush;

    this.setupInteraction();
  }

  private setupInteraction() {
    this.canvas.addEventListener('mousedown', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.brush.active = true;
      this.brush.startX = e.clientX - rect.left;
      this.brush.currentX = this.brush.startX;
    });

    this.canvas.addEventListener('mousemove', (e) => {
      if (!this.brush.active) return;
      const rect = this.canvas.getBoundingClientRect();
      this.brush.currentX = e.clientX - rect.left;
      this.requestRender();
    });

    this.canvas.addEventListener('mouseup', () => {
      if (!this.brush.active) return;
      this.brush.active = false;
      this.applyBrush();
    });

    this.canvas.addEventListener('mouseleave', () => {
      if (!this.brush.active) return;
      this.brush.active = false;
      this.applyBrush();
    });

    // Double-click to reset
    this.canvas.addEventListener('dblclick', () => {
      this.onBrush?.(null);
    });
  }

  private applyBrush() {
    const x1 = Math.min(this.brush.startX, this.brush.currentX);
    const x2 = Math.max(this.brush.startX, this.brush.currentX);

    // Convert pixel coordinates to data range
    const width = this.canvas.width;
    const min = this.scale.min + (x1 / width) * (this.scale.max - this.scale.min);
    const max = this.scale.min + (x2 / width) * (this.scale.max - this.scale.min);

    this.onBrush?.([min, max]);
  }

  private requestRender() {
    // Override this in subclass
  }

  getBrush(): ChartBrush {
    return this.brush;
  }

  clearBrush() {
    this.brush = { active: false, startX: 0, currentX: 0 };
  }
}

/**
 * Convert bins to downsampled array for visualization
 */
export function downsample(bins: Uint32Array, target: number): number[] {
  const chunk = Math.max(1, Math.floor(bins.length / target));
  const output = new Array(Math.ceil(bins.length / chunk)).fill(0);
  for (let i = 0; i < bins.length; i++) {
    const index = Math.floor(i / chunk);
    output[index] += bins[i];
  }
  return output;
}

/**
 * Sum all bins
 */
export function sumBins(bins: Uint32Array): number {
  let total = 0;
  for (let i = 0; i < bins.length; i++) total += bins[i];
  return total;
}

/**
 * Map value to bin index (quantize)
 * @param value - The value to quantize
 * @param scale - The scale {min, max}
 * @param bits - Number of bits (e.g., 10 for 1024 bins)
 */
export function valueToBin(value: number, scale: { min: number; max: number }, bits: number): number {
  if (scale.max <= scale.min) return 0;
  const maxBin = (1 << bits) - 1;
  const clamped = Math.min(Math.max(value, scale.min), scale.max);
  const normalized = (clamped - scale.min) / (scale.max - scale.min);
  return Math.round(normalized * maxBin);
}

/**
 * Map bin index to value
 * @param bin - Bin index
 * @param scale - The scale {min, max}
 * @param bits - Number of bits (e.g., 10 for 1024 bins)
 */
export function binToValue(bin: number, scale: { min: number; max: number }, bits: number): number {
  const maxBin = (1 << bits) - 1;
  return scale.min + (bin / maxBin) * (scale.max - scale.min);
}