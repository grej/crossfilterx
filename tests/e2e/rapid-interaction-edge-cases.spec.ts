import { test, expect, type Page } from '@playwright/test';

/**
 * Edge Case Tests for Rapid Interactions
 *
 * These tests validate that CrossfilterX handles async edge cases properly:
 * - Rapid filter changes (slider dragging)
 * - Race conditions during concurrent filter operations
 * - Data consistency during fast interactions
 * - Memory stability under rapid filter changes
 * - Proper filter cancellation/coalescing
 */

test.describe('Rapid Interaction Edge Cases', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/enhanced.html');
    await page.waitForFunction(
      () => document.querySelector('[data-summary="total"]')?.textContent !== '–',
      { timeout: 30000 }
    );
  });

  test('rapid slider drags maintain data consistency', async ({ page }) => {
    // Get initial total
    const totalText = await page.locator('[data-summary="total"]').textContent();
    const total = parseInt(totalText?.replace(/[^\\d]/g, '') || '0');

    const hourChart = page.locator('[data-chart="hour"]');
    const box = await hourChart.boundingBox();
    if (!box) throw new Error('Chart not found');

    const centerY = box.y + box.height / 2;

    // Perform 20 rapid drag operations
    for (let i = 0; i < 20; i++) {
      const startX = box.x + box.width * (i % 10) / 10;
      const endX = box.x + box.width * ((i + 3) % 10) / 10;

      await page.mouse.move(startX, centerY, { steps: 1 });
      await page.mouse.down();
      await page.mouse.move(endX, centerY, { steps: 2 });
      await page.mouse.up();

      // No wait between operations - rapid fire
    }

    // Wait for all async operations to settle
    await page.waitForTimeout(1000);

    // Verify active count is valid (between 0 and total)
    const activeText = await page.locator('[data-summary="active"]').textContent();
    const active = parseInt(activeText?.replace(/[^\\d]/g, '') || '0');

    expect(active).toBeGreaterThanOrEqual(0);
    expect(active).toBeLessThanOrEqual(total);

    // Verify total hasn't changed (data consistency)
    const finalTotalText = await page.locator('[data-summary="total"]').textContent();
    expect(finalTotalText).toBe(totalText);
  });

  test('concurrent filter operations on multiple dimensions', async ({ page }) => {
    const totalText = await page.locator('[data-summary="total"]')?.textContent();
    const total = parseInt(totalText?.replace(/[^\\d]/g, '') || '0');

    // Apply filters on all 4 dimensions simultaneously
    const operations = [
      applyFilterAsync(page, 'hour', 0.2, 0.8),
      applyFilterAsync(page, 'delay', 0.3, 0.7),
      applyFilterAsync(page, 'distance', 0.1, 0.9),
      applyFilterAsync(page, 'date', 0.4, 0.6),
    ];

    await Promise.all(operations);

    // Wait for all filters to apply
    await page.waitForTimeout(1000);

    // Verify data is still consistent
    const activeText = await page.locator('[data-summary="active"]').textContent();
    const active = parseInt(activeText?.replace(/[^\\d]/g, '') || '0');

    expect(active).toBeGreaterThanOrEqual(0);
    expect(active).toBeLessThanOrEqual(total);

    // Verify total is still correct
    const finalTotalText = await page.locator('[data-summary="total"]').textContent();
    expect(finalTotalText).toBe(totalText);
  });

  test('rapid filter and reset cycles', async ({ page }) => {
    const totalText = await page.locator('[data-summary="total"]').textContent();

    // Perform 15 rapid filter + reset cycles
    for (let i = 0; i < 15; i++) {
      // Apply filter
      await applyFilterAsync(page, 'hour', 0.3, 0.7);

      // Immediately reset without waiting
      await page.locator('[data-reset="hour"]').click();
    }

    await page.waitForTimeout(1000);

    // After all resets, active should equal total
    const activeText = await page.locator('[data-summary="active"]').textContent();
    expect(activeText).toBe(totalText);
  });

  test('mouse drag with rapid direction changes', async ({ page }) => {
    const hourChart = page.locator('[data-chart="hour"]');
    const box = await hourChart.boundingBox();
    if (!box) throw new Error('Chart not found');

    const centerY = box.y + box.height / 2;
    const startX = box.x + box.width * 0.5;

    // Start drag
    await page.mouse.move(startX, centerY);
    await page.mouse.down();

    // Rapidly move mouse back and forth (simulating jittery drag)
    const positions = [0.6, 0.4, 0.7, 0.3, 0.8, 0.2, 0.9, 0.1, 0.5];
    for (const pos of positions) {
      await page.mouse.move(box.x + box.width * pos, centerY, { steps: 1 });
      await page.waitForTimeout(10); // Very rapid
    }

    await page.mouse.up();
    await page.waitForTimeout(500);

    // Should complete without errors and have a valid state
    const activeText = await page.locator('[data-summary="active"]').textContent();
    const active = parseInt(activeText?.replace(/[^\\d]/g, '') || '0');
    expect(active).toBeGreaterThanOrEqual(0);
  });

  test('interleaved filter operations stress test', async ({ page }) => {
    // This test applies filters, resets, and new filters in rapid succession
    // to test for race conditions

    const operations = [];

    for (let i = 0; i < 10; i++) {
      operations.push(
        (async () => {
          await applyFilterAsync(page, 'hour', Math.random() * 0.5, 0.5 + Math.random() * 0.5);
          await page.waitForTimeout(Math.random() * 100);
          await page.locator('[data-reset="hour"]').click();
        })()
      );
    }

    await Promise.all(operations);
    await page.waitForTimeout(1000);

    // Should end in consistent state
    const totalText = await page.locator('[data-summary="total"]').textContent();
    const activeText = await page.locator('[data-summary="active"]').textContent();

    // After all operations, verify consistency
    expect(activeText).toBe(totalText);
  });

  test('filter during data loading edge case', async ({ page }) => {
    // Navigate to page that will reload data
    await page.goto('/enhanced.html');

    // Try to apply filter immediately, even before data is fully loaded
    const hourChart = page.locator('[data-chart="hour"]');

    // Don't wait for initialization - apply filter immediately
    try {
      const box = await hourChart.boundingBox({ timeout: 1000 });
      if (box) {
        await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2);
        await page.mouse.up();
      }
    } catch {
      // Expected - might not be ready
    }

    // Wait for proper initialization
    await page.waitForFunction(
      () => document.querySelector('[data-summary="total"]')?.textContent !== '–',
      { timeout: 30000 }
    );

    // Verify system recovered to valid state
    const activeText = await page.locator('[data-summary="active"]').textContent();
    const active = parseInt(activeText?.replace(/[^\\d]/g, '') || '0');
    expect(active).toBeGreaterThanOrEqual(0);
  });

  test('double-click spam resilience', async ({ page }) => {
    // Apply a filter first
    await applyFilterAsync(page, 'delay', 0.3, 0.7);
    await page.waitForTimeout(200);

    const delayChart = page.locator('[data-chart="delay"]');

    // Spam double-clicks (10 rapid double-clicks)
    for (let i = 0; i < 10; i++) {
      await delayChart.dblclick();
    }

    await page.waitForTimeout(500);

    // Should end with filter cleared
    const totalText = await page.locator('[data-summary="total"]').textContent();
    const activeText = await page.locator('[data-summary="active"]').textContent();
    expect(activeText).toBe(totalText);
  });

  test('brush and reset button race condition', async ({ page }) => {
    // Apply brush and click reset simultaneously
    const operations = [];

    for (let i = 0; i < 10; i++) {
      operations.push(
        applyFilterAsync(page, 'distance', 0.2, 0.8),
        page.locator('[data-reset="distance"]').click()
      );
    }

    await Promise.all(operations);
    await page.waitForTimeout(1000);

    // Should be in consistent state
    const totalText = await page.locator('[data-summary="total"]').textContent();
    const activeText = await page.locator('[data-summary="active"]').textContent();
    const total = parseInt(totalText?.replace(/[^\\d]/g, '') || '0');
    const active = parseInt(activeText?.replace(/[^\\d]/g, '') || '0');

    expect(active).toBeGreaterThanOrEqual(0);
    expect(active).toBeLessThanOrEqual(total);
  });

  test('memory stability during 100 filter operations', async ({ page }) => {
    // Get initial memory if available
    const initialMemory = await page.evaluate(() => {
      if ('memory' in performance) {
        return (performance as any).memory.usedJSHeapSize;
      }
      return null;
    });

    // Perform 100 filter operations
    for (let i = 0; i < 100; i++) {
      const dim = ['hour', 'delay', 'distance', 'date'][i % 4];
      await applyFilterAsync(page, dim, Math.random() * 0.4, 0.6 + Math.random() * 0.4);

      if (i % 10 === 0) {
        await page.locator(`[data-reset="${dim}"]`).click();
      }

      // No delay - rapid fire
    }

    await page.waitForTimeout(2000);

    // Get final memory
    const finalMemory = await page.evaluate(() => {
      if ('memory' in performance) {
        return (performance as any).memory.usedJSHeapSize;
      }
      return null;
    });

    // Verify data still consistent
    const totalText = await page.locator('[data-summary="total"]').textContent();
    const activeText = await page.locator('[data-summary="active"]').textContent();
    const total = parseInt(totalText?.replace(/[^\\d]/g, '') || '0');
    const active = parseInt(activeText?.replace(/[^\\d]/g, '') || '0');

    expect(active).toBeGreaterThanOrEqual(0);
    expect(active).toBeLessThanOrEqual(total);

    // Check for massive memory leaks (if memory API available)
    if (initialMemory && finalMemory) {
      const growth = finalMemory - initialMemory;
      const growthMB = growth / 1024 / 1024;

      // Memory shouldn't grow by more than 50MB for 100 operations
      expect(growthMB).toBeLessThan(50);

      console.log(`Memory growth: ${growthMB.toFixed(2)}MB`);
    }
  });

  test('coordinated filtering with rapid changes', async ({ page }) => {
    const totalText = await page.locator('[data-summary="total"]').textContent();
    const total = parseInt(totalText?.replace(/[^\\d]/g, '') || '0');

    // Apply filter on hour
    await applyFilterAsync(page, 'hour', 0.3, 0.7);

    // Immediately apply filter on delay (while hour is still processing)
    await applyFilterAsync(page, 'delay', 0.2, 0.8);

    // Immediately apply filter on distance
    await applyFilterAsync(page, 'distance', 0.4, 0.9);

    await page.waitForTimeout(1000);

    // Active should be filtered by all three
    const activeText = await page.locator('[data-summary="active"]').textContent();
    const active = parseInt(activeText?.replace(/[^\\d]/g, '') || '0');

    expect(active).toBeLessThan(total);
    expect(active).toBeGreaterThanOrEqual(0);

    // Reset all
    await Promise.all([
      page.locator('[data-reset="hour"]').click(),
      page.locator('[data-reset="delay"]').click(),
      page.locator('[data-reset="distance"]').click(),
    ]);

    await page.waitForTimeout(500);

    // Should return to full dataset
    const resetActiveText = await page.locator('[data-summary="active"]').textContent();
    expect(resetActiveText).toBe(totalText);
  });
});

// Helper function to apply filter asynchronously
async function applyFilterAsync(
  page: Page,
  dimension: string,
  start: number,
  end: number
): Promise<void> {
  const chart = page.locator(`[data-chart="${dimension}"]`);
  const box = await chart.boundingBox();
  if (!box) throw new Error(`Chart ${dimension} not found`);

  const startX = box.x + box.width * start;
  const endX = box.x + box.width * end;
  const centerY = box.y + box.height / 2;

  await page.mouse.move(startX, centerY, { steps: 1 });
  await page.mouse.down();
  await page.mouse.move(endX, centerY, { steps: 2 });
  await page.mouse.up();
}
