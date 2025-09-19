import { describe, expect, it } from 'vitest';

import { crossfilterX } from '../src';
import { quantize } from '../src/memory/quantize';

describe('descriptor-driven ingest', () => {
  it('quantizes each numeric dimension using its own range', async () => {
    const rows = [
      { distance: 10, duration: 1200 },
      { distance: 20, duration: 1800 },
      { distance: 50, duration: 5400 },
      { distance: 90, duration: 9600 },
      { distance: 120, duration: 18000 }
    ];

    const cf = crossfilterX(rows, { bins: 8 });
    await cf.whenIdle();

    const bits = Math.ceil(Math.log2(8));
    const distanceScale = inferScale(rows, 'distance', bits);
    const durationScale = inferScale(rows, 'duration', bits);

    const expectedDistance = buildHistogram(rows, 'distance', distanceScale);
    const expectedDuration = buildHistogram(rows, 'duration', durationScale);

    expect(Array.from(cf.group('distance').bins())).toEqual(expectedDistance);
    expect(Array.from(cf.group('duration').bins())).toEqual(expectedDuration);

    cf.dispose();
  });

  it('collapses overflow string categories into the fallback bin', async () => {
    const rows = [
      { distance: 10, carrier: 'AA' },
      { distance: 20, carrier: 'UA' },
      { distance: 30, carrier: 'DL' },
      { distance: 40, carrier: 'WN' },
      { distance: 50, carrier: 'B6' }
    ];

    const cf = crossfilterX(rows, { bins: 4 });
    await cf.whenIdle();

    expect(Array.from(cf.group('carrier').bins())).toEqual([1, 1, 1, 2]);

    cf.dispose();
  });

  it('ingests numeric columnar data without per-row objects', async () => {
    const distances = Float32Array.from([10, 20, 50, 90, 120]);
    const durations = Float32Array.from([1200, 1800, 5400, 9600, 18000]);
    const cfRows = crossfilterX(
      [
        { distance: 10, duration: 1200 },
        { distance: 20, duration: 1800 },
        { distance: 50, duration: 5400 },
        { distance: 90, duration: 9600 },
        { distance: 120, duration: 18000 }
      ],
      { bins: 8 }
    );
    await cfRows.whenIdle();

    const cfColumnar = crossfilterX({ columns: { distance: distances, duration: durations } }, { bins: 8 });
    await cfColumnar.whenIdle();

    expect(Array.from(cfColumnar.group('distance').bins())).toEqual(
      Array.from(cfRows.group('distance').bins())
    );
    expect(Array.from(cfColumnar.group('duration').bins())).toEqual(
      Array.from(cfRows.group('duration').bins())
    );

    cfRows.dispose();
    cfColumnar.dispose();
  });

  it('ingests columnar data with categorical dictionaries', async () => {
    const rows = [
      { carrier: 'AA', distance: 100 },
      { carrier: 'UA', distance: 200 },
      { carrier: 'AA', distance: 150 },
      { carrier: 'DL', distance: 250 }
    ];
    const cfRows = crossfilterX(rows, { bins: 8 });
    await cfRows.whenIdle();

    const carriers = Uint16Array.from([0, 1, 0, 2]);
    const distances = Float32Array.from([100, 200, 150, 250]);
    const cfColumnar = crossfilterX(
      {
        columns: { carrier: carriers, distance: distances },
        categories: { carrier: ['AA', 'UA', 'DL'] }
      },
      { bins: 8 }
    );
    await cfColumnar.whenIdle();

    expect(Array.from(cfColumnar.group('distance').bins())).toEqual(Array.from(cfRows.group('distance').bins()));
    expect(Array.from(cfColumnar.group('carrier').bins())).toEqual(Array.from(cfRows.group('carrier').bins()));

    cfRows.dispose();
    cfColumnar.dispose();
  });
});

type Scale = {
  min: number;
  max: number;
  bits: number;
  range: number;
  invSpan: number;
};

function inferScale(rows: Record<string, unknown>[], key: string, bits: number): Scale {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const row of rows) {
    const value = Number(row[key]);
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }

  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    min = 0;
    max = Math.max(1, 1 << bits);
  }

  const range = (1 << bits) - 1;
  const span = max - min;
  return { min, max, bits, range, invSpan: span > 0 ? range / span : 0 };
}

function buildHistogram(rows: Record<string, unknown>[], key: string, scale: Scale) {
  const binCount = 1 << scale.bits;
  const histogram = new Array<number>(binCount).fill(0);
  for (const row of rows) {
    const value = Number(row[key]);
    const bin = quantize(value, scale);
    histogram[bin]++;
  }
  return histogram;
}

function inferScaleRows(source: ArrayLike<number>, bits: number): Scale {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < source.length; i++) {
    const value = Number(source[i]);
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    min = 0;
    max = Math.max(1, 1 << bits);
  }
  const range = (1 << bits) - 1;
  const span = max - min;
  return { min, max, bits, range, invSpan: span > 0 ? range / span : 0 };
}

function buildHistogramTyped(source: ArrayLike<number>, scale: Scale) {
  const binCount = 1 << scale.bits;
  const histogram = new Array<number>(binCount).fill(0);
  for (let i = 0; i < source.length; i++) {
    const bin = quantize(Number(source[i]), scale);
    histogram[bin]++;
  }
  return histogram;
}
