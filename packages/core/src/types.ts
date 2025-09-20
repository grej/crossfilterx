/**
 * @fileoverview Houses shared type definitions for CrossfilterX, including the
 *   public API surface (`CFHandle`), dataset descriptors consumed by ingest, and
 *   profiling metadata. Core modules such as `protocol.ts`, the benchmarks, and
 *   the demo import these types to ensure consistent contracts, while external
 *   consumers rely on the generated declarations.
 */
import type { ClearPlannerSnapshot } from './worker/clear-planner';

export type CFOptions = {
  mode?: 'worker';
  bins?: number;
  prewarmDims?: string[];
  valueColumnNames?: string[];
};

export type TypedArray =
  | Float32Array
  | Float64Array
  | Int32Array
  | Uint32Array
  | Int16Array
  | Uint16Array
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray;

export type ColumnarData = {
  columns: Record<string, TypedArray>;
  length?: number;
  categories?: Record<string, string[]>;
};

export interface DimensionHandle extends PromiseLike<DimensionHandle> {
  filter(rangeOrSet: [number, number] | Set<number>): DimensionHandle;
  clear(): DimensionHandle;
  group(options?: GroupOptions): GroupHandle;
}

export interface GroupOptions {
  coarseTargetBins?: number; // e.g., 64 for a 64-bin coarse view
}

export interface GroupHandle {
  bins(): Uint32Array; // Full resolution
  keys(): Uint16Array | Float32Array;
  count(): number;

  // NEW: Returns null if no coarsening configured
  coarse(): {
    bins(): Uint32Array;
    keys(): Uint16Array | Float32Array;
  } | null;

  reduceSum(valueAccessor: string | ((d: any) => number)): this;

  all(): Array<{
    key: string | number;
    value: {
      count: number;
      sum?: number;
      avg?: number;
    };
  }>;

  top(k: number): Promise<Array<{ key: string | number; value: number }>>;

  bottom(k: number): Promise<Array<{ key: string | number; value: number }>>;
}

export interface CFHandle {
  dimension(name: string | ((row: unknown) => number | string)): DimensionHandle;
  group(name: string | DimensionHandle, options?: GroupOptions): GroupHandle;
  whenIdle(): Promise<void>;
  dispose(): void;
  buildIndex(name: string): Promise<void>;
  indexStatus(name: string): IndexStatus | undefined;
  profile(): ProfileSnapshot | null;
  clearPlannerSnapshot(): ClearPlannerSnapshot;
}

export type IndexStatus = {
  ready: boolean;
  ms?: number;
  bytes?: number;
};

export type ProfileSnapshot = {
  clear?: {
    fallback: boolean;
    insideRows?: number;
    outsideRows?: number;
    insideMs?: number;
    outsideMs?: number;
    totalMs?: number;
    outsideFraction?: number;
    rangeBins?: number;
    buffered?: boolean;
  };
};
