import { describe, expect, it } from 'vitest';

import { ClearPlanner } from '../src/worker/clear-planner';

describe('ClearPlanner', () => {
  const baseContext = {
    insideCount: 500_000,
    outsideCount: 500_000,
    totalRows: 1_000_000,
    histogramCount: 6,
    otherFilters: 0,
    activeCount: 500_000
  };

  it('defaults to recompute in the legacy guard window when untrained', () => {
    const planner = new ClearPlanner();
    const context = {
      ...baseContext,
      insideCount: 100_000,
      outsideCount: 900_000
    };
    expect(planner.choose(context)).toBe('recompute');
  });

  it('prefers delta when measured SIMD cost per row is lower', () => {
    const planner = new ClearPlanner({ legacyGuard: false });
    planner.record('delta', 12, 1_000_000);
    planner.record('recompute', 40, 1_000_000);
    expect(planner.choose(baseContext)).toBe('delta');
  });

  it('prefers recompute when its cost per row is lower', () => {
    const planner = new ClearPlanner({ legacyGuard: false });
    planner.record('delta', 80, 1_000_000);
    planner.record('recompute', 20, 1_000_000);
    expect(planner.choose(baseContext)).toBe('recompute');
  });

  it('exposes running estimates via snapshot', () => {
    const planner = new ClearPlanner({ legacyGuard: false });
    planner.record('delta', 10, 1_000_000);
    const snapshot = planner.snapshot();
    expect(snapshot.deltaCount).toBe(1);
    expect(snapshot.simdSamples).toBe(1);
    expect(snapshot.simdCostPerRow).toBeGreaterThan(0);
  });
});
