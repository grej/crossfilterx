import { WorkerController, type DimensionSpec } from './controller';
import type { CFHandle, CFOptions, DimensionHandle, GroupHandle } from './types';

export type { CFHandle, CFOptions, DimensionHandle, GroupHandle } from './types';

class DimensionHandleImpl implements DimensionHandle {
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly controller: WorkerController, private readonly id: number) {}

  filter(rangeOrSet: [number, number] | Set<number>): DimensionHandle {
    if (rangeOrSet instanceof Set) {
      throw new Error('Set-based filters not yet implemented.');
    }
    this.pending = this.controller.filterRange(this.id, rangeOrSet);
    return this;
  }

  clear(): DimensionHandle {
    this.pending = this.controller.clearFilter(this.id);
    return this;
  }

  then<TResult1 = DimensionHandle, TResult2 = never>(
    onfulfilled?: ((value: DimensionHandle) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ) {
    return this.pending.then(() => this).then(onfulfilled, onrejected);
  }
}

class GroupHandleImpl implements GroupHandle {
  constructor(private readonly controller: WorkerController, private readonly dimId: number) {}

  bins(): Uint32Array {
    return this.controller.groupStateFor(this.dimId).bins;
  }

  keys(): Uint16Array | Float32Array {
    return this.controller.groupStateFor(this.dimId).keys;
  }

  count(): number {
    return this.controller.groupStateFor(this.dimId).count;
  }
}

export const crossfilterX = (data: unknown, options: CFOptions = {}): CFHandle => {
  if (!Array.isArray(data)) {
    throw new Error('crossfilterX expects an array of records.');
  }

  const rows = data as Record<string, unknown>[];
  const schema = inferSchema(rows, options);
  const controller = new WorkerController(schema, rows, options);

  return {
    dimension(nameOrAccessor) {
      if (typeof nameOrAccessor !== 'string') {
        throw new Error('Functional dimensions are not yet supported.');
      }
      const id = controller.dimensionId(nameOrAccessor);
      return new DimensionHandleImpl(controller, id);
    },
    group(name) {
      const id = controller.dimensionId(name);
      return new GroupHandleImpl(controller, id);
    },
    whenIdle() {
      return controller.whenIdle();
    },
    dispose() {
      controller.dispose();
    }
  };
};

function inferSchema(rows: Record<string, unknown>[], options: CFOptions): DimensionSpec[] {
  const bits = resolveBits(options.bins);
  const first = rows[0] ?? {};
  const keys = Object.keys(first);
  return keys.map((name) => {
    const value = first[name];
    const type = typeof value === 'number' ? 'number' : 'string';
    return {
      name,
      type,
      bits
    } satisfies DimensionSpec;
  });
}

function resolveBits(bins?: number) {
  if (!bins) return 12;
  const bits = Math.ceil(Math.log2(bins));
  return Math.max(1, Math.min(16, bits));
}

export type { MsgToWorker, MsgFromWorker } from './protocol';
