/**
 * @fileoverview WorkerController - Main thread coordinator for CrossfilterX
 *
 * This module implements the main-thread side of CrossfilterX's worker architecture.
 * It manages communication with the Web Worker, tracks asynchronous state, and maintains
 * local histogram caches for immediate reads.
 *
 * ## Architecture
 *
 * CrossfilterX uses a **two-thread architecture**:
 * - **Main thread** (this file): Handles public API, manages worker communication,
 *   caches histogram data for synchronous reads
 * - **Worker thread** (protocol.ts): Processes data, applies filters, updates histograms
 *
 * ## Key Responsibilities
 *
 * 1. **Worker Lifecycle**: Creates, configures, and terminates the Web Worker
 * 2. **Message Passing**: Sends commands (FILTER_SET, FILTER_CLEAR, etc.) and
 *    receives results (FRAME, INDEX_READY, etc.)
 * 3. **Promise Coordination**: Converts async worker operations into promises
 *    that resolve when the worker completes
 * 4. **State Synchronization**: Maintains local GroupState caches that mirror
 *    worker-side histogram data via SharedArrayBuffer
 * 5. **Derived Dimensions**: Processes function-based dimensions on main thread
 *    (e.g., `dim((d) => d.computed)`) before sending to worker
 *
 * ## Data Flow
 *
 * ```
 * User calls dim.filter([100, 200])
 *        ↓
 * WorkerController.filterRange()
 *        ↓
 * postMessage({ t: 'FILTER_SET', ... }) → Worker processes
 *        ↓                                  ↓
 * trackFrame() creates promise        Worker updates histograms
 *        ↓                                  ↓
 * Promise resolves when         ← postMessage({ t: 'FRAME', ... })
 * FRAME message received
 * ```
 *
 * ## Performance Considerations
 *
 * - **Zero-copy reads**: Histogram bins backed by SharedArrayBuffer, no serialization
 * - **Async filtering**: Filter operations don't block main thread
 * - **Batch updates**: Multiple filter changes can be batched via sequence numbers
 * - **Function dimensions**: Processed on main thread, may block for large datasets
 *   (see UI_BLOCKING_THRESHOLD)
 *
 * @see protocol.ts for worker-side message handling
 * @see index.ts for public API that wraps this controller
 */
import type { CFOptions, ColumnarData, TypedArray, ProfileSnapshot } from './types';
import { quantize, type QuantizeScale } from './memory/quantize';
import { createProtocol, type DimSpec, type GroupSnapshot, type MsgFromWorker, type MsgToWorker } from './protocol';
import type { ColumnarPayload } from './worker/ingest-executor';
import type { ClearPlannerSnapshot } from './worker/clear-planner';
import { createLogger } from './utils/logger';

export type DimensionSpec = DimSpec;

type GroupState = {
  bins: Uint32Array;
  keys: Uint16Array | Float32Array;
  count: number;
  coarse?: {
    bins: Uint32Array;
    keys: Uint16Array | Float32Array;
  };
  sum?: Float64Array;
};

type FrameResolver = () => void;

type WorkerBridge = {
  postMessage: (message: MsgToWorker) => void;
  terminate: () => void;
  onmessage: ((event: MessageEvent<MsgFromWorker>) => void) | null;
};

export type IngestSource =
  | { kind: 'rows'; data: Record<string, unknown>[] }
  | { kind: 'columnar'; data: ColumnarData };

/**
 * Default histogram resolution in bits.
 *
 * 12 bits = 4096 bins, providing good balance between:
 * - Memory usage: 4096 bins × 4 bytes = 16KB per dimension
 * - Precision: 0.024% resolution for continuous data
 * - Performance: Reasonable computation time for most datasets
 *
 * Users can override this via the `bins` option in crossfilterX().
 */
const DEFAULT_BITS = 12;

