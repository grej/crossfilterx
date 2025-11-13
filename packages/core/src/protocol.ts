/**
 * @fileoverview Protocol - Worker-side message handler and data processor
 *
 * This module implements the worker-thread side of CrossfilterX's architecture.
 * It receives messages from the main thread (controller.ts), processes data,
 * applies filters, and updates histograms using efficient delta algorithms.
 *
 * ## Architecture Role
 *
 * While controller.ts coordinates on the main thread, this module does the
 * heavy lifting:
 * - **Data ingestion**: Quantizes raw data into compact bit-packed columns
 * - **Index building**: Constructs CSR (Compressed Sparse Row) indices for fast range queries
 * - **Filter application**: Uses delta updates or full recompute based on cost model
 * - **Histogram updates**: SIMD-accelerated histogram computation via RowActivator
 * - **State management**: Tracks active rows, filter ranges, and histogram bins
 *
 * ## Message Protocol
 *
 * ### Messages TO Worker (from controller):
 * - **INGEST**: Initial data load, creates dimensions and histograms
 * - **BUILD_INDEX**: Constructs CSR index for a dimension (optional optimization)
 * - **FILTER_SET**: Apply range filter to dimension (e.g., [100, 200])
 * - **FILTER_CLEAR**: Remove filter from dimension
 * - **ADD_DIMENSION**: Add new dimension after initial ingest
 * - **GROUP_SET_REDUCTION**: Configure aggregation (e.g., sum of price column)
 * - **GROUP_TOP_K**: Request top/bottom K values from a dimension
 * - **ESTIMATE**: Estimate cost of applying a filter (for preview)
 * - **REQUEST_PLANNER**: Get current ClearPlanner statistics
 * - **SWAP**: Debug command to swap active buffers
 *
 * ### Messages FROM Worker (to controller):
 * - **READY**: Worker initialized, data ingested, ready for commands
 * - **INDEX_BUILT**: CSR index construction complete
 * - **FRAME**: Filter operation complete, histograms updated
 * - **DIMENSION_ADDED**: New dimension created successfully
 * - **PLANNER**: ClearPlanner statistics snapshot
 * - **TOP_K_RESULT**: Top/bottom K results
 * - **PROGRESS**: Long-running operation progress update
 *
 * ## Filter Update Strategies
 *
 * When a filter changes (FILTER_SET or FILTER_CLEAR), the protocol chooses between:
 *
 * 1. **Delta Update** (incremental):
 *    - Computes which rows changed status (became active/inactive)
 *    - Updates only affected histogram bins
 *    - Uses CSR index for efficient range queries
 *    - Fast when filter changes are small
 *
 * 2. **Full Recompute**:
 *    - Rebuilds all histograms from scratch
 *    - Iterates over active rows only
 *    - Uses RowActivator for SIMD acceleration
 *    - Fast when active set is very small or filter changes are large
 *
 * The ClearPlanner maintains running cost estimates to choose the optimal strategy.
 *
 * ## Performance Optimizations
 *
 * - **SharedArrayBuffer**: Zero-copy histogram access from main thread
 * - **CSR Indexing**: O(log n + k) range queries instead of O(n)
 * - **Delta Updates**: Process only changed rows, not entire dataset
 * - **SIMD Histograms**: Rust/WASM acceleration when available
 * - **Bit Packing**: Quantized values stored compactly (4-16 bits per value)
 * - **Adaptive Strategy**: Cost model learns from actual timings to optimize future operations
 *
 * ## Data Flow Example
 *
 * ```
 * 1. INGEST message arrives
 *    ↓
 * 2. Quantize columns, allocate SharedArrayBuffer
 *    ↓
 * 3. Build initial histograms (all rows active)
 *    ↓
 * 4. Send READY with GroupSnapshots
 *    ↓
 * 5. FILTER_SET [100, 200] on dim 0
 *    ↓
 * 6. ClearPlanner chooses delta update
 *    ↓
 * 7. CSR index finds affected rows
 *    ↓
 * 8. Update histograms via diffRanges + RowActivator
 *    ↓
 * 9. Send FRAME with updated GroupSnapshots
 * ```
 *
 * ## Key Algorithms
 *
 * - **diffRanges()**: Computes set difference between old/new filter ranges
 * - **buildCsr()**: Two-pass CSR index construction
 * - **fullRecompute()**: Rebuild all histograms from active rows
 * - **diffUpdate()**: Incremental histogram updates via CSR deltas
 *
 * @see controller.ts for main-thread coordinator
 * @see indexers/csr.ts for CSR index implementation
 * @see worker/clear-planner.ts for adaptive strategy selection
 * @see worker/row-activator.ts for SIMD histogram updates
 */

