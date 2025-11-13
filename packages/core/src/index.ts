/**
 * @fileoverview CrossfilterX - High-performance multidimensional filtering for JavaScript
 *
 * This module provides the main public API for creating and managing filtered datasets.
 * It coordinates with a Web Worker for data processing while maintaining a simple,
 * promise-based interface on the main thread.
 *
 * @example Basic Usage
 * ```typescript
 * import { crossfilterX } from 'crossfilterx';
 *
 * // Create from columnar data (recommended for performance)
 * const cf = crossfilterX({
 *   columns: {
 *     price: new Uint16Array([100, 200, 150]),
 *     category: new Uint16Array([0, 1, 0])
 *   },
 *   length: 3
 * }, { bins: 256 });
 *
 * // Create dimension and filter
 * const priceDim = cf.dimension('price');
 * priceDim.filter([100, 150]);
 *
 * // Access histogram
 * const group = priceDim.group();
 * const histogram = group.bins();
 * ```
 *
 * @module crossfilterx
 */

import { WorkerController, type DimensionSpec, type IngestSource } from './controller';
import type { CFHandle, CFOptions, ColumnarData, DimensionHandle, GroupHandle } from './types';
import type { ClearPlannerSnapshot } from './worker/clear-planner';

export type { CFHandle, CFOptions, DimensionHandle, GroupHandle } from './types';

/**
 * Implementation of DimensionHandle, providing filtering and grouping operations.
 *
 * A dimension represents a single column in the dataset. You can filter rows
 * by setting a range on this dimension, which updates all other dimensions'
 * histograms to reflect the filtered data.
 *
 * Dimensions support efficient range queries via CSR (Compressed Sparse Row)
 * indexing. Call `buildIndex()` on the main handle before filtering for
 * optimal performance on large datasets.
 *
 * All operations are asynchronous since they're processed in a Web Worker.
 * The handle is thenable, so you can `await` it to ensure initialization
 * completes before calling methods.
 */
class DimensionHandleImpl implements DimensionHandle {
  private pending: Promise<void> = Promise.resolve();
  private resolvedId: number | null;
  private readonly idPromise: Promise<number>;

  constructor(private readonly controller: WorkerController, id: number | Promise<number>) {
    if (typeof id === 'number') {
      this.resolvedId = id;
      this.idPromise = Promise.resolve(id);
    } else {
      this.resolvedId = null;
      this.idPromise = id.then((resolved) => {
        this.resolvedId = resolved;
        return resolved;
      });
      this.pending = this.pending.then(() => this.idPromise).then(() => {});
    }
  }

  /**
   * Helper to execute a task with the resolved dimension ID.
   * Waits for dimension initialization if necessary.
   */
  private async withId<T>(task: (id: number) => Promise<T> | T): Promise<T> {
    const id = this.resolvedId ?? (await this.idPromise);
    return task(id);
  }

  /**
   * Applies a range filter to this dimension.
   *
   * Filters the dataset to include only rows where this dimension's value
   * falls within [min, max] (inclusive). All other dimensions' histograms
   * are updated to reflect the filtered data.
   *
   * The operation is asynchronous (processed in worker). The dimension handle
   * is returned immediately for chaining, but you can `await` it to ensure
   * the filter is fully applied.
   *
   * @param rangeOrSet - [min, max] range to filter (set-based filters coming soon)
   * @returns this - For method chaining
   *
   * @example
   * ```typescript
   * const priceDim = cf.dimension('price');
   *
   * // Filter to prices between $100-$200
   * priceDim.filter([100, 200]);
   *
   * // Wait for filter to apply
   * await priceDim;
   *
   * // Or chain operations
   * await priceDim.filter([100, 200]);
   * ```
   */
  filter(rangeOrSet: [number, number] | Set<number>): DimensionHandle {
    if (rangeOrSet instanceof Set) {
      throw new Error('Set-based filters not yet implemented.');
    }
    // If dimension is ready, call filterRange immediately (synchronously starts the operation)
    // Otherwise, chain it to the pending queue
    const id = this.resolvedId;
    if (id !== null) {
      // Call synchronously to ensure trackFrame is called before returning
      void this.controller.filterRange(id, rangeOrSet);
    } else {
      this.pending = this.pending.then(async () => {
        const id = await this.idPromise;
        await this.controller.filterRange(id, rangeOrSet);
      });
    }
    return this;
  }

