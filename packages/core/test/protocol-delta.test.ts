import { describe, expect, it } from 'vitest';

import { createProtocol, type MsgFromWorker } from '../src/protocol';

describe('protocol delta behaviour', () => {
  it('applies sequential filters and clears', () => {
    const messages: MsgFromWorker[] = [];
    const { handleMessage } = createProtocol((message) => {
      messages.push(message);
    });

    const rows = Array.from({ length: 5 }, (_, i) => ({ value: i }));
    handleMessage({
      t: 'INGEST',
      schema: [{ name: 'value', type: 'number', bits: 4 }],
      rows
    });

    const baseFrame = messages.find((msg) => msg.t === 'FRAME' && msg.seq === 0);
    expect(baseFrame && baseFrame.t === 'FRAME' ? baseFrame.activeCount : null).toBe(5);

    const rangeMin = quantizeValue(2, 0, 4, 4);
    const rangeMax = quantizeValue(3, 0, 4, 4);
    handleMessage({ t: 'FILTER_SET', dimId: 0, rangeMin, rangeMax, seq: 1 });
    const filtered = messages.find((msg) => msg.t === 'FRAME' && msg.seq === 1);
    expect(filtered && filtered.t === 'FRAME' ? filtered.activeCount : null).toBe(2);

    handleMessage({ t: 'FILTER_CLEAR', dimId: 0, seq: 2 });
    const cleared = messages.find((msg) => msg.t === 'FRAME' && msg.seq === 2);
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