export type MsgToWorker =
  | { t: 'INGEST'; schema: DimSpec[]; rows: ArrayBuffer | unknown[] | ColumnarPayload; valueColumnNames?: string[] }
  | { t: 'BUILD_INDEX'; dimId: number }
  | { t: 'FILTER_SET'; dimId: number; rangeMin: number; rangeMax: number; seq: number }
  | { t: 'FILTER_CLEAR'; dimId: number; seq: number }
  | { t: 'ESTIMATE'; dimId: number; rangeMin: number; rangeMax: number }
  | { t: 'SWAP' }
  | { t: 'REQUEST_PLANNER' }
  | {
      t: 'ADD_DIMENSION';
      name: string;
      kind: 'number' | 'string';
      bits: number;
      column: ArrayBuffer;
      scale?: QuantizeScale | null;
      labels?: string[] | null;
      fallback: number;
    }
  | {
      t: 'GROUP_SET_REDUCTION';
      dimId: number;
      reduction: 'sum';
      valueColumn: string; // Name of the column to aggregate
      seq: number;
    }
  | {
      t: 'GROUP_TOP_K';
      dimId: number;
      k: number;
      isBottom: boolean;
      seq: number;
    };

export type MsgFromWorker =
  | { t: 'READY'; n: number; groups: GroupSnapshot[] }
  | { t: 'INDEX_BUILT'; dimId: number; ms: number; bytes: number }
  | { t: 'FRAME'; seq: number; activeCount: number; groups: GroupSnapshot[]; profile?: ProfileSnapshot | null }
  | { t: 'PROGRESS'; phase: string; done: number; total: number }
  | { t: 'DIMENSION_ADDED'; dimId: number; name: string; group: GroupSnapshot }
  | { t: 'PLANNER'; snapshot: ReturnType<ClearPlanner['snapshot']> }
  | { t: 'ERROR'; message: string }
  | {
      t: 'TOP_K_RESULT';
      seq: number;
      results: Array<{ key: string | number; value: number }>;
    };

export type DimSpec = {
  name: string;
  type: 'number' | 'string';
  bits: number;
  coarseTargetBins?: number; // NEW
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
  // NEW: Optional coarse histogram views
  coarseBins?: ArrayBufferLike;
  coarseByteOffset?: number;
  coarseBinCount?: number;
  sum?: ArrayBufferLike;
};

import { createLayout, type HistogramView } from './memory/layout';
import type { ColumnDescriptor } from './memory/ingest';
import type { QuantizeScale } from './memory/quantize';
import { buildCsr, type CsrIndex } from './indexers/csr';
import { createHistogramSimdAccumulator, HistogramSimdAccumulator } from './wasm/simd';
import type { ProfileSnapshot, TypedArray } from './types';
import { ClearPlanner } from './worker/clear-planner';
import {
  createHistogramBuffers,
  flushHistogramBuffers,
  shouldBufferHistogramUpdate,
  type HistogramBuffer,
  type HistogramMode
} from './worker/histogram-updater';
import { computeTopK } from './worker/top-k';
import { ingestDataset, binsForSpec, type ColumnarPayload } from './worker/ingest-executor';
import { createLogger } from './utils/logger';
import { RowActivator, type RowActivatorState } from './engine/row-activator';

const BUFFER_THRESHOLD_ROWS = 32_768;
const BUFFER_THRESHOLD_WORK = 1_048_576; // rows * dims

const HISTOGRAM_MODE_FLAG = '__CFX_HIST_MODE' as const;
const DEFAULT_HISTOGRAM_MODE: HistogramMode = 'auto';

const DEBUG_MODE = Boolean((globalThis as any).__CFX_DEBUG || (typeof process !== 'undefined' && process?.env?.CFX_DEBUG));

