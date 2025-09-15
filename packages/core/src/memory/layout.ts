export type BufferLayout = {
  columns: SharedArrayBuffer;
  refcount: SharedArrayBuffer;
  activeMask: SharedArrayBuffer;
  groups: SharedArrayBuffer;
};

export type LayoutPlan = {
  rowCount: number;
  dimensionCount: number;
  bins: number;
};

export function estimateLayout(plan: LayoutPlan) {
  const { rowCount, dimensionCount, bins } = plan;
  const columnBytes = rowCount * dimensionCount * 2;
  const refcountBytes = rowCount * 4;
  const maskBytes = Math.ceil(rowCount / 8);
  const histogramBytes = dimensionCount * bins * 4 * 2;

  return {
    columnBytes,
    refcountBytes,
    maskBytes,
    histogramBytes,
    total: columnBytes + refcountBytes + maskBytes + histogramBytes
  };
}
