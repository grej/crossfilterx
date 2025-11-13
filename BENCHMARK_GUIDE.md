# CrossfilterX vs Crossfilter2 Benchmark Guide

## Quick Start (Standalone Benchmark)

Due to environmental issues with Playwright in the current setup, I've created a **standalone benchmark page** that you can run directly in your browser.

### Running the Standalone Benchmark

1. **Start the dev server** (if not already running):
   ```bash
   npm run dev
   ```

2. **Open the standalone benchmark page** in your browser:
   ```
   http://localhost:5173/standalone-benchmark.html
   ```

3. **Click "Run Benchmark"** and wait for results

4. **View results** displayed in a table showing:
   - Ingest Time
   - First Filter Time
   - Average Filter Time (20 operations)
   - Group All Time
   - Throughput (rows/second)
   - Winner for each metric
   - Speedup multiplier

5. **Click "Show JSON Results"** to see the raw data you can save for analysis

### What Gets Tested

The standalone benchmark tests:
- **Dataset Size**: 50,000 rows
- **Dimensions**: 4 dimensions
- **Operations**: 20 filter operations averaged for statistical reliability
- **Data Generation**: Uses record copying strategy (as you suggested) to maintain realistic patterns while scaling

### Benchmark Results Format

```json
{
  "config": {
    "size": 50000,
    "dimensions": 4
  },
  "crossfilterX": {
    "ingestTime": "1234.56",
    "firstFilterTime": "45.23",
    "avgFilterTime": "31.45",
    "groupAllTime": "12.34",
    "dimensionSize": 50000,
    "throughput": "40500"
  },
  "crossfilter2": {
    "ingestTime": "2345.67",
    "firstFilterTime": "123.45",
    "avgFilterTime": "89.12",
    "groupAllTime": "23.45",
    "dimensionSize": 50000,
    "throughput": "21300"
  },
  "speedup": "2.84",
  "timestamp": "2025-11-13T..."
}
```

## Comprehensive Testing (Advanced)

If you want to test multiple dataset sizes and dimensionalities, you have two options:

### Option 1: Interactive Deep Comparison Demo

1. **Open the deep comparison page**:
   ```
   http://localhost:5173/deep-comparison.html
   ```

2. **Select configuration**:
   - Choose dataset size: 1K, 10K, 50K, 100K, 250K, or 500K rows
   - Choose dimensions: 2, 4, 8, or 16 dimensions

3. **Run benchmarks**:
   - Click "Run Benchmark" for a single test
   - Click "Run All Sizes" to test all 6 dataset sizes
   - Click "Run All Dimensions" to test all 4 dimensionality levels

4. **Export results** as JSON for offline analysis

### Option 2: Automated Tests (When Environment Fixed)

Once the Playwright environment issues are resolved, you can run automated tests:

```bash
# Single configuration
npm run test:e2e -- deep-comparison-benchmarks.spec.ts -g "50,000 rows and 4 dimensions"

# All sizes
npm run test:e2e -- deep-comparison-benchmarks.spec.ts -g "all sizes"

# All dimensions
npm run test:e2e -- deep-comparison-benchmarks.spec.ts -g "all dimensions"
```

## Files Created

### Benchmark Pages
- **`packages/demo/standalone-benchmark.html`** - Simplified single-run benchmark (RECOMMENDED)
- **`packages/demo/deep-comparison.html`** - Full configurable benchmark suite
- **`packages/demo/src/deep-comparison-main.ts`** - Benchmark implementation
- **`packages/demo/comparison.html`** - Basic side-by-side comparison

### Test Suites
- **`tests/e2e/standalone-benchmark.spec.ts`** - Test for standalone page
- **`tests/e2e/deep-comparison-benchmarks.spec.ts`** - 10 automated benchmark tests
- **`tests/e2e/rapid-interaction-edge-cases.spec.ts`** - 11 async edge case tests
- **`tests/e2e/performance-benchmarks.spec.ts`** - 8 performance validation tests
- **`tests/e2e/comparison-demo.spec.ts`** - Comparison demo validation tests

### Documentation
- **`DEEP_COMPARISON_ANALYSIS.md`** - Comprehensive analysis framework
- **`TESTING_AND_VALIDATION.md`** - Complete testing guide
- **`BENCHMARK_GUIDE.md`** - This file

## Known Playwright Issues

The current environment has issues with Playwright tests:

1. **Page Crashes**: All Playwright tests crash immediately on page load
2. **Possible Causes**:
   - SharedArrayBuffer restrictions in containerized environment
   - WASM module loading issues with Playwright's Chromium
   - Resource constraints in Docker
   - Cross-origin isolation policy conflicts

3. **Workaround**: Use the standalone benchmark page directly in a real browser

## Framework Validation

To validate the performance assumptions mentioned in your request:

### Hypothesis 1: Filter Time Should NOT Scale with Dataset Size
**Test**: Run benchmarks with 1K, 10K, 50K, 100K, 250K, and 500K rows
**Expected**: Filter time remains relatively constant (~30-100ms) regardless of size
**Reason**: Both implementations use binning (O(bins) not O(rows))

**How to Test**:
```
Open: http://localhost:5173/deep-comparison.html
Click: "Run All Sizes"
Compare: "CFX Filter" column should be relatively stable
```

### Hypothesis 2: Ingest Time Should Scale Linearly
**Test**: Same as above
**Expected**: Ingest time increases proportionally with dataset size
**Reason**: Both must process all rows (O(n))

### Hypothesis 3: CrossfilterX Should Be Faster at Scale
**Test**: Compare filter times at 50K+ rows
**Expected**: CrossfilterX avg filter time < Crossfilter2
**Reason**: WebWorker + SIMD optimizations

### Hypothesis 4: Async Edge Cases Work Correctly
**Test**: Run rapid-interaction-edge-cases tests (when Playwright works)
**Expected**: No race conditions, data consistency maintained
**Tests**: 11 edge cases including concurrent ops, rapid changes, memory stability

## Interpreting Results

### Good Signs ✅
- CrossfilterX filter time < Crossfilter2 at 50K+ rows
- Filter time < 100ms for good UX
- Ingest time within 2x of Crossfilter2
- Memory growth < 50MB for 100 operations

### Warning Signs ⚠️
- Filter time scales significantly with dataset size
- CrossfilterX slower than Crossfilter2 at all sizes
- Memory usage 2x+ higher
- Ingest time > 3x slower

### Critical Issues ❌
- Filter time > 500ms at any size
- Crashes or errors at large sizes
- Incorrect results (data consistency issues)

## Next Steps

1. **Run the standalone benchmark** to get initial data
2. **Document the results** you observe
3. **Test with different sizes** using the deep comparison page
4. **Analyze the data** against the hypotheses above
5. **If performance is lacking**, consult `IMPROVEMENTS_2025-11-13.md` for optimization roadmap

## Questions or Issues?

- Check browser console for errors when running benchmarks
- Ensure dev server is running (`npm run dev`)
- Try different browsers (Chrome, Firefox, Safari)
- Check that crossfilter2 CDN loads (look for 404 errors in Network tab)

---

**Created**: 2025-11-13
**Purpose**: Validate CrossfilterX as drop-in replacement with performance comparison to original Crossfilter2
**Status**: Framework ready, awaiting manual benchmark execution
