# Deep Comparison Analysis: CrossfilterX vs Crossfilter2

This document provides comprehensive performance analysis comparing CrossfilterX against the original Crossfilter2 library across varying dataset sizes and dimensionalities.

## Methodology

### Testing Approach

1. **Direct Comparison**: Both implementations process identical datasets with identical operations
2. **Controlled Variables**: Same number of dimensions, same data distributions, same filter operations
3. **Statistical Significance**: Filter times averaged over 20 operations
4. **Real-World Workloads**: Simulates actual usage patterns (ingest, filter, group operations)

### Dataset Generation

Following the user's guidance that "crossfilter perf characteristics shouldn't be too impacted by cardinality since it aggregates into bins for rendering":

- **Base Dataset**: 10,000 unique records with realistic distributions
- **Scaling**: Records copied to reach target size (maintaining patterns)
- **Distributions**:
  - Dimension 0, 4, 8...: Uniform (0-24) - hour-like
  - Dimension 1, 5, 9...: Normal (μ=5, σ=25, range=-60 to 150) - delay-like
  - Dimension 2, 6, 10...: Skewed normal (μ=700, σ=400, range=50-2000) - distance-like
  - Dimension 3, 7, 11...: Sequential with noise (0-90) - date-like

This approach allows testing at scale while maintaining reasonable runtime.

### Metrics Measured

1. **Ingest Time**: Time to load data and create dimensions/groups
2. **First Filter Time**: Cold start filter operation
3. **Average Filter Time**: Mean of 20 filter operations
4. **Group All Time**: Time to aggregate all data
5. **Memory Usage**: Heap size increase (Chrome only)
6. **Throughput**: Rows processed per second during ingest

### Test Configurations

#### Dataset Sizes

- **1,000 rows**: Baseline/quick test
- **10,000 rows**: Small dataset
- **50,000 rows**: Medium dataset (default)
- **100,000 rows**: Large dataset
- **250,000 rows**: Very large dataset
- **500,000 rows**: Stress test

#### Dimensionality

- **2 dimensions**: Simple
- **4 dimensions**: Typical (like airplane demo)
- **8 dimensions**: Complex
- **16 dimensions**: High-dimensional

## Expected Performance Characteristics

### CrossfilterX Design Goals

1. **WebWorker Architecture**: Non-blocking UI
2. **SIMD Acceleration**: Faster bin operations
3. **SharedArrayBuffer**: Zero-copy data sharing
4. **Async API**: Proper async handling

### Theoretical Advantages

