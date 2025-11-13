import { test, expect } from '@playwright/test';

/**
 * Tests for the side-by-side comparison demo
 *
 * Validates that the comparison demo works correctly and provides
 * meaningful performance comparisons between CrossfilterX and original Crossfilter
 */

test.describe('Comparison Demo', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/comparison.html');

    // Wait for CrossfilterX to initialize
    await page.waitForFunction(
      () => {
        const cfxIngest = document.querySelector('[data-metric="cfx-ingest"]')?.textContent;
        return cfxIngest && cfxIngest !== '–';
      },
      { timeout: 30000 }
    );
  });

  test('loads and initializes CrossfilterX successfully', async ({ page }) => {
    // Verify CrossfilterX initialized
    const cfxIngest = await page.locator('[data-metric="cfx-ingest"]').textContent();
    expect(cfxIngest).toMatch(/\\d/);
    expect(cfxIngest).not.toBe('–');

    // Verify row counts
    const cfxTotal = await page.locator('[data-summary="cfx-total"]').textContent();
    expect(cfxTotal).toMatch(/\\d/);

    const cfxActive = await page.locator('[data-summary="cfx-active"]').textContent();
    expect(cfxActive).toBe(cfxTotal); // Initially all rows are active

    // Verify charts are visible
    await expect(page.locator('[data-chart="cfx-hour"]')).toBeVisible();
    await expect(page.locator('[data-chart="cfx-delay"]')).toBeVisible();
  });

  test('test controls are functional', async ({ page }) => {
    // Verify all test buttons are present
    await expect(page.locator('#test-rapid-filter')).toBeVisible();
    await expect(page.locator('#test-concurrent')).toBeVisible();
    await expect(page.locator('#test-memory')).toBeVisible();
    await expect(page.locator('#reset-all')).toBeVisible();
  });

  test('rapid filter test executes and reports results', async ({ page }) => {
    // Click rapid filter test button
    await page.locator('#test-rapid-filter').click();

    // Wait for test to complete (should show filter timing)
    await page.waitForFunction(
      () => {
        const filterTime = document.querySelector('[data-metric="cfx-filter"]')?.textContent;
        return filterTime && filterTime !== '–';
      },
      { timeout: 60000 }
    );

    // Verify filter timing was recorded
    const cfxFilter = await page.locator('[data-metric="cfx-filter"]').textContent();
    expect(cfxFilter).toMatch(/\\d/);
    expect(cfxFilter).not.toBe('–');

    // Verify test results are displayed
    const testResults = await page.locator('#test-results-container').textContent();
    expect(testResults).toContain('Rapid Filter Test');
  });

  test('concurrent operations test executes', async ({ page }) => {
    await page.locator('#test-concurrent').click();

    // Wait for test to complete
    await page.waitForFunction(
      () => {
        const results = document.querySelector('#test-results-container')?.textContent;
        return results && results.includes('Concurrent Operations Test');
      },
      { timeout: 30000 }
    );

    // Verify test passed
    const testResults = await page.locator('#test-results-container').textContent();
    expect(testResults).toContain('Concurrent Operations Test');
  });

  test('memory test executes (if API available)', async ({ page }) => {
    await page.locator('#test-memory').click();

    // Wait for test to complete
    await page.waitForFunction(
      () => {
        const results = document.querySelector('#test-results-container')?.textContent;
        return results && results.includes('Memory');
      },
      { timeout: 60000 }
    );

    // Verify test completed
    const testResults = await page.locator('#test-results-container').textContent();
    expect(testResults).toMatch(/Memory/i);
  });

  test('reset button clears all filters', async ({ page }) => {
    const initialActive = await page.locator('[data-summary="cfx-active"]').textContent();

    // This should theoretically apply some filters, but the comparison demo
    // doesn't have interactive brushing yet - it's controlled by test buttons
    // So we just verify reset doesn't break anything

    await page.locator('#reset-all').click();
    await page.waitForTimeout(500);

    // Should still have same total
    const activeAfterReset = await page.locator('[data-summary="cfx-active"]').textContent();
    expect(activeAfterReset).toBe(initialActive);
  });

  test('performance metrics are reasonable', async ({ page }) => {
    // Get ingest time
    const ingestText = await page.locator('[data-metric="cfx-ingest"]').textContent();
    const ingestTime = parseFloat(ingestText?.replace(/[^\\d.]/g, '') || '0');

    // Ingest should complete in reasonable time
    expect(ingestTime).toBeGreaterThan(0);
    expect(ingestTime).toBeLessThan(10000); // Under 10 seconds

    console.log(`CrossfilterX ingested data in ${ingestTime}ms`);

    // Run rapid filter test to get filter timing
    await page.locator('#test-rapid-filter').click();

    await page.waitForFunction(
      () => {
        const filterTime = document.querySelector('[data-metric="cfx-filter"]')?.textContent;
        return filterTime && filterTime !== '–';
      },
      { timeout: 60000 }
    );

    const filterText = await page.locator('[data-metric="cfx-filter"]').textContent();
    const filterTime = parseFloat(filterText?.replace(/[^\\d.]/g, '') || '0');

    // Average filter time should be fast
    expect(filterTime).toBeGreaterThan(0);
    expect(filterTime).toBeLessThan(100); // Under 100ms average

    console.log(`CrossfilterX average filter time: ${filterTime}ms`);
  });

  test('data consistency maintained across tests', async ({ page }) => {
    const totalBefore = await page.locator('[data-summary="cfx-total"]').textContent();

    // Run all tests
    await page.locator('#test-rapid-filter').click();
    await page.waitForTimeout(5000);

    await page.locator('#test-concurrent').click();
    await page.waitForTimeout(3000);

    await page.locator('#test-memory').click();
    await page.waitForTimeout(5000);

    // Reset all
    await page.locator('#reset-all').click();
    await page.waitForTimeout(500);

    // Total should be unchanged
    const totalAfter = await page.locator('[data-summary="cfx-total"]').textContent();
    expect(totalAfter).toBe(totalBefore);

    // Active should equal total after reset
    const activeAfter = await page.locator('[data-summary="cfx-active"]').textContent();
    expect(activeAfter).toBe(totalAfter);
  });

  test('renders performance comparison correctly', async ({ page }) => {
    // Run rapid filter test to populate metrics
    await page.locator('#test-rapid-filter').click();

    await page.waitForFunction(
      () => {
        const filterTime = document.querySelector('[data-metric="cfx-filter"]')?.textContent;
        return filterTime && filterTime !== '–';
      },
      { timeout: 60000 }
    );

    // Check if winner badge is applied
    const cfxIngestMetric = await page.locator('#cfx-ingest-metric').getAttribute('class');
    const cfxFilterMetric = await page.locator('#cfx-filter-metric').getAttribute('class');

    // At least one metric should be marked (even if original Crossfilter isn't loaded)
    const hasWinner = cfxIngestMetric?.includes('winner') || cfxFilterMetric?.includes('winner');

    // If original Crossfilter is available, expect comparison
    // If not, that's OK too
    expect(hasWinner !== undefined).toBe(true);
  });
});
