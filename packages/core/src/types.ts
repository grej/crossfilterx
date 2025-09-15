export type CFOptions = {
  mode?: 'worker';
  bins?: number;
  prewarmDims?: string[];
};

export interface DimensionHandle extends PromiseLike<DimensionHandle> {
  filter(rangeOrSet: [number, number] | Set<number>): DimensionHandle;
  clear(): DimensionHandle;
}

export interface GroupHandle {
  bins(): Uint32Array;
  keys(): Uint16Array | Float32Array;
  count(): number;
}

export interface CFHandle {
  dimension(name: string | ((row: unknown) => number | string)): DimensionHandle;
  group(name: string): GroupHandle;
  whenIdle(): Promise<void>;
  dispose(): void;
}
