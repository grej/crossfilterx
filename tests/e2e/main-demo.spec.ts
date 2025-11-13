import { test, expect } from '@playwright/test';

test.describe('Main Demo Functionality', () => {
  test('demo loads and initializes', async ({ page }) => {
    await page.goto('/');

    // Wait for initialization (with longer timeout)
    await page.waitForFunction(
      () => {
        const rows = document.querySelector('[data-summary="rows"] strong')?.textContent;
        return rows && rows !== '–';
      },
      { timeout: 30000 }
    );

    // Verify data loaded
    const rowsText = await page.locator('[data-summary="rows"] strong').textContent();
    expect(rowsText).toMatch(/\d/);
    expect(rowsText).not.toBe('–');

    // Verify filter count
    const filterText = await page.locator('[data-summary="filter"] strong').textContent();
    expect(filterText).toMatch(/\d/);

    // Verify ingest time
    const ingestText = await page.locator('[data-summary="ingest"] strong').textContent();
    expect(ingestText).toMatch(/\d+\.\d+ ms/);
  });

  test('filtering works correctly', async ({ page }) => {
    await page.goto('/');

    await page.waitForFunction(
      () => document.querySelector('[data-summary="rows"] strong')?.textContent !== '–',
      { timeout: 30000 }
    );

    const initialCount = await page.locator('[data-summary="filter"] strong').textContent();

    // Apply filter
    await page.locator('[data-slider="min"]').fill('30');
    await page.locator('[data-slider="min"]').dispatchEvent('change');

    await page.waitForTimeout(500);

    const filteredCount = await page.locator('[data-summary="filter"] strong').textContent();
    expect(filteredCount).not.toBe(initialCount);

    // Parse and verify count decreased
    const initial = parseInt(initialCount?.replace(/[^\d]/g, '') || '0');
    const filtered = parseInt(filteredCount?.replace(/[^\d]/g, '') || '0');
    expect(filtered).toBeLessThan(initial);
  });

  test('reset button works', async ({ page }) => {
    await page.goto('/');

    await page.waitForFunction(
      () => document.querySelector('[data-summary="rows"] strong')?.textContent !== '–',
      { timeout: 30000 }
    );

    const initialCount = await page.locator('[data-summary="filter"] strong').textContent();

    // Apply filter
    await page.locator('[data-slider="min"]').fill('40');
    await page.locator('[data-slider="max"]').fill('60');
    await page.locator('[data-slider="min"]').dispatchEvent('change');
    await page.waitForTimeout(500);

    // Reset
    await page.locator('[data-action="reset"]').click();
    await page.waitForTimeout(500);

    const resetCount = await page.locator('[data-summary="filter"] strong').textContent();
    expect(resetCount).toBe(initialCount);
  });
});