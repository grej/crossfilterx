/**
 * @fileoverview Houses shared type definitions for CrossfilterX, including the
 *   public API surface (`CFHandle`), dataset descriptors consumed by ingest, and
 *   profiling metadata. Core modules such as `protocol.ts`, the benchmarks, and
 *   the demo import these types to ensure consistent contracts, while external
 *   consumers rely on the generated declarations.
 */

export type CFOptions = {
  mode?: 'worker';
  bins?: number;
  prewarmDims?: string[];
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
  group(): GroupHandle;
}

export interface GroupHandle {
  bins(): Uint32Array;
  keys(): Uint16Array | Float32Array;
  count(): number;
}

export interface CFHandle {
  dimension(name: string | ((row: unknown) => number | string)): DimensionHandle;
  group(name: string | DimensionHandle): GroupHandle;
  whenIdle(): Promise<void>;
  dispose(): void;
  buildIndex(name: string): Promise<void>;
  indexStatus(name: string): IndexStatus | undefined;
  profile(): ProfileSnapshot | null;
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
