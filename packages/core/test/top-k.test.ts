import { describe, expect, it } from 'vitest';

import { crossfilterX } from '../src';

describe('top-k queries', () => {
  it('returns top k results', async () => {
    const rows = [
      { value: 1 },
      { value: 2 },
      { value: 3 },
      { value: 4 },
      { value: 5 },
      { value: 5 },
      { value: 5 },
      { value: 4 },
      { value: 4 }
    ];
    const cf = crossfilterX(rows);
    const dim = cf.dimension('value');
    const group = dim.group();

    await cf.whenIdle();

    const top2 = await group.top(2);
    expect(top2.length).toBe(2);
    // The order is not guaranteed when counts are the same
    expect(top2[0].key).toBeCloseTo(5);
    expect(top2[1].key).toBeCloseTo(4);

    const bottom2 = await group.bottom(2);
    expect(bottom2.length).toBe(2);
    expect(bottom2[0].key).toBeCloseTo(1);
    expect(bottom2[1].key).toBeCloseTo(2);
  });
});
