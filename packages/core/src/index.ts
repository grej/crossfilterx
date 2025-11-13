import { WorkerController, type DimensionSpec, type IngestSource } from './controller';
import type { CFHandle, CFOptions, ColumnarData, DimensionHandle, GroupHandle } from './types';
import type { ClearPlannerSnapshot } from './worker/clear-planner';

export type { CFHandle, CFOptions, DimensionHandle, GroupHandle } from './types';

class DimensionHandleImpl implements DimensionHandle {
  private pending: Promise<void> = Promise.resolve();
  private resolvedId: number | null;
  private readonly idPromise: Promise<number>;

  constructor(private readonly controller: WorkerController, id: number | Promise<number>) {
    if (typeof id === 'number') {
      this.resolvedId = id;
      this.idPromise = Promise.resolve(id);
    } else {
      this.resolvedId = null;
      this.idPromise = id.then((resolved) => {
        this.resolvedId = resolved;
        return resolved;
      });
      this.pending = this.pending.then(() => this.idPromise).then(() => {});
    }
  }

  private async withId<T>(task: (id: number) => Promise<T> | T): Promise<T> {
    const id = this.resolvedId ?? (await this.idPromise);
    return task(id);
  }

  filter(rangeOrSet: [number, number] | Set<number>): DimensionHandle {
    if (rangeOrSet instanceof Set) {
      throw new Error('Set-based filters not yet implemented.');
    }
    // If dimension is ready, call filterRange immediately (synchronously starts the operation)
    // Otherwise, chain it to the pending queue
    const id = this.resolvedId;
    if (id !== null) {
      // Call synchronously to ensure trackFrame is called before returning
      void this.controller.filterRange(id, rangeOrSet);
    } else {
      this.pending = this.pending.then(async () => {
        const id = await this.idPromise;
        await this.controller.filterRange(id, rangeOrSet);
      });
    }
    return this;
  }

  clear(): DimensionHandle {
    // If dimension is ready, call clearFilter immediately (synchronously starts the operation)
    // Otherwise, chain it to the pending queue
    const id = this.resolvedId;
    if (id !== null) {
      // Call synchronously to ensure trackFrame is called before returning
      void this.controller.clearFilter(id);
    } else {
      this.pending = this.pending.then(async () => {
        const id = await this.idPromise;
        await this.controller.clearFilter(id);
      });
    }
    return this;
  }

  group(options?: import('./types').GroupOptions): GroupHandleImpl {
    if (this.resolvedId === null) {
      throw new Error('Dimension is still initializing; await the handle before calling group().');
    }
    return new GroupHandleImpl(this.controller, this.resolvedId, options);
  }

  then<TResult1 = DimensionHandle, TResult2 = never>(
    onfulfilled?: ((value: DimensionHandle) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): Promise<TResult1 | TResult2> {
    return this.pending.then(() => this).then(onfulfilled, onrejected);
  }
}

class GroupHandleImpl implements GroupHandle {
  constructor(
    private readonly controller: WorkerController,
    private readonly dimId: number,
    private readonly options?: import('./types').GroupOptions
  ) {}

  bins(): Uint32Array {
    return this.controller.groupStateFor(this.dimId).bins;
  }

  keys(): Uint16Array | Float32Array {
    return this.controller.groupStateFor(this.dimId).keys;
  }

  count(): number {
    return this.controller.groupStateFor(this.dimId).count;
  }

  coarse(): { bins(): Uint32Array; keys(): Uint16Array | Float32Array } | null {
    const coarseState = this.controller.groupStateFor(this.dimId).coarse;
    if (!coarseState) return null;
    return {
      bins: () => coarseState.bins,
      keys: () => coarseState.keys
    };
  }

  reduceSum(valueAccessor: string | ((d: any) => number)): this {
    if (typeof valueAccessor === 'function') {
      // This would require creating a new dimension for the values, which is not supported yet.
      throw new Error('Function accessors for reduceSum are not yet implemented.');
    }
    this.controller.setReduction(this.dimId, 'sum', valueAccessor);
    return this;
  }

  all(): Array<{
    key: string | number;
    value: {
      count: number;
      sum?: number;
      avg?: number;
    };
  }> {
    const state = this.controller.groupStateFor(this.dimId);
    const keys = state.keys;
    const bins = state.bins;
    const sum = state.sum;
    const results = [];
    for (let i = 0; i < keys.length; i++) {
      const count = bins[i];
      if (count > 0) {
        const value: { count: number; sum?: number; avg?: number } = { count };
        if (sum) {
          value.sum = sum[i];
          value.avg = sum[i] / count;
        }
        results.push({
          key: keys[i],
          value
        });
      }
    }
    return results;
  }

  async top(k: number): Promise<Array<{ key: string | number; value: number }>> {
    return this.controller.getTopK(this.dimId, k, false);
  }

  async bottom(k: number): Promise<Array<{ key: string | number; value: number }>> {
    return this.controller.getTopK(this.dimId, k, true);
  }

  reduceMin(valueAccessor: string | ((d: any) => number)): this {
    // To be implemented
    return this;
  }

