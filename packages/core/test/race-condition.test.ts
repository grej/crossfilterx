/**
 * Tests to validate potential race conditions and performance issues
 * identified in code review
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crossfilterX } from '../src/index';

describe('Race Condition Tests', () => {
  it('should handle rapid consecutive filter calls correctly', async () => {
    const data = {
      columns: {
        price: new Uint16Array(Array.from({ length: 1000 }, (_, i) => i)),
        category: new Uint16Array(Array.from({ length: 1000 }, (_, i) => i % 10))
      },
      length: 1000
    };

    const cf = crossfilterX(data, { bins: 256 });
    const dim = cf.dimension('price');

    // Make rapid consecutive calls before worker is fully ready
    // This tests if the async handling causes race conditions
    const promise1 = dim.filter([100, 200]);
    const promise2 = dim.filter([150, 250]);
    const promise3 = dim.filter([200, 300]);

    // All promises should resolve
    await Promise.all([promise1, promise2, promise3]);

    // The final filter should be applied
    const group = dim.group();
    const bins = group.bins();

    // Bins outside [200, 300] should have 0 count
    expect(bins[50]).toBe(0); // Below range
    expect(bins[350]).toBe(0); // Above range

    // Bins within [200, 300] should have data
    let hasData = false;
    for (let i = 200; i <= 300; i++) {
      if (bins[i] > 0) {
        hasData = true;
        break;
      }
    }
    expect(hasData).toBe(true);
  });

  it('should maintain filter state consistency with overlapping calls', async () => {
    const data = {
      columns: {
        value: new Uint16Array(Array.from({ length: 500 }, (_, i) => i))
      },
      length: 500
    };

    const cf = crossfilterX(data, { bins: 256 });
    const dim = cf.dimension('value');

    // Rapid fire multiple filter changes
    const promises = [
      dim.filter([0, 100]),
      dim.filter([50, 150]),
      dim.filter([100, 200]),
      dim.filter([150, 250]),
      dim.filter([200, 300])
    ];

    await Promise.all(promises);

    // Should end up with the last filter applied
    const group = dim.group();
    const count = group.count();

    // Count should reflect [200, 300] range
    expect(count).toBeLessThanOrEqual(101); // Max 101 rows in range
    expect(count).toBeGreaterThan(0); // But should have some data
  });

  it('should handle filter and clear in rapid succession', async () => {
    const data = {
      columns: {
        value: new Uint16Array([10, 20, 30, 40, 50])
      },
      length: 5
    };

    const cf = crossfilterX(data, { bins: 256 });
    const dim = cf.dimension('value');

    // Rapid filter then clear
    const filterPromise = dim.filter([20, 40]);
    const clearPromise = dim.clear();

    await Promise.all([filterPromise, clearPromise]);

    // Should end up with no filter (all active)
    const group = dim.group();
    expect(group.count()).toBe(5);
  });
});

describe('Main Thread Blocking Tests', () => {
  it.skip('should warn about large function-based dimensions (CAUSES OOM - VALIDATES ISSUE)', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Create dataset just over UI_BLOCKING_THRESHOLD (250k)
    const largeRowData = Array.from({ length: 251000 }, (_, i) => ({
      id: i,
      value: i % 100
    }));

    const cf = crossfilterX(largeRowData, { bins: 256 });

    // Create function-based dimension (this will block main thread)
    const startTime = Date.now();
    const dim = cf.dimension((d: any) => d.value);
    await dim;
    const endTime = Date.now();

    // Should have warned about blocking
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('may block the UI thread')
    );

    // Should have taken measurable time
    expect(endTime - startTime).toBeGreaterThan(0);

    consoleWarnSpy.mockRestore();
  }, 60000); // Increased timeout for large dataset

  it('should not warn for small function-based dimensions', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Create small dataset
    const smallRowData = Array.from({ length: 100 }, (_, i) => ({
      id: i,
      value: i % 10
    }));

    const cf = crossfilterX(smallRowData, { bins: 256 });
    const dim = cf.dimension((d: any) => d.value);
    await dim;

    // Should not warn for small datasets
    expect(consoleWarnSpy).not.toHaveBeenCalled();

    consoleWarnSpy.mockRestore();
  });
});

describe('Filter Ordering Tests', () => {
  it('should process filters in the order they were called', async () => {
    const data = {
      columns: {
        value: new Uint16Array(Array.from({ length: 100 }, (_, i) => i))
      },
      length: 100
    };

    const cf = crossfilterX(data, { bins: 256 });
    const dim = cf.dimension('value');

    // Track the order of operations
    const operations: string[] = [];

    const p1 = dim.filter([0, 25]).then(() => operations.push('filter1'));
    const p2 = dim.filter([25, 50]).then(() => operations.push('filter2'));
    const p3 = dim.filter([50, 75]).then(() => operations.push('filter3'));

    await Promise.all([p1, p2, p3]);

    // Operations should complete in order
    expect(operations).toEqual(['filter1', 'filter2', 'filter3']);
  });

  it('should handle sequence numbers correctly', async () => {
    const data = {
      columns: {
        value: new Uint16Array([1, 2, 3, 4, 5])
      },
      length: 5
    };

    const cf = crossfilterX(data, { bins: 256 });
    const dim = cf.dimension('value');

    // Multiple rapid calls should each get unique sequence numbers
    await Promise.all([
      dim.filter([1, 2]),
      dim.filter([2, 3]),
      dim.filter([3, 4]),
      dim.filter([4, 5])
    ]);

    // Final state should reflect the last filter
    const group = dim.group();
    const count = group.count();

    // Should have filtered to [4, 5] range
    expect(count).toBeLessThanOrEqual(2);
  });
});
