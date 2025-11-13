import { describe, expect, it } from 'vitest';

import { crossfilterX } from '../src';

describe('reductions', () => {
  it('computes sum reduction', async () => {
    const rows = [
      { value: 1, amount: 10 },
      { value: 2, amount: 20 },
      { value: 3, amount: 30 },
      { value: 4, amount: 40 },
    ];
    const cf = crossfilterX(rows, { valueColumnNames: ['amount'] });
    const dim = cf.dimension('value');
    const group = dim.group().reduceSum('amount');

    await cf.whenIdle();

    const all = group.all();

    expect(all.length).toBe(4);
    expect(all[0].value.sum).toBe(10);
    expect(all[1].value.sum).toBe(20);
    expect(all[2].value.sum).toBe(30);
    expect(all[3].value.sum).toBe(40);
  });
});
