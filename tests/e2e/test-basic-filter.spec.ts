import { test, expect } from '@playwright/test';

test('basic filtering test', async ({ page }) => {
  await page.goto('/test-filter.html');

  // Wait for tests to complete (they run automatically)
  await page.waitForTimeout(3000);

  // Check for pass/fail indicators
  const tests = page.locator('.test');
  const count = await tests.count();

  console.log(`Found ${count} test results`);

  // Get all test text
  for (let i = 0; i < count; i++) {
    const text = await tests.nth(i).textContent();
    const className = await tests.nth(i).getAttribute('class');
    console.log(`[${className}] ${text}`);
  }

  // Check if any tests failed
  const failures = page.locator('.test.fail');
  const failCount = await failures.count();

  if (failCount > 0) {
    console.log(`\\n❌ ${failCount} test(s) failed`);
    for (let i = 0; i < failCount; i++) {
      const text = await failures.nth(i).textContent();
      console.log(`  - ${text}`);
    }
  }

  expect(failCount).toBe(0);
});