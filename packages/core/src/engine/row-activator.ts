/**
 * @fileoverview Centralized row activation and deactivation logic.
 * Handles histogram updates, coarse histogram updates, and reductions.
 * Eliminates code duplication and provides a single source of truth for
 * row state changes.
 */

import type { HistogramView } from '../memory/layout';
import type { HistogramSimdAccumulator } from '../wasm/simd';
import type { HistogramBuffer } from '../worker/histogram-updater';

/**
 * State required for row activation/deactivation operations.
 * This interface allows the RowActivator to work with the engine state
 * without knowing the full EngineState structure.
 */
export interface RowActivatorState {
  columns: Uint16Array[];
  histograms: HistogramView[];
  coarseHistograms: HistogramView[];
  activeRows: Uint8Array;
  layout: {
    activeMask: Uint8Array;
  } | null;
  histogramMode: 'direct' | 'buffered' | 'auto' | 'simd';
  simd: HistogramSimdAccumulator | null;
  reductions: Map<number, {
    type: 'sum';
    valueColumn: Float32Array;
    sumBuffers: {
      front: Float64Array;
      back: Float64Array;
    };
  }>;
  activeCount: number;
}

/**
 * Centralized row activator that handles all row state changes.
 * Supports both direct histogram updates and buffered updates.
 */
export class RowActivator {
  constructor(private readonly state: RowActivatorState) {}

  /**
   * Activate a row, updating histograms and reductions.
   *
   * @param row - The row index to activate
   * @param buffers - Optional histogram buffers for batched updates
   */
  activate(row: number, buffers?: HistogramBuffer[] | null): void {
    const { state } = this;
    const { activeRows, layout, columns, histograms, coarseHistograms, reductions } = state;

    // Mark row as active
    activeRows[row] = 1;
    if (layout) {
      setMask(layout.activeMask, row, true);
    }

    // Update histograms
    this.updateHistograms(row, 1, buffers);

    // Update reductions
    for (const [dimId, reduction] of reductions) {
      const bin = columns[dimId][row];
      const value = reduction.valueColumn[row];
      reduction.sumBuffers.front[bin] += value;
      reduction.sumBuffers.back[bin] += value;
    }

    state.activeCount++;
  }

  /**
   * Deactivate a row, updating histograms and reductions.
   *
   * @param row - The row index to deactivate
   * @param buffers - Optional histogram buffers for batched updates
   */
  deactivate(row: number, buffers?: HistogramBuffer[] | null): void {
    const { state } = this;
    const { activeRows, layout, columns, reductions } = state;

    // Mark row as inactive
    activeRows[row] = 0;
    if (layout) {
      setMask(layout.activeMask, row, false);
    }

    // Update histograms
    this.updateHistograms(row, -1, buffers);

    // Update reductions
    for (const [dimId, reduction] of reductions) {
      const bin = columns[dimId][row];
      const value = reduction.valueColumn[row];
      reduction.sumBuffers.front[bin] -= value;
      reduction.sumBuffers.back[bin] -= value;
    }

    state.activeCount--;
  }

  /**
   * Update histograms for a row activation/deactivation.
   * Handles three modes: buffered, SIMD, and direct updates.
   *
   * @param row - The row index
   * @param delta - +1 for activation, -1 for deactivation
   * @param buffers - Optional histogram buffers
   */
  private updateHistograms(row: number, delta: 1 | -1, buffers?: HistogramBuffer[] | null): void {
    const { state } = this;
    const { columns, histograms, coarseHistograms, histogramMode, simd } = state;

    // Mode 1: Buffered updates (for large batch operations)
    if (buffers) {
      for (let dim = 0; dim < buffers.length; dim++) {
        const bin = columns[dim][row];
        if (delta === 1) {
          buffers[dim].inc(bin);
        } else {
          buffers[dim].dec(bin);
        }
      }
      return;
    }

    // Mode 2: SIMD updates (for performance)
    if (histogramMode === 'simd' && simd) {
      simd.record(row, delta);
      return;
    }

    // Mode 3: Direct updates (standard path)
    for (let dim = 0; dim < histograms.length; dim++) {
      const bin = columns[dim][row];
      histograms[dim].front[bin] += delta;
      histograms[dim].back[bin] += delta;

      // Update coarse histogram if present
      const coarse = coarseHistograms[dim];
      if (coarse && coarse.front.length > 0) {
        const factor = Math.ceil(histograms[dim].front.length / coarse.front.length);
        const coarseIdx = Math.floor(bin / factor);
        coarse.front[coarseIdx] += delta;
        coarse.back[coarseIdx] += delta;
      }
    }
  }
}

/**
 * Set or clear a bit in a bitmask.
 * Used for marking rows as active/inactive in the layout's active mask.
 */
function setMask(mask: Uint8Array, row: number, isActive: boolean): void {
  const index = row >> 3;
  const bit = row & 7;
  if (isActive) {
    mask[index] |= 1 << bit;
  } else {
    mask[index] &= ~(1 << bit);
  }
}
