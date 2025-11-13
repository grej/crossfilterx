/**
 * @fileoverview CSR (Compressed Sparse Row) Index Builder
 *
 * This module implements CSR indexing for efficient range queries on quantized dimensions.
 * A CSR index enables O(log n + k) range queries instead of O(n) full scans, crucial for
 * fast filter updates on large datasets.
 *
 * ## What is CSR?
 *
 * Compressed Sparse Row is a sparse matrix format adapted here for grouping row IDs by
 * their bin values. Instead of storing a 2D matrix, we store:
 * - **rowIdsByBin**: Flat array of row IDs, sorted by bin
 * - **binOffsets**: Pointers marking where each bin's rows start/end
 *
 * ## Structure
 *
 * For a column with values [2, 1, 2, 0, 1] (5 rows, 3 bins):
 *
 * ```
 * Bin 0: rows [3]
 * Bin 1: rows [1, 4]
 * Bin 2: rows [0, 2]
 *
 * rowIdsByBin:  [3, 1, 4, 0, 2]
 *                 ↑  ↑-----↑  ↑--↑
 * binOffsets:   [0, 1,    3,    5]
 *               bin0 bin1  bin2  end
 * ```
 *
 * ## Range Query Example
 *
 * To find all rows in bins 1-2:
 * ```typescript
 * const start = binOffsets[1];     // 1
 * const end = binOffsets[2 + 1];   // 5
 * const rows = rowIdsByBin.slice(start, end);  // [1, 4, 0, 2]
 * ```
 *
 * ## Performance Characteristics
 *
 * - **Build time**: O(n + b) where n = rows, b = bins
 *   - First pass: Count rows per bin (O(n))
 *   - Second pass: Place row IDs (O(n))
 *   - Prefix sum: Compute offsets (O(b))
 * - **Memory**: O(n + b)
 *   - rowIdsByBin: 4n bytes (Uint32Array)
 *   - binOffsets: 4(b+1) bytes (Uint32Array)
 * - **Query time**: O(k) where k = rows in range
 *   - Direct offset lookup: O(1)
 *   - Row extraction: O(k)
 *
 * ## When to Build CSR
 *
 * CSR indices are optional optimizations. Build when:
 * - Dataset is large (>100K rows)
 * - Dimension will be filtered frequently
 * - Filter selectivity is high (filters exclude many rows)
 *
 * Skip when:
 * - Small datasets (<10K rows) - overhead exceeds benefit
 * - Dimension rarely filtered
 * - Nearly all rows always active - full recompute is faster
 *
 * ## Algorithm Details
 *
 * The buildCsr() function uses a classic two-pass algorithm:
 *
 * **Pass 1 - Count**: Histogram of how many rows per bin
 * **Pass 2 - Place**: Use offsets + cursor to place each row ID in the correct position
 *
 * This is more efficient than sorting (O(n log n)) because bins are already quantized.
 *
 * @see protocol.ts for CSR usage in delta updates
 * @see select/delta.ts for range query implementations
 */
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