type EngineState = {
  rowCount: number;
  dims: DimSpec[];
  descriptors: ColumnDescriptor[];
  layout?: ReturnType<typeof createLayout>;
  columns: Uint16Array[];
  histograms: HistogramView[];
  coarseHistograms: HistogramView[]; // NEW: Parallel array to histograms
  activeRows: Uint8Array;
  indexes: CsrIndex[];
  indexReady: boolean[];
  filters: Array<{ rangeMin: number; rangeMax: number } | null>;
  activeCount: number;
  profile: ProfileCollector | null;
  profiling: boolean;
  histogramMode: HistogramMode;
  simd: HistogramSimdAccumulator | null;
  planner: ClearPlanner;
  reductions: Map<
    number,
    {
      type: 'sum';
      valueColumn: Float32Array; // Direct values, no quantization
      sumBuffers: {
        front: Float64Array; // Precision matters for large sums
        back: Float64Array;
      };
    }
  >;
  valueColumns: Map<string, Float32Array>;
};

type ProfileCollector = {
  lastClear?: ProfileSnapshot['clear'];
};

export function createProtocol(post: (message: MsgFromWorker) => void) {
  const logger = createLogger('Worker');
  const profiling = Boolean((globalThis as { __CFX_PROFILE_CLEAR?: boolean }).__CFX_PROFILE_CLEAR);
  const state: EngineState = {
    rowCount: 0,
    dims: [],
    descriptors: [],
    layout: undefined,
    columns: [],
    histograms: [],
    coarseHistograms: [],
    activeRows: new Uint8Array(0),
    indexes: [],
    indexReady: [],
    filters: [],
    activeCount: 0,
    profile: profiling ? {} : null,
    profiling,
    histogramMode: resolveHistogramMode(),
    simd: null,
    planner: new ClearPlanner(),
    reductions: new Map(),
    valueColumns: new Map()
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
          logger.log(`FILTER_SET received: dimId=${message.dimId}, range=[${message.rangeMin}, ${message.rangeMax}]`);
          applyFilter(state, message.dimId, { rangeMin: message.rangeMin, rangeMax: message.rangeMax });
          logger.log(`After applyFilter, activeCount=${state.activeCount}`);
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
        case 'REQUEST_PLANNER':
          post({ t: 'PLANNER', snapshot: state.planner.snapshot() });
          break;
        case 'ADD_DIMENSION':
          addDimension(state, message, post);
          break;
        case 'GROUP_SET_REDUCTION':
          handleGroupSetReduction(message, state, post);
          break;
        case 'GROUP_TOP_K': {
          const histogram = state.histograms[message.dimId].front;
          const descriptor = state.descriptors[message.dimId];
          const dim = state.dims[message.dimId];
          const labels = descriptor.labels || (descriptor.dictionary ? Array.from(descriptor.dictionary.keys()) : undefined);

          const results = computeTopK(histogram, message.k, labels, message.isBottom);

          if (descriptor.scale) {
            const scale = descriptor.scale;
            const bits = dim.bits;
            const maxBin = (1 << bits) - 1;
            const mappedResults = results.map((result) => {
              const value = scale.min + ((result.key as number) / maxBin) * (scale.max - scale.min);
              return {
                key: value,
                value: result.value
              };
            });
            post({ t: 'TOP_K_RESULT', seq: message.seq, results: mappedResults });
          } else {
            post({ t: 'TOP_K_RESULT', seq: message.seq, results });
          }
          break;
        }
        default:
          exhaustive(message);
    }
    },
    plannerSnapshot(): ReturnType<ClearPlanner['snapshot']> {
      return state.planner.snapshot();
    }
  };
}

function handleGroupSetReduction(
  msg: Extract<MsgToWorker, { t: 'GROUP_SET_REDUCTION' }>,
  state: EngineState,
  post: (message: MsgFromWorker) => void
) {
  const { dimId, reduction, valueColumn, seq } = msg;
  const { layout, reductions, rowCount } = state;

  if (!layout) return;

  const valueCol = state.valueColumns?.get(valueColumn);
  if (!valueCol) {
    // This should not happen if the value column was ingested correctly
    return;
  }

  const sumBuffers = {
    front: new Float64Array(layout.histograms[dimId].front.length),
    back: new Float64Array(layout.histograms[dimId].back.length)
  };

  reductions.set(dimId, {
    type: reduction,
    valueColumn: valueCol,
    sumBuffers
  });

  fullRecompute(state);
  handleFrame(seq, state, post);
}