**CrossfilterX should be faster when**:
- Large datasets (worker overhead amortized)
- Rapid filter changes (async doesn't block)
- SIMD-friendly operations (bin accumulation)

**Crossfilter2 might be faster when**:
- Very small datasets (< 5K rows) - no worker overhead
- Simple synchronous operations
- Single filter operation (no async benefit)

### Key Performance Hypotheses

1. **Filter Time Should NOT Scale with Dataset Size**
   - Both implementations use binning
   - Filter operation is O(bins) not O(rows)
   - Expected: ~constant filter time regardless of data size

2. **Ingest Time Should Scale Linearly**
   - Both must process all rows
   - Expected: O(n) scaling
   - CrossfilterX may have worker startup overhead

3. **Filter Time May Scale with Dimensions**
   - More dimensions = more groups to update
   - But should still be reasonable (< 1s even for 16 dims)

4. **Memory Usage Should Be Comparable**
   - Both use similar data structures
   - CrossfilterX uses SharedArrayBuffer (efficient)

## Running the Benchmarks

### Interactive Demo

```bash
npm run dev
# Navigate to http://localhost:5173/deep-comparison.html
```

**Single Benchmark**:
1. Select dataset size
2. Select number of dimensions
3. Click "Run Benchmark"
4. View results side-by-side

**Comprehensive Testing**:
- Click "Run All Sizes" to test 6 dataset sizes
- Click "Run All Dimensions" to test 4 dimensionality levels
- Click "Export Results" to download JSON data

### Automated Tests

```bash
# Run all deep comparison tests
npm run test:e2e -- deep-comparison-benchmarks.spec.ts

# Run specific configuration
npm run test:e2e -- deep-comparison-benchmarks.spec.ts -g "50,000 rows"

# Run comprehensive suite
npm run test:e2e -- deep-comparison-benchmarks.spec.ts -g "comprehensive"
```

### Results Export

Results are exported as JSON with the following structure:

```json
{
  "config": { "size": 50000, "dimensions": 4 },
  "crossfilterX": {
    "ingestTime": 1234.56,
    "firstFilterTime": 45.23,
    "avgFilterTime": 31.45,
    "groupAllTime": 12.34,
    "dimensionSize": 50000,
    "memoryUsed": 12345678,
    "throughput": 40500.5
  },
  "crossfilter2": {
    "ingestTime": 2345.67,
    "firstFilterTime": 123.45,
    "avgFilterTime": 89.12,
    "groupAllTime": 23.45,
    "dimensionSize": 50000,
    "memoryUsed": 23456789,
    "throughput": 21300.3
  },
  "timestamp": "2025-11-13T..."
}
```

## Preliminary Results

> **Note**: Results will vary by hardware. The following are representative measurements.

### Dataset Size Scaling (4 dimensions)

| Size | CFX Ingest | CF2 Ingest | CFX Filter | CF2 Filter | Speedup |
|------|------------|------------|------------|------------|---------|
| 1K | TBD | TBD | TBD | TBD | TBD |
| 10K | TBD | TBD | TBD | TBD | TBD |
| 50K | TBD | TBD | TBD | TBD | TBD |
| 100K | TBD | TBD | TBD | TBD | TBD |
| 250K | TBD | TBD | TBD | TBD | TBD |
| 500K | TBD | TBD | TBD | TBD | TBD |

**Key Observations**:
- [ ] Filter time remains relatively constant (confirms bin hypothesis)
- [ ] Ingest time scales linearly
- [ ] CrossfilterX faster at larger sizes
- [ ] Crossfilter2 faster at smaller sizes

### Dimensionality Scaling (50K rows)

| Dims | CFX Ingest | CF2 Ingest | CFX Filter | CF2 Filter | Speedup |
|------|------------|------------|------------|------------|---------|
| 2 | TBD | TBD | TBD | TBD | TBD |
| 4 | TBD | TBD | TBD | TBD | TBD |
| 8 | TBD | TBD | TBD | TBD | TBD |
| 16 | TBD | TBD | TBD | TBD | TBD |

**Key Observations**:
- [ ] Ingest time scales with dimensions
- [ ] Filter time increases but remains manageable
- [ ] Both implementations handle high dimensionality

## Analysis Guidelines

### What to Look For

**✅ Success Indicators**:
1. CrossfilterX filter time < Crossfilter2 at 50K+ rows
2. Filter time stays < 100ms for good UX
3. Ingest time competitive (within 2x of Crossfilter2)
4. Memory usage reasonable (within 50% of Crossfilter2)

**⚠️ Warning Signs**:
1. Filter time scales significantly with dataset size
2. CrossfilterX slower than Crossfilter2 at all sizes
3. Memory usage 2x+ higher
4. Ingest time > 3x slower

**❌ Critical Issues**:
1. Filter time > 500ms at any size
2. Memory leaks evident
3. Crashes or errors at large sizes
4. Incorrect results (data consistency issues)

### Interpreting Results

**If CrossfilterX is faster**:
- Validates WebWorker + SIMD approach
- Confirms drop-in replacement with performance gains
- Proceed with confidence

**If Crossfilter2 is faster**:
- Check dataset size (small datasets may favor sync approach)
- Review SIMD utilization
- Consider implementation of Phase 1 optimizations from IMPROVEMENTS_2025-11-13.md
- May need transferable objects, request coalescing

**If results are mixed**:
- Analyze size threshold where CFX becomes faster
- Identify dimension threshold for crossover
- Document trade-offs

## Next Steps

### After Initial Benchmarking

1. **Document Findings**: Fill in results tables above
2. **Identify Bottlenecks**: Use profiling if needed
3. **Implement Optimizations**: From performance roadmap
4. **Re-benchmark**: Validate improvements

### Future Testing

1. **High Cardinality**: Test with unique values per row
2. **Real Datasets**: Use actual airplane data
3. **Browser Comparison**: Test in Firefox, Safari
4. **Older Hardware**: Test on lower-end machines

## Validation Checklist

- [ ] CrossfilterX loads and initializes
- [ ] Crossfilter2 loaded successfully
- [ ] Benchmarks run without errors
- [ ] Results display correctly
- [ ] Metrics are reasonable (no NaN, no negative times)
- [ ] Data consistency: both implementations return same counts
- [ ] Filter time doesn't scale dramatically with size
- [ ] Memory usage is stable
- [ ] Export function works
- [ ] All test configurations pass

## Troubleshooting

### Common Issues

**"crossfilter is not defined"**:
- Ensure crossfilter2 CDN script is loaded
- Check browser console for load errors
- Try refreshing page

**Tests timeout**:
- Increase timeout for large datasets
- Run smaller tests first
- Check system resources

**Inconsistent results**:
- Run multiple times for statistical validity
- Check for background processes
- Ensure stable system state

**Memory API not available**:
- Memory tracking only works in Chrome/Chromium
- Tests will skip memory assertions in other browsers
- This is expected behavior

## Summary

This deep comparison framework provides:

✅ **Direct head-to-head comparison** with original Crossfilter2
✅ **Comprehensive dataset coverage** (1K to 500K rows)
✅ **Dimensionality testing** (2 to 16 dimensions)
✅ **Real performance metrics** from actual implementations
✅ **Automated test suite** for regression detection
✅ **Export capability** for offline analysis
✅ **Statistical validity** through averaged measurements

Use this framework to validate that CrossfilterX is a true drop-in replacement with competitive or superior performance characteristics.

---

**Last Updated**: 2025-11-13
**Framework Version**: 1.0.0
**Status**: Ready for benchmarking
