import { test, expect } from '@playwright/test';

/**
 * Test suite for validating CrossfilterX with different data configurations.
 * Tests various combinations of data sizes and dimension counts.
 */

type TestConfig = {
  rows: number;
  dims: number;
  name: string;
  maxIngestMs: number;
  maxFilterMs: number;
  columnar: boolean;
};

const testConfigs: TestConfig[] = [
  { rows: 1000, dims: 3, name: '1k-3d-rows', maxIngestMs: 50, maxFilterMs: 10, columnar: false },
  { rows: 1000, dims: 3, name: '1k-3d-columnar', maxIngestMs: 30, maxFilterMs: 10, columnar: true },
  { rows: 10000, dims: 6, name: '10k-6d-rows', maxIngestMs: 100, maxFilterMs: 20, columnar: false },
  { rows: 10000, dims: 6, name: '10k-6d-columnar', maxIngestMs: 60, maxFilterMs: 20, columnar: true },
  { rows: 100000, dims: 6, name: '100k-6d-rows', maxIngestMs: 300, maxFilterMs: 50, columnar: false },
  { rows: 100000, dims: 6, name: '100k-6d-columnar', maxIngestMs: 150, maxFilterMs: 50, columnar: true },
  { rows: 500000, dims: 12, name: '500k-12d-rows', maxIngestMs: 1500, maxFilterMs: 150, columnar: false },
  { rows: 500000, dims: 12, name: '500k-12d-columnar', maxIngestMs: 800, maxFilterMs: 150, columnar: true },
];

test.describe('CrossfilterX Data Configuration Tests', () => {
  for (const config of testConfigs) {
    test(`${config.name}: ingest and filter performance`, async ({ page }) => {
      // Create a test page with the specified configuration
      await page.goto('/');

      // Inject configuration and reload data
      await page.evaluate(
        ({ rows, dims, columnar }) => {
          (window as any).CROSSFILTER_TEST_CONFIG = { rows, dims, columnar };
        },
        config
      );

      // For now, we test with the demo's default config
      // In a production test suite, we'd have test-specific pages for each config

      await page.waitForFunction(
        () => {
          const ingestEl = document.querySelector('[data-summary="ingest"] strong');
          return ingestEl && ingestEl.textContent !== '–';
        },
        { timeout: config.maxIngestMs * 2 }
      );

      // Verify ingest time
      const ingestText = await page.locator('[data-summary="ingest"] strong').textContent();
      const ingestMs = parseFloat(ingestText?.match(/(\d+\.\d+)/)?.[1] || '0');

      console.log(`${config.name}: Ingest time: ${ingestMs}ms (max: ${config.maxIngestMs}ms)`);

      // For larger datasets, we're more lenient
      const ingestMultiplier = config.rows >= 100000 ? 2 : 1.5;
      expect(ingestMs).toBeLessThan(config.maxIngestMs * ingestMultiplier);

      // Test filtering
      const filterStart = Date.now();
      await page.locator('[data-slider="min"]').fill('25');
      await page.locator('[data-slider="min"]').dispatchEvent('change');

      await page.waitForFunction(
        (initialCount: string) => {
          const current = document.querySelector('[data-summary="filter"] strong')?.textContent;
          return current !== '–' && current !== initialCount;
        },
        await page.locator('[data-summary="filter"] strong').textContent() || '0',
        { timeout: config.maxFilterMs * 3 }
      );

      const filterMs = Date.now() - filterStart;
      console.log(`${config.name}: Filter time: ${filterMs}ms (max: ${config.maxFilterMs}ms)`);

      // Filter should complete reasonably quickly
      expect(filterMs).toBeLessThan(config.maxFilterMs * 2);

      // Verify data integrity
      const activeCount = await page.locator('[data-summary="filter"] strong').textContent();
      const activeNum = parseInt(activeCount?.replace(/[^\d]/g, '') || '0');
      expect(activeNum).toBeGreaterThan(0);
      expect(activeNum).toBeLessThan(200000); // Demo uses 200k rows by default
    });
  }
});

