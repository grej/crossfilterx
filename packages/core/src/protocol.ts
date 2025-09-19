/**
 * @fileoverview Defines the worker protocol for CrossfilterX, including message
 *   handling, ingest routines, and histogram update paths. The module depends on
 *   SharedArrayBuffer layout helpers from `memory/layout`, ingest utilities from
 *   `memory/ingest`, and CSR index builders from `indexers/csr`. It is consumed
 *   by the worker runtime bootstrapped through `packages/core/src/index.ts`, and
 *   the public API as well as the benchmark harness depend on the message
 *   handling exposed here.
 */

export type MsgToWorker =
  | { t: 'INGEST'; schema: DimSpec[]; rows: ArrayBuffer | unknown[] | ColumnarPayload }
  | { t: 'BUILD_INDEX'; dimId: number }
  | { t: 'FILTER_SET'; dimId: number; lo: number; hi: number; seq: number }
  | { t: 'FILTER_CLEAR'; dimId: number; seq: number }
  | { t: 'ESTIMATE'; dimId: number; lo: number; hi: number }
  | { t: 'SWAP' }
  | {
      t: 'ADD_DIMENSION';
      name: string;
      kind: 'number' | 'string';
      bits: number;
      column: ArrayBuffer;
      scale?: QuantizeScale | null;
      labels?: string[] | null;
      fallback: number;
    };

export type MsgFromWorker =
  | { t: 'READY'; n: number; dims: DimMeta[] }
  | { t: 'INDEX_BUILT'; dimId: number; ms: number; bytes: number }
  | { t: 'FRAME'; seq: number; activeCount: number; groups: GroupSnapshot[]; profile?: ProfileSnapshot | null }
  | { t: 'PROGRESS'; phase: string; done: number; total: number }
  | { t: 'DIMENSION_ADDED'; dimId: number; name: string; group: GroupSnapshot }
  | { t: 'ERROR'; message: string };

export type DimSpec = {
  name: string;
  type: 'number' | 'string';
  bits: number;
};

export type DimMeta = {
  name: string;
  bins: number;
};

export type GroupSnapshot = {
  id: number;
  bins: ArrayBufferLike;
  byteOffset: number;
  binCount: number;
  count: number;
};

import { createLayout, type HistogramView } from './memory/layout';
import { ingestRows, type ColumnDescriptor, type ColumnarSource } from './memory/ingest';
import type { QuantizeScale } from './memory/quantize';
import { buildCsr, type CsrIndex } from './indexers/csr';
import { createHistogramSimdAccumulator, HistogramSimdAccumulator } from './wasm/simd';
import type { ProfileSnapshot, TypedArray } from './types';

type HistogramMode = 'direct' | 'buffered' | 'auto' | 'simd';
const HISTOGRAM_MODE_FLAG = '__CFX_HIST_MODE' as const;
const DEFAULT_HISTOGRAM_MODE: HistogramMode = 'auto';
const BUFFER_THRESHOLD_ROWS = 2_000_000;
const BUFFER_THRESHOLD_WORK = 12_000_000;

export type ColumnarPayload = {
  kind: 'columnar';
  rowCount: number;
  columns: Array<{ name: string; data: TypedArray }>;
  categories?: Array<{ name: string; labels: string[] }>;
};

type EngineState = {
  rowCount: number;
  dims: DimSpec[];
  descriptors: ColumnDescriptor[];
  layout?: ReturnType<typeof createLayout>;
  columns: Uint16Array[];
  histograms: HistogramView[];
  activeRows: Uint8Array;
  indexes: CsrIndex[];
  indexReady: boolean[];
  filters: Array<{ lo: number; hi: number } | null>;
  activeCount: number;
  profile: ProfileCollector | null;
  profiling: boolean;
  histogramMode: HistogramMode;
  simd: HistogramSimdAccumulator | null;
  heuristic: {
    deltaAvg: number;
    deltaCount: number;
    recomputeAvg: number;
    recomputeCount: number;
    simdCostPerRow: number;
    simdSamples: number;
    recomputeCostPerRow: number;
    recomputeSamples: number;
  };
};

type ProfileCollector = {
  lastClear?: ProfileSnapshot['clear'];
};

type ColumnarSources = Map<string, ColumnarSource>;

