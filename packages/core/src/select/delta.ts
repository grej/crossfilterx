import type { CsrIndex } from '../indexers/csr';
import { Refcount } from './refcount';

export type Range = { rangeMin: number; rangeMax: number };

export type RangeDiff = {
  added: Range[];
  removed: Range[];
};

export type HistogramUpdater = (rowId: number, sign: 1 | -1) => void;

export function applyDelta(
  index: CsrIndex,
  diff: RangeDiff,
  refcount: Refcount,
  updateHistogram: HistogramUpdater
) {
  const { rowIdsByBin, binOffsets } = index;

  for (const range of diff.added) {
    for (let bin = range.rangeMin; bin <= range.rangeMax; bin++) {
      const start = binOffsets[bin];
      const end = binOffsets[bin + 1];
      for (let cursor = start; cursor < end; cursor++) {
        const rowId = rowIdsByBin[cursor];
        if (refcount.increment(rowId)) {
          updateHistogram(rowId, 1);
        }
      }
    }
  }

  for (const range of diff.removed) {
    for (let bin = range.rangeMin; bin <= range.rangeMax; bin++) {
      const start = binOffsets[bin];
      const end = binOffsets[bin + 1];
      for (let cursor = start; cursor < end; cursor++) {
        const rowId = rowIdsByBin[cursor];
        if (refcount.decrement(rowId)) {
          updateHistogram(rowId, -1);
        }
      }
    }
  }
}
