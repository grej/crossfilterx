/**
 * Tests for function dimension removal
 *
 * Validates that function-based dimensions are properly rejected
 * to prevent main thread blocking.
 */

import { describe, it, expect } from 'vitest';
import { crossfilterX } from '../src/index';

describe('Function Dimension Rejection', () => {
  it('should throw error when attempting to create function dimension', () => {
    const data = {
      columns: {
        value: new Uint16Array([10, 20, 30, 40, 50])
      },
      length: 5
    };

    const cf = crossfilterX(data, { bins: 256 });

    // Attempting to use a function dimension should throw
    expect(() => {
      cf.dimension((d: any) => d.value);
    }).toThrow('Function-based dimensions are not supported');

    // Clean up
    cf.dispose();
  });

  it('should include documentation link in error message', () => {
    const data = {
      columns: {
        value: new Uint16Array([10, 20, 30])
      },
      length: 3
    };

    const cf = crossfilterX(data, { bins: 256 });

    try {
      cf.dimension((d: any) => d.value);
      throw new Error('Should have thrown');
    } catch (err: any) {
      expect(err.message).toContain('main thread');
      expect(err.message).toContain('https://github.com/grej/crossfilterx');
      expect(err.message).toContain('Pre-compute');
    }

    cf.dispose();
  });

  it('should still allow string-based dimensions', () => {
    const data = {
      columns: {
        price: new Uint16Array([100, 200, 300]),
        category: new Uint16Array([0, 1, 2])
      },
      length: 3
    };

    const cf = crossfilterX(data, { bins: 256 });

    // String-based dimensions should still work
    const priceDim = cf.dimension('price');
    const categoryDim = cf.dimension('category');

    expect(priceDim).toBeDefined();
    expect(categoryDim).toBeDefined();

    cf.dispose();
  });

  it('should fail fast before any row processing', () => {
    const data = {
      columns: {
        value: new Uint16Array(Array.from({ length: 10000 }, (_, i) => i))
      },
      length: 10000
    };

    const cf = crossfilterX(data, { bins: 256 });

    const startTime = Date.now();

    try {
      cf.dimension((d: any) => d.value);
      throw new Error('Should have thrown');
    } catch (err: any) {
      const endTime = Date.now();

      // Error should be thrown immediately, not after processing rows
      // This should take <1ms, not hundreds of ms
      expect(endTime - startTime).toBeLessThan(50);
      expect(err.message).toContain('Function-based dimensions');
    }

    cf.dispose();
  });
});
