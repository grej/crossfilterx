export function estimateTouchedRows(counts: Uint32Array, ranges: Array<{ rangeMin: number; rangeMax: number }>) {
  let total = 0;
  for (const range of ranges) {
    for (let bin = range.rangeMin; bin <= range.rangeMax; bin++) {
      total += counts[bin];
    }
  }
  return total;
}
