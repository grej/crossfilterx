/**
 * Focused tests for async behavior and race conditions
 */

import { describe, it, expect } from 'vitest';
import { crossfilterX } from '../src/index';

describe('Async Filter Behavior', () => {
  it('should handle single filter call correctly', async () => {
    const data = {
      columns: {
        value: new Uint16Array([10, 20, 30, 40, 50])
      },
      length: 5
    };

    const cf = crossfilterX(data, { bins: 256 });
    const dim = cf.dimension('value');

    await dim.filter([20, 40]);

    const group = dim.group();
    const count = group.count();

    // Should have 3 rows: 20, 30, 40
    expect(count).toBe(3);
  });

  it('should handle two consecutive filter calls', async () => {
    const data = {
      columns: {
        value: new Uint16Array([10, 20, 30, 40, 50])
      },
      length: 5
    };

    const cf = crossfilterX(data, { bins: 256 });
    const dim = cf.dimension('value');

    // First filter
    await dim.filter([20, 40]);

    // Second filter - should override the first
    await dim.filter([30, 50]);

    const group = dim.group();
    const count = group.count();

    // Should have 3 rows: 30, 40, 50
    expect(count).toBe(3);
  });

  it('should handle rapid consecutive calls without awaiting', async () => {
    const data = {
      columns: {
        value: new Uint16Array([10, 20, 30, 40, 50])
      },
      length: 5
    };

    const cf = crossfilterX(data, { bins: 256 });
    const dim = cf.dimension('value');

    // Make multiple calls without awaiting each one
    const p1 = dim.filter([10, 20]);
    const p2 = dim.filter([20, 30]);
    const p3 = dim.filter([30, 40]);

    // Wait for all to complete
    await Promise.all([p1, p2, p3]);

    const group = dim.group();
    const count = group.count();

    // The last filter ([30, 40]) should be applied
    // This tests if there's a race condition
    expect(count).toBe(2); // rows 30 and 40
  });

  it('should handle filter then clear', async () => {
    const data = {
      columns: {
        value: new Uint16Array([10, 20, 30, 40, 50])
      },
      length: 5
    };

    const cf = crossfilterX(data, { bins: 256 });
    const dim = cf.dimension('value');

    await dim.filter([20, 30]);
    await dim.clear();

    const group = dim.group();
    const count = group.count();

    // After clear, all 5 rows should be active
    expect(count).toBe(5);
  });

  it('should handle rapid filter-clear-filter sequence', async () => {
    const data = {
      columns: {
        value: new Uint16Array([10, 20, 30, 40, 50])
      },
      length: 5
    };

    const cf = crossfilterX(data, { bins: 256 });
    const dim = cf.dimension('value');

    // Rapid sequence without individual awaits
    const p1 = dim.filter([20, 40]);
    const p2 = dim.clear();
    const p3 = dim.filter([30, 50]);

    await Promise.all([p1, p2, p3]);

    const group = dim.group();
    const count = group.count();

    // Final state should be [30, 50] filter
    expect(count).toBe(3); // rows 30, 40, 50
  });
});

describe('Function Dimension Behavior', () => {
  it('should handle small function-based dimensions', async () => {
    const rowData = [
      { id: 1, value: 10 },
      { id: 2, value: 20 },
      { id: 3, value: 30 }
    ];

    const cf = crossfilterX(rowData, { bins: 256 });
    const dim = cf.dimension((d: any) => d.value);

    await dim;

    const group = dim.group();
    expect(group.count()).toBe(3);
  });
});