function handleIngest(
  msg: Extract<MsgToWorker, { t: 'INGEST' }>,
  state: EngineState,
  post: (message: MsgFromWorker) => void
) {
  const rows = Array.isArray(msg.rows) ? (msg.rows as Record<string, unknown>[]) : [];
  const columnarPayload = isColumnarPayload(msg.rows) ? msg.rows : undefined;
  const ingestResult = ingestDataset({ schema: msg.schema, rows, columnarPayload, valueColumnNames: msg.valueColumnNames });
  const { rowCount, descriptors, layout, columns, binsPerDimension, valueColumns } = ingestResult;
  const indexes = columns.map(() => null as unknown as CsrIndex);

  state.rowCount = rowCount;
  state.dims = msg.schema;
  state.descriptors = descriptors;
  state.layout = layout;
  state.columns = columns;
  state.histograms = layout.histograms;
  state.coarseHistograms = layout.coarseHistograms;
  state.valueColumns = valueColumns ?? new Map();
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
    groups: state.histograms.map((histogram, id) => {
      const coarse = state.coarseHistograms[id];
      return {
        id,
        bins: histogram.front.buffer,
        byteOffset: histogram.front.byteOffset,
        binCount: histogram.front.length,
        count: state.activeCount,
        coarseBins: coarse?.front.buffer,
        coarseByteOffset: coarse?.front.byteOffset,
        coarseBinCount: coarse?.front.length
      };
    })
  });
  handleFrame(0, state, post);
}

function isColumnarPayload(value: unknown): value is ColumnarPayload {
  return typeof value === 'object' && value !== null && (value as ColumnarPayload).kind === 'columnar';
}

function handleFrame(seq: number, state: EngineState, post: (message: MsgFromWorker) => void) {
  const logger = createLogger('Worker');
  const profileSnapshot = state.profile?.lastClear ? { clear: state.profile.lastClear } : null;

  // DEBUG: Log histogram values before sending
  const debugSums = state.histograms.map((h, id) => {
    const sum = Array.from(h.front).reduce((a, b) => a + b, 0);
    return `[dim${id}:${sum}]`;
  }).join(' ');
  logger.log(`handleFrame seq=${seq}, sums=${debugSums}, activeCount=${state.activeCount}`);

  post({
    t: 'FRAME',
    seq,
    activeCount: state.activeCount,
    groups: state.histograms.map((histogram, id) => {
      const coarse = state.coarseHistograms[id];
      const reduction = state.reductions.get(id);
      return {
        id,
        bins: histogram.front.buffer,
        byteOffset: histogram.front.byteOffset,
        binCount: histogram.front.length,
        count: state.activeCount,
        coarseBins: coarse?.front.buffer,
        coarseByteOffset: coarse?.front.byteOffset,
        coarseBinCount: coarse?.front.length,
        sum: reduction?.sumBuffers.front.buffer
      };
    }),
    profile: profileSnapshot
  });
}

function applyFilter(state: EngineState, dimId: number, range: { rangeMin: number; rangeMax: number } | null) {
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

  const { layout, activeRows, indexes } = state;
  const requiredFilters = countActiveFilters(state.filters);
  const refcount = layout.refcount;
  const index = indexes[dimId];
  const rowActivator = new RowActivator(state as unknown as RowActivatorState);

  if (diff.removed.length > 0) {
    for (const [rangeMin, rangeMax] of diff.removed) {
      applyRange(index, rangeMin, rangeMax, (row) => updateRowState(row, -1));
    }
  }

  if (diff.added.length > 0) {
    for (const [rangeMin, rangeMax] of diff.added) {
      applyRange(index, rangeMin, rangeMax, (row) => updateRowState(row, 1));
    }
  }

  function updateRowState(row: number, delta: -1 | 1) {
    const prev = refcount[row];
    const next = (refcount[row] = prev + delta);
    const wasActive = activeRows[row] === 1;
    const isActive = next >= requiredFilters;

    if (!wasActive && isActive) {
      rowActivator.activate(row);
    } else if (wasActive && !isActive) {
      rowActivator.deactivate(row);
    }
  }

  flushSimd(state);
}