/**
 * Maximum histogram resolution in bits.
 *
 * 16 bits = 65536 bins is the hard limit because:
 * - Histogram bins are stored as Uint16Array indices
 * - Beyond 16 bits, memory usage becomes prohibitive (256KB+ per dimension)
 * - Diminishing returns: most visualizations don't benefit from >16-bit precision
 */
const MAX_BITS = 16;

/**
 * Row count threshold that triggers UI blocking warning.
 *
 * Function-based dimensions (e.g., `dim((d) => d.computed)`) must process
 * every row on the main thread to extract values. Beyond 250K rows, this
 * can cause noticeable UI lag.
 *
 * Users should pre-compute these columns and include them in the dataset
 * rather than using function accessors for large datasets.
 */
const UI_BLOCKING_THRESHOLD = 250_000;

/**
 * Maximum unique categories for function-based dimensions.
 *
 * Category codes are stored as Uint16Array, limiting us to 65535 (0xFFFF)
 * unique values. This is typically sufficient for categorical data like:
 * - Countries, states, cities
 * - Product categories, SKUs
 * - User segments, tags
 *
 * If you need more categories, restructure as a numeric dimension or use hashing.
 */
const MAX_CATEGORIES = 0xffff;

export class WorkerController {
  /**
   * Registry for automatic cleanup of workers when instances are garbage collected.
   * Prevents memory leaks by ensuring workers are terminated even if dispose() isn't called.
   */
  private static readonly cleanup = new FinalizationRegistry<WorkerBridge>((worker) => {
    worker.terminate();
  });

  /**
   * Tracks the number of active CrossfilterX instances for memory leak warnings.
   * Incremented in constructor, decremented in dispose().
   */
  private static instanceCount = 0;

  /**
   * Maximum number of concurrent instances before warning the user.
   * Can be overridden via CFX_MAX_INSTANCES environment variable.
   */
  private static readonly MAX_INSTANCES = typeof process !== 'undefined' && process.env?.CFX_MAX_INSTANCES
    ? parseInt(process.env.CFX_MAX_INSTANCES, 10)
    : 5;

  private readonly logger = createLogger('Controller');
  private readonly worker: WorkerBridge;
  private readonly plannerSnapshotFn: () => ClearPlannerSnapshot;
  private readonly dimsByName = new Map<string, number>();
  private readonly groupState = new Map<number, GroupState>();
  private readonly indexInfo = new Map<number, { ready: boolean; ms?: number; bytes?: number }>();
  private readonly indexResolvers = new Map<number, FrameResolver[]>();
  private readonly frameResolvers: FrameResolver[] = [];
  private readonly idleResolvers: FrameResolver[] = [];
  private readonly readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private pendingFrames = 0;
  private disposed = false;
  private seq = 0;
  private readyResolved = false;
  private lastProfile: ProfileSnapshot | null = null;
  private readonly source: IngestSource;
  private readonly options: CFOptions;
  private readonly schema: DimensionSpec[];
  private readonly pendingDimensionResolvers = new Map<string, (dimId: number, snapshot: GroupSnapshot) => void>();
  private readonly topKResolvers = new Map<number, (results: Array<{ key: string | number; value: number }>) => void>();
  private readonly filterState = new Map<number, [number, number]>();
  private plannerSnapshotCache: ClearPlannerSnapshot = createEmptyPlannerSnapshot();