export function createProtocol(post: (message: MsgFromWorker) => void) {
  const profiling = Boolean((globalThis as { __CFX_PROFILE_CLEAR?: boolean }).__CFX_PROFILE_CLEAR);
  const state: EngineState = {
    rowCount: 0,
    dims: [],
    descriptors: [],
    layout: undefined,
    columns: [],
    histograms: [],
    activeRows: new Uint8Array(0),
    indexes: [],
    indexReady: [],
    filters: [],
    activeCount: 0,
    profile: profiling ? {} : null,
    profiling,
    histogramMode: resolveHistogramMode(),
    simd: null,
    heuristic: {
      deltaAvg: 0,
      deltaCount: 0,
      recomputeAvg: 0,
      recomputeCount: 0,
      simdCostPerRow: 0,
      simdSamples: 0,
      recomputeCostPerRow: 0,
      recomputeSamples: 0
    }
  };

  return {
    handleMessage(message: MsgToWorker) {
      switch (message.t) {
        case 'INGEST':
          handleIngest(message, state, post);
          break;
        case 'BUILD_INDEX':
          buildIndex(state, message.dimId, post);
          break;
        case 'FILTER_SET':
          applyFilter(state, message.dimId, { lo: message.lo, hi: message.hi });
          handleFrame(message.seq, state, post);
          break;
      case 'FILTER_CLEAR':
        applyFilter(state, message.dimId, null);
        handleFrame(message.seq, state, post);
        break;
      case 'ESTIMATE':
      case 'SWAP':
        // TODO: implement worker handlers
        break;
      case 'ADD_DIMENSION':
        addDimension(state, message, post);
        break;
      default:
        exhaustive(message);
    }
  }
};
}

function handleIngest(
  msg: Extract<MsgToWorker, { t: 'INGEST' }>,
  state: EngineState,
  post: (message: MsgFromWorker) => void
) {
  const columnarPayload = isColumnarPayload(msg.rows) ? msg.rows : null;
  const columnar = columnarPayload ? buildColumnarSources(columnarPayload) : undefined;
  const rows = Array.isArray(msg.rows) ? (msg.rows as Record<string, unknown>[]) : [];
  const rowCount = columnarPayload ? columnarPayload.rowCount : rows.length;
  const descriptors = buildDescriptors(msg.schema, rows, columnar);
  const layout = createLayout({
    rowCount,
    dimensions: msg.schema.map((dim) => ({ bins: resolveBinCount(dim) }))
  });
  const columns = ingestRows(rows, descriptors, layout.columns, columnar);
  const indexes = columns.map(() => null as unknown as CsrIndex);

  state.rowCount = rowCount;
  state.dims = msg.schema;
  state.descriptors = descriptors;
  state.layout = layout;
  state.columns = columns;
  state.histograms = layout.histograms;
  if (state.histogramMode === 'simd') {
    state.simd = createHistogramSimdAccumulator(columns, layout.histograms);
  } else {
    state.simd = null;
  }
  state.filters = new Array(msg.schema.length).fill(null);
  state.activeRows = new Uint8Array(state.rowCount);
  state.indexes = indexes;
  state.indexReady = new Array(msg.schema.length).fill(false);
  state.profile = state.profiling ? {} : null;

  fullRecompute(state);

  post({
    t: 'READY',
    n: state.rowCount,
    dims: msg.schema.map((dim) => ({
      name: dim.name,
      bins: resolveBinCount(dim)
    }))
  });
  handleFrame(0, state, post);
}

function isColumnarPayload(value: unknown): value is ColumnarPayload {
  return typeof value === 'object' && value !== null && (value as ColumnarPayload).kind === 'columnar';
}

function buildColumnarSources(payload: ColumnarPayload): ColumnarSources {
  const map = new Map<string, ColumnarSource>();
  const categoryLookup = new Map<string, string[]>();
  if (payload.categories) {
    for (const entry of payload.categories) {
      categoryLookup.set(entry.name, entry.labels);
    }
  }
  for (const column of payload.columns) {
    const array = column.data;
    if (array.length !== payload.rowCount) {
      throw new Error(`Column "${column.name}" length mismatch (expected ${payload.rowCount}, got ${array.length}).`);
    }
    const labels = categoryLookup.get(column.name);
    map.set(column.name, { data: array, labels });
  }
  return map;
}

function handleFrame(seq: number, state: EngineState, post: (message: MsgFromWorker) => void) {
  const profileSnapshot = state.profile?.lastClear ? { clear: state.profile.lastClear } : null;
  post({
    t: 'FRAME',
    seq,
    activeCount: state.activeCount,
    groups: state.histograms.map((histogram, id) => ({
      id,
      bins: histogram.front.buffer,
      byteOffset: histogram.front.byteOffset,
      binCount: histogram.front.length,
      count: state.activeCount
    })),
    profile: profileSnapshot
  });
}

