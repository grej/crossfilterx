import { test } from '@playwright/test';

test('capture all JS execution', async ({ page }) => {
  // Capture ALL console output
  page.on('console', (msg) => {
    console.log(`[${msg.type().toUpperCase()}]`, msg.text());
    // Also get args
    msg.args().forEach(async (arg, i) => {
      try {
        const val = await arg.jsonValue();
        console.log(`  arg[${i}]:`, JSON.stringify(val));
      } catch (e) {
        // ignore
      }
    });
  });

  // Capture page errors
  page.on('pageerror', (error) => {
    console.log('\n!!! PAGE ERROR !!!\n', error.message, '\n', error.stack);
  });

  // Capture worker errors
  page.on('worker', (worker) => {
    console.log('WORKER CREATED:', worker.url());
    worker.on('console', (msg) => {
      console.log(`[WORKER-${msg.type().toUpperCase()}]`, msg.text());
    });
   worker.on('pageerror', (error) => {
      console.log('\n!!! WORKER ERROR !!!\n', error.message);
    });
  });

  await page.goto('/');

  // Check if main.ts loaded and executed
  const mainExecuted = await page.evaluate(() => {
    return (window as any).__CROSSFILTER_MAIN_LOADED;
  });
  console.log('Main script loaded flag:', mainExecuted);

  // Try to manually check if crossfilterX function exists
  const cfExists = await page.evaluate(async () => {
    try {
      const mod = await import('/src/main.ts');
      return { hasModule: true, keys: Object.keys(mod) };
    } catch (e: any) {
      return { hasModule: false, error: e.message };
    }
  });
  console.log('CrossfilterX module check:', cfExists);

  // Wait longer
  await page.waitForTimeout(10000);

  console.log('\n=== Final State ===');
  const finalState = await page.evaluate(() => {
    return {
      rows: document.querySelector('[data-summary="rows"] strong')?.textContent,
      filter: document.querySelector('[data-summary="filter"] strong')?.textContent,
      ingest: document.querySelector('[data-summary="ingest"] strong')?.textContent,
    };
  });
  console.log(finalState);
});