  /**
   * Clears any active filter on this dimension.
   *
   * Restores all rows that were excluded by this dimension's filter.
   * Equivalent to calling `filter(null)`. All other dimensions' histograms
   * are updated to reflect the change.
   *
   * The operation is asynchronous (processed in worker). The dimension handle
   * is returned immediately for chaining.
   *
   * @returns this - For method chaining
   *
   * @example
   * ```typescript
   * const priceDim = cf.dimension('price');
   * priceDim.filter([100, 200]);
   *
   * // Later, clear the filter
   * priceDim.clear();
   * await priceDim; // Wait for clear to complete
   * ```
   */
  clear(): DimensionHandle {
    // If dimension is ready, call clearFilter immediately (synchronously starts the operation)
    // Otherwise, chain it to the pending queue
    const id = this.resolvedId;
    if (id !== null) {
      // Call synchronously to ensure trackFrame is called before returning
      void this.controller.clearFilter(id);
    } else {
      this.pending = this.pending.then(async () => {
        const id = await this.idPromise;
        await this.controller.clearFilter(id);
      });
    }
    return this;
  }

  /**
   * Creates a group for aggregating this dimension's data.
   *
   * Groups provide access to histograms, statistics, and top-K queries
   * on the filtered dataset. The group automatically reflects the current
   * filter state across all dimensions.
   *
   * @param options - Optional configuration for coarse binning, etc.
   * @returns GroupHandle for accessing aggregated data
   * @throws Error if dimension is still initializing (await the handle first)
   *
   * @example
   * ```typescript
   * const priceDim = cf.dimension('price');
   * const group = priceDim.group();
   *
   * // Access histogram synchronously (reads from SharedArrayBuffer)
   * const histogram = group.bins();  // Uint32Array of counts per bin
   * console.log(histogram[0]); // Count of rows in bin 0
   *
   * // Get top K values
   * const topPrices = await group.top(10);
   * ```
   */
  group(options?: import('./types').GroupOptions): GroupHandleImpl {
    if (this.resolvedId === null) {
      throw new Error('Dimension is still initializing; await the handle before calling group().');
    }
    return new GroupHandleImpl(this.controller, this.resolvedId, options);
  }

  /**
   * Makes DimensionHandle thenable/await-able.
   *
   * This allows you to `await` a dimension handle to ensure all pending
   * operations (including initialization) are complete.
   *
   * @example
   * ```typescript
   * const dim = cf.dimension('price');
   * dim.filter([100, 200]);
   * await dim; // Waits for both initialization and filter
   * ```
   */
  then<TResult1 = DimensionHandle, TResult2 = never>(
    onfulfilled?: ((value: DimensionHandle) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): Promise<TResult1 | TResult2> {
    return this.pending.then(() => this).then(onfulfilled, onrejected);
  }
}

/**
 * Implementation of GroupHandle, providing access to aggregated dimension data.
 *
 * Groups provide histograms, counts, and statistics that reflect the current
 * filter state across all dimensions. Data is accessed synchronously via
 * SharedArrayBuffer for maximum performance.
 *
 * Groups support:
 * - Histograms (bin counts)
 * - Coarse histograms (for visualization)
 * - Total count of filtered rows
 * - Sum reductions (aggregate values by category)
 * - Top-K/Bottom-K queries
 */
class GroupHandleImpl implements GroupHandle {
  constructor(
    private readonly controller: WorkerController,
    private readonly dimId: number,
    private readonly options?: import('./types').GroupOptions
  ) {}

  /**
   * Returns the histogram of bin counts for this dimension.
   *
   * Each bin represents a range of values. The array index is the bin
   * number, and the value is the count of rows in that bin after filtering.
   *
   * This is a synchronous read from SharedArrayBuffer, so it's very fast.
   * The data automatically updates when filters change.
   *
   * @returns Uint32Array - Counts per bin (length = number of bins from options)
   *
   * @example
   * ```typescript
   * const group = priceDim.group();
   * const bins = group.bins();
   * console.log(bins[0]); // Count of rows in bin 0
   * console.log(bins.length); // Number of bins (e.g., 256, 4096)
   *
   * // Use for charting
   * bins.forEach((count, bin) => {
   *   if (count > 0) console.log(`Bin ${bin}: ${count} items`);
   * });
   * ```
   */
  bins(): Uint32Array {
    return this.controller.groupStateFor(this.dimId).bins;
  }

