import { test, expect } from '@playwright/test';

test.describe('Enhanced Demo', () => {
  test('loads and initializes with all charts', async ({ page }) => {
    await page.goto('/enhanced.html');

    // Wait for initialization
    await page.waitForFunction(
      () => {
        const total = document.querySelector('[data-summary="total"]')?.textContent;
        return total && total !== '–';
      },
      { timeout: 30000 }
    );

    // Verify summary stats loaded
    const totalFlights = await page.locator('[data-summary="total"]').textContent();
    expect(totalFlights).toMatch(/\d/);
    expect(totalFlights).not.toBe('–');

    // Verify all 4 charts are present
    const hourChart = page.locator('[data-chart="hour"]');
    const delayChart = page.locator('[data-chart="delay"]');
    const distanceChart = page.locator('[data-chart="distance"]');
    const dateChart = page.locator('[data-chart="date"]');

    await expect(hourChart).toBeVisible();
    await expect(delayChart).toBeVisible();
    await expect(distanceChart).toBeVisible();
    await expect(dateChart).toBeVisible();

    // Verify flight table has rows
    const tableRows = page.locator('.flight-table tbody tr');
    const count = await tableRows.count();
    expect(count).toBeGreaterThan(0);
  });

  test('brush filtering works on hour chart', async ({ page }) => {
    await page.goto('/enhanced.html');

    await page.waitForFunction(
      () => document.querySelector('[data-summary="total"]')?.textContent !== '–',
      { timeout: 30000 }
    );

    const initialActive = await page.locator('[data-summary="active"]').textContent();

    // Simulate brush on hour chart (drag from 25% to 75% of canvas width)
    const hourChart = page.locator('[data-chart="hour"]');
    const box = await hourChart.boundingBox();
    if (!box) throw new Error('Chart not found');

    const startX = box.x + box.width * 0.25;
    const endX = box.x + box.width * 0.75;
    const centerY = box.y + box.height / 2;

    await page.mouse.move(startX, centerY);
    await page.mouse.down();
    await page.mouse.move(endX, centerY);
    await page.mouse.up();

    // Wait for filter to apply
    await page.waitForTimeout(500);

    const filteredActive = await page.locator('[data-summary="active"]').textContent();
    expect(filteredActive).not.toBe(initialActive);

    // Parse and verify count changed
    const initial = parseInt(initialActive?.replace(/[^\\d]/g, '') || '0');
    const filtered = parseInt(filteredActive?.replace(/[^\\d]/g, '') || '0');
    expect(filtered).toBeLessThan(initial);
  });

  test('reset button clears filters', async ({ page }) => {
    await page.goto('/enhanced.html');

    await page.waitForFunction(
      () => document.querySelector('[data-summary="total"]')?.textContent !== '–',
      { timeout: 30000 }
    );

    const initialActive = await page.locator('[data-summary="active"]').textContent();

    // Apply filter via brush
    const distanceChart = page.locator('[data-chart="distance"]');
    const box = await distanceChart.boundingBox();
    if (!box) throw new Error('Chart not found');

    const startX = box.x + box.width * 0.4;
    const endX = box.x + box.width * 0.6;
    const centerY = box.y + box.height / 2;

    await page.mouse.move(startX, centerY);
    await page.mouse.down();
    await page.mouse.move(endX, centerY);
    await page.mouse.up();

    await page.waitForTimeout(500);

    // Click reset button for distance
    await page.locator('[data-reset="distance"]').click();
    await page.waitForTimeout(500);

    const resetActive = await page.locator('[data-summary="active"]').textContent();
    expect(resetActive).toBe(initialActive);
  });

  test('double-click clears filter on chart', async ({ page }) => {
    await page.goto('/enhanced.html');

    await page.waitForFunction(
      () => document.querySelector('[data-summary="total"]')?.textContent !== '–',
      { timeout: 30000 }
    );

    const initialActive = await page.locator('[data-summary="active"]').textContent();

    // Apply filter
    const delayChart = page.locator('[data-chart="delay"]');
    const box = await delayChart.boundingBox();
    if (!box) throw new Error('Chart not found');

    const startX = box.x + box.width * 0.3;
    const endX = box.x + box.width * 0.7;
    const centerY = box.y + box.height / 2;

    await page.mouse.move(startX, centerY);
    await page.mouse.down();
    await page.mouse.move(endX, centerY);
    await page.mouse.up();

    await page.waitForTimeout(500);

    // Double-click to clear
    await delayChart.dblclick({ position: { x: box.width / 2, y: box.height / 2 } });
    await page.waitForTimeout(500);

    const clearedActive = await page.locator('[data-summary="active"]').textContent();
    expect(clearedActive).toBe(initialActive);
  });

  test('flight table displays correctly', async ({ page }) => {
    await page.goto('/enhanced.html');

    await page.waitForFunction(
      () => document.querySelector('[data-summary="total"]')?.textContent !== '–',
      { timeout: 30000 }
    );

    // Check table has expected columns
    const headers = page.locator('.flight-table thead th');
    const headerCount = await headers.count();
    expect(headerCount).toBe(7); // Date, Time, Carrier, Origin, Dest, Distance, Delay

    // Check table has rows
    const rows = page.locator('.flight-table tbody tr');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);
    expect(rowCount).toBeLessThanOrEqual(40); // Should show max 40 flights

    // Check delay coloring works
    const firstRow = rows.first();
    const delayCell = firstRow.locator('td:last-child');
    const className = await delayCell.getAttribute('class');
    expect(className).toMatch(/early|late|ontime/);
  });

  test('coordinated filtering updates all charts', async ({ page }) => {
    await page.goto('/enhanced.html');

    await page.waitForFunction(
      () => document.querySelector('[data-summary="total"]')?.textContent !== '–',
      { timeout: 30000 }
    );

    // Apply filter on one dimension
    const hourChart = page.locator('[data-chart="hour"]');
    const box = await hourChart.boundingBox();
    if (!box) throw new Error('Chart not found');

    const startX = box.x + box.width * 0.3;
    const endX = box.x + box.width * 0.7;
    const centerY = box.y + box.height / 2;

    await page.mouse.move(startX, centerY);
    await page.mouse.down();
    await page.mouse.move(endX, centerY);
    await page.mouse.up();

    await page.waitForTimeout(500);

    // Verify active count changed
    const activeText = await page.locator('[data-summary="active"]').textContent();
    const totalText = await page.locator('[data-summary="total"]').textContent();

    const active = parseInt(activeText?.replace(/[^\\d]/g, '') || '0');
    const total = parseInt(totalText?.replace(/[^\\d]/g, '') || '0');

    expect(active).toBeLessThan(total);

    // All other charts should still be visible and responsive
    await expect(page.locator('[data-chart="delay"]')).toBeVisible();
    await expect(page.locator('[data-chart="distance"]')).toBeVisible();
    await expect(page.locator('[data-chart="date"]')).toBeVisible();
  });
});