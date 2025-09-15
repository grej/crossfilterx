import type { CFOptions } from './types';
import type { DimSpec, GroupSnapshot, MsgFromWorker, MsgToWorker } from './protocol';

export type DimensionSpec = DimSpec;

type GroupState = {
  bins: Uint32Array;
  keys: Uint16Array | Float32Array;
  count: number;
};

type FrameResolver = () => void;

export class WorkerController {
  private readonly worker: Worker;
  private readonly dimsByName = new Map<string, number>();
  private readonly groupState = new Map<number, GroupState>();
  private readonly frameResolvers: FrameResolver[] = [];
  private readonly idleResolvers: FrameResolver[] = [];
  private readonly readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private pendingFrames = 0;
  private disposed = false;
  private seq = 0;
  private readyResolved = false;

  constructor(schema: DimensionSpec[], rows: Record<string, unknown>[], _options: CFOptions) {
    void _options;
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event) => {
      this.handleMessage(event.data as MsgFromWorker);
    };

    this.readyPromise = new Promise((resolve) => {
      this.resolveReady = resolve;
    });

    schema.forEach((dim, index) => {
      this.dimsByName.set(dim.name, index);
      this.groupState.set(index, createGroupState(dim.bits));
    });

    this.trackFrame({
      t: 'INGEST',
      schema,
      rows
    });
  }

  async filterRange(dimId: number, range: [number, number]) {
    await this.readyPromise;
    const [lo, hi] = range;
    return this.trackFrame({
      t: 'FILTER_SET',
      dimId,
      lo,
      hi,
      seq: this.nextSeq()
    });
  }

  async clearFilter(dimId: number) {
    await this.readyPromise;
    return this.trackFrame({
      t: 'FILTER_CLEAR',
      dimId,
      seq: this.nextSeq()
    });
  }

  whenIdle() {
    if (this.pendingFrames === 0) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.idleResolvers.push(resolve);
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

  private nextSeq() {
    return ++this.seq;
  }

  private trackFrame(message: MsgToWorker) {
    if (this.disposed) {
      return Promise.resolve();
    }
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
        if (!this.readyResolved) {
          this.readyResolved = true;
          this.resolveReady();
        }
        break;
      case 'FRAME':
        this.applyFrame(message.groups);
        this.resolveFrame();
        break;
      case 'INDEX_BUILT':
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

  private applyFrame(groups: GroupSnapshot[]) {
    for (const snapshot of groups) {
      const state = this.groupState.get(snapshot.id);
      if (!state) continue;
      const incoming = new Uint32Array(snapshot.bins);
      if (incoming.length !== state.bins.length) {
        state.bins = new Uint32Array(incoming);
        state.keys = createKeys(state.bins.length);
      } else {
        state.bins.set(incoming);
      }
      state.count = snapshot.count;
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
    while (this.idleResolvers.length) {
      this.idleResolvers.shift()?.();
    }
  }

  private flushFrames() {
    while (this.frameResolvers.length) {
      this.frameResolvers.shift()?.();
    }
  }
}

function createGroupState(bits: number): GroupState {
  const binCount = Math.max(1, 1 << Math.min(bits, 16));
  const bins = new Uint32Array(binCount);
  const keys = createKeys(binCount);
  return { bins, keys, count: 0 };
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