  constructor(schema: DimensionSpec[], source: IngestSource, _options: CFOptions) {
    this.source = source;
    this.options = _options;
    this.schema = [...schema];
    const bridge = createWorkerInstance();
    this.worker = bridge.worker;
    this.plannerSnapshotFn = bridge.plannerSnapshot;
    this.worker.onmessage = (event) => {
      this.handleMessage(event.data as MsgFromWorker);
    };

    // Track instance for memory leak detection
    WorkerController.instanceCount++;

    // Register for automatic cleanup when garbage collected
    WorkerController.cleanup.register(this, this.worker, this);

    // Warn if too many instances are active
    if (WorkerController.instanceCount >= WorkerController.MAX_INSTANCES) {
      console.warn(
        `[CrossfilterX] ${WorkerController.instanceCount} active instances detected. ` +
        `Call dispose() on unused instances to prevent memory leaks. ` +
        `See: https://github.com/grej/crossfilterx#memory-management`
      );
    }

    this.readyPromise = new Promise((resolve) => {
      this.resolveReady = resolve;
    });

    schema.forEach((dim, index) => {
      this.dimsByName.set(dim.name, index);
      this.groupState.set(index, createGroupState(dim.bits));
      this.indexInfo.set(index, { ready: false });
    });

    this.trackFrame({
      t: 'INGEST',
      schema,
      rows: prepareRowsPayload(source),
      valueColumnNames: _options.valueColumnNames
    });
  }

  filterRange(dimId: number, range: [number, number]) {
    this.logger.log(`filterRange CALLED: dimId=${dimId}, range=[${range}], readyResolved=${this.readyResolved}`);
    const [rangeMin, rangeMax] = range;
    this.filterState.set(dimId, range);

    // If ready, call trackFrame synchronously (before any async)
    if (this.readyResolved) {
      this.logger.log(`filterRange CALLING trackFrame SYNCHRONOUSLY`);
      return this.trackFrame({
        t: 'FILTER_SET',
        dimId,
        rangeMin,
        rangeMax,
        seq: this.nextSeq()
      });
    }

    // If not ready yet, wait then call trackFrame
    return this.readyPromise.then(() => {
      return this.trackFrame({
        t: 'FILTER_SET',
        dimId,
        rangeMin,
        rangeMax,
        seq: this.nextSeq()
      });
    });
  }

  clearFilter(dimId: number) {
    this.filterState.delete(dimId);

    // If ready, call trackFrame synchronously (before any async)
    if (this.readyResolved) {
      return this.trackFrame({
        t: 'FILTER_CLEAR',
        dimId,
        seq: this.nextSeq()
      });
    }

    // If not ready yet, wait then call trackFrame
    return this.readyPromise.then(() => {
      return this.trackFrame({
        t: 'FILTER_CLEAR',
        dimId,
        seq: this.nextSeq()
      });
    });
  }

  whenIdle() {
    this.logger.log(`whenIdle CALLED: pendingFrames=${this.pendingFrames}`);
    if (this.pendingFrames === 0) {
      this.logger.log(`whenIdle RESOLVING IMMEDIATELY`);
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.idleResolvers.push(resolve);
      this.logger.log(`whenIdle WAITING (${this.idleResolvers.length} resolvers queued)`);
    });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;

    // Decrement instance count
    WorkerController.instanceCount--;

    // Unregister from automatic cleanup (we're cleaning up manually)
    WorkerController.cleanup.unregister(this);

    // Terminate worker
    this.worker.terminate();

    // CRITICAL: Clear all references to SharedArrayBuffers to allow GC
    // Without this, TypedArray views keep SharedArrayBuffers alive
    this.groupState.clear();
    this.dimsByName.clear();
    this.indexInfo.clear();
    this.indexResolvers.clear();
    this.filterState.clear();
    this.topKResolvers.clear();
    this.pendingDimensionResolvers.clear();

