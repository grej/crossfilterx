export type CsrIndex = {
  rowIdsByBin: Uint32Array;
  binOffsets: Uint32Array;
};

export function buildCsr(column: Uint16Array, binCount: number): CsrIndex {
  const rowCount = column.length;
  const counts = new Uint32Array(binCount);

  for (let i = 0; i < rowCount; i++) {
    counts[column[i]]++;
  }

  const offsets = new Uint32Array(binCount + 1);
  for (let bin = 0, acc = 0; bin < binCount; bin++) {
    offsets[bin] = acc;
    acc += counts[bin];
  }
  offsets[binCount] = rowCount;

  const cursor = offsets.slice();
  const rowIds = new Uint32Array(rowCount);
  for (let row = 0; row < rowCount; row++) {
    const bin = column[row];
    rowIds[cursor[bin]++] = row;
  }

  return { rowIdsByBin: rowIds, binOffsets: offsets };
}