  /**
   * Returns the bin keys (actual values) for this dimension.
   *
   * For quantized dimensions, keys are the center points of each bin.
   * For categorical dimensions (strings), keys are category codes that
   * map to the original string values.
   *
   * @returns Uint16Array | Float32Array - Bin keys matching bins() array
   *
   * @example
   * ```typescript
   * const keys = group.keys();
   * const bins = group.bins();
   *
   * // Iterate bins with their values
   * for (let i = 0; i < bins.length; i++) {
   *   console.log(`Value ${keys[i]}: ${bins[i]} rows`);
   * }
   * ```
   */
  keys(): Uint16Array | Float32Array {
    return this.controller.groupStateFor(this.dimId).keys;
  }

  /**
   * Returns the active row count after filtering.
   *
   * This is the number of rows that pass all active filters across
   * all dimensions. It's equivalent to summing all bins, but faster.
   *
   * @returns number - Count of active rows
   *
   * @example
   * ```typescript
   * const total = group.count();
   * console.log(`${total} of ${totalRows} rows match current filters`);
   *
   * // Or compute percentage
   * const percentage = (total / totalRows) * 100;
   * console.log(`${percentage.toFixed(1)}% of data visible`);
   * ```
   */
  count(): number {
    return this.controller.groupStateFor(this.dimId).count;
  }

  /**
   * Returns the coarse-grained histogram for visualization.
   *
   * Coarse histograms aggregate fine bins into fewer bins for display.
   * For example, 4096 fine bins might aggregate into 64 coarse bins
   * for a bar chart.
   *
   * Coarse binning must be configured per-dimension in options.
   *
   * @returns Object with bins() and keys() methods, or null if not configured
   *
   * @example
   * ```typescript
   * // Configure coarse bins when creating crossfilterX
   * const cf = crossfilterX(data, {
   *   bins: 4096,
   *   dimensions: {
   *     price: { coarseTargetBins: 64 }
   *   }
   * });
   *
   * const group = cf.dimension('price').group();
   * const coarse = group.coarse();
   * if (coarse) {
   *   const bins = coarse.bins(); // 64 bins instead of 4096
   *   // Use for chart rendering
   * }
   * ```
   */
  coarse(): { bins(): Uint32Array; keys(): Uint16Array | Float32Array } | null {
    const coarseState = this.controller.groupStateFor(this.dimId).coarse;
    if (!coarseState) return null;
    return {
      bins: () => coarseState.bins,
      keys: () => coarseState.keys
    };
  }

  /**
   * Configures a sum reduction on this dimension's group.
   *
   * Instead of counts per bin, each bin will contain the sum of values
   * from another dimension. This enables "sum by category" operations.
   *
   * After calling reduceSum(), use bins() to get sums instead of counts.
   * The all() method will also include sum and average values.
   *
   * @param valueAccessor - Name of dimension to sum, or function (coming soon)
   * @returns this - For method chaining
   *
   * @example
   * ```typescript
   * // Sum revenue by category
   * const categoryDim = cf.dimension('category');
   * const revenueSum = categoryDim.group().reduceSum('revenue');
   *
   * const sums = revenueSum.bins();
   * // sums[i] = total revenue for category i
   *
   * // Or use all() for structured output
   * const results = revenueSum.all();
   * // [{ key: 'Electronics', value: { count: 10, sum: 5000, avg: 500 } }, ...]
   * ```
   */
  reduceSum(valueAccessor: string | ((d: any) => number)): this {
    if (typeof valueAccessor === 'function') {
      // This would require creating a new dimension for the values, which is not supported yet.
      throw new Error('Function accessors for reduceSum are not yet implemented.');
    }
    this.controller.setReduction(this.dimId, 'sum', valueAccessor);
    return this;
  }

  /**
   * Returns all bins with their keys and aggregated values.
   *
   * This method provides a structured view of the histogram data,
   * combining keys, counts, and optional reduction values (sum/avg).
   * Only returns bins with count > 0.
   *
   * @returns Array of objects with key and value properties
   *
   * @example
   * ```typescript
   * const group = categoryDim.group();
   * const results = group.all();
   * // [
   * //   { key: 'Electronics', value: { count: 150 } },
   * //   { key: 'Books', value: { count: 80 } }
   * // ]
   *
   * // With sum reduction
   * const revenueGroup = categoryDim.group().reduceSum('revenue');
   * const withSums = revenueGroup.all();
   * // [
   * //   { key: 'Electronics', value: { count: 150, sum: 75000, avg: 500 } },
   * //   { key: 'Books', value: { count: 80, sum: 3200, avg: 40 } }
   * // ]
   * ```
   */
  all(): Array<{
    key: string | number;
    value: {
      count: number;
      sum?: number;
      avg?: number;
    };
  }> {
    const state = this.controller.groupStateFor(this.dimId);
    const keys = state.keys;
    const bins = state.bins;
    const sum = state.sum;
    const results = [];
    for (let i = 0; i < keys.length; i++) {
      const count = bins[i];
      if (count > 0) {
        const value: { count: number; sum?: number; avg?: number } = { count };
        if (sum) {
          value.sum = sum[i];
          value.avg = sum[i] / count;
        }
        results.push({
          key: keys[i],
          value
        });
      }
    }
    return results;
  }

