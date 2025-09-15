import type { CFHandle, DimensionHandle, GroupHandle } from '@crossfilterx/core';

export type AdapterDimension = {
  filter: (range: [number, number]) => Promise<void>;
  filterAll: () => Promise<void>;
  group: () => AdapterGroup;
};

export type AdapterGroup = {
  all: () => Array<{ key: number; value: number }>;
};

export function adaptCrossfilter(handle: CFHandle) {
  return {
    dimension(selector: string | ((row: unknown) => number)) {
      if (typeof selector !== 'string') {
        throw new Error('Function-based selectors are not supported in the adapter yet.');
      }
      const dimensionHandle = handle.dimension(selector);
      return createAdapterDimension(dimensionHandle, handle, selector);
    },
    whenIdle() {
      return handle.whenIdle();
    },
    dispose() {
      handle.dispose();
    }
  };
}

function createAdapterDimension(
  dimensionHandle: DimensionHandle,
  handle: CFHandle,
  name: string
): AdapterDimension {
  return {
    async filter(range: [number, number]) {
      await dimensionHandle.filter(range);
      await handle.whenIdle();
    },
    async filterAll() {
      await dimensionHandle.clear();
      await handle.whenIdle();
    },
    group() {
      return createAdapterGroup(handle.group(name));
    }
  };
}

function createAdapterGroup(groupHandle: GroupHandle): AdapterGroup {
  return {
    all() {
      const bins = groupHandle.bins();
      const results: Array<{ key: number; value: number }> = new Array(bins.length);
      for (let i = 0; i < bins.length; i++) {
        results[i] = { key: i, value: bins[i] };
      }
      return results;
    }
  };
}