    if (!this.readyResolved) {
      this.resolveReady();
      this.readyResolved = true;
    }
    this.pendingFrames = 0;
    this.flushFrames();
    this.flushIdle();
  }

  dimensionId(name: string) {
    const id = this.dimsByName.get(name);
    if (id === undefined) {
      throw new Error(`Unknown dimension: ${name}`);
    }
    return id;
  }

  groupStateFor(dimId: number) {
    const state = this.groupState.get(dimId);
    if (!state) {
      throw new Error(`Unknown group for dimension ${dimId}`);
    }
    return state;
  }

  indexStatus(dimId: number) {
    return this.indexInfo.get(dimId);
  }

  profile() {
    return this.lastProfile;
  }

  plannerSnapshot(): ClearPlannerSnapshot {
    const snapshot = this.plannerSnapshotFn();
    if (snapshot) {
      this.plannerSnapshotCache = snapshot;
    }
    try {
      this.worker.postMessage({ t: 'REQUEST_PLANNER' } as MsgToWorker);
    } catch (error) {
      // ignore
    }
    return this.plannerSnapshotCache;
  }

  async buildIndex(dimId: number) {
    await this.readyPromise;
    if (this.indexInfo.get(dimId)?.ready) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const resolvers = this.indexResolvers.get(dimId) ?? [];
      resolvers.push(resolve);
      this.indexResolvers.set(dimId, resolvers);
      this.worker.postMessage({ t: 'BUILD_INDEX', dimId });
    });
  }

  async setReduction(dimId: number, reduction: 'sum', valueColumn: string) {
    await this.readyPromise;
    return this.trackFrame({
      t: 'GROUP_SET_REDUCTION',
      dimId,
      reduction,
      valueColumn,
      seq: this.nextSeq()
    });
  }

  async getTopK(dimId: number, k: number, isBottom: boolean): Promise<Array<{ key: string | number; value: number }>> {
    await this.readyPromise;
    const seq = this.nextSeq();
    const promise = new Promise<Array<{ key: string | number; value: number }>>((resolve) => {
      this.topKResolvers.set(seq, resolve);
    });
    this.worker.postMessage({
      t: 'GROUP_TOP_K',
      dimId,
      k,
      isBottom,
      seq
    });
    return promise;
  }

  private nextSeq() {
    return ++this.seq;
  }

  private trackFrame(message: MsgToWorker) {
    if (this.disposed) {
      return Promise.resolve();
    }
    this.logger.log(`trackFrame INCREMENTING pendingFrames from ${this.pendingFrames} to ${this.pendingFrames + 1}`);
    this.pendingFrames++;
    const completion = new Promise<void>((resolve) => {
      this.frameResolvers.push(resolve);
    });
    this.worker.postMessage(message);
    return completion;
  }

  private handleMessage(message: MsgFromWorker) {
    if (this.disposed) return;
    switch (message.t) {
      case 'READY':
        for (const snapshot of message.groups) {
          this.groupState.set(snapshot.id, snapshotToGroupState(snapshot));
        }
        if (!this.readyResolved) {
          this.readyResolved = true;
          this.resolveReady();
        }
        break;
      case 'FRAME':
        this.applyFrame(message.groups);
        this.lastProfile = message.profile ?? null;
        this.resolveFrame();
        break;
      case 'INDEX_BUILT':
        this.markIndexBuilt(message.dimId, message.ms, message.bytes);
        break;
      case 'DIMENSION_ADDED':
        this.handleDimensionAdded(message);
        break;
      case 'TOP_K_RESULT': {
        const resolver = this.topKResolvers.get(message.seq);
        if (resolver) {
          resolver(message.results);
          this.topKResolvers.delete(message.seq);
        }
        break;
      }
      case 'PLANNER':
        this.plannerSnapshotCache = message.snapshot;
        break;
      case 'PROGRESS':
        // fall through for now
        break;
      case 'ERROR':
        console.error('[crossfilterx] worker error:', message.message);
        this.resolveFrame();
        break;
      default: {
        const neverMessage: never = message;
        console.warn('Unhandled worker message', neverMessage);
      }
    }
  }

  private handleDimensionAdded(message: Extract<MsgFromWorker, { t: 'DIMENSION_ADDED' }>) {
    const resolver = this.pendingDimensionResolvers.get(message.name);
    if (resolver) {
      resolver(message.dimId, message.group);
      this.pendingDimensionResolvers.delete(message.name);
    }
    const existing = this.filterState.get(message.dimId);
    if (existing) {
      void this.filterRange(message.dimId, existing);
    }
  }

  private applyFrame(groups: GroupSnapshot[]) {
    // DEBUG: Log what we're receiving
    const debugSums = groups.map(g => {
      const arr = new Uint32Array(g.bins, g.byteOffset, g.binCount);
      const sum = Array.from(arr).reduce((a, b) => a + b, 0);
      return `[dim${g.id}:${sum}]`;
    }).join(' ');
    this.logger.log(`applyFrame sums=${debugSums}`);

    for (const snapshot of groups) {
      const state = this.groupState.get(snapshot.id);
      if (!state) continue;
      const incoming = new Uint32Array(snapshot.bins, snapshot.byteOffset, snapshot.binCount);

      // DEBUG: Check if state.bins shows the same values
      const stateBinsSum = Array.from(state.bins).reduce((a, b) => a + b, 0);
      const incomingSum = Array.from(incoming).reduce((a, b) => a + b, 0);
      const bufferInfo = `state buffer ${state.bins.buffer.byteLength}@${state.bins.byteOffset}, incoming buffer ${incoming.buffer.byteLength}@${incoming.byteOffset}`;
      this.logger.log(`dim${snapshot.id}: state.bins sum=${stateBinsSum}, incoming sum=${incomingSum}, same buffer? ${state.bins.buffer === incoming.buffer}, ${bufferInfo}`);

      // ALWAYS update the bins reference to ensure we have the latest data
      // Even if it's the same SharedArrayBuffer, we want to ensure the view is correct
      state.bins = incoming;
      if (state.bins.length !== state.keys.length) {
        state.keys = createKeys(state.bins.length);
      }
      state.count = snapshot.count;

      if (snapshot.coarseBins && snapshot.coarseByteOffset !== undefined && snapshot.coarseBinCount !== undefined) {
        const coarseIncoming = new Uint32Array(
          snapshot.coarseBins,
          snapshot.coarseByteOffset,
          snapshot.coarseBinCount
        );
        if (!state.coarse || state.coarse.bins.buffer !== coarseIncoming.buffer) {
          state.coarse = {
            bins: coarseIncoming,
            keys: createKeys(coarseIncoming.length)
          };
        }
      }

      if (snapshot.sum) {
        state.sum = new Float64Array(snapshot.sum);
      }
    }
  }

  private resolveFrame() {
    if (this.pendingFrames > 0) {
      this.pendingFrames--;
    }
    const resolver = this.frameResolvers.shift();
    resolver?.();
    if (this.pendingFrames === 0) {
      this.flushIdle();
    }
  }

  private flushIdle() {
    this.logger.log(`flushIdle: resolving ${this.idleResolvers.length} idle resolvers`);
    while (this.idleResolvers.length) {
      this.idleResolvers.shift()?.();
    }
  }

  private flushFrames() {
    while (this.frameResolvers.length) {
      this.frameResolvers.shift()?.();
    }
  }

  private getRowCount() {
    if (this.source.kind === 'rows') {
      return this.source.data.length;
    }
    const columns = Object.values(this.source.data.columns);
    const length = columns[0]?.length ?? 0;
    return this.source.data.length ?? length;
  }

  private resolveBitsLocal() {
    const bins = this.options.bins;
    if (!bins) return DEFAULT_BITS;
    const bits = Math.ceil(Math.log2(bins));
    return Math.max(1, Math.min(MAX_BITS, bits));
  }

  private markIndexBuilt(dimId: number, ms: number, bytes: number) {
    const info = this.indexInfo.get(dimId);
    if (info) {
      this.indexInfo.set(dimId, { ready: true, ms, bytes });
    } else {
      this.indexInfo.set(dimId, { ready: true, ms, bytes });
    }
    const resolvers = this.indexResolvers.get(dimId);
    if (resolvers && resolvers.length) {
      while (resolvers.length) {
        resolvers.shift()?.();
      }
      this.indexResolvers.delete(dimId);
    }
  }
}

