import { test } from '@playwright/test';

test('check for worker errors', async ({ page, context }) => {
  const allLogs: string[] = [];

  // Capture page logs
  page.on('console', msg => {
    const text = `[PAGE-${msg.type()}] ${msg.text()}`;
    allLogs.push(text);
    console.log(text);
  });

  page.on('pageerror', err => {
    const text = `[PAGE-ERROR] ${err.message}\n${err.stack}`;
    allLogs.push(text);
    console.log(text);
  });

  // Capture worker logs and errors
  page.on('worker', worker => {
    console.log(`[WORKER-CREATED] ${worker.url()}`);

    worker.on('console', msg => {
      const text = `[WORKER-${msg.type()}] ${msg.text()}`;
      allLogs.push(text);
      console.log(text);
    });

    worker.on('close', () => {
      console.log(`[WORKER-CLOSED] ${worker.url()}`);
    });
  });

  // Navigate
  await page.goto('/debug.html');

  // Wait a bit to see messages
  await page.waitForTimeout(5000);

  console.log('\n=== All captured logs ===');
  allLogs.forEach(log => console.log(log));

  // Check worker count
  const workerCount = await page.evaluate(() => {
    return (performance as any).memory ? 'Memory API available' : 'No memory API';
  });
  console.log('\nBrowser info:', workerCount);
});