function applyFilter(state: EngineState, dimId: number, range: { lo: number; hi: number } | null) {
  if (!state.layout) return;
  const previous = state.filters[dimId];
  state.filters[dimId] = range;

  if (!previous && !range) {
    fullRecompute(state);
    return;
  }

  if (previous && !range) {
    clearFilterRange(state, dimId, previous);
    return;
  }

  if (!previous || !range) {
    fullRecompute(state);
    return;
  }

  const diff = diffRanges(previous, range);
  if (!diff) {
    return;
  }

  if (!state.indexReady[dimId]) {
    buildIndex(state, dimId, () => {});
  }

  const { layout, columns, histograms, activeRows, indexes } = state;
  const requiredFilters = countActiveFilters(state.filters);
  const refcount = layout.refcount;
  const index = indexes[dimId];

  if (diff.removed.length > 0) {
    for (const [lo, hi] of diff.removed) {
      applyRange(index, lo, hi, (row) => updateRowState(row, -1));
    }
  }

  if (diff.added.length > 0) {
    for (const [lo, hi] of diff.added) {
      applyRange(index, lo, hi, (row) => updateRowState(row, 1));
    }
  }

  function updateRowState(row: number, delta: -1 | 1) {
    const prev = refcount[row];
    const next = (refcount[row] = prev + delta);
    const wasActive = activeRows[row] === 1;
    const isActive = next >= requiredFilters;

    if (!wasActive && isActive) {
      activateRow(row);
    } else if (wasActive && !isActive) {
      deactivateRow(row);
    }
  }

  function activateRow(row: number) {
    activeRows[row] = 1;
    setMask(layout.activeMask, row, true);
    const simd = state.histogramMode === 'simd' ? state.simd : null;
    if (simd) {
      simd.record(row, 1);
    } else {
      for (let dim = 0; dim < histograms.length; dim++) {
        const bin = columns[dim][row];
        histograms[dim].front[bin]++;
        histograms[dim].back[bin]++;
      }
    }
    state.activeCount++;
  }

  function deactivateRow(row: number) {
    activeRows[row] = 0;
    setMask(layout.activeMask, row, false);
    const simd = state.histogramMode === 'simd' ? state.simd : null;
    if (simd) {
      simd.record(row, -1);
    } else {
      for (let dim = 0; dim < histograms.length; dim++) {
        const bin = columns[dim][row];
        histograms[dim].front[bin]--;
        histograms[dim].back[bin]--;
      }
    }
    state.activeCount--;
  }

  flushSimd(state);
}

