import { describe, expect, it } from 'vitest';

import { crossfilterX } from '../src';

describe('bin coarsening', () => {
  it('generates coarse histograms', async () => {
    const rows = Array.from({ length: 1024 }, (_, i) => ({ value: i }));
    const cf = crossfilterX(rows, {
      bins: 1024,
      dimensions: {
        value: {
          coarseTargetBins: 64
        }
      }
    });
    const dim = cf.dimension('value');
    const group = dim.group();

    await cf.whenIdle();

    const coarse = group.coarse();
    expect(coarse).not.toBeNull();

    if (coarse) {
      const coarseBins = coarse.bins();
      expect(coarseBins.length).toBe(64);

      const total = coarseBins.reduce((sum, count) => sum + count, 0);
      expect(total).toBe(1024);
    }
  });
});
