import { test, expect } from '@playwright/test';

/**
 * Deep Comparison Benchmark Tests
 *
 * Automatically runs comprehensive benchmarks comparing CrossfilterX vs Crossfilter2
 * across different dataset sizes and dimensionalities
 */

interface BenchmarkResult {
  config: { size: number; dimensions: number };
  crossfilterX: any;
  crossfilter2: any;
  timestamp: string;
}

test.describe('Deep Comparison Benchmarks', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/deep-comparison.html');

    // Wait for page to be ready
    await page.waitForFunction(
      () => {
        // @ts-ignore
        return typeof window.crossfilter !== 'undefined';
      },
      { timeout: 10000 }
    );
  });

  test('loads and initializes correctly', async ({ page }) => {
    // Verify Crossfilter2 is loaded
    const crossfilterAvailable = await page.evaluate(() => {
      // @ts-ignore
      return typeof window.crossfilter !== 'undefined';
    });

    expect(crossfilterAvailable).toBe(true);

    // Verify buttons are present
    await expect(page.locator('#run-benchmark')).toBeVisible();
    await expect(page.locator('#run-all-sizes')).toBeVisible();
    await expect(page.locator('#run-all-dimensions')).toBeVisible();
  });

  test('runs benchmark with 1,000 rows and 4 dimensions', async ({ page }) => {
    // Select 1,000 rows
    await page.locator('input[name="size"][value="1000"]').click();

    // Select 4 dimensions
    await page.locator('input[name="dimensions"][value="4"]').click();

    // Run benchmark
    await page.locator('#run-benchmark').click();

    // Wait for completion
    await page.waitForFunction(
      () => {
        const status = document.querySelector('#status-bar');
        return status?.classList.contains('complete');
      },
      { timeout: 60000 }
    );

    // Verify results are displayed
    await expect(page.locator('#results')).toBeVisible();

    // Get results
    const results = await page.evaluate(() => {
      // @ts-ignore
      return window.allResults || [];
    });

    expect(results.length).toBeGreaterThan(0);

    const result = results[0];
    console.log('1K rows, 4 dims:', {
      cfx_ingest: result.crossfilterX.ingestTime.toFixed(2) + 'ms',
      cf_ingest: result.crossfilter2.ingestTime.toFixed(2) + 'ms',
      cfx_filter: result.crossfilterX.avgFilterTime.toFixed(2) + 'ms',
      cf_filter: result.crossfilter2.avgFilterTime.toFixed(2) + 'ms',
    });
  });

  test('runs benchmark with 50,000 rows and 4 dimensions', async ({ page }) => {
    // Select 50,000 rows (default)
    await page.locator('input[name="size"][value="50000"]').click();

    // Select 4 dimensions (default)
    await page.locator('input[name="dimensions"][value="4"]').click();

    // Run benchmark
    await page.locator('#run-benchmark').click();

    // Wait for completion (longer timeout for larger dataset)
    await page.waitForFunction(
      () => {
        const status = document.querySelector('#status-bar');
        return status?.classList.contains('complete');
      },
      { timeout: 120000 }
    );

    // Verify results
    await expect(page.locator('#results')).toBeVisible();

    const results = await page.evaluate(() => {
      // @ts-ignore
      return window.allResults || [];
    });

    expect(results.length).toBeGreaterThan(0);

    const result = results[results.length - 1];
    console.log('50K rows, 4 dims:', {
      cfx_ingest: result.crossfilterX.ingestTime.toFixed(2) + 'ms',
      cf_ingest: result.crossfilter2.ingestTime.toFixed(2) + 'ms',
      cfx_filter: result.crossfilterX.avgFilterTime.toFixed(2) + 'ms',
      cf_filter: result.crossfilter2.avgFilterTime.toFixed(2) + 'ms',
      speedup: (result.crossfilter2.avgFilterTime / result.crossfilterX.avgFilterTime).toFixed(2) + 'x',
    });

    // Performance assertions
    expect(result.crossfilterX.ingestTime).toBeLessThan(10000); // Under 10s
    expect(result.crossfilterX.avgFilterTime).toBeLessThan(200); // Under 200ms
  });

  test('runs benchmark with 100,000 rows and 4 dimensions', async ({ page }) => {
    await page.locator('input[name="size"][value="100000"]').click();
    await page.locator('input[name="dimensions"][value="4"]').click();

    await page.locator('#run-benchmark').click();

    await page.waitForFunction(
      () => {
        const status = document.querySelector('#status-bar');
        return status?.classList.contains('complete');
      },
      { timeout: 180000 }
    );

    const results = await page.evaluate(() => {
      // @ts-ignore
      return window.allResults || [];
    });

    const result = results[results.length - 1];
    console.log('100K rows, 4 dims:', {
      cfx_ingest: result.crossfilterX.ingestTime.toFixed(2) + 'ms',
      cf_ingest: result.crossfilter2.ingestTime.toFixed(2) + 'ms',
      cfx_filter: result.crossfilterX.avgFilterTime.toFixed(2) + 'ms',
      cf_filter: result.crossfilter2.avgFilterTime.toFixed(2) + 'ms',
      speedup: (result.crossfilter2.avgFilterTime / result.crossfilterX.avgFilterTime).toFixed(2) + 'x',
    });
  });

  test('runs benchmark with 50,000 rows and 8 dimensions', async ({ page }) => {
    await page.locator('input[name="size"][value="50000"]').click();
    await page.locator('input[name="dimensions"][value="8"]').click();

    await page.locator('#run-benchmark').click();

    await page.waitForFunction(
      () => {
        const status = document.querySelector('#status-bar');
        return status?.classList.contains('complete');
      },
      { timeout: 180000 }
    );

    const results = await page.evaluate(() => {
      // @ts-ignore
      return window.allResults || [];
    });

    const result = results[results.length - 1];
    console.log('50K rows, 8 dims:', {
      cfx_ingest: result.crossfilterX.ingestTime.toFixed(2) + 'ms',
      cf_ingest: result.crossfilter2.ingestTime.toFixed(2) + 'ms',
      cfx_filter: result.crossfilterX.avgFilterTime.toFixed(2) + 'ms',
      cf_filter: result.crossfilter2.avgFilterTime.toFixed(2) + 'ms',
      speedup: (result.crossfilter2.avgFilterTime / result.crossfilterX.avgFilterTime).toFixed(2) + 'x',
    });
  });

  test('runs benchmark with 50,000 rows and 16 dimensions', async ({ page }) => {
    await page.locator('input[name="size"][value="50000"]').click();
    await page.locator('input[name="dimensions"][value="16"]').click();

    await page.locator('#run-benchmark').click();

    await page.waitForFunction(
      () => {
        const status = document.querySelector('#status-bar');
        return status?.classList.contains('complete');
      },
      { timeout: 180000 }
    );

    const results = await page.evaluate(() => {
      // @ts-ignore
      return window.allResults || [];
    });

    const result = results[results.length - 1];
    console.log('50K rows, 16 dims:', {
      cfx_ingest: result.crossfilterX.ingestTime.toFixed(2) + 'ms',
      cf_ingest: result.crossfilter2.ingestTime.toFixed(2) + 'ms',
      cfx_filter: result.crossfilterX.avgFilterTime.toFixed(2) + 'ms',
      cf_filter: result.crossfilter2.avgFilterTime.toFixed(2) + 'ms',
      speedup: (result.crossfilter2.avgFilterTime / result.crossfilterX.avgFilterTime).toFixed(2) + 'x',
    });
  });

  test('comprehensive: all sizes with 4 dimensions', async ({ page }) => {
    test.setTimeout(600000); // 10 minute timeout for comprehensive test

    await page.locator('input[name="dimensions"][value="4"]').click();
    await page.locator('#run-all-sizes').click();

    // Wait for all benchmarks to complete
    await page.waitForFunction(
      () => {
        const status = document.querySelector('#status-text')?.textContent;
        return status?.includes('Completed all size benchmarks');
      },
      { timeout: 540000 }
    );

    // Get all results
    const results: BenchmarkResult[] = await page.evaluate(() => {
      // @ts-ignore
      return window.allResults || [];
    });

    // Should have 6 results (one for each size)
    expect(results.length).toBeGreaterThanOrEqual(6);

    // Log comprehensive results
    console.log('\n=== COMPREHENSIVE SIZE COMPARISON (4 dimensions) ===\n');

    const table = results.map((r) => ({
      Size: r.config.size.toLocaleString(),
      'CFX Ingest': r.crossfilterX.ingestTime.toFixed(1) + 'ms',
      'CF2 Ingest': r.crossfilter2.ingestTime.toFixed(1) + 'ms',
      'CFX Filter': r.crossfilterX.avgFilterTime.toFixed(2) + 'ms',
      'CF2 Filter': r.crossfilter2.avgFilterTime.toFixed(2) + 'ms',
      'Speedup': (r.crossfilter2.avgFilterTime / r.crossfilterX.avgFilterTime).toFixed(2) + 'x',
    }));

    console.table(table);

    // Export results
    const json = JSON.stringify(results, null, 2);
    console.log('\nFull results available in browser console or export');

    // Verify performance characteristics
    results.forEach((result) => {
      // Ingest should scale roughly linearly
      const expectedIngestTime = (result.config.size / 1000) * 10; // ~10ms per 1K rows
      expect(result.crossfilterX.ingestTime).toBeLessThan(expectedIngestTime * 2); // 2x margin

      // Filter time should remain relatively constant (not scale with size)
      expect(result.crossfilterX.avgFilterTime).toBeLessThan(500); // Under 500ms for any size
    });
  });

  test('comprehensive: all dimensions with 50,000 rows', async ({ page }) => {
    test.setTimeout(600000); // 10 minute timeout

    await page.locator('input[name="size"][value="50000"]').click();
    await page.locator('#run-all-dimensions').click();

    await page.waitForFunction(
      () => {
        const status = document.querySelector('#status-text')?.textContent;
        return status?.includes('Completed all dimension benchmarks');
      },
      { timeout: 540000 }
    );

    const results: BenchmarkResult[] = await page.evaluate(() => {
      // @ts-ignore
      return window.allResults || [];
    });

    // Should have 4 results (one for each dimension count)
    expect(results.length).toBeGreaterThanOrEqual(4);

    console.log('\n=== COMPREHENSIVE DIMENSION COMPARISON (50K rows) ===\n');

    const table = results.map((r) => ({
      Dimensions: r.config.dimensions,
      'CFX Ingest': r.crossfilterX.ingestTime.toFixed(1) + 'ms',
      'CF2 Ingest': r.crossfilter2.ingestTime.toFixed(1) + 'ms',
      'CFX Filter': r.crossfilterX.avgFilterTime.toFixed(2) + 'ms',
      'CF2 Filter': r.crossfilter2.avgFilterTime.toFixed(2) + 'ms',
      'Speedup': (r.crossfilter2.avgFilterTime / r.crossfilterX.avgFilterTime).toFixed(2) + 'x',
    }));

    console.table(table);

    // Verify scaling characteristics
    results.forEach((result) => {
      // Ingest should scale with dimensions
      const expectedIngestTime = result.config.dimensions * 200; // ~200ms per dimension
      expect(result.crossfilterX.ingestTime).toBeLessThan(expectedIngestTime * 2);

      // Filter time should not scale dramatically with dimensions
      expect(result.crossfilterX.avgFilterTime).toBeLessThan(1000); // Under 1s even with 16 dims
    });
  });

  test('exports results correctly', async ({ page }) => {
    // Run a benchmark first
    await page.locator('input[name="size"][value="10000"]').click();
    await page.locator('#run-benchmark').click();

    await page.waitForFunction(
      () => {
        const status = document.querySelector('#status-bar');
        return status?.classList.contains('complete');
      },
      { timeout: 60000 }
    );

    // Setup download listener
    const downloadPromise = page.waitForEvent('download');

    // Click export
    await page.locator('#export-results').click();

    // Wait for download
    const download = await downloadPromise;

    // Verify filename
    expect(download.suggestedFilename()).toMatch(/crossfilterx-comparison-\d+\.json/);

    // Read download content
    const content = await download.path();
    expect(content).toBeTruthy();
  });
});
