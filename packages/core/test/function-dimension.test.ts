import { describe, expect, it } from 'vitest';

import { crossfilterX } from '../src';

const sampleRows = [
  { value: 1, category: 'a' },
  { value: 2, category: 'b' },
  { value: 3, category: 'a' },
  { value: 4, category: 'c' }
];

describe('function-based dimensions', () => {
  it('supports numeric accessors on row data', async () => {
    const cf = crossfilterX(sampleRows);
    const dim = cf.dimension((row: { value: number }) => row.value * 2);
    await dim;

    const group = dim.group();

    dim.filter([4, 8]);
    await cf.whenIdle();

    const bins = group.bins();
    const total = bins.reduce((sum, count) => sum + count, 0);
    expect(total).toBe(3);
  });

  it('supports string accessors on columnar data', async () => {
    const columnar = {
      columns: {
        value: Float32Array.from([5, 6, 7, 8]),
        type: Uint16Array.from([0, 1, 0, 2])
      },
      categories: {
        type: ['x', 'y', 'z']
      },
      length: 4
    } as const;

    const cf = crossfilterX(columnar);
    const dim = cf.dimension((row: { type: string }) => row.type.toUpperCase());
    await dim;

    const group = dim.group();
    dim.filter([0, 1]);
    await cf.whenIdle();

    const bins = group.bins();
    const total = bins.reduce((sum, count) => sum + count, 0);
    expect(total).toBeGreaterThan(0);
  });
});