function prepareRowsPayload(source: IngestSource): Extract<MsgToWorker, { t: 'INGEST' }>['rows'] {
  if (source.kind === 'rows') {
    return source.data;
  }
  const columns = Object.entries(source.data.columns).map(([name, array]) => ({
    name,
    data: ensureTypedArray(array)
  }));
  const rowCount = source.data.length ?? (columns[0]?.data.length ?? 0);
  const categories = Object.entries(source.data.categories ?? {}).map(([name, labels]) => ({
    name,
    labels
  }));
  return {
    kind: 'columnar',
    rowCount,
    columns,
    categories: categories.length ? categories : undefined
  } satisfies ColumnarPayload;
}

function ensureTypedArray(array: TypedArray): TypedArray {
  return array;
}

function createGroupState(bits: number): GroupState {
  const binCount = Math.max(1, 1 << Math.min(bits, MAX_BITS));
  const bins = new Uint32Array(binCount);
  const keys = createKeys(binCount);
  return { bins, keys, count: 0 };
}

function snapshotToGroupState(snapshot: GroupSnapshot): GroupState {
  const bins = new Uint32Array(snapshot.bins, snapshot.byteOffset, snapshot.binCount);
  const keys = createKeys(snapshot.binCount);
  const state: GroupState = { bins, keys, count: snapshot.count };

  if (snapshot.coarseBins && snapshot.coarseByteOffset !== undefined && snapshot.coarseBinCount !== undefined) {
    state.coarse = {
      bins: new Uint32Array(snapshot.coarseBins, snapshot.coarseByteOffset, snapshot.coarseBinCount),
      keys: createKeys(snapshot.coarseBinCount)
    };
  }

  if (snapshot.sum) {
    state.sum = new Float64Array(snapshot.sum);
  }

  return state;
}

