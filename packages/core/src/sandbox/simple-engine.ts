import { ingestRows, type ColumnDescriptor } from '../memory/ingest';
import { quantize } from '../memory/quantize';

export type SimpleDimension = {
  name: string;
  kind: 'number';
  min?: number;
  max?: number;
  bits?: number;
};

export type SimpleEngine = {
  histogram(dim: number): Uint32Array;
  activeCount(): number;
  filter(dim: number, rangeMin: number, rangeMax: number): void;
  clear(dim: number): void;
};

type Scale = {
  min: number;
  max: number;
  bits: number;
  range: number;
  invSpan: number;
};

type InternalState = {
  columns: Uint16Array[];
  scales: Scale[];
  histograms: Uint32Array[];
  filters: Array<{ rangeMin: number; rangeMax: number } | null>;
  active: number;
};

export function createSimpleEngine(schema: SimpleDimension[], rows: Record<string, unknown>[]): SimpleEngine {
  if (schema.length === 0) {
    throw new Error('SimpleEngine requires at least one dimension.');
  }

  const scales = schema.map((dim) => inferScale(dim, rows));
  const descriptors: ColumnDescriptor[] = schema.map((dim, index) => ({
    name: dim.name,
    scale: scales[index]
  }));
  const columns = ingestRows(rows, descriptors);
  const histograms = scales.map((scale) => new Uint32Array(1 << scale.bits));
  const filters: Array<{ rangeMin: number; rangeMax: number } | null> = new Array(schema.length).fill(null);

  const state: InternalState = {
    columns,
    scales,
    histograms,
    filters,
    active: 0
  };

  recompute(state);

  return {
    histogram(dim: number) {
      return state.histograms[dim];
    },
    activeCount() {
      return state.active;
    },
    filter(dim: number, rangeMin: number, rangeMax: number) {
      state.filters[dim] = { rangeMin, rangeMax };
      recompute(state);
    },
    clear(dim: number) {
      state.filters[dim] = null;
      recompute(state);
    }
  };
}

function recompute(state: InternalState) {
  state.histograms.forEach((hist) => hist.fill(0));
  let active = 0;

  const rowCount = state.columns[0].length;
  for (let row = 0; row < rowCount; row++) {
    if (!passesFilters(state, row)) {
      continue;
    }
    active++;
    for (let dim = 0; dim < state.columns.length; dim++) {
      const bin = state.columns[dim][row];
      state.histograms[dim][bin]++;
    }
  }

  state.active = active;
}

function passesFilters(state: InternalState, row: number) {
  for (let dim = 0; dim < state.filters.length; dim++) {
    const filter = state.filters[dim];
    if (!filter) continue;
    const value = state.columns[dim][row];
    if (value < filter.rangeMin || value > filter.rangeMax) {
      return false;
    }
  }
  return true;
}

function inferScale(dim: SimpleDimension, rows: Record<string, unknown>[]): Scale {
  const bits = clampBits(dim.bits ?? 8);
  let min = dim.min ?? Number.POSITIVE_INFINITY;
  let max = dim.max ?? Number.NEGATIVE_INFINITY;

  if (Number.isFinite(min) && Number.isFinite(max) && min !== Number.NEGATIVE_INFINITY && max !== Number.POSITIVE_INFINITY) {
    if (min === max) {
      max = min + 1;
    }
    const range = (1 << bits) - 1;
    const span = max - min;
    return { min, max, bits, range, invSpan: span > 0 ? range / span : 0 };
  }

  for (const row of rows) {
    const raw = row[dim.name];
    const value = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }

  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    min = 0;
    max = Math.max(1, rows.length);
  }

  const range = (1 << bits) - 1;
  const span = max - min;
  return { min, max, bits, range, invSpan: span > 0 ? range / span : 0 };
}

function clampBits(bits: number) {
  return Math.max(1, Math.min(16, Math.round(bits)));
}

export function locateBin(scale: Scale, value: number) {
  return quantize(value, scale);
}
