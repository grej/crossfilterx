import { test, expect, Page } from '@playwright/test';

// Test configurations for different data sizes and dimensions
const testConfigs = [
  { rows: 1000, dims: 3, name: '1k-3d' },
  { rows: 10000, dims: 6, name: '10k-6d' },
  { rows: 100000, dims: 6, name: '100k-6d' },
  { rows: 500000, dims: 12, name: '500k-12d' },
];

test.describe('CrossfilterX Core Functionality', () => {
  test('demo page loads successfully', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('CrossfilterX');
    await expect(page.locator('[data-summary="rows"] strong')).not.toHaveText('–');
  });

  test('worker initializes with SharedArrayBuffer support', async ({ page }) => {
    const workerLogs: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'log' || msg.type() === 'error') {
        workerLogs.push(msg.text());
      }
    });

    await page.goto('/');
    await page.waitForTimeout(2000);

    // Check for SharedArrayBuffer availability
    const hasSharedArrayBuffer = await page.evaluate(() => {
      return typeof SharedArrayBuffer !== 'undefined';
    });
    expect(hasSharedArrayBuffer).toBe(true);

    // Verify no critical errors
    const hasErrors = workerLogs.some((log) => log.includes('Error') && !log.includes('devtools'));
    expect(hasErrors).toBe(false);
  });

  test('ingest completes in reasonable time', async ({ page }) => {
    await page.goto('/');

    // Wait for ingest to complete
    await page.waitForFunction(
      () => {
        const ingestEl = document.querySelector('[data-summary="ingest"] strong');
        return ingestEl && ingestEl.textContent !== '–';
      },
      { timeout: 30000 }
    );

    const ingestTime = await page.locator('[data-summary="ingest"] strong').textContent();
    expect(ingestTime).toMatch(/\d+\.\d+ ms/);

    // Extract numeric value and verify it's reasonable (< 500ms for 200k rows)
    const timeMs = parseFloat(ingestTime?.match(/(\d+\.\d+)/)?.[1] || '0');
    expect(timeMs).toBeLessThan(500);
  });

  test('filtering updates histograms correctly', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => document.querySelector('[data-summary="filter"] strong')?.textContent !== '–'
    );

    // Get initial active count
    const initialCount = await page.locator('[data-summary="filter"] strong').textContent();

    // Apply filter by moving slider
    await page.locator('[data-slider="min"]').fill('25');
    await page.locator('[data-slider="min"]').dispatchEvent('input');
    await page.waitForTimeout(500);

    // Verify count changed
    const filteredCount = await page.locator('[data-summary="filter"] strong').textContent();
    expect(filteredCount).not.toBe(initialCount);

    // Verify count decreased
    const initial = parseInt(initialCount?.replace(/,/g, '') || '0');
    const filtered = parseInt(filteredCount?.replace(/,/g, '') || '0');
    expect(filtered).toBeLessThan(initial);
  });

  test('reset button clears filters', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => document.querySelector('[data-summary="filter"] strong')?.textContent !== '–'
    );

    const initialCount = await page.locator('[data-summary="filter"] strong').textContent();

    // Apply filter
    await page.locator('[data-slider="min"]').fill('30');
    await page.locator('[data-slider="max"]').fill('70');
    await page.locator('[data-slider="min"]').dispatchEvent('change');
    await page.waitForTimeout(500);

    // Reset
    await page.locator('[data-action="reset"]').click();
    await page.waitForTimeout(500);

    // Verify count restored
    const resetCount = await page.locator('[data-summary="filter"] strong').textContent();
    expect(resetCount).toBe(initialCount);
  });

  test('columnar mode switch works', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => document.querySelector('[data-summary="ingest"] strong')?.textContent !== '–'
    );

    const initialMode = await page.locator('[data-summary="ingest"] strong').textContent();
    const isColumnar = initialMode?.includes('columnar');

    // Click mode toggle
    await page.locator('.mode-toggle').click();

    // Page should reload
    await page.waitForLoadState('load');
    await page.waitForFunction(
      () => document.querySelector('[data-summary="ingest"] strong')?.textContent !== '–'
    );

    const newMode = await page.locator('[data-summary="ingest"] strong').textContent();
    const isNowColumnar = newMode?.includes('columnar');

    expect(isColumnar).not.toBe(isNowColumnar);
  });
});

test.describe('CrossfilterX Performance Tests', () => {
  test('filter operations complete in < 100ms for 200k rows', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => document.querySelector('[data-summary="filter"] strong')?.textContent !== '–'
    );

    const filterTimes: number[] = [];

    // Perform multiple filter operations
    for (let i = 0; i < 5; i++) {
      const start = Date.now();
      await page.locator('[data-slider="min"]').fill(String(i * 10));
      await page.locator('[data-slider="min"]').dispatchEvent('change');
      await page.waitForFunction(
        (prevCount: string, iteration: number) => {
          const current = document.querySelector('[data-summary="filter"] strong')?.textContent;
          return current !== '–' && current !== prevCount;
        },
        await page.locator('[data-summary="filter"] strong').textContent() || '0',
        { timeout: 5000 }
      );
      const elapsed = Date.now() - start;
      filterTimes.push(elapsed);
    }

    const avgTime = filterTimes.reduce((a, b) => a + b, 0) / filterTimes.length;
    expect(avgTime).toBeLessThan(100);
  });

  test('UI remains responsive during filter operations', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => document.querySelector('[data-summary="filter"] strong')?.textContent !== '–'
    );

    // Rapidly change filters
    for (let i = 0; i < 10; i++) {
      await page.locator('[data-slider="min"]').fill(String(i * 5));
      await page.locator('[data-slider="min"]').dispatchEvent('input');
      await page.waitForTimeout(50); // Simulate rapid dragging
    }

    // Verify page is still responsive
    const isVisible = await page.locator('h1').isVisible();
    expect(isVisible).toBe(true);

    // Verify final state updated
    await page.waitForTimeout(500);
    const finalCount = await page.locator('[data-summary="filter"] strong').textContent();
    expect(finalCount).not.toBe('–');
  });
});

test.describe('CrossfilterX Browser Compatibility', () => {
  test('works in all major browsers', async ({ browserName, page }) => {
    await page.goto('/');

    // Check SharedArrayBuffer support
    const hasSharedArrayBuffer = await page.evaluate(() => {
      return typeof SharedArrayBuffer !== 'undefined';
    });

    if (!hasSharedArrayBuffer) {
      test.skip(true, `${browserName} does not support SharedArrayBuffer`);
      return;
    }

    // Verify basic functionality
    await page.waitForFunction(
      () => document.querySelector('[data-summary="rows"] strong')?.textContent !== '–',
      { timeout: 30000 }
    );

    const rowCount = await page.locator('[data-summary="rows"] strong').textContent();
    expect(rowCount).toBeTruthy();

    // Verify filtering works
    await page.locator('[data-slider="min"]').fill('20');
    await page.locator('[data-slider="min"]').dispatchEvent('change');
    await page.waitForTimeout(500);

    const filteredCount = await page.locator('[data-summary="filter"] strong').textContent();
    expect(filteredCount).toBeTruthy();
  });
});