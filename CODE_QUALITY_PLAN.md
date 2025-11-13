# Code Quality Improvement Plan
**Phase 2: Documentation, Readability & Architecture Excellence**

> "Code is read far more often than it is written. Make it a pleasure to read."
> — Inspired by Mike Bostock, Addy Osmani, and Pythonic principles

---

## Philosophy

This plan embraces principles from exceptional JavaScript engineers:

- **Mike Bostock (D3.js)**: Self-documenting code, clear algorithms, beautiful abstractions
- **Addy Osmani**: Comprehensive documentation, clear naming, maintainability patterns
- **Pythonic**: Explicit is better than implicit, readability counts, simple is better than complex

---

## Phase 2.1: Core Documentation (Week 1)

### Priority 1: Public API Documentation ⭐⭐⭐

**Goal:** Every public method has comprehensive JSDoc with examples

#### `packages/core/src/index.ts`

**Add file-level documentation:**
```typescript
/**
 * @fileoverview CrossfilterX - High-performance multidimensional filtering for JavaScript
 *
 * This module provides the main public API for creating and managing filtered datasets.
 * It coordinates with a Web Worker for data processing while maintaining a simple,
 * promise-based interface on the main thread.
 *
 * @example
 * ```typescript
 * import { crossfilterX } from 'crossfilterx';
 *
 * const data = {
 *   columns: {
 *     price: new Uint16Array([100, 200, 150]),
 *     category: new Uint16Array([0, 1, 0])
 *   },
 *   length: 3
 * };
 *
 * const cf = crossfilterX(data, { bins: 256 });
 * const priceDim = cf.dimension('price');
 * priceDim.filter([100, 150]);
 *
 * const group = priceDim.group();
 * const histogram = await group.bins();
 * ```
 *
 * @module crossfilterx
 */
```

**Document `crossfilterX()` function:**
```typescript
/**
 * Creates a CrossfilterX instance for multidimensional filtering.
 *
 * This is the main entry point for the library. It accepts data in either
 * row-oriented or columnar format and returns a handle for creating dimensions
 * and performing filter operations.
 *
 * Data processing happens in a Web Worker, so operations are async. Use
 * `await` with dimension/group operations or call `whenIdle()` to wait for
 * all pending work to complete.
 *
 * @param data - Dataset in columnar or row-oriented format
 * @param options - Configuration options
 * @param options.bins - Number of histogram bins per dimension (default: 256)
 * @param options.worker - Custom worker instance (advanced usage)
 *
 * @returns Handle with methods for creating dimensions and managing data
 *
 * @example
 * ```typescript
 * // Columnar data (recommended for performance)
 * const cf = crossfilterX({
 *   columns: {
 *     temperature: new Float32Array([72, 68, 75]),
 *     humidity: new Uint16Array([45, 52, 48])
 *   },
 *   length: 3
 * }, { bins: 1024 });
 *
 * // Create dimension and filter
 * const tempDim = cf.dimension('temperature');
 * tempDim.filter([68, 73]); // Filter to 68-73°F range
 *
 * // Access filtered histogram
 * const group = tempDim.group();
 * const histogram = await group.bins();
 * console.log(histogram); // Counts per temperature bin
 * ```
 *
 * @example
 * ```typescript
 * // Row-oriented data (auto-converted to columnar)
 * const cf = crossfilterX([
 *   { price: 100, category: 'A' },
 *   { price: 200, category: 'B' },
 *   { price: 150, category: 'A' }
 * ]);
 * ```
 */
export const crossfilterX = (data: unknown, options: CFOptions = {}): CFHandle => {
```