  /**
   * Returns the top K rows by this dimension's value.
   *
   * This is useful for finding the highest/largest values in the filtered
   * dataset. Results are sorted in descending order by value.
   *
   * This operation is asynchronous and processed in the worker thread.
   *
   * @param k - Number of top results to return
   * @returns Promise<Array> - Top K values with their keys and counts
   *
   * @example
   * ```typescript
   * // Get 10 highest prices
   * const priceGroup = cf.dimension('price').group();
   * const topPrices = await priceGroup.top(10);
   * // [
   * //   { key: 1999, value: 5 },   // 5 items at $1999
   * //   { key: 1899, value: 12 },  // 12 items at $1899
   * //   ...
   * // ]
   *
   * topPrices.forEach(({ key, value }) => {
   *   console.log(`Price $${key}: ${value} items`);
   * });
   * ```
   */
  async top(k: number): Promise<Array<{ key: string | number; value: number }>> {
    return this.controller.getTopK(this.dimId, k, false);
  }

  /**
   * Returns the bottom K rows by this dimension's value.
   *
   * This is useful for finding the lowest/smallest values in the filtered
   * dataset. Results are sorted in ascending order by value.
   *
   * This operation is asynchronous and processed in the worker thread.
   *
   * @param k - Number of bottom results to return
   * @returns Promise<Array> - Bottom K values with their keys and counts
   *
   * @example
   * ```typescript
   * // Get 10 lowest prices
   * const priceGroup = cf.dimension('price').group();
   * const bottomPrices = await priceGroup.bottom(10);
   * // [
   * //   { key: 9, value: 3 },    // 3 items at $9
   * //   { key: 12, value: 8 },   // 8 items at $12
   * //   ...
   * // ]
   * ```
   */
  async bottom(k: number): Promise<Array<{ key: string | number; value: number }>> {
    return this.controller.getTopK(this.dimId, k, true);
  }

  /**
   * Configures a minimum reduction on this dimension's group.
   * @todo Not yet implemented
   */
  reduceMin(valueAccessor: string | ((d: any) => number)): this {
    // To be implemented
    return this;
  }

