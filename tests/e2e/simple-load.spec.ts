import { test } from '@playwright/test';

test('trace execution step by step', async ({ page }) => {
  const logs: string[] = [];

  page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => logs.push(`[ERROR] ${err.message}`));

  await page.goto('/');

  // Wait for page to load
  await page.waitForLoadState('networkidle');

  // Check if crossfilterX was called
  const state = await page.evaluate(() => {
    return {
      appExists: !!document.querySelector('#app'),
      appHasContent: (document.querySelector('#app')?.innerHTML?.length ?? 0) > 100,
      h1Exists: !!document.querySelector('h1'),
      rowsValue: document.querySelector('[data-summary="rows"] strong')?.textContent,
      windowKeys: Object.keys(window).filter(k => k.includes('cross') || k.includes('CROSS')),
    };
  });

  console.log('Page state:', JSON.stringify(state, null, 2));
  console.log('\nAll logs:');
  logs.forEach(log => console.log(log));

  // Try to manually execute crossfilterX
  await page.waitForTimeout(2000);

  const manualTest = await page.evaluate(async () => {
    try {
      // @ts-ignore
      const { crossfilterX } = await import('/packages/core/src/index.ts');
      const data = [{ x: 1 }, { x: 2 }, { x: 3 }];
      const cf = crossfilterX(data);
      await cf.whenIdle();
      return { success: true, message: 'Manual test passed' };
    } catch (e: any) {
      return { success: false, error: e.message, stack: e.stack };
    }
  });

  console.log('\nManual test:', JSON.stringify(manualTest, null, 2));
});