**Document DimensionHandle methods:**
```typescript
/**
 * Handle for a single dimension, providing filtering and grouping operations.
 *
 * A dimension represents a single column in the dataset. You can filter rows
 * by setting a range on this dimension, which updates all other dimensions'
 * histograms to reflect the filtered data.
 *
 * Dimensions support efficient range queries via CSR (Compressed Sparse Row)
 * indexing. Call `buildIndex()` before filtering for optimal performance.
 */
class DimensionHandleImpl {
  /**
   * Applies a range filter to this dimension.
   *
   * This filters the dataset to include only rows where this dimension's
   * value falls within [min, max]. All other dimensions' histograms are
   * updated to reflect the filtered data.
   *
   * The operation is asynchronous (processed in worker). The promise resolves
   * when the filter is fully applied.
   *
   * @param range - [min, max] range to filter, or null to clear filter
   * @returns Promise that resolves when filter is applied
   *
   * @example
   * ```typescript
   * const priceDim = cf.dimension('price');
   *
   * // Filter to prices between $100-$200
   * await priceDim.filter([100, 200]);
   *
   * // Clear filter
   * await priceDim.filter(null);
   * ```
   */
  filter(range: [number, number] | null): Promise<void> {

  /**
   * Clears any active filter on this dimension.
   *
   * Equivalent to `filter(null)`. Restores all rows that were excluded
   * by this dimension's filter.
   *
   * @returns Promise that resolves when filter is cleared
   */
  clear(): Promise<void> {

  /**
   * Creates a group for aggregating this dimension's data.
   *
   * Groups provide access to histograms, statistics, and top-K queries
   * on the filtered dataset. The group automatically reflects the current
   * filter state across all dimensions.
   *
   * @returns GroupHandle for accessing aggregated data
   *
   * @example
   * ```typescript
   * const group = dimension.group();
   * const histogram = await group.bins();  // Get counts per bin
   * const topPrices = await group.top(10); // Get top 10 values
   * ```
   */
  group(): GroupHandle {
```

**Document GroupHandle methods:**
```typescript
/**
 * Handle for grouped/aggregated data on a dimension.
 *
 * Groups provide access to histograms, counts, and top-K queries that
 * reflect the current filter state. All operations are asynchronous
 * since they're computed in the worker.
 */
class GroupHandleImpl {
  /**
   * Returns the histogram of bin counts for this dimension.
   *
   * Each bin represents a range of values. The array index is the bin
   * number, and the value is the count of rows in that bin after filtering.
   *
   * @returns Promise<Uint32Array> - Counts per bin
   *
   * @example
   * ```typescript
   * const group = priceDim.group();
   * const bins = await group.bins();
   * console.log(bins[0]); // Count of rows in bin 0
   * console.log(bins.length); // Number of bins (from options.bins)
   * ```
   */
  bins(): Promise<Uint32Array> {

  /**
   * Returns the coarse-grained histogram for visualization.
   *
   * Coarse histograms aggregate fine bins into fewer bins for display.
   * For example, 4096 fine bins might aggregate into 64 coarse bins
   * for a chart.
   *
   * @returns Promise<Uint32Array | null> - Coarse bin counts, or null if not configured
   *
   * @example
   * ```typescript
   * const coarse = await group.coarse();
   * // Use for chart with ~64 bars instead of 4096
   * ```
   */
  coarse(): Promise<Uint32Array | null> {

  /**
   * Returns the active row count after filtering.
   *
   * This is the number of rows that pass all active filters across
   * all dimensions.
   *
   * @returns Promise<number> - Count of active rows
   *
   * @example
   * ```typescript
   * const total = await group.count();
   * console.log(`${total} rows match current filters`);
   * ```
   */
  count(): Promise<number> {

  /**
   * Returns the top K rows by this dimension's value.
   *
   * This is useful for finding the highest/largest values in the filtered
   * dataset. Results are sorted in descending order.
   *
   * @param k - Number of top results to return
   * @returns Promise<Array<{ value: number, count: number }>> - Top K values with counts
   *
   * @example
   * ```typescript
   * // Get 10 highest prices
   * const topPrices = await priceGroup.top(10);
   * topPrices.forEach(({ value, count }) => {
   *   console.log(`Price ${value}: ${count} items`);
   * });
   * ```
   */
  top(k: number): Promise<Array<{ value: number; count: number }>> {

  /**
   * Returns the bottom K rows by this dimension's value.
   *
   * This is useful for finding the lowest/smallest values in the filtered
   * dataset. Results are sorted in ascending order.
   *
   * @param k - Number of bottom results to return
   * @returns Promise<Array<{ value: number, count: number }>> - Bottom K values with counts
   */
  bottom(k: number): Promise<Array<{ value: number; count: number }>> {

  /**
   * Configures a sum reduction on this dimension's group.
   *
   * Instead of counts, each bin will contain the sum of values from another
   * dimension. This is useful for "sum by category" operations.
   *
   * @param valueAccessor - Dimension name or function to get value to sum
   * @returns this - For method chaining
   *
   * @example
   * ```typescript
   * // Sum revenue by category
   * const categoryDim = cf.dimension('category');
   * const revenueSum = categoryDim.group().reduceSum('revenue');
   * const sums = await revenueSum.bins();
   * // sums[i] = total revenue for category i
   * ```
   */
  reduceSum(valueAccessor: string | ((d: any) => number)): this {
```

