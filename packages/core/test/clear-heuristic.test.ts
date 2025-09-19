/**
 * @fileoverview Validates the clear-path heuristic and associated profiling
 *   metadata exposed by the worker protocol. The tests exercise range clears in
 *   different configurations and depend on `createProtocol` from
 *   `packages/core/src/protocol`. Profiling output is asserted here because the
 *   benchmark harness and developer tooling rely on these fields for guidance.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { createProtocol, type MsgFromWorker, type MsgToWorker } from '../src/protocol';

const PROFILE_FLAG = '__CFX_PROFILE_CLEAR' as const;
const MODE_FLAG = '__CFX_HIST_MODE' as const;

describe('clear heuristic profiling', () => {
  afterEach(() => {
    // reset profiling flag between tests
    if (PROFILE_FLAG in globalThis) {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      delete globalThis[PROFILE_FLAG];
    }
    if (MODE_FLAG in globalThis) {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      delete globalThis[MODE_FLAG];
    }
  });

  it('falls back to full recompute for narrow ranges', () => {
    const profile = runClearScenario({ lo: 7, hi: 8 });
    expect(profile?.fallback).toBe(true);
  });

  it('uses CSR delta for wide ranges', () => {
    const profile = runClearScenario({ lo: 1, hi: 14 });
    expect(profile?.fallback).toBe(false);
  });

  it('falls back for mid-width ranges', () => {
    const profile = runClearScenario({ lo: 4, hi: 11 });
    expect(profile?.fallback).toBe(true);
  });

  it('preserves histogram totals after CSR clear', () => {
    const profile = runClearScenario({ lo: 2, hi: 13 }, true);
    expect(profile?.fallback).toBe(false);
  });

  it('marks buffered clears when histogram buffering is forced', () => {
    (globalThis as Record<string, unknown>)[MODE_FLAG] = 'buffered';
    const profile = runClearScenario({ lo: 2, hi: 13 }, true);
    expect(profile?.fallback).toBe(false);
    expect(profile?.buffered).toBe(true);
  });
});

type RangeBins = { lo: number; hi: number };

function runClearScenario(range: RangeBins, verifyCounts = false) {
  (globalThis as Record<string, unknown>)[PROFILE_FLAG] = true;
  const messages: MsgFromWorker[] = [];
  const { handleMessage } = createProtocol((message) => {
    messages.push(message);
  });

  const schema = [{ name: 'value', type: 'number', bits: 4 }];
  const rows = Array.from({ length: 16 }, (_, value) => ({ value }));

  const ingest: MsgToWorker = { t: 'INGEST', schema, rows };
  handleMessage(ingest);

  const filter: MsgToWorker = {
    t: 'FILTER_SET',
    dimId: 0,
    lo: range.lo,
    hi: range.hi,
    seq: 1
  };
  handleMessage(filter);

  const clear: MsgToWorker = { t: 'FILTER_CLEAR', dimId: 0, seq: 2 };
  handleMessage(clear);

  if (verifyCounts) {
    const frame = messages.find((msg) => msg.t === 'FRAME' && msg.seq === 2);
    if (frame && frame.t === 'FRAME') {
      const bins = new Uint32Array(frame.groups[0].bins, frame.groups[0].byteOffset, frame.groups[0].binCount);
      const total = bins.reduce((acc, value) => acc + value, 0);
      expect(total).toBe(rows.length);
    }
  }

  const frame = messages
    .reverse()
    .find((msg) => msg.t === 'FRAME' && msg.profile && msg.profile.clear);
  return frame && frame.t === 'FRAME' ? frame.profile?.clear : null;
}
