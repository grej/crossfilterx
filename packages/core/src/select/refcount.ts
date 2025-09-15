export class Refcount {
  private readonly counts: Uint32Array;
  private readonly requiredDims: number;

  constructor(rowCount: number, requiredDims: number) {
    this.counts = new Uint32Array(rowCount);
    this.requiredDims = requiredDims;
  }

  increment(row: number) {
    const next = ++this.counts[row];
    return next === this.requiredDims;
  }

  decrement(row: number) {
    const next = --this.counts[row];
    return next === this.requiredDims - 1;
  }
}
