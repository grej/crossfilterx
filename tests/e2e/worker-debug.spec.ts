import { test, expect } from '@playwright/test';

test('check worker and SharedArrayBuffer', async ({ page }) => {
  const logs: string[] = [];
  page.on('console', (msg) => {
    logs.push(`[${msg.type()}] ${msg.text()}`);
  });

  page.on('pageerror', (error) => {
    logs.push(`[ERROR] ${error.message}`);
  });

  await page.goto('/');

  // Check if SharedArrayBuffer is available
  const hasSharedArrayBuffer = await page.evaluate(() => {
    return typeof SharedArrayBuffer !== 'undefined';
  });

  console.log('SharedArrayBuffer available:', hasSharedArrayBuffer);

  // Check if crossOriginIsolated
  const crossOriginIsolated = await page.evaluate(() => {
    return (window as any).crossOriginIsolated;
  });

  console.log('crossOriginIsolated:', crossOriginIsolated);

  // Wait for data to load
  await page.waitForTimeout(5000);

  // Get the summary values
  const rowsText = await page.locator('[data-summary="rows"] strong').textContent();
  const filterText = await page.locator('[data-summary="filter"] strong').textContent();
  const ingestText = await page.locator('[data-summary="ingest"] strong').textContent();

  console.log('Rows:', rowsText);
  console.log('Filter:', filterText);
  console.log('Ingest:', ingestText);

  // Print all logs
  console.log('\n=== All Console Logs ===');
  logs.forEach(log => console.log(log));
});