---

### Priority 2: File-Level Documentation

**Add comprehensive `@fileoverview` to:**

#### `packages/core/src/controller.ts`
```typescript
/**
 * @fileoverview Main thread controller for CrossfilterX worker communication.
 *
 * The WorkerController manages the main thread side of CrossfilterX, coordinating
 * with the Web Worker that performs data processing. It handles:
 *
 * - Dimension creation and lifecycle management
 * - Filter operations (apply, clear, range queries)
 * - Shared memory views for zero-copy data access
 * - Message passing and promise coordination with worker
 * - Public API surface for crossfilterX handle methods
 *
 * The controller maintains a map of dimensions and their associated shared
 * memory views (histograms, coarse histograms, reduction buffers). When
 * filters are applied, it sends messages to the worker and tracks pending
 * operations via sequence numbers.
 *
 * Threading Model:
 * - Main thread: API calls, histogram reads (via SharedArrayBuffer)
 * - Worker thread: Data processing, filter application, histogram updates
 *
 * @module crossfilterx/controller
 */
```

#### `packages/core/src/protocol.ts`
```typescript
/**
 * @fileoverview Worker-side protocol handler for CrossfilterX data operations.
 *
 * This module implements the core filtering engine that runs in a Web Worker.
 * It handles all data processing operations:
 *
 * - Data ingestion and memory layout
 * - Filter application with delta updates
 * - Full recomputes when necessary
 * - Histogram and reduction management
 * - CSR index building for efficient range queries
 * - Top-K queries
 *
 * The protocol uses message passing to communicate with the main thread
 * (via WorkerController). All data structures use SharedArrayBuffer for
 * zero-copy access from the main thread.
 *
 * Performance Characteristics:
 * - Filter operations: O(k) where k = rows in delta, or O(n) for full recompute
 * - Indexed range queries: O(k) where k = rows in range
 * - Histogram updates: SIMD-accelerated when available
 *
 * @module crossfilterx/protocol
 */
```

#### `packages/core/src/indexers/csr.ts`
```typescript
/**
 * @fileoverview CSR (Compressed Sparse Row) index builder for efficient range queries.
 *
 * CSR format stores row IDs grouped by bin value, enabling O(k) iteration
 * over rows in a bin range (where k = rows in range) vs O(n) full scan.
 *
 * Format:
 * - `binOffsets`: binOffsets[i] to binOffsets[i+1] gives the range in rowIds
 * - `rowIds`: All row indices, grouped by their bin values
 *
 * Example for column [2, 0, 2, 1]:
 * ```
 * binOffsets: [0, 1, 2, 4]  // bin 0 has 1 row, bin 1 has 1 row, bin 2 has 2 rows
 * rowIds: [1, 3, 0, 2]      // bin 0: row 1, bin 1: row 3, bin 2: rows 0,2
 * ```
 *
 * This enables fast iteration: "for bin in range, iterate rowIds[binOffsets[bin]...binOffsets[bin+1]]"
 *
 * @module crossfilterx/indexers/csr
 */
```

---

## Phase 2.2: Naming Clarity (Week 1)

### Rename: `lo` / `hi` → `rangeMin` / `rangeMax`

**Files to update (48 occurrences):**
- `packages/core/src/protocol.ts` (28 occurrences)
- `packages/core/src/controller.ts` (12 occurrences)
- `packages/core/src/types.ts` (8 occurrences)

**Example transformation:**
```typescript
// Before
FILTER_SET: { dimId: number; lo: number; hi: number }
function applyFilter(dimId: number, range: { lo: number; hi: number } | null)

// After
FILTER_SET: { dimensionId: number; rangeMin: number; rangeMax: number }
function applyFilter(dimensionId: number, range: { rangeMin: number; rangeMax: number } | null)
```

### Rename: `dimId` → `dimensionId`

**Rationale:** Abbreviations harm readability. "dimensionId" is self-documenting.