function clearFilterRange(state: EngineState, dimId: number, previous: { lo: number; hi: number }) {
  const { layout } = state;
  if (!layout) return;
  const layoutRef = layout;

  if (!state.indexReady[dimId]) {
    buildIndex(state, dimId, () => {});
  }

  const { columns, histograms, activeRows, indexes } = state;
  const requiredFilters = countActiveFilters(state.filters);
  const refcount = layoutRef.refcount;
  const index = indexes[dimId];
  const bins = histograms[dimId].front.length;

  const removeLo = Math.max(previous.lo, 0);
  const removeHi = Math.min(previous.hi, bins - 1);

  const offsets = index.binOffsets;
  const insideCount = offsets[removeHi + 1] - offsets[removeLo];
  const totalRows = state.rowCount;
  const outsideCount = totalRows - insideCount;
  const collector = state.profile;
  const outsideFraction = totalRows === 0 ? 0 : outsideCount / totalRows;
  const toggledEstimate = insideCount + outsideCount;
  const buffersEnabled = shouldBufferHistogramUpdate(
    state.histogramMode,
    toggledEstimate,
    state.histograms.length
  );
  const allowBuffers = state.histogramMode !== 'simd';
  const allocateBuffers = allowBuffers && (buffersEnabled || collector !== null);

  const otherFilters = countActiveFilters(state.filters);
  let useDelta = shouldApplyDeltaClear({
    insideCount,
    outsideCount,
    totalRows,
    histogramCount: state.histograms.length,
    otherFilters,
    activeCount: state.activeCount,
    stats: state.heuristic
  });

  if (state.histogramMode === 'simd' && outsideFraction < 0.55) {
    useDelta = true;
  }

  if (!useDelta) {
    flushSimd(state);
    const recomputeStart = performance.now();
    if (collector) {
      collector.lastClear = {
        fallback: true,
        insideRows: insideCount,
        outsideRows: outsideCount,
        outsideFraction,
        rangeBins: removeHi >= removeLo ? removeHi - removeLo + 1 : 0,
        buffered: false
      };
    }
    fullRecompute(state);
    recordHeuristic(state, 'recompute', performance.now() - recomputeStart, state.rowCount);
    return;
  }

  if (collector) {
    let insideRowsVisited = 0;
    let outsideRowsVisited = 0;
    const insideStart = performance.now();
    const insideBuffers = allocateBuffers ? createHistogramBuffers(histograms.length, bins) : null;
    applyRange(index, removeLo, removeHi, (row) => {
      insideRowsVisited++;
      adjustRow(row, -1, insideBuffers);
    });
    const afterInside = performance.now();
    const outsideBuffers = allocateBuffers ? createHistogramBuffers(histograms.length, bins) : null;
    if (removeLo > 0) {
      applyRange(index, 0, removeLo - 1, (row) => {
        outsideRowsVisited++;
        adjustRow(row, 0, outsideBuffers);
      });
    }
    if (removeHi < bins - 1) {
      applyRange(index, removeHi + 1, bins - 1, (row) => {
        outsideRowsVisited++;
        adjustRow(row, 0, outsideBuffers);
      });
    }
    const afterOutside = performance.now();
    flushHistogramBuffers(insideBuffers, histograms);
    flushHistogramBuffers(outsideBuffers, histograms);
    flushSimd(state);
    const totalMs = afterOutside - insideStart;
    const insideMs = afterInside - insideStart;
    const outsideMs = outsideRowsVisited > 0 ? afterOutside - afterInside : 0;
    collector.lastClear = {
      fallback: false,
      insideRows: insideRowsVisited,
      outsideRows: outsideRowsVisited,
      insideMs,
      outsideMs,
      totalMs,
      outsideFraction,
      rangeBins: removeHi >= removeLo ? removeHi - removeLo + 1 : 0,
      buffered: allowBuffers && buffersEnabled
    };
    recordHeuristic(state, 'delta', totalMs, insideRowsVisited + outsideRowsVisited);
  } else {
    const deltaStart = performance.now();
    let rowsVisited = 0;
    const insideBuffers = allocateBuffers ? createHistogramBuffers(histograms.length, bins) : null;
    applyRange(index, removeLo, removeHi, (row) => {
      rowsVisited++;
      adjustRow(row, -1, insideBuffers);
    });
    flushHistogramBuffers(insideBuffers, histograms);

    const outsideBuffers = allocateBuffers ? createHistogramBuffers(histograms.length, bins) : null;
    if (removeLo > 0) {
      applyRange(index, 0, removeLo - 1, (row) => {
        rowsVisited++;
        adjustRow(row, 0, outsideBuffers);
      });
    }

    if (removeHi < bins - 1) {
      applyRange(index, removeHi + 1, bins - 1, (row) => {
        rowsVisited++;
        adjustRow(row, 0, outsideBuffers);
      });
    }
    flushHistogramBuffers(outsideBuffers, histograms);
    flushSimd(state);
    recordHeuristic(state, 'delta', performance.now() - deltaStart, rowsVisited);
  }

  function adjustRow(row: number, delta: -1 | 0, buffers?: HistogramBuffer[] | null) {
    const prev = refcount[row];
    const candidate = prev + delta;
    const next = candidate < 0 ? 0 : candidate;
    refcount[row] = next;
    const wasActive = activeRows[row] === 1;
    const isActive = next >= requiredFilters;
    if (!wasActive && isActive) {
      activateRow(row, buffers);
    } else if (wasActive && !isActive) {
      deactivateRow(row, buffers);
    }
  }

function activateRow(row: number, buffers?: HistogramBuffer[] | null) {
    activeRows[row] = 1;
    setMask(layoutRef.activeMask, row, true);
    const simd = !buffers && state.histogramMode === 'simd' ? state.simd : null;
    if (buffers) {
      for (let dim = 0; dim < buffers.length; dim++) {
        buffers[dim].inc(columns[dim][row]);
      }
    } else if (simd) {
      simd.record(row, 1);
    } else {
      for (let dim = 0; dim < histograms.length; dim++) {
        const bin = columns[dim][row];
        histograms[dim].front[bin]++;
        histograms[dim].back[bin]++;
      }
    }
    state.activeCount++;
  }

function deactivateRow(row: number, buffers?: HistogramBuffer[] | null) {
    activeRows[row] = 0;
    setMask(layoutRef.activeMask, row, false);
    const simd = !buffers && state.histogramMode === 'simd' ? state.simd : null;
    if (buffers) {
      for (let dim = 0; dim < buffers.length; dim++) {
        buffers[dim].dec(columns[dim][row]);
      }
    } else if (simd) {
      simd.record(row, -1);
    } else {
      for (let dim = 0; dim < histograms.length; dim++) {
        const bin = columns[dim][row];
        histograms[dim].front[bin]--;
        histograms[dim].back[bin]--;
      }
    }
    state.activeCount--;
  }
}

