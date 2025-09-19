import { describe, expect, it } from 'vitest';

import { createLayout } from '../src/memory/layout';

describe('createLayout', () => {
  it('allocates shared views with consistent alignment', () => {
    const layout = createLayout({
      rowCount: 4,
      dimensions: [{ bins: 8 }, { bins: 16 }]
    });

    expect(layout.columns).toHaveLength(2);
    expect(layout.columns[0]).toBeInstanceOf(Uint16Array);
    expect(layout.columns[0].length).toBe(4);
    expect(layout.columns[1].length).toBe(4);

    layout.columns[0][0] = 3;
    layout.columns[1][0] = 5;
    expect(layout.columns[0][0]).toBe(3);
    expect(layout.columns[1][0]).toBe(5);

    expect(layout.histograms).toHaveLength(2);
    expect(layout.histograms[0].front.length).toBe(8);
    expect(layout.histograms[1].front.length).toBe(16);

    const maskBytes = Math.ceil(4 / 8);
    expect(layout.activeMask.length).toBe(maskBytes);
    expect(layout.byteLength).toBeGreaterThan(0);
  });
});
