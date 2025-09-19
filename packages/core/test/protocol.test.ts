import { describe, expect, it } from 'vitest';

import { createProtocol, type MsgFromWorker, type MsgToWorker } from '../src/protocol';

describe('protocol recompute', () => {
  it('recomputes histograms after applying a filter', () => {
    const messages: MsgFromWorker[] = [];
    const { handleMessage } = createProtocol((message) => {
      messages.push(message);
    });

    const ingest: MsgToWorker = {
      t: 'INGEST',
      schema: [{ name: 'value', type: 'number', bits: 4 }],
      rows: [
        { value: 1 },
        { value: 2 },
        { value: 3 },
        { value: 4 }
      ]
    };
    handleMessage(ingest);

    const frame = messages.find((msg) => msg.t === 'FRAME' && msg.seq === 0);
    expect(
      frame && frame.t === 'FRAME'
        ? Array.from(
            new Uint32Array(
              frame.groups[0].bins,
              frame.groups[0].byteOffset,
              frame.groups[0].binCount
            )
          )
        : null
    ).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

    const filter: MsgToWorker = { t: 'FILTER_SET', dimId: 0, lo: 5, hi: 10, seq: 1 };
    handleMessage(filter);

    const filtered = messages.find((msg) => msg.t === 'FRAME' && msg.seq === 1);
    expect(filtered && filtered.t === 'FRAME' ? filtered.activeCount : null).toBe(2);
    expect(
      filtered && filtered.t === 'FRAME'
        ? Array.from(
            new Uint32Array(
              filtered.groups[0].bins,
              filtered.groups[0].byteOffset,
              filtered.groups[0].binCount
            )
          )
        : null
    ).toEqual([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]);
  });
});