function resolveHistogramMode(): HistogramMode {
  const flag = (globalThis as Record<string, unknown>)[HISTOGRAM_MODE_FLAG];
  if (typeof flag === 'string') {
    const normalized = flag.toLowerCase();
    if (normalized === 'direct' || normalized === 'buffered' || normalized === 'auto' || normalized === 'simd') {
      (globalThis as Record<string, unknown> & { __CFX_LAST_MODE?: string }).__CFX_LAST_MODE =
        normalized;
      return normalized;
    }
  }
  (globalThis as Record<string, unknown> & { __CFX_LAST_MODE?: string }).__CFX_LAST_MODE = DEFAULT_HISTOGRAM_MODE;
  return DEFAULT_HISTOGRAM_MODE;
}

function shouldBufferHistogramUpdate(mode: HistogramMode, toggledRows: number, histogramCount: number) {
  if (mode === 'buffered') return true;
  if (mode === 'direct') return false;
  if (mode === 'simd') return false;
  if (mode === 'auto' && toggledRows < BUFFER_THRESHOLD_ROWS) {
    return false;
  }
  const boundedHistograms = Math.max(1, histogramCount);
  const workEstimate = toggledRows * boundedHistograms;
  return toggledRows >= BUFFER_THRESHOLD_ROWS || workEstimate >= BUFFER_THRESHOLD_WORK;
}

type HistogramBuffer = {
  inc(bin: number): void;
  dec(bin: number): void;
  flush(histograms: HistogramView[], dim: number): void;
};

/**
 * Creates per-dimension accumulators backed by `Int32Array` buffers. Each
 * buffer collects bin deltas locally so that `flushHistogramBuffers` can apply
 * them in a single pass, avoiding repeated writes to the front/back histogram
 * views during large clears.
 */
function createHistogramBuffers(count: number, bins: number) {
  if (!count) return null;
  const buffers: HistogramBuffer[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const local = new Int32Array(bins);
    buffers[i] = {
      inc(bin) {
        local[bin]++;
      },
      dec(bin) {
        local[bin]--;
      },
      flush(histograms, dim) {
        const target = histograms[dim];
        for (let bin = 0; bin < bins; bin++) {
          const delta = local[bin];
          if (!delta) continue;
          target.front[bin] += delta;
          target.back[bin] += delta;
          local[bin] = 0;
        }
      }
    };
  }
  return buffers;
}

function flushHistogramBuffers(buffers: HistogramBuffer[] | null, histograms: HistogramView[]) {
  if (!buffers) return;
  for (let dim = 0; dim < buffers.length; dim++) {
    buffers[dim].flush(histograms, dim);
  }
}

function recordHeuristic(
  state: EngineState,
  kind: 'delta' | 'recompute',
  ms: number,
  rowsProcessed?: number
) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  const stats = state.heuristic;
  const alpha = 0.2;
  const safeRows = rowsProcessed && rowsProcessed > 0 ? rowsProcessed : state.rowCount;
  const costPerRow = safeRows > 0 ? ms / safeRows : 0;

  if (kind === 'delta') {
    stats.deltaAvg = stats.deltaCount > 0 ? stats.deltaAvg * (1 - alpha) + ms * alpha : ms;
    stats.deltaCount++;
    if (Number.isFinite(costPerRow) && costPerRow > 0) {
      stats.simdCostPerRow =
        stats.simdSamples > 0 ? stats.simdCostPerRow * (1 - alpha) + costPerRow * alpha : costPerRow;
      stats.simdSamples++;
    }
  } else {
    stats.recomputeAvg =
      stats.recomputeCount > 0 ? stats.recomputeAvg * (1 - alpha) + ms * alpha : ms;
    stats.recomputeCount++;
    if (Number.isFinite(costPerRow) && costPerRow > 0) {
      stats.recomputeCostPerRow =
        stats.recomputeSamples > 0
          ? stats.recomputeCostPerRow * (1 - alpha) + costPerRow * alpha
          : costPerRow;
      stats.recomputeSamples++;
    }
  }
}

