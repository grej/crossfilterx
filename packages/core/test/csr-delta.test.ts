import { describe, expect, it } from 'vitest';

import { createProtocol, type MsgFromWorker } from '../src/protocol';

describe('CSR delta behaviour', () => {
  it('adds and removes rows when filters change', () => {
    const messages: MsgFromWorker[] = [];
    const { handleMessage } = createProtocol((message) => {
      messages.push(message);
    });

    const rows = Array.from({ length: 6 }, (_, i) => ({ value: i }));
    const schema = [{ name: 'value', type: 'number', bits: 4 }];
    handleMessage({ t: 'INGEST', schema, rows });

    const rangeMin1 = quantizeValue(1, 0, 5, 4);
    const rangeMax1 = quantizeValue(4, 0, 5, 4);
    handleMessage({ t: 'FILTER_SET', dimId: 0, rangeMin: rangeMin1, rangeMax: rangeMax1, seq: 1 });
    const filtered = messages.find((msg) => msg.t === 'FRAME' && msg.seq === 1);
    expect(filtered && filtered.t === 'FRAME' ? filtered.activeCount : null).toBe(4);

    const rangeMin2 = quantizeValue(2, 0, 5, 4);
    const rangeMax2 = quantizeValue(3, 0, 5, 4);
    handleMessage({ t: 'FILTER_SET', dimId: 0, rangeMin: rangeMin2, rangeMax: rangeMax2, seq: 2 });
    const narrowed = messages.find((msg) => msg.t === 'FRAME' && msg.seq === 2);
    expect(narrowed && narrowed.t === 'FRAME' ? narrowed.activeCount : null).toBe(2);

    handleMessage({ t: 'FILTER_CLEAR', dimId: 0, seq: 3 });
    const cleared = messages.find((msg) => msg.t === 'FRAME' && msg.seq === 3);
    expect(cleared && cleared.t === 'FRAME' ? cleared.activeCount : null).toBe(6);
  });

  it('handles filter widening with unsorted data', () => {
    const messages: MsgFromWorker[] = [];
    const { handleMessage } = createProtocol((message) => {
      messages.push(message);
    });

    const rows = [5, 1, 3, 7, 2].map((value) => ({ value }));
    const schema = [{ name: 'value', type: 'number', bits: 4 }];
    handleMessage({ t: 'INGEST', schema, rows });

    const rangeMin = quantizeValue(1, 1, 7, 4);
    const rangeMax = quantizeValue(3, 1, 7, 4);
    handleMessage({ t: 'FILTER_SET', dimId: 0, rangeMin, rangeMax, seq: 1 });
    const initial = messages.find((msg) => msg.t === 'FRAME' && msg.seq === 1);
    expect(initial && initial.t === 'FRAME' ? initial.activeCount : null).toBe(3);

    const rangeMin2 = quantizeValue(2, 1, 7, 4);
    const rangeMax2 = quantizeValue(7, 1, 7, 4);
    handleMessage({ t: 'FILTER_SET', dimId: 0, rangeMin: rangeMin2, rangeMax: rangeMax2, seq: 2 });
    const widened = messages.find((msg) => msg.t === 'FRAME' && msg.seq === 2);
    expect(widened && widened.t === 'FRAME' ? widened.activeCount : null).toBe(4);

    handleMessage({ t: 'FILTER_CLEAR', dimId: 0, seq: 3 });
    const cleared = messages.find((msg) => msg.t === 'FRAME' && msg.seq === 3);
    expect(cleared && cleared.t === 'FRAME' ? cleared.activeCount : null).toBe(5);
  });
});

function quantizeValue(value: number, min: number, max: number, bits: number) {
  if (max <= min) return 0;
  const range = (1 << bits) - 1;
  const clamped = Math.min(Math.max(value, min), max);
  const normalized = (clamped - min) / (max - min);
  return Math.round(normalized * range);
}
