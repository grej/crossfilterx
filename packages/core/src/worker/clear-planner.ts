/**
 * ClearPlanner maintains running estimates of the cost of processing a clear via
 * CSR delta updates (SIMD) versus a full recompute. Its job is to keep timing
 * heuristics out of the hot path: execution code supplies contextual data
 * (inside/outside counts, number of histograms, etc.), the planner chooses a
 * strategy, and the caller reports the actual timings so future decisions get
 * smarter.
 */
export type ClearStrategy = 'delta' | 'recompute';

export interface ClearPlanContext {
  insideCount: number;
  outsideCount: number;
  totalRows: number;
  histogramCount: number;
  otherFilters: number;
  activeCount: number;
}

export interface ClearPlannerOptions {
  ewmaAlpha?: number;
  legacyGuard?: boolean;
}

interface RunningEstimates {
  deltaAvg: number;
  deltaCount: number;
  recomputeAvg: number;
  recomputeCount: number;
  simdCostPerRow: number;
  simdSamples: number;
  recomputeCostPerRow: number;
  recomputeSamples: number;
}

const DEFAULT_ALPHA = 0.2;

export type ClearPlannerSnapshot = RunningEstimates;

export class ClearPlanner {
  private readonly alpha: number;
  private readonly legacyGuard: boolean;
  private readonly estimates: RunningEstimates;

  constructor(options: ClearPlannerOptions = {}) {
    this.alpha = options.ewmaAlpha ?? DEFAULT_ALPHA;
    this.legacyGuard = options.legacyGuard ?? true;
    this.estimates = {
      deltaAvg: 0,
      deltaCount: 0,
      recomputeAvg: 0,
      recomputeCount: 0,
      simdCostPerRow: 0,
      simdSamples: 0,
      recomputeCostPerRow: 0,
      recomputeSamples: 0,
    };
  }

  choose(context: ClearPlanContext): ClearStrategy {
    const { insideCount, outsideCount, totalRows, histogramCount, otherFilters, activeCount } =
      context;
    if (totalRows === 0) return 'recompute';

    const histCount = Math.max(1, histogramCount);
    const outsideWeight = 1.1 + 0.15 * Math.min(4, otherFilters);
    const outsideFraction = totalRows === 0 ? 0 : outsideCount / totalRows;
    const activeFraction = Math.min(1, totalRows === 0 ? 0 : activeCount / totalRows);
    const rowsTouched = insideCount + outsideCount;

    const baselineSimd = (insideCount + outsideCount * outsideWeight) * histCount;

    const effectiveFraction = Math.max(0.01, activeFraction);
    const recomputeRows =
      otherFilters > 0
        ? Math.min(
            totalRows,
            Math.max(Math.max(1, activeCount), Math.round(totalRows * Math.pow(effectiveFraction, 0.85)))
          )
        : totalRows;
    const recomputeWeight = otherFilters > 0 ? 0.9 + activeFraction * 0.6 : 1.1;
    const baselineRecompute = recomputeRows * histCount * recomputeWeight;

    const { simdCostPerRow, simdSamples, recomputeCostPerRow, recomputeSamples } = this.estimates;

    const simdEstimate =
      simdSamples > 0 && Number.isFinite(simdCostPerRow)
        ? simdCostPerRow * Math.max(1, rowsTouched)
        : baselineSimd;

    const recomputeEstimate =
      recomputeSamples > 0 && Number.isFinite(recomputeCostPerRow)
        ? recomputeCostPerRow * Math.max(1, recomputeRows)
        : baselineRecompute;

    if (simdSamples === 0 && recomputeSamples === 0 && this.legacyGuard) {
      if (otherFilters === 0 && outsideFraction > 0.35 && outsideFraction < 0.65) {
        return 'recompute';
      }
      if (otherFilters === 0 && insideCount < totalRows * 0.2 && outsideFraction > 0.6) {
        return 'recompute';
      }
      if (otherFilters > 0 && activeFraction < 0.05 && outsideFraction < 0.5) {
        return 'recompute';
      }
    }

    return simdEstimate <= recomputeEstimate ? 'delta' : 'recompute';
  }

  record(kind: ClearStrategy, ms: number, rowsProcessed: number) {
    if (!Number.isFinite(ms) || ms <= 0) return;
    const rows = rowsProcessed > 0 ? rowsProcessed : 0;
    const costPerRow = rows > 0 ? ms / rows : 0;

    if (kind === 'delta') {
      this.estimates.deltaAvg =
        this.estimates.deltaCount > 0
          ? this.mix(this.estimates.deltaAvg, ms)
          : ms;
      this.estimates.deltaCount++;
      if (costPerRow > 0) {
        this.estimates.simdCostPerRow =
          this.estimates.simdSamples > 0
            ? this.mix(this.estimates.simdCostPerRow, costPerRow)
            : costPerRow;
        this.estimates.simdSamples++;
      }
    } else {
      this.estimates.recomputeAvg =
        this.estimates.recomputeCount > 0
          ? this.mix(this.estimates.recomputeAvg, ms)
          : ms;
      this.estimates.recomputeCount++;
      if (costPerRow > 0) {
        this.estimates.recomputeCostPerRow =
          this.estimates.recomputeSamples > 0
            ? this.mix(this.estimates.recomputeCostPerRow, costPerRow)
            : costPerRow;
        this.estimates.recomputeSamples++;
      }
    }
  }

  snapshot() {
    return { ...this.estimates };
  }

  private mix(previous: number, sample: number) {
    return previous * (1 - this.alpha) + sample * this.alpha;
  }
}