**Files to update (120+ occurrences)**

### Rename Other Abbreviations

| Current | New | Rationale |
|---------|-----|-----------|
| `acc` | `cumulativeOffset` | Describes what it accumulates |
| `k` (in topK) | `resultCount` | Clearer parameter name |
| `requiredFilters` | `activeFilterCount` | Describes what it counts |

---

## Phase 2.3: Magic Numbers → Named Constants (Week 1)

### Extract Buffer Thresholds
```typescript
/**
 * Row count threshold for enabling histogram buffering.
 *
 * For operations affecting more than 32K rows, we batch histogram updates
 * to reduce SharedArrayBuffer contention. This value was chosen as it
 * approximates L1 cache size for typical row operations.
 */
const HISTOGRAM_BUFFER_THRESHOLD_ROWS = 32_768;

/**
 * Work threshold for histogram buffering (rows × dimensions).
 *
 * When total work (rows to update × dimensions) exceeds 1M operations,
 * we use buffering regardless of row count. This prevents excessive
 * SharedArrayBuffer writes for high-dimensional datasets.
 */
const HISTOGRAM_BUFFER_THRESHOLD_WORK = 1_048_576;
```

### Extract UI Blocking Threshold
```typescript
/**
 * Row count that may cause UI blocking.
 *
 * Operations on more than 250K rows may take >16ms and block the UI thread
 * when reading results. This threshold triggers a warning to help developers
 * identify performance issues.
 *
 * Note: The actual computation happens in a worker (non-blocking), but
 * reading large SharedArrayBuffers on the main thread can still cause jank.
 */
const UI_BLOCKING_THRESHOLD = 250_000;
```

### Extract Category Limit
```typescript
/**
 * Maximum number of unique categories per dimension.
 *
 * Limited to 65,535 (0xFFFF) because we use Uint16Array for category codes.
 * Going beyond this requires switching to Uint32Array, which doubles memory
 * usage.
 */
const MAX_CATEGORIES = 0xFFFF;
```

### Extract Clear Planner Constants

**This is the most important cleanup!**

```typescript
/**
 * Exponential weighted moving average (EWMA) smoothing factor.
 *
 * Controls how quickly the planner adapts to new performance data:
 * - 0.2 = 20% weight to new sample, 80% to history
 * - Higher values = faster adaptation but more noise
 * - Lower values = smoother but slower to adapt
 *
 * This value provides a good balance for typical workloads.
 */
const EWMA_ALPHA = 0.2;

/**
 * Base cost weight for processing rows outside the cleared range.
 *
 * Outside rows require activation (histogram updates, reductions, etc.).
 * Base weight of 1.1 reflects this is slightly more expensive than
 * a simple iteration.
 */
const OUTSIDE_ROWS_BASE_WEIGHT = 1.1;

/**
 * Additional cost per additional active filter.
 *
 * Each additional filter adds overhead to row evaluation during activation.
 * 0.15 per filter was empirically determined from benchmarks.
 */
const OUTSIDE_ROWS_FILTER_PENALTY = 0.15;

/**
 * Maximum filter count considered for penalty calculation.
 *
 * Beyond 4 filters, the marginal cost increase plateaus, so we cap
 * the penalty calculation to avoid over-penalizing complex filter states.
 */
const OUTSIDE_ROWS_MAX_FILTERS = 4;

/**
 * Minimum active fraction to prevent division-by-zero effects.
 *
 * When active rows are < 1% of total, costs become unstable. We clamp
 * to 0.01 to ensure reasonable cost estimates.
 */
const MIN_ACTIVE_FRACTION = 0.01;

/**
 * Recompute exponent for non-linear scaling of active rows.
 *
 * Full recompute cost scales with active_rows^0.85, not linearly.
 * This reflects sub-linear scaling from better cache behavior with
 * fewer active rows.
 */
const RECOMPUTE_SCALE_EXPONENT = 0.85;

/**
 * Recompute weight when multiple filters are active.
 *
 * Base: 0.9, increased by active_fraction * 0.6
 * Reflects that full recomputes can leverage SIMD and better cache locality.
 */
const RECOMPUTE_WEIGHT_BASE = 0.9;
const RECOMPUTE_WEIGHT_ACTIVE_FACTOR = 0.6;

/**
 * Recompute weight when only one filter is active (being cleared).
 *
 * Slightly higher (1.1) because there's no multi-filter benefit.
 */
const RECOMPUTE_WEIGHT_SINGLE_FILTER = 1.1;

/**
 * Balanced distribution range for outside fraction.
 *
 * When outside fraction is between 35-65%, the data is "balanced" between
 * inside and outside. In this case, delta and recompute have similar costs,
 * so we apply tie-breaker heuristics.
 */
const BALANCED_DISTRIBUTION_MIN = 0.35;
const BALANCED_DISTRIBUTION_MAX = 0.65;

/**
 * Small inside range threshold.
 *
 * When the cleared range is < 20% of total rows and outside is > 60%,
 * we prefer recompute because iterating the large outside set is expensive.
 */
const SMALL_INSIDE_THRESHOLD = 0.2;
const LARGE_OUTSIDE_THRESHOLD = 0.6;

/**
 * Sparse active rows threshold.
 *
 * When active rows are < 5% and outside is < 50%, we prefer delta because
 * recomputing the sparse active set is efficient.
 */
const SPARSE_ACTIVE_THRESHOLD = 0.05;
const SPARSE_OUTSIDE_THRESHOLD = 0.5;
```

