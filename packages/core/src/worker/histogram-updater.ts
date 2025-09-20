/**
 * @fileoverview Centralises histogram update helpers for the worker runtime.
 * The helpers exposed here are used by the protocol handler to decide whether
 * to buffer histogram deltas, to create reusable buffer instances, and to flush
 * accumulated deltas back into the SharedArrayBuffer-backed histogram views.
 * Keeping these utilities in their own module keeps the protocol file focused
 * on message handling while allowing future SIMD/wasm experiments to share the
 * same buffering primitives.
 */

import type { HistogramView } from '../memory/layout';

export type HistogramMode = 'direct' | 'buffered' | 'auto' | 'simd';

export const BUFFER_THRESHOLD_ROWS = 2_000_000;
export const BUFFER_THRESHOLD_WORK = 12_000_000;

export type HistogramBuffer = {
  inc(bin: number): void;
  dec(bin: number): void;
  flush(histograms: HistogramView[], dim: number): void;
};

/**
 * Decide whether buffered histogram updates should be used for a given clear
 * delta. The decision is based on the estimated number of rows toggled and the
 * number of histograms that will be touched; buffering avoids repeatedly
 * touching the SharedArrayBuffer when the workload is large enough to justify
 * the extra copy.
 */
export function shouldBufferHistogramUpdate(
  mode: HistogramMode,
  toggledRows: number,
  histogramCount: number
): boolean {
  if (mode === 'direct') return false;
  if (mode === 'simd') return false;
  if (mode === 'auto' && toggledRows < BUFFER_THRESHOLD_ROWS) {
    return false;
  }
  const boundedHistograms = Math.max(1, histogramCount);
  const workEstimate = toggledRows * boundedHistograms;
  return toggledRows >= BUFFER_THRESHOLD_ROWS || workEstimate >= BUFFER_THRESHOLD_WORK;
}

/**
 * Create per-dimension buffers backed by `Int32Array` views. Each buffer keeps
 * track of bin deltas locally until `flushHistogramBuffers` applies them to the
 * canonical histogram views.
 */
export function createHistogramBuffers(count: number, bins: number): HistogramBuffer[] | null {
  if (!count) return null;
  const buffers: HistogramBuffer[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const local = new Int32Array(bins);
    buffers[i] = {
      inc(bin) {
        local[bin]++;
      },
      dec(bin) {
        local[bin]--;
      },
      flush(histograms, dim) {
        const target = histograms[dim];
        for (let bin = 0; bin < bins; bin++) {
          const delta = local[bin];
          if (!delta) continue;
          target.front[bin] += delta;
          target.back[bin] += delta;
          local[bin] = 0;
        }
      }
    };
  }
  return buffers;
}

/**
 * Applies any pending deltas stored in the provided buffers. Buffers are flushed
 * per dimension to keep the protocol handler simple and to preserve reusability
 * for future histogram update strategies.
 */
export function flushHistogramBuffers(buffers: HistogramBuffer[] | null, histograms: HistogramView[]): void {
  if (!buffers) return;
  for (let dim = 0; dim < buffers.length; dim++) {
    buffers[dim].flush(histograms, dim);
  }
}
