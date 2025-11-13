import { test, expect } from '@playwright/test';

test('debug sequence with console logs', async ({ page }) => {
  const logs: string[] = [];

  page.on('console', msg => {
    const text = msg.text();
    logs.push(`${msg.type()}: ${text}`);
    // Print all logs, especially Worker and Controller logs
    if (text.includes('[Worker]') || text.includes('[Controller]') || text.includes('[TEST]')) {
      console.log(`>>> ${text}`);
    }
  });

  await page.goto('/sequence-test.html');

  // Wait for test to complete
  await page.waitForTimeout(5000);

  // Get final output
  const output = await page.locator('#output').textContent();
  console.log('\n=== PAGE OUTPUT ===');
  console.log(output);

  // Check if we got controller/worker logs
  const hasControllerLogs = logs.some(l => l.includes('[Controller]'));
  const hasWorkerLogs = logs.some(l => l.includes('[Worker]'));

  console.log(`\nController logs found: ${hasControllerLogs}`);
  console.log(`Worker logs found: ${hasWorkerLogs}`);

  // Show relevant logs
  console.log('\n=== RELEVANT LOGS ===');
  logs.filter(l => l.includes('[Worker]') || l.includes('[Controller]') || l.includes('[TEST]'))
      .forEach(l => console.log(l));

  // For now, just check the output
  console.log(`\nFinal sum was: ${output?.match(/sum: (\d+)/g)}`);
});