---

## Phase 2.4: Function Decomposition (Week 2)

### Break Down `clearFilterRange()` (155 lines → 4 functions)

**Current structure is monolithic. Extract:**

```typescript
/**
 * Clears a filter range on a dimension, updating histograms and state.
 *
 * This is the most complex operation in the protocol. It must decide between:
 * - Delta update: Iterate rows outside the cleared range and reactivate them
 * - Full recompute: Recalculate all histograms from scratch
 *
 * The ClearPlanner uses heuristics and historical performance data to choose
 * the best strategy. This function executes the chosen strategy.
 *
 * @param state - Current engine state
 * @param dimensionId - Dimension being cleared
 * @param previous - Range that was active (now being removed)
 */
function clearFilterRange(
  state: EngineState,
  dimensionId: number,
  previous: { rangeMin: number; rangeMax: number }
) {
  const { layout, activeRows, indexes, histograms } = state;
  if (!layout) return;

  const logger = createLogger('Worker');
  const column = state.columns[dimensionId];
  const totalRows = state.rowCount;

  // 1. Decide strategy
  const strategy = planClearStrategy(state, dimensionId, previous, totalRows);

  // 2. Execute chosen strategy
  if (strategy === 'recompute') {
    logger.log(`Clear filter: using RECOMPUTE strategy`);
    fullRecompute(state);
    return;
  }

  // 3. Execute delta strategy
  executeDeltaClearStrategy(state, dimensionId, previous, strategy);
}

/**
 * Plans the optimal strategy for clearing a filter range.
 *
 * Uses ClearPlanner to decide between delta and recompute based on:
 * - Row counts (inside range, outside range, active rows)
 * - Number of other active filters
 * - Historical performance data (if available)
 *
 * @returns 'recompute' | 'delta-with-profile' | 'delta'
 */
function planClearStrategy(
  state: EngineState,
  dimensionId: number,
  previous: { rangeMin: number; rangeMax: number },
  totalRows: number
): ClearStrategy {
  const { indexes } = state;
  const index = indexes.get(dimensionId);

  if (!index) {
    return 'recompute'; // No index = must recompute
  }

  const { binOffsets } = index;
  const insideRowCount = binOffsets[previous.rangeMax + 1] - binOffsets[previous.rangeMin];
  const outsideRowCount = totalRows - insideRowCount;

  // Count other active filters (excludes the one being cleared)
  const otherActiveFilters = countActiveFilters(state.filters) - 1;

  // Delegate to planner
  const planner = state.clearPlanner;
  return planner.choose({
    totalRows,
    insideCount: insideRowCount,
    outsideCount: outsideRowCount,
    activeRows: state.activeCount,
    otherFilters: otherActiveFilters,
  });
}

/**
 * Executes delta strategy for clearing a filter.
 *
 * This iterates rows outside the cleared range and reactivates them.
 * Optionally collects performance profile data for the planner.
 *
 * @param state - Engine state
 * @param dimensionId - Dimension being cleared
 * @param previous - Range being cleared
 * @param strategy - 'delta' or 'delta-with-profile'
 */
function executeDeltaClearStrategy(
  state: EngineState,
  dimensionId: number,
  previous: { rangeMin: number; rangeMax: number },
  strategy: ClearStrategy
) {
  const { indexes, columns } = state;
  const index = indexes.get(dimensionId)!;
  const column = columns[dimensionId];
  const { binOffsets, rowIds } = index;

  const shouldProfile = strategy === 'delta-with-profile';
  const profiler = shouldProfile ? createProfiler() : null;

  // Build list of rows to reactivate (outside the cleared range)
  const rowsToActivate = collectOutsideRows(
    rowIds,
    binOffsets,
    previous.rangeMin,
    previous.rangeMax
  );

  if (profiler) profiler.mark('collect-rows');

  // Reactivate rows (update histograms, reductions, etc.)
  activateRowBatch(state, rowsToActivate);

  if (profiler) {
    profiler.mark('activate-rows');
    recordClearPerformance(state, profiler.measurements);
  }
}

/**
 * Collects row IDs outside the specified range from a CSR index.
 *
 * This efficiently gathers all rows that need reactivation by iterating
 * bins outside [rangeMin, rangeMax] and collecting their row IDs.
 *
 * @param rowIds - CSR row ID array
 * @param binOffsets - CSR offset array
 * @param rangeMin - Minimum bin of cleared range
 * @param rangeMax - Maximum bin of cleared range
 * @returns Array of row IDs to reactivate
 */
function collectOutsideRows(
  rowIds: Uint32Array,
  binOffsets: Uint32Array,
  rangeMin: number,
  rangeMax: number
): number[] {
  const result: number[] = [];

  // Rows before the range
  const beforeStart = 0;
  const beforeEnd = binOffsets[rangeMin];
  for (let i = beforeStart; i < beforeEnd; i++) {
    result.push(rowIds[i]);
  }

  // Rows after the range
  const afterStart = binOffsets[rangeMax + 1];
  const afterEnd = rowIds.length;
  for (let i = afterStart; i < afterEnd; i++) {
    result.push(rowIds[i]);
  }

  return result;
}

/**
 * Activates a batch of rows, updating histograms and reductions.
 *
 * Uses RowActivator for consistent activation logic with automatic
 * SIMD support and coarse histogram updates.
 *
 * @param state - Engine state
 * @param rows - Array of row indices to activate
 */
function activateRowBatch(state: EngineState, rows: number[]) {
  const rowActivator = new RowActivator(state as unknown as RowActivatorState);

  for (const row of rows) {
    rowActivator.activate(row);
  }
}
```

