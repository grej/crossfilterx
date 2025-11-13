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

/**
 * EWMA (Exponential Weighted Moving Average) smoothing factor for cost estimates.
 *
 * Controls how quickly the planner adapts to new performance measurements:
 * - 0.2 = 20% weight to new sample, 80% to historical average
 * - Higher values = faster adaptation but more noise
 * - Lower values = smoother estimates but slower to adapt to changes
 *
 * This value provides good balance for typical workloads with varying
 * filter patterns and data distributions.
 */
const DEFAULT_ALPHA = 0.2;

/**
 * Base cost weight for processing rows outside the cleared range.
 *
 * Outside rows require reactivation (histogram updates, reductions, etc.),
 * which is slightly more expensive than simple iteration. The 1.1 multiplier
 * accounts for this overhead.
 */
const OUTSIDE_ROWS_BASE_WEIGHT = 1.1;

/**
 * Additional cost penalty per active filter.
 *
 * Each additional filter adds overhead to row evaluation during activation,
 * as each row must be checked against all filters. 0.15 per filter was
 * determined empirically from benchmarks across various datasets.
 */
const OUTSIDE_ROWS_FILTER_PENALTY = 0.15;

/**
 * Maximum number of filters considered for penalty calculation.
 *
 * Beyond 4 filters, the marginal cost increase plateaus due to CPU pipelining
 * and branch prediction, so we cap the penalty to avoid over-penalizing
 * complex filter states.
 */
const OUTSIDE_ROWS_MAX_FILTERS = 4;

/**
 * Minimum active fraction to prevent numerical instability.
 *
 * When active rows are < 1% of total, cost estimates become unreliable due
 * to floating-point precision limits. We clamp to 0.01 to ensure reasonable
 * cost calculations.
 */
const MIN_ACTIVE_FRACTION = 0.01;

/**
 * Recompute exponent for non-linear active row scaling.
 *
 * Full recompute cost scales with active_rows^0.85 rather than linearly,
 * reflecting sub-linear scaling from better cache behavior and CPU
 * prefetching with fewer active rows.
 *
 * Empirically derived from benchmarks on datasets of varying sparsity.
 */
const RECOMPUTE_SCALE_EXPONENT = 0.85;

/**
 * Base recompute weight when multiple filters are active.
 *
 * Full recomputes can leverage SIMD operations and have better memory locality,
 * making them 10% more efficient (0.9 weight) than naive estimation would suggest.
 */
const RECOMPUTE_WEIGHT_BASE = 0.9;

/**
 * Active fraction scaling factor for recompute weight.
 *
 * As more rows are active, cache benefits diminish. This factor (0.6) scales
 * the weight adjustment based on how many rows will actually be processed.
 */
const RECOMPUTE_WEIGHT_ACTIVE_FACTOR = 0.6;

/**
 * Recompute weight when only one filter is active (being cleared).
 *
 * Slightly higher (1.1) than multi-filter case because there's no opportunity
 * to optimize across multiple filter evaluations.
 */
const RECOMPUTE_WEIGHT_SINGLE_FILTER = 1.1;

/**
 * Lower bound for balanced distribution heuristic.
 *
 * When outside fraction is between 35-65%, the distribution is considered
 * "balanced" between inside and outside rows, triggering special heuristics.
 */
const BALANCED_DISTRIBUTION_MIN = 0.35;

/**
 * Upper bound for balanced distribution heuristic.
 *
 * See BALANCED_DISTRIBUTION_MIN documentation.
 */
const BALANCED_DISTRIBUTION_MAX = 0.65;

/**
 * Threshold for small inside range heuristic.
 *
 * When the cleared range contains < 20% of total rows, it's considered
 * "small" and may favor recompute over delta updates.
 */
const SMALL_INSIDE_THRESHOLD = 0.2;

/**
 * Threshold for large outside range heuristic.
 *
 * When outside fraction > 60%, iterating outside rows becomes expensive
 * enough that recompute may be faster.
 */
const LARGE_OUTSIDE_THRESHOLD = 0.6;

/**
 * Threshold for sparse active rows heuristic.
 *
 * When active rows are < 5% of total, the dataset is considered "sparse"
 * and full recompute over the small active set is often faster than delta.
 */
const SPARSE_ACTIVE_THRESHOLD = 0.05;

/**
 * Threshold for sparse outside range heuristic.
 *
 * When outside fraction < 50% and active set is sparse, delta is preferred.
 */
const SPARSE_OUTSIDE_THRESHOLD = 0.5;

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
    const outsideWeight = OUTSIDE_ROWS_BASE_WEIGHT +
      OUTSIDE_ROWS_FILTER_PENALTY * Math.min(OUTSIDE_ROWS_MAX_FILTERS, otherFilters);
    const outsideFraction = totalRows === 0 ? 0 : outsideCount / totalRows;
    const activeFraction = Math.min(1, totalRows === 0 ? 0 : activeCount / totalRows);
    const rowsTouched = insideCount + outsideCount;

    const baselineSimd = (insideCount + outsideCount * outsideWeight) * histCount;

    const effectiveFraction = Math.max(MIN_ACTIVE_FRACTION, activeFraction);
    const recomputeRows =
      otherFilters > 0
        ? Math.min(
            totalRows,
            Math.max(Math.max(1, activeCount), Math.round(totalRows * Math.pow(effectiveFraction, RECOMPUTE_SCALE_EXPONENT)))
          )
        : totalRows;
    const recomputeWeight = otherFilters > 0
      ? RECOMPUTE_WEIGHT_BASE + activeFraction * RECOMPUTE_WEIGHT_ACTIVE_FACTOR
      : RECOMPUTE_WEIGHT_SINGLE_FILTER;
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
      if (otherFilters === 0 && outsideFraction > BALANCED_DISTRIBUTION_MIN && outsideFraction < BALANCED_DISTRIBUTION_MAX) {
        return 'recompute';
      }
      if (otherFilters === 0 && insideCount < totalRows * SMALL_INSIDE_THRESHOLD && outsideFraction > LARGE_OUTSIDE_THRESHOLD) {
        return 'recompute';
      }
      if (otherFilters > 0 && activeFraction < SPARSE_ACTIVE_THRESHOLD && outsideFraction < SPARSE_OUTSIDE_THRESHOLD) {
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
