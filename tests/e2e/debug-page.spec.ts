import { test, expect } from '@playwright/test';

test('debug page initialization', async ({ page }) => {
  const logs: string[] = [];

  page.on('console', msg => {
    const text = msg.text();
    logs.push(`[${msg.type()}] ${text}`);
    console.log(`[${msg.type()}]`, text);
  });

  page.on('pageerror', err => {
    logs.push(`[ERROR] ${err.message}`);
    console.log('[PAGE ERROR]', err.message);
  });

  page.on('worker', worker => {
    console.log('[WORKER CREATED]', worker.url());
    worker.on('console', msg => console.log('[WORKER]', msg.text()));
  });

  await page.goto('/debug.html');

  // Wait for either success or error (with timeout)
  try {
    await page.waitForFunction(
      () => {
        const status = document.getElementById('status')?.textContent || '';
        return status.includes('SUCCESS') || status.includes('ERROR');
      },
      { timeout: 15000 }
    );

    const status = await page.locator('#status').textContent();
    console.log('\nFinal status:', status);

    // Check if it succeeded
    expect(status).toContain('SUCCESS');
  } catch (error) {
    console.log('\nTimeout waiting for initialization');
    const status = await page.locator('#status').textContent();
    console.log('Status at timeout:', status);

    // Take screenshot for debugging
    await page.screenshot({ path: 'test-results/debug-timeout.png' });

    throw error;
  }
});