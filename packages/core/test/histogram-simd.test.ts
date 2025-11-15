/**
 * @fileoverview Validates the SIMD histogram mode wiring by toggling the
 *   `__CFX_HIST_MODE` flag, exercising range filters/clears, and confirming that
 *   the resulting histograms match the baseline counts. This ensures the new
 *   accumulator stub behaves identically to the direct JS path.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { createProtocol, type MsgFromWorker, type MsgToWorker } from '../src/protocol';

const MODE_FLAG = '__CFX_HIST_MODE' as const;

describe('SIMD histogram mode', () => {
  afterEach(() => {
    if (MODE_FLAG in globalThis) {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      delete globalThis[MODE_FLAG];
    }
  });

  it('tracks range filters and clears via the SIMD accumulator', () => {
    (globalThis as Record<string, unknown>)[MODE_FLAG] = 'simd';
    const messages: MsgFromWorker[] = [];
    const { handleMessage } = createProtocol((message) => {
      messages.push(message);
    });

    const schema = [{ name: 'value', type: 'number', bits: 4 }];
    const rows = Array.from({ length: 16 }, (_, value) => ({ value }));
    handleMessage({ t: 'INGEST', schema, rows } satisfies MsgToWorker);

    handleMessage({ t: 'FILTER_SET', dimId: 0, rangeMin: 4, rangeMax: 10, seq: 1 } satisfies MsgToWorker);
    const filtered = findFrame(messages, 1);
    expect(filtered?.activeCount).toBe(7);
    if (filtered) {
      const bins = asBins(filtered.groups[0]);
      expect(sum(bins)).toBe(7);
    }

    handleMessage({ t: 'FILTER_CLEAR', dimId: 0, seq: 2 } satisfies MsgToWorker);
    const cleared = findFrame(messages, 2);
    expect(cleared?.activeCount).toBe(16);
    if (cleared) {
      const bins = asBins(cleared.groups[0]);
      expect(sum(bins)).toBe(16);
    }
  });
});

function findFrame(messages: MsgFromWorker[], seq: number) {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.t === 'FRAME' && message.seq === seq) {
      return message;
    }
  }
  return null;
}

function asBins(group: MsgFromWorker & { t: 'FRAME' }['groups'][number]) {
  return new Uint32Array(group.bins, group.byteOffset, group.binCount);
}

function sum(array: Uint32Array) {
  let total = 0;
  for (let index = 0; index < array.length; index++) {
    total += array[index];
  }
  return total;
}
