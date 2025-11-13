// Type declaration for WASM package
declare module './pkg/crossfilterx_kernels.js' {
  export function init_panic_hook(): void;
  export function scratchBuffer(size: number): Uint16Array;
  export function accumulateScratch(len: number, binCount: number): Uint32Array;
  export function accumulateBins(bins: Uint16Array, binCount: number): Uint32Array;
  export function resetMetrics(): void;
  export function takeMetrics(): unknown;
  export default function init(input?: { module_or_path?: unknown }): Promise<void>;
}