function flushSimd(state: EngineState) {
  if (state.histogramMode !== 'simd') return;
  state.simd?.flush();
}

function shouldApplyDeltaClear(params: {
  insideCount: number;
  outsideCount: number;
  totalRows: number;
  histogramCount: number;
  otherFilters: number;
  activeCount: number;
  stats: EngineState['heuristic'];
}) {
  const {
    insideCount,
    outsideCount,
    totalRows,
    histogramCount,
    otherFilters,
    activeCount,
    stats
  } = params;
  if (totalRows === 0) return false;
  const rowsTouched = insideCount + outsideCount;
  const histCount = Math.max(1, histogramCount);
  const outsideWeight = 1.1 + 0.15 * Math.min(4, otherFilters);
  const outsideFraction = totalRows === 0 ? 0 : outsideCount / totalRows;
  const activeFraction = Math.min(1, totalRows === 0 ? 0 : activeCount / totalRows);
  const baselineSimd = (insideCount + outsideCount * outsideWeight) * histCount;
  const effectiveFraction = Math.max(0.01, activeFraction);
  const recomputeRows =
    otherFilters > 0
      ? Math.min(
          totalRows,
          Math.max(Math.max(1, activeCount), Math.round(totalRows * Math.pow(effectiveFraction, 0.85)))
        )
      : totalRows;
  const recomputeWeight = otherFilters > 0 ? 0.9 + activeFraction * 0.6 : 1.1;
  const baselineRecompute = recomputeRows * histCount * recomputeWeight;

  const simdEstimate =
    stats.simdSamples > 0 && Number.isFinite(stats.simdCostPerRow)
      ? stats.simdCostPerRow * Math.max(1, rowsTouched)
      : baselineSimd;

  const recomputeEstimate =
    stats.recomputeSamples > 0 && Number.isFinite(stats.recomputeCostPerRow)
      ? stats.recomputeCostPerRow * Math.max(1, recomputeRows)
      : baselineRecompute;

  if (stats.simdSamples === 0 && stats.recomputeSamples === 0) {
    if (otherFilters === 0 && outsideFraction > 0.35 && outsideFraction < 0.65) {
      return false;
    }
    if (otherFilters === 0 && insideCount < totalRows * 0.2 && outsideFraction > 0.6) {
      return false;
    }
    if (otherFilters > 0 && activeFraction < 0.05 && outsideFraction < 0.5) {
      return false;
    }
    return simdEstimate <= recomputeEstimate;
  }

  return simdEstimate <= recomputeEstimate;
}

function fullRecompute(state: EngineState) {
  const layout = state.layout;
  if (!layout) {
    state.activeCount = 0;
    return;
  }

  const { columns, histograms, filters } = state;
  const rowCount = state.rowCount;

  for (const histogram of histograms) {
    histogram.front.fill(0);
    histogram.back.fill(0);
  }
  layout.refcount.fill(0);
  layout.activeMask.fill(0);
  state.activeRows.fill(0);

  let activeCount = 0;
  for (let row = 0; row < rowCount; row++) {
    const { passes, satisfied } = evaluateRow(filters, columns, row);
    layout.refcount[row] = satisfied;

    if (!passes) continue;
    activeCount++;
    state.activeRows[row] = 1;
    setMask(layout.activeMask, row, true);
    for (let dim = 0; dim < histograms.length; dim++) {
      const bin = columns[dim][row];
      histograms[dim].front[bin]++;
      histograms[dim].back[bin]++;
    }
  }

  state.activeCount = activeCount;
}

function exhaustive(value: never): never {
  throw new Error(`Unhandled message type: ${JSON.stringify(value)}`);
}