**Benefits:**
- Each function < 50 lines
- Single responsibility per function
- Easier to test in isolation
- Clear names document intent
- Can optimize individual functions

---

## Phase 2.5: Algorithm Explanations (Week 2)

### Add detailed comments to complex algorithms

#### `diffRanges()` - Range difference algorithm
```typescript
/**
 * Computes the geometric difference between two ranges.
 *
 * Given a previous range and a new range, calculates which sub-ranges were
 * added and which were removed. This enables delta updates when a filter
 * changes rather than full recomputation.
 *
 * Example:
 * ```
 * previous: [10, 20]
 * next:     [15, 25]
 *
 * removed: [[10, 14]]  // Rows 10-14 were in previous, not in next
 * added:   [[21, 25]]  // Rows 21-25 are in next, not in previous
 * ```
 *
 * Special cases:
 * - No overlap: entire previous is removed, entire next is added
 * - Identical ranges: returns null (no change)
 * - One contained in other: returns non-overlapping portions
 *
 * @param previous - Previous filter range
 * @param next - New filter range
 * @returns Object with `added` and `removed` sub-ranges, or null if no change
 */
function diffRanges(
  previous: { rangeMin: number; rangeMax: number },
  next: { rangeMin: number; rangeMax: number }
): { added: Array<[number, number]>; removed: Array<[number, number]> } | null {
  // Early exit: identical ranges
  if (previous.rangeMin === next.rangeMin && previous.rangeMax === next.rangeMax) {
    return null;
  }

  const added: Array<[number, number]> = [];
  const removed: Array<[number, number]> = [];

  // Case 1: No overlap - entire previous removed, entire next added
  // Example: prev=[10,20], next=[30,40]
  if (next.rangeMax < previous.rangeMin || next.rangeMin > previous.rangeMax) {
    removed.push([previous.rangeMin, previous.rangeMax]);
    added.push([next.rangeMin, next.rangeMax]);
    return { added, removed };
  }

  // Case 2: Next expands left of previous
  // Example: prev=[15,25], next=[10,25] → added=[10,14]
  if (next.rangeMin < previous.rangeMin) {
    added.push([next.rangeMin, previous.rangeMin - 1]);
  }

  // Case 3: Next contracts from left of previous
  // Example: prev=[10,25], next=[15,25] → removed=[10,14]
  if (next.rangeMin > previous.rangeMin) {
    removed.push([previous.rangeMin, next.rangeMin - 1]);
  }

  // Case 4: Next expands right of previous
  // Example: prev=[10,20], next=[10,25] → added=[21,25]
  if (next.rangeMax > previous.rangeMax) {
    added.push([previous.rangeMax + 1, next.rangeMax]);
  }

  // Case 5: Next contracts from right of previous
  // Example: prev=[10,25], next=[10,20] → removed=[21,25]
  if (next.rangeMax < previous.rangeMax) {
    removed.push([next.rangeMax + 1, previous.rangeMax]);
  }

  return { added, removed };
}
```

