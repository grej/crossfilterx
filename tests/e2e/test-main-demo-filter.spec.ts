import { test, expect } from '@playwright/test';

test('main demo filtering actually works', async ({ page }) => {
  await page.goto('/');

  // Wait for load
  await page.waitForFunction(
    () => document.querySelector('[data-summary="rows"] strong')?.textContent !== '–',
    { timeout: 30000 }
  );

  // Get initial count
  const initialText = await page.locator('[data-summary="filter"] strong').textContent();
  const initialMatch = initialText?.match(/[\d,]+/);
  const initialCount = initialMatch ? parseInt(initialMatch[0].replace(/,/g, '')) : 0;

  console.log(`Initial active count: ${initialCount}`);

  // Set sliders to narrow range (30-70)
  await page.locator('[data-slider="min"]').fill('30');
  await page.locator('[data-slider="max"]').fill('70');

  // Trigger change event
  await page.locator('[data-slider="min"]').dispatchEvent('change');

  // Wait for update
  await page.waitForTimeout(1000);

  // Get filtered count
  const filteredText = await page.locator('[data-summary="filter"] strong').textContent();
  const filteredMatch = filteredText?.match(/[\d,]+/);
  const filteredCount = filteredMatch ? parseInt(filteredMatch[0].replace(/,/g, '')) : 0;

  console.log(`Filtered active count: ${filteredCount}`);
  console.log(`Reduction: ${((1 - filteredCount/initialCount) * 100).toFixed(1)}%`);

  expect(filteredCount).toBeLessThan(initialCount);
  expect(filteredCount).toBeGreaterThan(0);
});