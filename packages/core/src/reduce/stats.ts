export class RunningStats {
  private sum = 0;
  private sumSquares = 0;
  private count = 0;

  add(value: number) {
    this.sum += value;
    this.sumSquares += value * value;
    this.count += 1;
  }

  remove(value: number) {
    this.sum -= value;
    this.sumSquares -= value * value;
    this.count -= 1;
  }

  mean() {
    return this.count === 0 ? 0 : this.sum / this.count;
  }

  variance() {
    if (this.count <= 1) return 0;
    const mean = this.mean();
    return this.sumSquares / this.count - mean * mean;
  }
}
