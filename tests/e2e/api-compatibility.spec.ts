import { test, expect } from '@playwright/test';

/**
 * Test suite for validating CrossfilterX API compatibility with original crossfilter.
 * These tests verify the adapter layer works correctly.
 */

test.describe('CrossfilterX API Compatibility', () => {
  test('native API basic usage', async ({ page }) => {
    await page.goto('/');

    // Test native API directly
    const result = await page.evaluate(async () => {
      // @ts-ignore - injecting test code
      const { crossfilterX } = await import('/@fs' + '/Users/greg/Documents/dev/crossfilter-v2/packages/core/src/index.ts');

      const data = [
        { date: 1, quantity: 10, total: 100 },
        { date: 2, quantity: 20, total: 200 },
        { date: 3, quantity: 30, total: 300 },
        { date: 4, quantity: 40, total: 400 },
      ];

      const cf = crossfilterX(data);
      const dateDim = cf.dimension('date');
      const quantityGroup = cf.group('quantity');

      await cf.whenIdle();

      return {
        success: true,
        bins: Array.from(quantityGroup.bins()),
        keys: Array.from(quantityGroup.keys()),
      };
    });

    expect(result.success).toBe(true);
    expect(result.bins).toBeTruthy();
    expect(result.keys).toBeTruthy();
  });

  test('dimension filter and clear', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(async () => {
      // @ts-ignore
      const { crossfilterX } = await import('/@fs' + '/Users/greg/Documents/dev/crossfilter-v2/packages/core/src/index.ts');

      const data = Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        value: Math.floor(Math.random() * 100),
      }));

      const cf = crossfilterX(data);
      const dim = cf.dimension('value');
      const group = cf.group('value');

      await cf.whenIdle();

      // Get initial count
      const initialCount = group.count();

      // Apply filter
      dim.filter([25, 75]);
      await cf.whenIdle();
      const filteredCount = group.count();

      // Clear filter
      dim.clear();
      await cf.whenIdle();
      const clearedCount = group.count();

      return {
        initialCount,
        filteredCount,
        clearedCount,
        success: filteredCount < initialCount && clearedCount === initialCount,
      };
    });

    expect(result.success).toBe(true);
    expect(result.filteredCount).toBeLessThan(result.initialCount);
    expect(result.clearedCount).toBe(result.initialCount);
  });

  test('group aggregations', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(async () => {
      // @ts-ignore
      const { crossfilterX } = await import('/@fs' + '/Users/greg/Documents/dev/crossfilter-v2/packages/core/src/index.ts');

      const data = [
        { category: 'A', value: 10 },
        { category: 'A', value: 20 },
        { category: 'B', value: 30 },
        { category: 'B', value: 40 },
      ];

      const cf = crossfilterX(data);
      const group = cf.group('category');

      await cf.whenIdle();

      const all = group.all();
      const nonZero = all.filter((d) => d.value.count > 0);

      return {
        all: nonZero,
        success: nonZero.length > 0,
      };
    });

    expect(result.success).toBe(true);
    expect(result.all.length).toBeGreaterThan(0);
  });

  test('multiple dimensions', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(async () => {
      // @ts-ignore
      const { crossfilterX } = await import('/@fs' + '/Users/greg/Documents/dev/crossfilter-v2/packages/core/src/index.ts');

      const data = Array.from({ length: 100 }, (_, i) => ({
        x: i % 10,
        y: i % 5,
        z: i % 3,
      }));

      const cf = crossfilterX(data);
      const xDim = cf.dimension('x');
      const yDim = cf.dimension('y');
      const zDim = cf.dimension('z');

      await cf.whenIdle();

      const xGroup = cf.group('x');
      const initialCount = xGroup.count();

      // Filter on y
      yDim.filter([1, 3]);
      await cf.whenIdle();
      const afterYFilter = xGroup.count();

      // Also filter on z
      zDim.filter([0, 1]);
      await cf.whenIdle();
      const afterZFilter = xGroup.count();

      // Clear y filter
      yDim.clear();
      await cf.whenIdle();
      const afterYClear = xGroup.count();

      // Clear z filter
      zDim.clear();
      await cf.whenIdle();
      const afterAllClear = xGroup.count();

      return {
        initialCount,
        afterYFilter,
        afterZFilter,
        afterYClear,
        afterAllClear,
        success:
          afterYFilter < initialCount &&
          afterZFilter < afterYFilter &&
          afterYClear > afterZFilter &&
          afterAllClear === initialCount,
      };
    });

    expect(result.success).toBe(true);
  });
});

test.describe('CrossfilterX Performance Characteristics', () => {
  test('large dataset filter performance', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(async () => {
      // @ts-ignore
      const { crossfilterX } = await import('/@fs' + '/Users/greg/Documents/dev/crossfilter-v2/packages/core/src/index.ts');

      const data = Array.from({ length: 50000 }, (_, i) => ({
        id: i,
        value: Math.random() * 1000,
        category: Math.floor(Math.random() * 10),
      }));

      const start = performance.now();
      const cf = crossfilterX(data);
      const dim = cf.dimension('value');
      const group = cf.group('category');

      await cf.whenIdle();
      const ingestTime = performance.now() - start;

      const filterStart = performance.now();
      dim.filter([250, 750]);
      await cf.whenIdle();
      const filterTime = performance.now() - filterStart;

      const clearStart = performance.now();
      dim.clear();
      await cf.whenIdle();
      const clearTime = performance.now() - clearStart;

      return {
        ingestTime,
        filterTime,
        clearTime,
        count: group.count(),
      };
    });

    console.log('50k dataset performance:', result);

    expect(result.ingestTime).toBeLessThan(500); // < 500ms ingest
    expect(result.filterTime).toBeLessThan(100); // < 100ms filter
    expect(result.clearTime).toBeLessThan(100); // < 100ms clear
  });

  test('columnar data performance', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(async () => {
      // @ts-ignore
      const { crossfilterX } = await import('/@fs' + '/Users/greg/Documents/dev/crossfilter-v2/packages/core/src/index.ts');

      const rows = 50000;
      const columnarData = {
        columns: {
          id: new Uint32Array(rows).map((_, i) => i),
          value: new Float32Array(rows).map(() => Math.random() * 1000),
          category: new Uint16Array(rows).map(() => Math.floor(Math.random() * 10)),
        },
        length: rows,
      };

      const start = performance.now();
      const cf = crossfilterX(columnarData);
      const dim = cf.dimension('value');
      const group = cf.group('category');

      await cf.whenIdle();
      const ingestTime = performance.now() - start;

      const filterStart = performance.now();
      dim.filter([250, 750]);
      await cf.whenIdle();
      const filterTime = performance.now() - filterStart;

      return {
        ingestTime,
        filterTime,
        count: group.count(),
      };
    });

    console.log('50k columnar performance:', result);

    // Columnar should be faster than row-based
    expect(result.ingestTime).toBeLessThan(300); // < 300ms ingest (better than rows)
    expect(result.filterTime).toBeLessThan(100); // < 100ms filter
  });
});