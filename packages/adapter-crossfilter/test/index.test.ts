import { describe, expect, it, vi } from 'vitest';

import type { CFHandle, DimensionHandle, GroupHandle } from '@crossfilterx/core';
import { adaptCrossfilter } from '../src/index';

class MockDimension implements DimensionHandle {
  private pending: Promise<void> = Promise.resolve();
  filter() {
    this.pending = Promise.resolve();
    return this;
  }
  clear() {
    this.pending = Promise.resolve();
    return this;
  }
  then<TResult1 = DimensionHandle, TResult2 = never>(
    onfulfilled?: ((value: DimensionHandle) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return this.pending.then(() => this).then(onfulfilled, onrejected);
  }
}

class MockGroup implements GroupHandle {
  constructor(private readonly values: Uint32Array) {}
  bins() {
    return this.values;
  }
  keys() {
    return new Uint16Array(this.values.length);
  }
  count() {
    return this.values.reduce((acc, value) => acc + value, 0);
  }
}

describe('adaptCrossfilter', () => {
  it('exposes dimension/group wrappers', async () => {
    const dimension = new MockDimension();
    const group = new MockGroup(new Uint32Array([1, 2, 3]));
    const whenIdle = vi.fn(() => Promise.resolve());
    const handle: CFHandle = {
      dimension: () => dimension,
      group: () => group,
      whenIdle,
      dispose: vi.fn()
    };

    const adapter = adaptCrossfilter(handle);
    const dim = adapter.dimension('value');
    await dim.filter([0, 1]);
    const all = dim.group().all();
    expect(all).toEqual([
      { key: 0, value: 1 },
      { key: 1, value: 2 },
      { key: 2, value: 3 }
    ]);
    expect(whenIdle).toHaveBeenCalled();
  });
});
