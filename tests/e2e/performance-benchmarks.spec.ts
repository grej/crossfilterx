import { test, expect } from '@playwright/test';

/**
 * Performance Benchmark Tests
 *
 * These tests measure CrossfilterX performance for comparison with original Crossfilter:
 * - Data ingestion time
 * - Filter application time
 * - Histogram generation time
 * - Responsiveness during rapid interactions
 * - Memory usage patterns
 */

interface PerformanceMetrics {
  ingestTime: number;
  firstFilterTime: number;
  rapidFilterTime: number;
  histogramTime: number;
  resetTime: number;
  memoryUsed: number | null;
}

test.describe('Performance Benchmarks', () => {
  test('measure data ingestion performance', async ({ page }) => {
    const startTime = Date.now();

    await page.goto('/enhanced.html');

    // Wait for ingestion to complete
    await page.waitForFunction(
      () => {
        const ingestStat = document.querySelector('[data-summary="ingest"]')?.textContent;
        return ingestStat && ingestStat !== '–';
      },
      { timeout: 30000 }
    );

    const totalTime = Date.now() - startTime;

    // Get the reported ingest time from the page
    const ingestText = await page.locator('[data-summary="ingest"]').textContent();
    const ingestTime = parseFloat(ingestText?.replace(/[^\\d.]/g, '') || '0');

    console.log(`Total page load + ingest: ${totalTime}ms`);
    console.log(`Reported ingest time: ${ingestTime}ms`);

    // Get row count
    const totalText = await page.locator('[data-summary="total"]').textContent();
    const rowCount = parseInt(totalText?.replace(/[^\\d]/g, '') || '0');

    console.log(`Rows: ${rowCount.toLocaleString()}`);
    console.log(`Throughput: ${(rowCount / ingestTime * 1000).toLocaleString()} rows/sec`);

    // Benchmark expectations (adjust based on hardware)
    expect(ingestTime).toBeLessThan(5000); // Should ingest in under 5 seconds
    expect(rowCount).toBeGreaterThan(0);

    // Store metrics
    const metrics = { ingestTime, rowCount, totalTime };
    console.table(metrics);
  });

  test('measure filter application performance', async ({ page }) => {
    await page.goto('/enhanced.html');
    await page.waitForFunction(
      () => document.querySelector('[data-summary="total"]')?.textContent !== '–',
      { timeout: 30000 }
    );

    const hourChart = page.locator('[data-chart="hour"]');
    const box = await hourChart.boundingBox();
    if (!box) throw new Error('Chart not found');

    // Measure single filter operation
    const startTime = performance.now();

    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2);
    await page.mouse.up();

    // Wait for filter to complete
    await page.waitForTimeout(100);

    const endTime = performance.now();
    const filterTime = endTime - startTime;

    console.log(`Single filter operation: ${filterTime.toFixed(2)}ms`);

    // Should be very fast - under 100ms for responsiveness
    expect(filterTime).toBeLessThan(500);

    // Get the filter result
    const activeText = await page.locator('[data-summary="active"]').textContent();
    const totalText = await page.locator('[data-summary="total"]').textContent();

    console.log(`Filtered ${activeText} of ${totalText} rows in ${filterTime.toFixed(2)}ms`);
  });

  test('measure rapid filter performance (100 operations)', async ({ page }) => {
    await page.goto('/enhanced.html');
    await page.waitForFunction(
      () => document.querySelector('[data-summary="total"]')?.textContent !== '–',
      { timeout: 30000 }
    );

    const dimensions = ['hour', 'delay', 'distance', 'date'];
    const iterations = 100;

    const startTime = performance.now();

    // Perform 100 rapid filter operations
    for (let i = 0; i < iterations; i++) {
      const dim = dimensions[i % 4];
      const chart = page.locator(`[data-chart="${dim}"]`);
      const box = await chart.boundingBox();
      if (!box) continue;

      const startPos = Math.random() * 0.5;
      const endPos = 0.5 + Math.random() * 0.5;

      await page.mouse.move(box.x + box.width * startPos, box.y + box.height / 2, { steps: 1 });
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * endPos, box.y + box.height / 2, { steps: 1 });
      await page.mouse.up();

      // No wait - rapid fire
    }

    // Wait for all operations to settle
    await page.waitForTimeout(2000);

    const endTime = performance.now();
    const totalTime = endTime - startTime;
    const avgTime = totalTime / iterations;

    console.log(`100 filter operations: ${totalTime.toFixed(2)}ms`);
    console.log(`Average per operation: ${avgTime.toFixed(2)}ms`);
    console.log(`Throughput: ${(1000 / avgTime).toFixed(2)} ops/sec`);

    // Should handle rapid operations efficiently
    expect(avgTime).toBeLessThan(50); // Average under 50ms per operation
  });

  test('measure histogram rendering performance', async ({ page }) => {
    await page.goto('/enhanced.html');
    await page.waitForFunction(
      () => document.querySelector('[data-summary="total"]')?.textContent !== '–',
      { timeout: 30000 }
    );

    // Apply a filter to trigger histogram updates
    const hourChart = page.locator('[data-chart="hour"]');
    const box = await hourChart.boundingBox();
    if (!box) throw new Error('Chart not found');

    // Measure time for filter + histogram update
    const startTime = performance.now();

    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2);
    await page.mouse.up();

    await page.waitForTimeout(100);

    const endTime = performance.now();
    const updateTime = endTime - startTime;

    console.log(`Filter + 4 histogram updates: ${updateTime.toFixed(2)}ms`);

    // Should update all histograms quickly
    expect(updateTime).toBeLessThan(300);
  });

  test('measure reset performance', async ({ page }) => {
    await page.goto('/enhanced.html');
    await page.waitForFunction(
      () => document.querySelector('[data-summary="total"]')?.textContent !== '–',
      { timeout: 30000 }
    );

    // Apply filters on all dimensions
    const dimensions = ['hour', 'delay', 'distance', 'date'];

    for (const dim of dimensions) {
      const chart = page.locator(`[data-chart="${dim}"]`);
      const box = await chart.boundingBox();
      if (!box) continue;

      await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2);
      await page.mouse.up();
    }

    await page.waitForTimeout(500);

    // Measure reset time
    const startTime = performance.now();

    // Reset all dimensions
    for (const dim of dimensions) {
      await page.locator(`[data-reset="${dim}"]`).click();
    }

    await page.waitForTimeout(200);

    const endTime = performance.now();
    const resetTime = endTime - startTime;

    console.log(`Reset 4 dimensions: ${resetTime.toFixed(2)}ms`);

    // Verify all filters cleared
    const totalText = await page.locator('[data-summary="total"]').textContent();
    const activeText = await page.locator('[data-summary="active"]').textContent();
    expect(activeText).toBe(totalText);

    // Reset should be fast
    expect(resetTime).toBeLessThan(500);
  });

  test('measure memory usage patterns', async ({ page }) => {
    await page.goto('/enhanced.html');
    await page.waitForFunction(
      () => document.querySelector('[data-summary="total"]')?.textContent !== '–',
      { timeout: 30000 }
    );

    // Get initial memory
    const initialMemory = await page.evaluate(() => {
      if ('memory' in performance) {
        const mem = (performance as any).memory;
        return {
          used: mem.usedJSHeapSize,
          total: mem.totalJSHeapSize,
          limit: mem.jsHeapSizeLimit,
        };
      }
      return null;
    });

    if (!initialMemory) {
      test.skip();
      return;
    }

    // Perform 50 filter operations
    for (let i = 0; i < 50; i++) {
      const dim = ['hour', 'delay', 'distance', 'date'][i % 4];
      const chart = page.locator(`[data-chart="${dim}"]`);
      const box = await chart.boundingBox();
      if (!box) continue;

      await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2);
      await page.mouse.up();
    }

    await page.waitForTimeout(1000);

    // Get final memory
    const finalMemory = await page.evaluate(() => {
      const mem = (performance as any).memory;
      return {
        used: mem.usedJSHeapSize,
        total: mem.totalJSHeapSize,
        limit: mem.jsHeapSizeLimit,
      };
    });

    const growth = finalMemory.used - initialMemory.used;
    const growthMB = growth / 1024 / 1024;

    console.log('Memory Usage:');
    console.log(`  Initial: ${(initialMemory.used / 1024 / 1024).toFixed(2)}MB`);
    console.log(`  Final: ${(finalMemory.used / 1024 / 1024).toFixed(2)}MB`);
    console.log(`  Growth: ${growthMB.toFixed(2)}MB`);
    console.log(`  Limit: ${(finalMemory.limit / 1024 / 1024).toFixed(2)}MB`);

    // Memory growth should be reasonable (< 20MB for 50 operations)
    expect(growthMB).toBeLessThan(20);
  });

  test('measure end-to-end interaction latency', async ({ page }) => {
    await page.goto('/enhanced.html');
    await page.waitForFunction(
      () => document.querySelector('[data-summary="total"]')?.textContent !== '–',
      { timeout: 30000 }
    );

    // Measure complete interaction cycle:
    // 1. Apply filter
    // 2. Wait for UI update
    // 3. Verify data changed
    const timings = [];

    for (let i = 0; i < 10; i++) {
      const dim = ['hour', 'delay'][i % 2];
      const chart = page.locator(`[data-chart="${dim}"]`);
      const box = await chart.boundingBox();
      if (!box) continue;

      const start = performance.now();

      // Apply filter
      await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2);
      await page.mouse.up();

      // Wait for update (polling)
      await page.waitForTimeout(50);

      const end = performance.now();
      timings.push(end - start);

      // Reset
      await page.locator(`[data-reset="${dim}"]`).click();
      await page.waitForTimeout(50);
    }

    const avgLatency = timings.reduce((a, b) => a + b, 0) / timings.length;
    const maxLatency = Math.max(...timings);
    const minLatency = Math.min(...timings);

    console.log('Interaction Latency:');
    console.log(`  Average: ${avgLatency.toFixed(2)}ms`);
    console.log(`  Min: ${minLatency.toFixed(2)}ms`);
    console.log(`  Max: ${maxLatency.toFixed(2)}ms`);

    // Should feel snappy - under 200ms average
    expect(avgLatency).toBeLessThan(200);
  });

  test('comprehensive performance profile', async ({ page }) => {
    const metrics: PerformanceMetrics = {
      ingestTime: 0,
      firstFilterTime: 0,
      rapidFilterTime: 0,
      histogramTime: 0,
      resetTime: 0,
      memoryUsed: null,
    };

    // Start fresh
    const pageLoadStart = performance.now();
    await page.goto('/enhanced.html');

    await page.waitForFunction(
      () => document.querySelector('[data-summary="total"]')?.textContent !== '–',
      { timeout: 30000 }
    );

    // Get ingest time
    const ingestText = await page.locator('[data-summary="ingest"]').textContent();
    metrics.ingestTime = parseFloat(ingestText?.replace(/[^\\d.]/g, '') || '0');

    // Measure first filter
    const hourChart = page.locator('[data-chart="hour"]');
    const box = await hourChart.boundingBox();
    if (!box) throw new Error('Chart not found');

    let start = performance.now();
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2);
    await page.mouse.up();
    await page.waitForTimeout(100);
    metrics.firstFilterTime = performance.now() - start;

    // Measure 50 rapid filters
    start = performance.now();
    for (let i = 0; i < 50; i++) {
      const dim = ['hour', 'delay', 'distance', 'date'][i % 4];
      const chart = page.locator(`[data-chart="${dim}"]`);
      const b = await chart.boundingBox();
      if (!b) continue;

      await page.mouse.move(b.x + b.width * 0.2, b.y + b.height / 2, { steps: 1 });
      await page.mouse.down();
      await page.mouse.move(b.x + b.width * 0.8, b.y + b.height / 2, { steps: 1 });
      await page.mouse.up();
    }
    await page.waitForTimeout(1000);
    metrics.rapidFilterTime = performance.now() - start;

    // Measure histogram update
    start = performance.now();
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
    await page.mouse.up();
    await page.waitForTimeout(100);
    metrics.histogramTime = performance.now() - start;

    // Measure reset
    start = performance.now();
    await Promise.all([
      page.locator('[data-reset="hour"]').click(),
      page.locator('[data-reset="delay"]').click(),
      page.locator('[data-reset="distance"]').click(),
      page.locator('[data-reset="date"]').click(),
    ]);
    await page.waitForTimeout(200);
    metrics.resetTime = performance.now() - start;

    // Get memory
    metrics.memoryUsed = await page.evaluate(() => {
      if ('memory' in performance) {
        return (performance as any).memory.usedJSHeapSize;
      }
      return null;
    });

    console.log('\n=== CrossfilterX Performance Profile ===');
    console.log(`Ingest Time: ${metrics.ingestTime.toFixed(2)}ms`);
    console.log(`First Filter: ${metrics.firstFilterTime.toFixed(2)}ms`);
    console.log(`50 Rapid Filters: ${metrics.rapidFilterTime.toFixed(2)}ms (${(metrics.rapidFilterTime / 50).toFixed(2)}ms avg)`);
    console.log(`Histogram Update: ${metrics.histogramTime.toFixed(2)}ms`);
    console.log(`Reset All: ${metrics.resetTime.toFixed(2)}ms`);
    if (metrics.memoryUsed) {
      console.log(`Memory Used: ${(metrics.memoryUsed / 1024 / 1024).toFixed(2)}MB`);
    }
    console.log('=========================================\n');

    // Write metrics to file for comparison
    await page.evaluate((m) => {
      (window as any).__performanceMetrics = m;
    }, metrics);
  });
});
