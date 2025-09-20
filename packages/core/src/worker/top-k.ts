import { BinaryHeap } from './heap';

export function computeTopK(
  histogram: Uint32Array,
  k: number,
  labels?: string[],
  isBottom: boolean = false
): Array<{ key: string | number; value: number }> {
  // Use min-heap for top-k, max-heap for bottom-k
  const heap = new BinaryHeap(
    k,
    (idx: number) => histogram[idx],
    !isBottom
  );

  // Single pass through histogram - O(N log k)
  for (let i = 0; i < histogram.length; i++) {
    if (histogram[i] > 0) {
      heap.insert(i);
    }
  }

  // Extract and map to results
  return heap.extract().map((idx) => ({
    key: labels?.[idx] ?? idx,
    value: histogram[idx]
  }));
}
