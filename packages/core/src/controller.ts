import type { CFOptions, ColumnarData, TypedArray, ProfileSnapshot } from './types';
import { quantize, type QuantizeScale } from './memory/quantize';
import { createProtocol, type DimSpec, type GroupSnapshot, type MsgFromWorker, type MsgToWorker } from './protocol';
import type { ColumnarPayload } from './worker/ingest-executor';
import type { ClearPlannerSnapshot } from './worker/clear-planner';

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

export class WorkerController {
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
  private functionCounter = 0;
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
    console.log(`[Controller] filterRange CALLED: dimId=${dimId}, range=[${range}], readyResolved=${this.readyResolved}`);
    const [lo, hi] = range;
    this.filterState.set(dimId, range);

    // If ready, call trackFrame synchronously (before any async)
    if (this.readyResolved) {
      console.log(`[Controller] filterRange CALLING trackFrame SYNCHRONOUSLY`);
      return this.trackFrame({
        t: 'FILTER_SET',
        dimId,
        lo,
        hi,
        seq: this.nextSeq()
      });
    }

    // If not ready yet, wait then call trackFrame
    return this.readyPromise.then(() => {
      return this.trackFrame({
        t: 'FILTER_SET',
        dimId,
        lo,
        hi,
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
    console.log(`[Controller] whenIdle CALLED: pendingFrames=${this.pendingFrames}`);
    if (this.pendingFrames === 0) {
      console.log(`[Controller] whenIdle RESOLVING IMMEDIATELY`);
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.idleResolvers.push(resolve);
      console.log(`[Controller] whenIdle WAITING (${this.idleResolvers.length} resolvers queued)`);
    });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.terminate();
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

  createFunctionDimension(accessor: (row: Record<string, unknown>) => unknown): Promise<number> {
    const name = this.generateFunctionName(accessor.name || 'dimension');
    const derived = this.buildDerivedColumn(name, accessor);
    const dimId = this.schema.length;
    this.schema.push({ name, type: derived.kind, bits: derived.bits });

    const resolver = new Promise<number>((resolve) => {
      this.pendingDimensionResolvers.set(name, (id, snapshot) => {
        this.dimsByName.set(name, id);
        this.groupState.set(id, snapshotToGroupState(snapshot));
        this.indexInfo.set(id, { ready: false });
        resolve(id);
      });
    });

    const columnBuffer = derived.column.buffer.slice(0);
    this.worker.postMessage({
      t: 'ADD_DIMENSION',
      name,
      kind: derived.kind,
      bits: derived.bits,
      column: columnBuffer,
      scale: derived.kind === 'number' ? derived.scale : null,
      labels: derived.kind === 'string' ? derived.labels : null,
      fallback: derived.kind === 'string' ? derived.fallback : 0
    });

    return resolver;
  }

  private nextSeq() {
    return ++this.seq;
  }

  private trackFrame(message: MsgToWorker) {
    if (this.disposed) {
      return Promise.resolve();
    }
    console.log(`[Controller] trackFrame INCREMENTING pendingFrames from ${this.pendingFrames} to ${this.pendingFrames + 1}`);
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
    console.log(`[Controller] applyFrame sums=${debugSums}`);

    for (const snapshot of groups) {
      const state = this.groupState.get(snapshot.id);
      if (!state) continue;
      const incoming = new Uint32Array(snapshot.bins, snapshot.byteOffset, snapshot.binCount);

      // DEBUG: Check if state.bins shows the same values
      const stateBinsSum = Array.from(state.bins).reduce((a, b) => a + b, 0);
      const incomingSum = Array.from(incoming).reduce((a, b) => a + b, 0);
      const bufferInfo = `state buffer ${state.bins.buffer.byteLength}@${state.bins.byteOffset}, incoming buffer ${incoming.buffer.byteLength}@${incoming.byteOffset}`;
      console.log(`[Controller] dim${snapshot.id}: state.bins sum=${stateBinsSum}, incoming sum=${incomingSum}, same buffer? ${state.bins.buffer === incoming.buffer}, ${bufferInfo}`);

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
    console.log(`[Controller] flushIdle: resolving ${this.idleResolvers.length} idle resolvers`);
    while (this.idleResolvers.length) {
      this.idleResolvers.shift()?.();
    }
  }

  private flushFrames() {
    while (this.frameResolvers.length) {
      this.frameResolvers.shift()?.();
    }
  }

  private generateFunctionName(base: string) {
    const sanitized = base.replace(/\s+/g, '_').replace(/[^A-Za-z0-9_]/g, '').toLowerCase();
    let candidate = sanitized ? `fn_${sanitized}` : `fn_${this.functionCounter}`;
    while (this.dimsByName.has(candidate)) {
      candidate = `${candidate}_${++this.functionCounter}`;
    }
    this.functionCounter++;
    return candidate;
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
    if (!bins) return 12;
    const bits = Math.ceil(Math.log2(bins));
    return Math.max(1, Math.min(16, bits));
  }

  private buildDerivedColumn(name: string, accessor: (row: Record<string, unknown>) => unknown) {
    const rowCount = this.getRowCount();
    if (rowCount > 250_000) {
      console.warn(
        `[CrossfilterX] Creating function dimension on ${rowCount} rows. ` +
          `This may block the UI thread. Consider pre-computing this dimension.`
      );
    }
    const values = new Array<unknown>(rowCount);
    this.forEachRow((row, index) => {
      values[index] = accessor(row);
    });

    let sample = values.find((value) => value !== undefined && value !== null);
    if (sample instanceof Date) {
      sample = sample.valueOf();
    }

    if (typeof sample === 'number') {
      return this.buildNumericColumn(values);
    }

    return this.buildStringColumn(values);
  }

  private buildNumericColumn(values: Array<unknown>) {
    const rowCount = this.getRowCount();
    const numbers = new Array<number>(rowCount);
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < rowCount; index++) {
      const numeric = Number(values[index]);
      numbers[index] = numeric;
      if (Number.isFinite(numeric)) {
        if (numeric < min) min = numeric;
        if (numeric > max) max = numeric;
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
      min = Number.isFinite(min) ? min : 0;
      max = min + 1;
    }
    const bits = this.resolveBitsLocal();
    const range = (1 << bits) - 1;
    const span = max - min;
    const invSpan = span > 0 && Number.isFinite(span) ? range / span : 0;
    const scale: QuantizeScale = { min, max, bits, range, invSpan };
    const column = new Uint16Array(rowCount);
    for (let index = 0; index < rowCount; index++) {
      const numeric = numbers[index];
      column[index] = Number.isFinite(numeric) ? quantize(numeric, scale) : 0;
    }
    return { kind: 'number' as const, bits, column, scale };
  }

  private buildStringColumn(values: Array<unknown>) {
    const rowCount = this.getRowCount();
    const dictionary = new Map<string, number>();
    const labels: string[] = [];
    const column = new Uint16Array(rowCount);
    for (let index = 0; index < rowCount; index++) {
      const key = values[index] === undefined || values[index] === null ? '' : String(values[index]);
      let code = dictionary.get(key);
      if (code === undefined) {
        code = labels.length;
        if (code > 0xffff) {
          throw new Error('Function-based dimension exceeded 65535 unique categories.');
        }
        dictionary.set(key, code);
        labels.push(key);
      }
      column[index] = code;
    }
    const bits = Math.max(1, Math.ceil(Math.log2(Math.max(1, labels.length))));
    const fallback = dictionary.get('') ?? 0;
    return { kind: 'string' as const, bits, column, labels, fallback };
  }

  private forEachRow(callback: (row: Record<string, unknown>, index: number) => void) {
    if (this.source.kind === 'rows') {
      this.source.data.forEach((row, index) => callback(row, index));
      return;
    }
    const { columns, categories } = this.source.data;
    const names = Object.keys(columns);
    const columnData = names.map((name) => ({
      data: columns[name] as ArrayLike<number>,
      labels: categories?.[name]
    }));
    const rowCount = this.getRowCount();
    let currentIndex = 0;
    const view: Record<string, unknown> = {};
    columnData.forEach(({ data, labels }, idx) => {
      Object.defineProperty(view, names[idx], {
        enumerable: true,
        get: () => {
          const raw = data[currentIndex];
          if (labels) {
            const code = typeof raw === 'number' ? raw : Number(raw);
            return labels[code] ?? labels[0] ?? '';
          }
          return raw;
        }
      });
    });
    for (currentIndex = 0; currentIndex < rowCount; currentIndex++) {
      callback(view, currentIndex);
    }
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
  const binCount = Math.max(1, 1 << Math.min(bits, 16));
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