#### `buildCsr()` - Two-pass CSR construction
```typescript
/**
 * Builds a CSR (Compressed Sparse Row) index for efficient range queries.
 *
 * Algorithm (two-pass):
 * 1. Count Pass: Count how many rows have each bin value
 * 2. Place Pass: Place each row ID in its bin's section of the array
 *
 * Example:
 * ```
 * Input column: [2, 0, 2, 1, 0]
 *
 * After count pass:
 *   counts: [2, 1, 2] (bin 0 has 2 rows, bin 1 has 1, bin 2 has 2)
 *
 * Convert counts to offsets:
 *   offsets: [0, 2, 3, 5] (bin 0 starts at 0, bin 1 at 2, bin 2 at 3)
 *
 * After place pass:
 *   rowIds: [1, 4, 3, 0, 2]
 *           |____| |  |____|
 *           bin 0  |  bin 2
 *                  bin 1
 * ```
 *
 * This enables O(k) iteration over rows in a bin range where k = rows in range,
 * vs O(n) for a full scan.
 *
 * @param column - Column data (bin values per row)
 * @param binCount - Number of bins (max value + 1)
 * @returns CSR index with binOffsets and rowIds arrays
 */
export function buildCsr(column: Uint16Array, binCount: number): CsrIndex {
  const rowCount = column.length;

  // Pass 1: Count rows per bin
  const counts = new Uint32Array(binCount);
  for (let row = 0; row < rowCount; row++) {
    const bin = column[row];
    counts[bin]++;
  }

  // Convert counts to cumulative offsets
  // offsets[i] = starting index in rowIds for bin i
  const binOffsets = new Uint32Array(binCount + 1);
  let cumulativeOffset = 0;
  for (let bin = 0; bin < binCount; bin++) {
    binOffsets[bin] = cumulativeOffset;
    cumulativeOffset += counts[bin];
  }
  binOffsets[binCount] = cumulativeOffset; // Final offset = total row count

  // Pass 2: Place row IDs in their bin's section
  const rowIds = new Uint32Array(rowCount);
  const writePositions = new Uint32Array(binOffsets); // Copy offsets to track write position

  for (let row = 0; row < rowCount; row++) {
    const bin = column[row];
    const position = writePositions[bin];
    rowIds[position] = row;
    writePositions[bin]++; // Advance write position for this bin
  }

  return { binOffsets, rowIds };
}
```

