import { test } from '@playwright/test';

test('check module URLs', async ({ page }) => {
  await page.goto('/debug.html');

  const urls = await page.evaluate(async () => {
    // Check what URL the controller module has
    const mod = await import('/packages/core/src/controller.ts');
    return {
      hasController: !!mod,
      // Can't access import.meta.url from evaluate, but we can check the module path
    };
  });

  console.log('Module info:', urls);

  await page.waitForTimeout(1000);
});