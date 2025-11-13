import { test } from '@playwright/test';

test('debug demo loading', async ({ page }) => {
  // Capture console messages
  page.on('console', (msg) => {
    console.log(`CONSOLE [${msg.type()}]:`, msg.text());
  });

  // Capture page errors
  page.on('pageerror', (error) => {
    console.log('PAGE ERROR:', error.message);
  });

  // Capture requests
  page.on('request', (request) => {
    console.log('REQUEST:', request.method(), request.url());
  });

  // Capture responses
  page.on('response', (response) => {
    console.log('RESPONSE:', response.status(), response.url());
  });

  await page.goto('/');

  // Wait a bit to see what happens
  await page.waitForTimeout(10000);

  // Take a screenshot
  await page.screenshot({ path: 'test-results/debug-screenshot.png', fullPage: true });

  // Get page content
  const html = await page.content();
  console.log('PAGE HTML LENGTH:', html.length);
});