#### `setMask()` - Bit packing explanation
```typescript
/**
 * Sets or clears a bit in a packed bit mask.
 *
 * This packs 8 row states into each byte of the mask array, reducing
 * memory usage by 8× compared to a byte-per-row encoding.
 *
 * Bit manipulation:
 * - `row >> 3` = row ÷ 8 (finds which byte contains this row's bit)
 * - `row & 7` = row % 8 (finds which bit within that byte)
 * - `1 << bit` = creates a mask with only that bit set
 *
 * Example for row 13:
 * ```
 * row = 13
 * byteIndex = 13 >> 3 = 1  (13 ÷ 8 = 1, in byte 1)
 * bitPosition = 13 & 7 = 5  (13 % 8 = 5, bit 5 within byte)
 * mask = 1 << 5 = 0b00100000
 *
 * To set bit: mask[1] |= 0b00100000
 * To clear bit: mask[1] &= ~0b00100000
 * ```
 *
 * @param mask - Packed bit array (8 rows per byte)
 * @param row - Row index to set/clear
 * @param isActive - true to set bit, false to clear it
 */
function setMask(mask: Uint8Array, row: number, isActive: boolean) {
  const byteIndex = row >> 3;          // Divide by 8 to find byte
  const bitPosition = row & 7;         // Modulo 8 to find bit within byte
  const bitMask = 1 << bitPosition;    // Create mask for this bit

  if (isActive) {
    mask[byteIndex] |= bitMask;        // Set bit (OR)
  } else {
    mask[byteIndex] &= ~bitMask;       // Clear bit (AND with inverse)
  }
}
```

---

## Phase 2.6: Type Safety (Week 2)

### Replace `any` with proper types

#### Before:
```typescript
reduceSum(valueAccessor: string | ((d: any) => number)): this {
```

#### After:
```typescript
/**
 * Row type for user-provided data. Can be customized via generic parameter.
 */
export type Row = Record<string, unknown>;

/**
 * Value accessor function type.
 */
export type ValueAccessor<T = Row> = (row: T) => number;

// Update method signature
reduceSum<T = Row>(valueAccessor: string | ValueAccessor<T>): this {
```

---

## Implementation Checklist

### Week 1: Documentation & Naming
- [ ] Add file-level `@fileoverview` to index.ts, controller.ts, protocol.ts, csr.ts
- [ ] Add comprehensive JSDoc to `crossfilterX()` function
- [ ] Add JSDoc to all DimensionHandle methods (filter, clear, group)
- [ ] Add JSDoc to all GroupHandle methods (bins, keys, count, top, bottom, reduceSum, etc.)
- [ ] Add JSDoc to WorkerController public methods
- [ ] Rename `lo`/`hi` to `rangeMin`/`rangeMax` throughout (48 occurrences)
- [ ] Rename `dimId` to `dimensionId` throughout (120+ occurrences)
- [ ] Extract magic numbers to named constants (protocol.ts, clear-planner.ts)
- [ ] Run tests after each major change
- [ ] Commit as "Phase 2.1: Documentation & Naming Improvements"

### Week 2: Structure & Algorithms
- [ ] Break down `clearFilterRange()` into 4-5 smaller functions
- [ ] Add comprehensive comments to `diffRanges()` algorithm
- [ ] Add comprehensive comments to `buildCsr()` algorithm
- [ ] Add inline comments to `setMask()` bit manipulation
- [ ] Add comments to `choose()` in clear-planner.ts explaining heuristics
- [ ] Replace `any` types with proper generics/types
- [ ] Add "why" comments to complex conditionals in applyFilter()
- [ ] Add algorithm overview to fullRecompute()
- [ ] Run full test suite
- [ ] Commit as "Phase 2.2: Structure & Algorithm Documentation"

---

## Success Criteria

### Quantitative
- [ ] 100% of public API has JSDoc
- [ ] 100% of complex algorithms (>20 lines) have explanatory comments
- [ ] 0 remaining `any` types in public API
- [ ] <10 magic numbers without named constants
- [ ] All functions <80 lines (except well-commented edge cases)
- [ ] All tests passing

### Qualitative
- [ ] A new contributor can understand the architecture from comments alone
- [ ] Function names clearly describe what they do
- [ ] Variable names clearly describe what they contain
- [ ] Comments explain "why" not just "what"
- [ ] Complex algorithms have clear examples in comments
- [ ] Code reads like well-written prose

---

## Inspiration

### Mike Bostock (D3.js) Principles
- Self-documenting code through clear abstractions
- Comprehensive examples in documentation
- Beautiful, readable implementations

### Addy Osmani Principles
- Document the "why" not just the "what"
- Make code easy to maintain 6 months later
- Think of your future self as your user

### Pythonic Principles
- Explicit is better than implicit
- Readability counts
- Simple is better than complex
- There should be one obvious way to do it

---

**Let's make CrossfilterX not just fast, but beautiful to read and maintain!** 🎨