  /**
   * Configures a maximum reduction on this dimension's group.
   * @todo Not yet implemented
   */
  reduceMax(valueAccessor: string | ((d: any) => number)): this {
    // To be implemented
    return this;
  }
}

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
 * @param options.bins - Number of histogram bins per dimension (default: 4096, from 12 bits)
 * @param options.dimensions - Per-dimension configuration (bins, coarse bins, etc.)
 * @param options.worker - Custom worker instance (for advanced use cases)
 *
 * @returns CFHandle - Handle with methods for creating dimensions and managing data
 *
 * @example Columnar Data (Recommended)
 * ```typescript
 * import { crossfilterX } from 'crossfilterx';
 *
 * // Columnar format is fastest (no conversion needed)
 * const cf = crossfilterX({
 *   columns: {
 *     temperature: new Float32Array([72.5, 68.3, 75.1]),
 *     humidity: new Uint16Array([45, 52, 48]),
 *     city: new Uint16Array([0, 1, 0])  // Category codes
 *   },
 *   categories: {
 *     city: ['New York', 'San Francisco']  // Category labels
 *   },
 *   length: 3
 * }, {
 *   bins: 1024,  // 1024 bins per dimension
 *   dimensions: {
 *     temperature: {
 *       bins: 4096,           // Override: 4096 bins for temperature
 *       coarseTargetBins: 64  // Coarse histogram for charts
 *     }
 *   }
 * });
 *
 * // Create dimension and filter
 * const tempDim = cf.dimension('temperature');
 * await tempDim.filter([68, 73]); // Filter to 68-73°F range
 *
 * // Access filtered histogram
 * const group = tempDim.group();
 * const histogram = group.bins();
 * console.log(`${group.count()} readings match filter`);
 * ```
 *
 * @example Row-Oriented Data
 * ```typescript
 * // Row format auto-converts to columnar (slower ingestion)
 * const cf = crossfilterX([
 *   { price: 100, category: 'Electronics', inStock: true },
 *   { price: 200, category: 'Books', inStock: false },
 *   { price: 150, category: 'Electronics', inStock: true }
 * ]);
 *
 * const priceDim = cf.dimension('price');
 * priceDim.filter([100, 150]);
 * ```
 *
 * @example Multiple Filters
 * ```typescript
 * const cf = crossfilterX(data);
 *
 * // Create multiple dimensions
 * const priceDim = cf.dimension('price');
 * const categoryDim = cf.dimension('category');
 *
 * // Apply filters on multiple dimensions
 * priceDim.filter([100, 200]);
 * categoryDim.filter([0, 5]); // Categories 0-5
 *
 * // All histograms reflect the intersection of filters
 * await cf.whenIdle();
 * const count = priceDim.group().count();
 * console.log(`${count} items match all filters`);
 * ```
 *
 * @example Sum Reductions
 * ```typescript
 * const cf = crossfilterX(data);
 * const categoryDim = cf.dimension('category');
 *
 * // Sum revenue by category
 * const revenueByCategory = categoryDim.group().reduceSum('revenue');
 *
 * // Get sums per category
 * const results = revenueByCategory.all();
 * results.forEach(({ key, value }) => {
 *   console.log(`Category ${key}: $${value.sum} total, $${value.avg} avg`);
 * });
 * ```
 */
export const crossfilterX = (data: unknown, options: CFOptions = {}): CFHandle => {
  const source = prepareIngestSource(data);
  const schema = inferSchema(source, options);
  const controller = new WorkerController(schema, source, options);

  return {
    dimension(nameOrAccessor) {
      if (typeof nameOrAccessor === 'string') {
        const id = controller.dimensionId(nameOrAccessor);
        return new DimensionHandleImpl(controller, id);
      }
      if (typeof nameOrAccessor === 'function') {
        const promise = controller.createFunctionDimension(nameOrAccessor);
        return new DimensionHandleImpl(controller, promise);
      }
      throw new Error('Dimension must be defined by a column name or accessor function.');
    },
    group(name, options) {
      if (typeof name === 'string') {
        const id = controller.dimensionId(name);
        return new GroupHandleImpl(controller, id, options);
      }
      if (name instanceof DimensionHandleImpl) {
        return name.group(options);
      }
      throw new Error('Group expects a dimension name or handle.');
    },
    whenIdle() {
      return controller.whenIdle();
    },
    dispose() {
      controller.dispose();
    },
    buildIndex(name: string) {
      const id = controller.dimensionId(name);
      return controller.buildIndex(id);
    },
    indexStatus(name: string) {
      const id = controller.dimensionId(name);
      return controller.indexStatus(id);
    },
    profile() {
      return controller.profile();
    },
    /**
     * Returns the running SIMD/recompute cost estimates learned by the worker.
     * In browser environments where the engine lives in a dedicated Worker,
     * this currently returns zeros (a dedicated message channel is a future
     * enhancement). The values are populated in single-threaded test/bench runs,
     * which is where we consume them today.
     */
    clearPlannerSnapshot(): ClearPlannerSnapshot {
      return controller.plannerSnapshot();
    }
  };
};

/**
 * Infers dimension specifications from the data source and options.
 *
 * Examines the data to determine:
 * - Column names
 * - Data types (number vs string/categorical)
 * - Number of histogram bins per dimension
 * - Coarse binning configuration
 *
 * @param source - Prepared ingest source (row or columnar format)
 * @param options - User-provided configuration
 * @returns Array of dimension specifications for the engine
 */
function inferSchema(source: IngestSource, options: CFOptions): DimensionSpec[] {
  const bits = resolveBits(options.bins);
  if (source.kind === 'rows') {
    const first = source.data[0] ?? {};
    const keys = Object.keys(first);
    return keys.map((name) => {
      const value = first[name];
      const type = typeof value === 'number' ? 'number' : 'string';
      const dimOptions = options.dimensions?.[name];
      return {
        name,
        type,
        bits: dimOptions?.bins ? resolveBits(dimOptions.bins) : bits,
        coarseTargetBins: dimOptions?.coarseTargetBins
      } satisfies DimensionSpec;
    });
  }
  const keys = Object.keys(source.data.columns);
  const categories = source.data.categories ?? {};
  return keys.map((name) => {
    const dimOptions = options.dimensions?.[name];
    return {
      name,
      type: categories[name] ? 'string' : 'number',
      bits: dimOptions?.bins ? resolveBits(dimOptions.bins) : bits,
      coarseTargetBins: dimOptions?.coarseTargetBins
    } satisfies DimensionSpec;
  });
}

/**
 * Converts bin count to bit precision.
 *
 * CrossfilterX internally stores bin counts as bit precision (e.g., 12 bits = 4096 bins).
 * This function converts user-friendly bin counts to bit precision, clamped to [1, 16] bits.
 *
 * Examples:
 * - 256 bins → 8 bits
 * - 1024 bins → 10 bits
 * - 4096 bins → 12 bits (default)
 *
 * @param bins - Desired number of bins (optional)
 * @returns Bit precision (1-16), defaults to 12 bits (4096 bins)
 */
function resolveBits(bins?: number) {
  if (!bins) return 12;
  const bits = Math.ceil(Math.log2(bins));
  return Math.max(1, Math.min(16, bits));
}

type RowArray = Record<string, unknown>[];

/**
 * Prepares raw user data into a normalized ingest source.
 *
 * Detects whether data is in row-oriented or columnar format and
 * normalizes it for ingestion. Row data is kept as-is and will be
 * converted to columnar format during ingestion. Columnar data is
 * validated and normalized.
 *
 * @param data - Raw data from user (array of objects or columnar)
 * @returns Normalized ingest source ready for the engine
 * @throws Error if data format is invalid
 */
function prepareIngestSource(data: unknown): IngestSource {
  if (Array.isArray(data)) {
    return { kind: 'rows', data: data as RowArray };
  }
  if (isColumnarData(data)) {
    const columnar = normalizeColumnarData(data as ColumnarData);
    return { kind: 'columnar', data: columnar };
  }
  throw new Error('crossfilterX expects an array of records or a columnar dataset.');
}

/**
 * Type guard to check if data is in columnar format.
 *
 * Columnar data must have:
 * - A `columns` object with at least one TypedArray
 * - All column values must be TypedArrays (not plain arrays)
 *
 * @param value - Value to check
 * @returns true if value is valid columnar data
 */
function isColumnarData(value: unknown): value is ColumnarData {
  if (!value || typeof value !== 'object') return false;
  const columns = (value as ColumnarData).columns;
  if (!columns || typeof columns !== 'object') return false;
  const entries = Object.values(columns);
  if (entries.length === 0) return false;
  return entries.every((entry) => isTypedArray(entry));
}

/**
 * Type guard to check if a value is a TypedArray.
 *
 * TypedArrays include: Uint8Array, Uint16Array, Uint32Array, Int8Array,
 * Int16Array, Int32Array, Float32Array, Float64Array, etc.
 *
 * DataView is excluded as it's not iterable like TypedArrays.
 *
 * @param value - Value to check
 * @returns true if value is a TypedArray
 */
function isTypedArray(value: unknown): value is ArrayBufferView {
  return ArrayBuffer.isView(value) && !(value instanceof DataView);
}

/**
 * Normalizes and validates columnar data format.
 *
 * Ensures:
 * - At least one column exists
 * - All columns have the same length
 * - Length property matches column lengths
 * - Category labels (if provided) are non-empty string arrays
 *
 * @param input - Raw columnar data from user
 * @returns Normalized columnar data
 * @throws Error if validation fails
 */
function normalizeColumnarData(input: ColumnarData): ColumnarData {
  const entries = Object.entries(input.columns);
  if (entries.length === 0) {
    throw new Error('Columnar datasets require at least one column.');
  }
  const lengths = entries.map(([, array]) => array.length);
  const targetLength = input.length ?? lengths[0];
  for (let i = 0; i < entries.length; i++) {
    if (entries[i][1].length !== targetLength) {
      throw new Error('All columnar arrays must share the same length.');
    }
  }
  if (input.categories) {
    for (const [name, labels] of Object.entries(input.categories)) {
      if (!Array.isArray(labels) || labels.length === 0) {
        throw new Error(`Column "${name}" categories must be a non-empty string array.`);
      }
    }
  }
  return {
    columns: input.columns,
    length: targetLength,
    categories: input.categories
  };
}

export type { MsgToWorker, MsgFromWorker } from './protocol';
