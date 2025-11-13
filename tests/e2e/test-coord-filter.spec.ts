import { test } from '@playwright/test';

test('coordinated filtering test', async ({ page }) => {
  await page.goto('/test-coord-filter.html');

  // Wait for completion
  await page.waitForTimeout(3000);

  // Get all logs
  const logs = page.locator('.test');
  const count = await logs.count();

  console.log('\n=== Coordinated Filtering Test ===');
  for (let i = 0; i < count; i++) {
    const text = await logs.nth(i).textContent();
    console.log(text);
  }
});