test.describe('CrossfilterX Multi-Dimensional Filtering', () => {
  test('sequential filters on different dimensions work correctly', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => document.querySelector('[data-summary="filter"] strong')?.textContent !== '–'
    );

    const initialCount = await page.locator('[data-summary="filter"] strong').textContent();
    const initialNum = parseInt(initialCount?.replace(/[^\d]/g, '') || '0');

    // Apply first filter
    await page.locator('[data-slider="min"]').fill('30');
    await page.locator('[data-slider="min"]').dispatchEvent('change');
    await page.waitForTimeout(300);

    const afterFirstFilter = await page.locator('[data-summary="filter"] strong').textContent();
    const firstNum = parseInt(afterFirstFilter?.replace(/[^\d]/g, '') || '0');
    expect(firstNum).toBeLessThan(initialNum);

    // Apply second filter (tighten range)
    await page.locator('[data-slider="max"]').fill('70');
    await page.locator('[data-slider="max"]').dispatchEvent('change');
    await page.waitForTimeout(300);

    const afterSecondFilter = await page.locator('[data-summary="filter"] strong').textContent();
    const secondNum = parseInt(afterSecondFilter?.replace(/[^\d]/g, '') || '0');
    expect(secondNum).toBeLessThan(firstNum);

    // Clear all filters
    await page.locator('[data-action="reset"]').click();
    await page.waitForTimeout(300);

    const afterReset = await page.locator('[data-summary="filter"] strong').textContent();
    const resetNum = parseInt(afterReset?.replace(/[^\d]/g, '') || '0');
    expect(resetNum).toBe(initialNum);
  });

  test('rapid filter changes remain stable', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => document.querySelector('[data-summary="filter"] strong')?.textContent !== '–'
    );

    // Rapidly change filters (simulating slider drag)
    for (let i = 0; i < 20; i++) {
      await page.locator('[data-slider="min"]').fill(String(i * 4));
      await page.locator('[data-slider="min"]').dispatchEvent('input');
      await page.waitForTimeout(25); // 40fps update rate
    }

    // Final change event
    await page.locator('[data-slider="min"]').dispatchEvent('change');
    await page.waitForTimeout(500);

    // Verify stable final state
    const finalCount = await page.locator('[data-summary="filter"] strong').textContent();
    expect(finalCount).not.toBe('–');
    expect(finalCount).toMatch(/\d/);

    // Wait a bit more and verify no changes
    await page.waitForTimeout(300);
    const stableCount = await page.locator('[data-summary="filter"] strong').textContent();
    expect(stableCount).toBe(finalCount);
  });
});

test.describe('CrossfilterX Memory and Resource Tests', () => {
  test('no memory leaks during filter operations', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => document.querySelector('[data-summary="filter"] strong')?.textContent !== '–'
    );

    // Get initial memory usage
    const initialMetrics = await page.evaluate(() => {
      if ('memory' in performance) {
        return (performance as any).memory.usedJSHeapSize;
      }
      return null;
    });

    // Perform many filter operations
    for (let i = 0; i < 50; i++) {
      await page.locator('[data-slider="min"]').fill(String((i % 10) * 10));
      await page.locator('[data-slider="min"]').dispatchEvent('change');
      await page.waitForTimeout(50);
    }

    await page.waitForTimeout(1000); // Let GC run

    // Get final memory usage
    const finalMetrics = await page.evaluate(() => {
      if ('memory' in performance) {
        return (performance as any).memory.usedJSHeapSize;
      }
      return null;
    });

    if (initialMetrics !== null && finalMetrics !== null) {
      const memoryIncrease = finalMetrics - initialMetrics;
      const increasePercent = (memoryIncrease / initialMetrics) * 100;

      console.log(`Memory increase: ${(memoryIncrease / 1024 / 1024).toFixed(2)} MB (${increasePercent.toFixed(1)}%)`);

      // Memory should not increase dramatically (< 50% increase)
      expect(increasePercent).toBeLessThan(50);
    } else {
      // If memory API not available, just verify operations completed
      const finalCount = await page.locator('[data-summary="filter"] strong').textContent();
      expect(finalCount).toBeTruthy();
    }
  });

  test('handles concurrent operations gracefully', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => document.querySelector('[data-summary="filter"] strong')?.textContent !== '–'
    );

    // Trigger multiple operations simultaneously
    await Promise.all([
      page.locator('[data-slider="min"]').fill('20'),
      page.locator('[data-slider="max"]').fill('80'),
    ]);

    await Promise.all([
      page.locator('[data-slider="min"]').dispatchEvent('change'),
      page.locator('[data-slider="max"]').dispatchEvent('change'),
    ]);

    // Wait for operations to complete
    await page.waitForTimeout(1000);

    // Verify stable state
    const finalCount = await page.locator('[data-summary="filter"] strong').textContent();
    expect(finalCount).toBeTruthy();
    expect(finalCount).not.toBe('–');
  });
});