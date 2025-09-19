import { describe, expect, it } from 'vitest';

import { createSimpleEngine } from '../src/sandbox/simple-engine';
import { quantize } from '../src/memory/quantize';

describe('simple engine prototype', () => {
  it('builds histograms and applies filters', () => {
    const rows = Array.from({ length: 8 }, (_, idx) => ({
      value: idx,
      doubled: idx * 2
    }));

    const engine = createSimpleEngine(
      [
        { name: 'value', kind: 'number', bits: 4 },
        { name: 'doubled', kind: 'number', bits: 4 }
      ],
      rows
    );

    expect(engine.activeCount()).toBe(8);

    const scaleValue = { min: 0, max: 7, bits: 4, range: (1 << 4) - 1, invSpan: ((1 << 4) - 1) / 7 } as const;
    const expectedValueBins = new Uint32Array(16);
    rows.forEach((row) => {
      expectedValueBins[quantize(row.value, scaleValue)]++;
    });
    expect(Array.from(engine.histogram(0))).toEqual(Array.from(expectedValueBins));

    const loBin = quantize(2, scaleValue);
    const hiBin = quantize(5, scaleValue);
    engine.filter(0, loBin, hiBin);
    expect(engine.activeCount()).toBe(4);
    const filteredBins = new Uint32Array(16);
    rows
      .filter((row) => row.value >= 2 && row.value <= 5)
      .forEach((row) => {
        filteredBins[quantize(row.value, scaleValue)]++;
      });
    expect(Array.from(engine.histogram(0))).toEqual(Array.from(filteredBins));
    const scaleDoubled = {
      min: 0,
      max: 14,
      bits: 4,
      range: (1 << 4) - 1,
      invSpan: ((1 << 4) - 1) / 14
    } as const;
    const expectedDoubled = new Uint32Array(16);
    rows
      .filter((row) => row.value >= 2 && row.value <= 5)
      .forEach((row) => {
        expectedDoubled[quantize(row.doubled, scaleDoubled)]++;
      });
    expect(Array.from(engine.histogram(1))).toEqual(Array.from(expectedDoubled));

    engine.clear(0);
    expect(engine.activeCount()).toBe(8);
  });
});