function clearFilterRange(state: EngineState, dimId: number, previous: { rangeMin: number; rangeMax: number }) {
  const { layout } = state;
  if (!layout) return;
  const layoutRef = layout;
  const logger = createLogger('Worker');

  if (!state.indexReady[dimId]) {
    buildIndex(state, dimId, () => {});
  }

  const { activeRows, indexes, histograms } = state;
  const requiredFilters = countActiveFilters(state.filters);
  const refcount = layoutRef.refcount;
  const index = indexes[dimId];
  const bins = histograms[dimId].front.length;
  const rowActivator = new RowActivator(state as unknown as RowActivatorState);

  const removeMin = Math.max(previous.rangeMin, 0);
  const removeMax = Math.min(previous.rangeMax, bins - 1);

  const offsets = index.binOffsets;
  const insideCount = offsets[removeMax + 1] - offsets[removeMin];
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

  const plan = state.planner.choose({
    insideCount,
    outsideCount,
    totalRows,
    histogramCount: state.histograms.length,
    otherFilters: countActiveFilters(state.filters),
    activeCount: state.activeCount,
  });
  const useDelta = plan === 'delta';

  if (DEBUG_MODE && !useDelta) {
    logger.log(
      `Full recompute triggered. ` +
        `Inside: ${insideCount}, Outside: ${outsideCount}, ` +
        `Reason: ${plan === 'recompute' ? 'Planner decision' : 'Fallback'}`
    );
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
        rangeBins: removeMax >= removeMin ? removeMax - removeMin + 1 : 0,
        buffered: false
      };
    }
    fullRecompute(state);
    state.planner.record('recompute', performance.now() - recomputeStart, state.rowCount);
    return;
  }

  if (collector) {
    let insideRowsVisited = 0;
    let outsideRowsVisited = 0;
    const insideStart = performance.now();
    const insideBuffers = allocateBuffers ? createHistogramBuffers(histograms.length, bins) : null;
    applyRange(index, removeMin, removeMax, (row) => {
      insideRowsVisited++;
      adjustRow(row, -1, insideBuffers);
    });
    const afterInside = performance.now();
    const outsideBuffers = allocateBuffers ? createHistogramBuffers(histograms.length, bins) : null;
    if (removeMin > 0) {
      applyRange(index, 0, removeMin - 1, (row) => {
        outsideRowsVisited++;
        adjustRow(row, 0, outsideBuffers);
      });
    }
    if (removeMax < bins - 1) {
      applyRange(index, removeMax + 1, bins - 1, (row) => {
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
      rangeBins: removeMax >= removeMin ? removeMax - removeMin + 1 : 0,
      buffered: allowBuffers && buffersEnabled
    };
    state.planner.record('delta', totalMs, insideRowsVisited + outsideRowsVisited);
  } else {
    const deltaStart = performance.now();
    let rowsVisited = 0;
    const insideBuffers = allocateBuffers ? createHistogramBuffers(histograms.length, bins) : null;
    applyRange(index, removeMin, removeMax, (row) => {
      rowsVisited++;
      adjustRow(row, -1, insideBuffers);
    });
    flushHistogramBuffers(insideBuffers, histograms);

    const outsideBuffers = allocateBuffers ? createHistogramBuffers(histograms.length, bins) : null;
    if (removeMin > 0) {
      applyRange(index, 0, removeMin - 1, (row) => {
        rowsVisited++;
        adjustRow(row, 0, outsideBuffers);
      });
    }

    if (removeMax < bins - 1) {
      applyRange(index, removeMax + 1, bins - 1, (row) => {
        rowsVisited++;
        adjustRow(row, 0, outsideBuffers);
      });
    }
    flushHistogramBuffers(outsideBuffers, histograms);
    flushSimd(state);
    state.planner.record('delta', performance.now() - deltaStart, rowsVisited);
  }

  function adjustRow(row: number, delta: -1 | 0, buffers?: HistogramBuffer[] | null) {
    const prev = refcount[row];
    const candidate = prev + delta;
    const next = candidate < 0 ? 0 : candidate;
    refcount[row] = next;
    const wasActive = activeRows[row] === 1;
    const isActive = next >= requiredFilters;
    if (!wasActive && isActive) {
      rowActivator.activate(row, buffers);
    } else if (wasActive && !isActive) {
      rowActivator.deactivate(row, buffers);
    }
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





function flushSimd(state: EngineState) {
  if (state.histogramMode !== 'simd') return;
  state.simd?.flush();
}

function fullRecompute(state: EngineState) {
  const layout = state.layout;
  if (!layout) {
    state.activeCount = 0;
    return;
  }

  const { columns, histograms, filters, reductions } = state;
  const rowCount = state.rowCount;
  const rowActivator = new RowActivator(state as unknown as RowActivatorState);

  // Clear all state
  for (const histogram of histograms) {
    histogram.front.fill(0);
    histogram.back.fill(0);
  }
  for (const reduction of reductions.values()) {
    reduction.sumBuffers.front.fill(0);
    reduction.sumBuffers.back.fill(0);
  }
  for (const coarse of state.coarseHistograms) {
    if (coarse && coarse.front.length > 0) {
      coarse.front.fill(0);
      coarse.back.fill(0);
    }
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
    // Use RowActivator for consistency and automatic SIMD/coarse histogram support
    rowActivator.activate(row);
  }

  state.activeCount = activeCount;
}

function exhaustive(value: never): never {
  throw new Error(`Unhandled message type: ${JSON.stringify(value)}`);
}

function diffRanges(
  previous: { rangeMin: number; rangeMax: number },
  next: { rangeMin: number; rangeMax: number }
): { added: Array<[number, number]>; removed: Array<[number, number]> } | null {
  if (previous.rangeMin === next.rangeMin && previous.rangeMax === next.rangeMax) {
    return null;
  }

  const added: Array<[number, number]> = [];
  const removed: Array<[number, number]> = [];

  if (next.rangeMin < previous.rangeMin) {
    added.push([next.rangeMin, Math.min(previous.rangeMin - 1, next.rangeMax)]);
  }
  if (next.rangeMax > previous.rangeMax) {
    added.push([Math.max(previous.rangeMax + 1, next.rangeMin), next.rangeMax]);
  }

  if (previous.rangeMin < next.rangeMin) {
    removed.push([previous.rangeMin, Math.min(next.rangeMin - 1, previous.rangeMax)]);
  }
  if (previous.rangeMax > next.rangeMax) {
    removed.push([Math.max(next.rangeMax + 1, previous.rangeMin), previous.rangeMax]);
  }

  return { added: normalizeRanges(added), removed: normalizeRanges(removed) };
}

function normalizeRanges(ranges: Array<[number, number]>) {
  return ranges
    .map(([rangeMin, rangeMax]) => (rangeMin <= rangeMax ? [rangeMin, rangeMax] : null))
    .filter((segment): segment is [number, number] => segment !== null);
}

function applyRange(index: CsrIndex, rangeMin: number, rangeMax: number, visit: (row: number) => void) {
  const { rowIdsByBin, binOffsets } = index;
  const end = Math.min(rangeMax, binOffsets.length - 2);
  const start = Math.max(rangeMin, 0);
  for (let bin = start; bin <= end; bin++) {
    const binStart = binOffsets[bin];
    const binEnd = binOffsets[bin + 1];
    for (let cursor = binStart; cursor < binEnd; cursor++) {
      visit(rowIdsByBin[cursor]);
    }
  }
}

function countActiveFilters(filters: Array<{ rangeMin: number; rangeMax: number } | null>) {
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
  filters: Array<{ rangeMin: number; rangeMax: number } | null>,
  columns: Uint16Array[],
  row: number
) {
  let satisfied = 0;
  let passes = true;
  for (let dim = 0; dim < filters.length; dim++) {
    const filter = filters[dim];
    if (!filter) continue;
    const value = columns[dim][row];
    if (value < filter.rangeMin || value > filter.rangeMax) {
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
