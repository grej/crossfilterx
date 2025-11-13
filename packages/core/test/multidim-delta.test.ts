import { describe, expect, it } from 'vitest';

import { createProtocol, type MsgFromWorker } from '../src/protocol';

describe('multi-dimension delta', () => {
  it('handles overlapping filters across dimensions', () => {
    const messages: MsgFromWorker[] = [];
    const { handleMessage } = createProtocol((message) => {
      messages.push(message);
    });

    const rows = [
      { a: 0, b: 10 },
      { a: 1, b: 11 },
      { a: 2, b: 12 },
      { a: 3, b: 13 }
    ];
    const schema = [
      { name: 'a', type: 'number', bits: 4 },
      { name: 'b', type: 'number', bits: 4 }
    ];
    handleMessage({ t: 'INGEST', schema, rows });

    const rangeMinA = quantize(1, 0, 3, 4);
    const rangeMaxA = quantize(3, 0, 3, 4);
    handleMessage({ t: 'FILTER_SET', dimId: 0, rangeMin: rangeMinA, rangeMax: rangeMaxA, seq: 1 });

    const rangeMinB = quantize(12, 10, 13, 4);
    const rangeMaxB = quantize(13, 10, 13, 4);
    handleMessage({ t: 'FILTER_SET', dimId: 1, rangeMin: rangeMinB, rangeMax: rangeMaxB, seq: 2 });

    const frame = messages.find((msg) => msg.t === 'FRAME' && msg.seq === 2);
    expect(frame && frame.t === 'FRAME' ? frame.activeCount : null).toBe(2);
  });

  it('supports widening and clearing filters sequentially', () => {
    const messages: MsgFromWorker[] = [];
    const { handleMessage } = createProtocol((message) => {
      messages.push(message);
    });

    const rows = [
      { a: 0, b: 0 },
      { a: 1, b: 10 },
      { a: 2, b: 20 },
      { a: 3, b: 30 },
      { a: 4, b: 40 }
    ];
    const schema = [
      { name: 'a', type: 'number', bits: 4 },
      { name: 'b', type: 'number', bits: 4 }
    ];
    handleMessage({ t: 'INGEST', schema, rows });

    const rangeMinA = quantize(1, 0, 4, 4);
    const rangeMaxA = quantize(3, 0, 4, 4);
    handleMessage({ t: 'FILTER_SET', dimId: 0, rangeMin: rangeMinA, rangeMax: rangeMaxA, seq: 1 });
    const first = messages.find((msg) => msg.t === 'FRAME' && msg.seq === 1);
    expect(first && first.t === 'FRAME' ? first.activeCount : null).toBe(3);

    const rangeMinA2 = quantize(2, 0, 4, 4);
    const rangeMaxA2 = quantize(4, 0, 4, 4);
    handleMessage({ t: 'FILTER_SET', dimId: 0, rangeMin: rangeMinA2, rangeMax: rangeMaxA2, seq: 2 });
    const widened = messages.find((msg) => msg.t === 'FRAME' && msg.seq === 2);
    expect(widened && widened.t === 'FRAME' ? widened.activeCount : null).toBe(3);

    const rangeMinB = quantize(15, 0, 40, 4);
    const rangeMaxB = quantize(35, 0, 40, 4);
    handleMessage({ t: 'FILTER_SET', dimId: 1, rangeMin: rangeMinB, rangeMax: rangeMaxB, seq: 3 });
    const secondDim = messages.find((msg) => msg.t === 'FRAME' && msg.seq === 3);
    expect(secondDim && secondDim.t === 'FRAME' ? secondDim.activeCount : null).toBe(2);

    handleMessage({ t: 'FILTER_CLEAR', dimId: 1, seq: 4 });
    const cleared = messages.find((msg) => msg.t === 'FRAME' && msg.seq === 4);
    expect(cleared && cleared.t === 'FRAME' ? cleared.activeCount : null).toBe(3);

    handleMessage({ t: 'FILTER_CLEAR', dimId: 0, seq: 5 });
    const fullyCleared = messages.find((msg) => msg.t === 'FRAME' && msg.seq === 5);
    expect(fullyCleared && fullyCleared.t === 'FRAME' ? fullyCleared.activeCount : null).toBe(5);
  });
});

function quantize(value: number, min: number, max: number, bits: number) {
  if (max <= min) return 0;
  const range = (1 << bits) - 1;
  const clamped = Math.min(Math.max(value, min), max);
  const normalized = (clamped - min) / (max - min);
  return Math.round(normalized * range);
}
