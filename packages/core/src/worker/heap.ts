export class BinaryHeap<T> {
  private heap: Array<[number, T]> = [];

  constructor(
    private k: number,
    private getValue: (item: T) => number,
    private isMinHeap: boolean = true
  ) {}

  insert(item: T): void {
    const value = this.getValue(item);

    if (this.heap.length < this.k) {
      this.heap.push([value, item]);
      this.bubbleUp(this.heap.length - 1);
    } else if (this.shouldReplace(value)) {
      this.heap[0] = [value, item];
      this.bubbleDown(0);
    }
  }

  private shouldReplace(value: number): boolean {
    return this.isMinHeap
      ? value > this.heap[0][0] // Min heap: replace if new value is larger
      : value < this.heap[0][0]; // Max heap: replace if new value is smaller
  }

  private bubbleUp(index: number): void {
    const parent = Math.floor((index - 1) / 2);
    if (parent >= 0 && this.compare(index, parent)) {
      this.swap(index, parent);
      this.bubbleUp(parent);
    }
  }

  private bubbleDown(index: number): void {
    const left = 2 * index + 1;
    const right = 2 * index + 2;
    let target = index;

    if (left < this.heap.length && this.compare(left, target)) {
      target = left;
    }
    if (right < this.heap.length && this.compare(right, target)) {
      target = right;
    }

    if (target !== index) {
      this.swap(index, target);
      this.bubbleDown(target);
    }
  }

  private compare(i: number, j: number): boolean {
    return this.isMinHeap
      ? this.heap[i][0] < this.heap[j][0]
      : this.heap[i][0] > this.heap[j][0];
  }

  private swap(i: number, j: number): void {
    const temp = this.heap[i];
    this.heap[i] = this.heap[j];
    this.heap[j] = temp;
  }

  extract(): T[] {
    return this.heap
      .map(([_, item]) => item)
      .sort((a, b) => {
        const aVal = this.getValue(a);
        const bVal = this.getValue(b);
        return this.isMinHeap ? bVal - aVal : aVal - bVal;
      });
  }
}
