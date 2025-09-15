export function estimateTouchedRows(counts: Uint32Array, ranges: Array<{ lo: number; hi: number }>) {
  let total = 0;
  for (const range of ranges) {
    for (let bin = range.lo; bin <= range.hi; bin++) {
      total += counts[bin];
    }
  }
  return total;
}
