/**
 * Tests for memory management and instance tracking
 *
 * NOTE: This test validates memory management by creating multiple instances.
 * It's designed to run via run-tests.js which isolates it in its own process.
 */

import { describe, it, expect, vi } from 'vitest';
import { crossfilterX } from '../src/index';

describe('Memory Management', () => {
  it('should properly track and clean up instances', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const data = {
      columns: {
        value: new Uint16Array([1, 2, 3, 4, 5])
      },
      length: 5
    };

    // Test 1: Sequential create/dispose should not accumulate memory
    for (let i = 0; i < 10; i++) {
      const cf = crossfilterX(data, { bins: 256 });
      const dim = cf.dimension('value');

      // Create group before filtering
      const group = dim.group();

      // Filter and wait for completion
      await dim.filter([2, 4]);

      // Count should show filtered results (values 2, 3, 4 = 3 rows)
      expect(group.count()).toBe(3);

      cf.dispose();
    }

    // Should never have warned (max 1 instance at a time)
    expect(consoleWarnSpy).not.toHaveBeenCalled();

    consoleWarnSpy.mockClear();

    // Test 2: Creating 5 instances should trigger warning
    const instances = [];
    for (let i = 0; i < 5; i++) {
      instances.push(crossfilterX(data, { bins: 256 }));
    }

    // Should warn at 5th instance
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('5 active instances')
    );
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Call dispose()')
    );

    // Test 3: Disposing should decrement count
    instances.forEach(cf => cf.dispose());

    consoleWarnSpy.mockClear();

    // Creating one more should not warn (count is back to 0)
    const newCf = crossfilterX(data, { bins: 256 });
    expect(consoleWarnSpy).not.toHaveBeenCalled();

    newCf.dispose();

    consoleWarnSpy.mockRestore();
  });
});