function createKeys(length: number): Uint16Array | Float32Array {
  if (length <= 0xffff) {
    const keys = new Uint16Array(length);
    for (let i = 0; i < length; i++) {
      keys[i] = i;
    }
    return keys;
  }
  const keys = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    keys[i] = i;
  }
  return keys;
}

function createWorkerInstance(): { worker: WorkerBridge; plannerSnapshot: () => ClearPlannerSnapshot } {
  let lastSnapshot = createEmptyPlannerSnapshot();

  if (typeof Worker === 'function' && typeof window !== 'undefined') {
    // Always use worker.ts - Vite and browsers will handle the resolution
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    let listener: ((event: MessageEvent<MsgFromWorker>) => void) | null = null;
    worker.onmessage = (event) => {
      const data = event.data as MsgFromWorker;
      if (data && typeof data === 'object' && data.t === 'PLANNER') {
        lastSnapshot = data.snapshot;
      }
      listener?.(event as MessageEvent<MsgFromWorker>);
    };
    return {
      worker: {
        postMessage: (message) => worker.postMessage(message),
        terminate: () => worker.terminate(),
        get onmessage() {
          return listener;
        },
        set onmessage(handler) {
          listener = handler;
        }
      },
      plannerSnapshot: () => lastSnapshot
    };
  }

  let listener: ((event: MessageEvent<MsgFromWorker>) => void) | null = null;
  const protocol = createProtocol((message) => {
    if (message.t === 'PLANNER') {
      lastSnapshot = message.snapshot;
    }
    listener?.({ data: message } as MessageEvent<MsgFromWorker>);
  });

  return {
    worker: {
      postMessage(message) {
        protocol.handleMessage(message);
      },
      terminate() {},
      get onmessage() {
        return listener;
      },
      set onmessage(handler) {
        listener = handler;
      }
    },
    plannerSnapshot: () => {
      lastSnapshot = protocol.plannerSnapshot();
      return lastSnapshot;
    }
  };
}

function createEmptyPlannerSnapshot(): ClearPlannerSnapshot {
  return {
    deltaAvg: 0,
    deltaCount: 0,
    recomputeAvg: 0,
    recomputeCount: 0,
    simdCostPerRow: 0,
    simdSamples: 0,
    recomputeCostPerRow: 0,
    recomputeSamples: 0,
  };
}
