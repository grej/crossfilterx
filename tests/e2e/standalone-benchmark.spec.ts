import { test, expect } from '@playwright/test';

test('standalone benchmark execution', async ({ page }) => {
  test.setTimeout(180000); // 3 minute timeout

  console.log('Navigating to standalone benchmark page...');
  await page.goto('/standalone-benchmark.html');

  console.log('Waiting for page to load...');
  await page.waitForLoadState('networkidle', { timeout: 30000 });

  console.log('Clicking run benchmark button...');
  await page.click('#run-benchmark');

  // Wait for benchmark to complete
  console.log('Waiting for benchmark to complete...');
  await page.waitForFunction(
    () => {
      const status = document.querySelector('#status');
      return status?.textContent?.includes('complete');
    },
    { timeout: 150000 }
  );

  console.log('Benchmark complete! Extracting results...');

  // Get results from the page
  const results = await page.evaluate(() => {
    // @ts-ignore
    return window.benchmarkResults;
  });

  console.log('\n=== BENCHMARK RESULTS ===\n');
  console.log(`Dataset: ${results.config.size} rows, ${results.config.dimensions} dimensions`);
  console.log(`\nCrossfilterX:`);
  console.log(`  Ingest Time: ${results.crossfilterX.ingestTime}ms`);
  console.log(`  First Filter: ${results.crossfilterX.firstFilterTime}ms`);
  console.log(`  Avg Filter (20 ops): ${results.crossfilterX.avgFilterTime}ms`);
  console.log(`  Group All: ${results.crossfilterX.groupAllTime}ms`);
  console.log(`  Throughput: ${results.crossfilterX.throughput} rows/sec`);

  console.log(`\nCrossfilter2:`);
  console.log(`  Ingest Time: ${results.crossfilter2.ingestTime}ms`);
  console.log(`  First Filter: ${results.crossfilter2.firstFilterTime}ms`);
  console.log(`  Avg Filter (20 ops): ${results.crossfilter2.avgFilterTime}ms`);
  console.log(`  Group All: ${results.crossfilter2.groupAllTime}ms`);
  console.log(`  Throughput: ${results.crossfilter2.throughput} rows/sec`);

  console.log(`\nSpeedup: ${results.speedup}x`);
  console.log('\n========================\n');

  // Verify results are valid
  expect(results).toBeTruthy();
  expect(results.crossfilterX).toBeTruthy();
  expect(results.crossfilter2).toBeTruthy();
  expect(parseFloat(results.crossfilterX.ingestTime)).toBeGreaterThan(0);
  expect(parseFloat(results.crossfilterX.avgFilterTime)).toBeGreaterThan(0);
  expect(parseFloat(results.crossfilter2.ingestTime)).toBeGreaterThan(0);
  expect(parseFloat(results.crossfilter2.avgFilterTime)).toBeGreaterThan(0);

  // Performance assertions
  expect(parseFloat(results.crossfilterX.ingestTime)).toBeLessThan(10000); // Under 10s
  expect(parseFloat(results.crossfilterX.avgFilterTime)).toBeLessThan(200); // Under 200ms
});