function buildDescriptors(schema: DimSpec[], rows: Record<string, unknown>[], columnar?: ColumnarSources) {
  const dimensionCount = schema.length;
  const binCounts = schema.map(resolveBinCount);
  const descriptors: ColumnDescriptor[] = new Array(dimensionCount);

  const minValues = new Array<number>(dimensionCount).fill(Number.POSITIVE_INFINITY);
  const maxValues = new Array<number>(dimensionCount).fill(Number.NEGATIVE_INFINITY);
  const dictionaries = new Array<Map<string, number> | undefined>(dimensionCount);
  const nextCodes = new Array<number>(dimensionCount).fill(0);
  const fallbackBins = new Array<number>(dimensionCount).fill(0);

  const numericDims: number[] = [];
  const stringDims: number[] = [];

  for (let dim = 0; dim < dimensionCount; dim++) {
    const spec = schema[dim];
    if (spec.type === 'number') {
      numericDims.push(dim);
    } else {
      stringDims.push(dim);
      dictionaries[dim] = new Map<string, number>();
      const bins = binCounts[dim];
      fallbackBins[dim] = bins > 0 ? bins - 1 : 0;
    }
  }

  if (columnar) {
    for (const dim of numericDims) {
      const source = columnar.get(schema[dim].name);
      if (!source) continue;
      const data = source.data;
      for (let i = 0; i < data.length; i++) {
        const value = Number(data[i]);
        if (!Number.isFinite(value)) continue;
        if (value < minValues[dim]) minValues[dim] = value;
        if (value > maxValues[dim]) maxValues[dim] = value;
      }
    }
    for (const dim of stringDims) {
      const source = columnar.get(schema[dim].name);
      if (!source?.labels) {
        throw new Error(`Columnar dataset missing categories for dimension "${schema[dim].name}".`);
      }
      const dictionary = dictionaries[dim] ?? new Map<string, number>();
      dictionaries[dim] = dictionary;
      const labels = source.labels;
      for (let idx = 0; idx < labels.length; idx++) {
        dictionary.set(labels[idx], idx);
      }
      fallbackBins[dim] = labels.length > 0 ? labels.length - 1 : 0;
    }
  } else {
    for (const row of rows) {
      for (const dim of numericDims) {
        const value = Number(row[schema[dim].name]);
        if (!Number.isFinite(value)) continue;
        if (value < minValues[dim]) minValues[dim] = value;
        if (value > maxValues[dim]) maxValues[dim] = value;
      }

      for (const dim of stringDims) {
        const raw = row[schema[dim].name];
        const key = raw === undefined ? '' : String(raw);
        const dictionary = dictionaries[dim]!;
        if (dictionary.has(key)) continue;
        const limit = binCounts[dim];
        const next = nextCodes[dim];
        if (next < limit) {
          dictionary.set(key, next);
          nextCodes[dim] = next + 1;
        } else {
          dictionary.set(key, fallbackBins[dim]);
        }
      }
    }
  }

  for (let dim = 0; dim < dimensionCount; dim++) {
    const spec = schema[dim];
    const bins = binCounts[dim];
    const bits = Math.ceil(Math.log2(bins));
    if (spec.type === 'number') {
      let min = minValues[dim];
      let max = maxValues[dim];
      if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
        min = 0;
        max = bins;
      }
      const range = (1 << bits) - 1;
      const span = max - min;
      const safeSpan = span > 0 && Number.isFinite(span) ? span : 1;
      const invSpan = range / safeSpan;
      descriptors[dim] = {
        name: spec.name,
        scale: { min, max, bits, range, invSpan }
      };
    } else {
      const dictionary = dictionaries[dim] ?? new Map<string, number>();
      descriptors[dim] = {
        name: spec.name,
        dictionary,
        dictionaryFallback: fallbackBins[dim]
      };
      if (columnar) {
        const labels = columnar.get(spec.name)?.labels;
        if (labels) descriptors[dim].labels = labels;
      }
    }
  }

  return descriptors;
}

function resolveBinCount(dim: DimSpec) {
  return Math.max(1, 1 << Math.min(dim.bits, 16));
}

function diffRanges(
  previous: { lo: number; hi: number },
  next: { lo: number; hi: number }
): { added: Array<[number, number]>; removed: Array<[number, number]> } | null {
  if (previous.lo === next.lo && previous.hi === next.hi) {
    return null;
  }

  const added: Array<[number, number]> = [];
  const removed: Array<[number, number]> = [];

  if (next.lo < previous.lo) {
    added.push([next.lo, Math.min(previous.lo - 1, next.hi)]);
  }
  if (next.hi > previous.hi) {
    added.push([Math.max(previous.hi + 1, next.lo), next.hi]);
  }

  if (previous.lo < next.lo) {
    removed.push([previous.lo, Math.min(next.lo - 1, previous.hi)]);
  }
  if (previous.hi > next.hi) {
    removed.push([Math.max(next.hi + 1, previous.lo), previous.hi]);
  }

  return { added: normalizeRanges(added), removed: normalizeRanges(removed) };
}

function normalizeRanges(ranges: Array<[number, number]>) {
  return ranges
    .map(([lo, hi]) => (lo <= hi ? [lo, hi] : null))
    .filter((segment): segment is [number, number] => segment !== null);
}

