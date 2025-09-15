export class Histogram {
  readonly front: Uint32Array;
  readonly back: Uint32Array;

  constructor(binCount: number) {
    this.front = new Uint32Array(binCount);
    this.back = new Uint32Array(binCount);
  }

  add(bin: number, delta: number) {
    this.back[bin] += delta;
  }

  swap() {
    this.front.set(this.back);
  }
}

export function buildHistogram(column: Uint16Array, binCount: number) {
  const histogram = new Uint32Array(binCount);
  for (let i = 0; i < column.length; i++) {
    const bin = column[i];
    histogram[bin] += 1;
  }
  return histogram;
}