  reduceMax(valueAccessor: string | ((d: any) => number)): this {
    // To be implemented
    return this;
  }
}

export const crossfilterX = (data: unknown, options: CFOptions = {}): CFHandle => {
  const source = prepareIngestSource(data);
  const schema = inferSchema(source, options);
  const controller = new WorkerController(schema, source, options);

  return {
    dimension(nameOrAccessor) {
      if (typeof nameOrAccessor === 'string') {
        const id = controller.dimensionId(nameOrAccessor);
        return new DimensionHandleImpl(controller, id);
      }
      if (typeof nameOrAccessor === 'function') {
        const promise = controller.createFunctionDimension(nameOrAccessor);
        return new DimensionHandleImpl(controller, promise);
      }
      throw new Error('Dimension must be defined by a column name or accessor function.');
    },
    group(name, options) {
      if (typeof name === 'string') {
        const id = controller.dimensionId(name);
        return new GroupHandleImpl(controller, id, options);
      }
      if (name instanceof DimensionHandleImpl) {
        return name.group(options);
      }
      throw new Error('Group expects a dimension name or handle.');
    },
    whenIdle() {
      return controller.whenIdle();
    },
    dispose() {
      controller.dispose();
    },
    buildIndex(name: string) {
      const id = controller.dimensionId(name);
      return controller.buildIndex(id);
    },
    indexStatus(name: string) {
      const id = controller.dimensionId(name);
      return controller.indexStatus(id);
    },
    profile() {
      return controller.profile();
    },
    /**
     * Returns the running SIMD/recompute cost estimates learned by the worker.
     * In browser environments where the engine lives in a dedicated Worker,
     * this currently returns zeros (a dedicated message channel is a future
     * enhancement). The values are populated in single-threaded test/bench runs,
     * which is where we consume them today.
     */
    clearPlannerSnapshot(): ClearPlannerSnapshot {
      return controller.plannerSnapshot();
    }
  };
};

function inferSchema(source: IngestSource, options: CFOptions): DimensionSpec[] {
  const bits = resolveBits(options.bins);
  if (source.kind === 'rows') {
    const first = source.data[0] ?? {};
    const keys = Object.keys(first);
    return keys.map((name) => {
      const value = first[name];
      const type = typeof value === 'number' ? 'number' : 'string';
      const dimOptions = options.dimensions?.[name];
      return {
        name,
        type,
        bits: dimOptions?.bins ? resolveBits(dimOptions.bins) : bits,
        coarseTargetBins: dimOptions?.coarseTargetBins
      } satisfies DimensionSpec;
    });
  }
  const keys = Object.keys(source.data.columns);
  const categories = source.data.categories ?? {};
  return keys.map((name) => {
    const dimOptions = options.dimensions?.[name];
    return {
      name,
      type: categories[name] ? 'string' : 'number',
      bits: dimOptions?.bins ? resolveBits(dimOptions.bins) : bits,
      coarseTargetBins: dimOptions?.coarseTargetBins
    } satisfies DimensionSpec;
  });
}

function resolveBits(bins?: number) {
  if (!bins) return 12;
  const bits = Math.ceil(Math.log2(bins));
  return Math.max(1, Math.min(16, bits));
}

type RowArray = Record<string, unknown>[];

function prepareIngestSource(data: unknown): IngestSource {
  if (Array.isArray(data)) {
    return { kind: 'rows', data: data as RowArray };
  }
  if (isColumnarData(data)) {
    const columnar = normalizeColumnarData(data as ColumnarData);
    return { kind: 'columnar', data: columnar };
  }
  throw new Error('crossfilterX expects an array of records or a columnar dataset.');
}

function isColumnarData(value: unknown): value is ColumnarData {
  if (!value || typeof value !== 'object') return false;
  const columns = (value as ColumnarData).columns;
  if (!columns || typeof columns !== 'object') return false;
  const entries = Object.values(columns);
  if (entries.length === 0) return false;
  return entries.every((entry) => isTypedArray(entry));
}

function isTypedArray(value: unknown): value is ArrayBufferView {
  return ArrayBuffer.isView(value) && !(value instanceof DataView);
}

function normalizeColumnarData(input: ColumnarData): ColumnarData {
  const entries = Object.entries(input.columns);
  if (entries.length === 0) {
    throw new Error('Columnar datasets require at least one column.');
  }
  const lengths = entries.map(([, array]) => array.length);
  const targetLength = input.length ?? lengths[0];
  for (let i = 0; i < entries.length; i++) {
    if (entries[i][1].length !== targetLength) {
      throw new Error('All columnar arrays must share the same length.');
    }
  }
  if (input.categories) {
    for (const [name, labels] of Object.entries(input.categories)) {
      if (!Array.isArray(labels) || labels.length === 0) {
        throw new Error(`Column "${name}" categories must be a non-empty string array.`);
      }
    }
  }
  return {
    columns: input.columns,
    length: targetLength,
    categories: input.categories
  };
}

export type { MsgToWorker, MsgFromWorker } from './protocol';