function applyRange(index: CsrIndex, lo: number, hi: number, visit: (row: number) => void) {
  const { rowIdsByBin, binOffsets } = index;
  const end = Math.min(hi, binOffsets.length - 2);
  const start = Math.max(lo, 0);
  for (let bin = start; bin <= end; bin++) {
    const binStart = binOffsets[bin];
    const binEnd = binOffsets[bin + 1];
    for (let cursor = binStart; cursor < binEnd; cursor++) {
      visit(rowIdsByBin[cursor]);
    }
  }
}

function countActiveFilters(filters: Array<{ lo: number; hi: number } | null>) {
  let count = 0;
  for (const filter of filters) {
    if (filter) count++;
  }
  return count;
}

function addDimension(
  state: EngineState,
  message: Extract<MsgToWorker, { t: 'ADD_DIMENSION' }>,
  post: (message: MsgFromWorker) => void
) {
  if (state.rowCount === 0) return;
  const dimId = state.dims.length;
  state.dims.push({ name: message.name, type: message.kind, bits: message.bits });

  if (message.kind === 'number' && message.scale) {
    state.descriptors.push({ name: message.name, scale: message.scale });
  } else if (message.kind === 'string' && message.labels) {
    const dictionary = new Map<string, number>();
    message.labels.forEach((label, index) => {
      dictionary.set(label, index);
    });
    state.descriptors.push({
      name: message.name,
      dictionary,
      dictionaryFallback: message.fallback,
      labels: message.labels
    });
  } else {
    state.descriptors.push({ name: message.name });
  }

  const sourceColumn = new Uint16Array(message.column);
  const supportsShared = typeof SharedArrayBuffer === 'function';
  const columnBuffer = supportsShared
    ? new SharedArrayBuffer(sourceColumn.length * 2)
    : new ArrayBuffer(sourceColumn.length * 2);
  const columnView = new Uint16Array(columnBuffer);
  columnView.set(sourceColumn);
  state.columns.push(columnView);
  if (state.layout) {
    state.layout.columns = state.columns;
  }

  const binCount = message.kind === 'number' ? 1 << message.bits : (message.labels?.length ?? 1);
  const frontBuffer = supportsShared ? new SharedArrayBuffer(binCount * 4) : new ArrayBuffer(binCount * 4);
  const backBuffer = supportsShared ? new SharedArrayBuffer(binCount * 4) : new ArrayBuffer(binCount * 4);
  const front = new Uint32Array(frontBuffer);
  const back = new Uint32Array(backBuffer);

  for (let row = 0; row < state.rowCount; row++) {
    const bin = columnView[row];
    if (bin >= binCount) continue;
    back[bin] += 1;
    if (state.activeRows[row] === 1) {
      front[bin] += 1;
    }
  }

  state.histograms.push({ front, back });
  if (state.layout) {
    state.layout.histograms = state.histograms;
  }
  state.indexes.push({ rowIdsByBin: new Uint32Array(0), binOffsets: new Uint32Array(0) });
  state.indexReady.push(false);
  state.filters.push(null);

  post({
    t: 'DIMENSION_ADDED',
    dimId,
    name: message.name,
    group: {
      id: dimId,
      bins: front.buffer,
      byteOffset: front.byteOffset,
      binCount,
      count: state.activeCount
    }
  });
}

function buildIndex(state: EngineState, dimId: number, post: (message: MsgFromWorker) => void) {
  if (!state.layout || state.indexReady[dimId]) return;
  const start = performance.now();
  const column = state.columns[dimId];
  const bins = state.histograms[dimId].front.length;
  state.indexes[dimId] = buildCsr(column, bins);
  state.indexReady[dimId] = true;
  const ms = performance.now() - start;
  const bytes = state.indexes[dimId].rowIdsByBin.byteLength + state.indexes[dimId].binOffsets.byteLength;
  post({ t: 'INDEX_BUILT', dimId, ms, bytes });
}

function evaluateRow(
  filters: Array<{ lo: number; hi: number } | null>,
  columns: Uint16Array[],
  row: number
) {
  let satisfied = 0;
  let passes = true;
  for (let dim = 0; dim < filters.length; dim++) {
    const filter = filters[dim];
    if (!filter) continue;
    const value = columns[dim][row];
    if (value < filter.lo || value > filter.hi) {
      passes = false;
      continue;
    }
    satisfied++;
  }
  return { passes, satisfied };
}

function setMask(mask: Uint8Array, row: number, isActive: boolean) {
  const index = row >> 3;
  const bit = row & 7;
  if (isActive) {
    mask[index] |= 1 << bit;
  } else {
    mask[index] &= ~(1 << bit);
  }
}
