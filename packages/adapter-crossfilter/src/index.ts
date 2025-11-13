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
      const dimensionHandle = handle.dimension(selector);
      return createAdapterDimension(dimensionHandle, handle);
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
  handle: CFHandle
): AdapterDimension {
  return {
    filter(range: [number, number]): Promise<void> {
      dimensionHandle.filter(range);
      return handle.whenIdle();
    },
    filterAll(): Promise<void> {
      dimensionHandle.clear();
      return handle.whenIdle();
    },
    group() {
      return createAdapterGroup(dimensionHandle.group());
    }
  };
}

function createAdapterGroup(groupHandle: GroupHandle): AdapterGroup {
  return {
    all() {
      const bins = groupHandle.bins();
      const keys = groupHandle.keys();
      const results: Array<{ key: number; value: number }> = new Array(bins.length);
      for (let i = 0; i < bins.length; i++) {
        results[i] = { key: keys[i], value: bins[i] };
      }
      return results;
    }
  };
}
