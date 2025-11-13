# CrossfilterX Testing & Validation Guide

This document describes the comprehensive testing suite created to validate that CrossfilterX is a true drop-in replacement for Crossfilter with enhanced performance.

## Table of Contents

1. [Overview](#overview)
2. [Edge Case Tests](#edge-case-tests)
3. [Performance Benchmarks](#performance-benchmarks)
4. [Comparison Demo](#comparison-demo)
5. [Running the Tests](#running-the-tests)
6. [Expected Results](#expected-results)

---

## Overview

The testing suite focuses on three critical areas:

1. **Edge Cases** - Validates correct behavior during rapid, concurrent, and complex operations
2. **Performance** - Measures and benchmarks performance characteristics
3. **Compatibility** - Compares behavior against original Crossfilter for drop-in replacement validation

### Test Files

- **`tests/e2e/rapid-interaction-edge-cases.spec.ts`** - Edge case validation
- **`tests/e2e/performance-benchmarks.spec.ts`** - Performance measurements
- **`tests/e2e/comparison-demo.spec.ts`** - Comparison demo validation

### Demo Files

- **`packages/demo/comparison.html`** - Side-by-side comparison UI
- **`packages/demo/src/comparison-main.ts`** - Comparison implementation

---

## Edge Case Tests

### Purpose

Validates that CrossfilterX handles async edge cases properly, which are critical for responsive UI:

- Rapid filter changes (like dragging sliders)
- Race conditions during concurrent operations
- Data consistency during fast interactions
- Memory stability under load
- Proper filter cancellation/coalescing

### Test Cases

#### 1. Rapid Slider Drags

**Test**: `rapid slider drags maintain data consistency`

Performs 20 rapid drag operations without delays to simulate a user quickly dragging a slider back and forth.

**Validates**:
- Active count remains between 0 and total
- Total count doesn't change (data integrity)
- No crashes or errors

**Why It Matters**: Users expect responsive UIs. If dragging a slider creates 100 filter operations, the system must handle them gracefully without corruption.

#### 2. Concurrent Filter Operations

**Test**: `concurrent filter operations on multiple dimensions`

Applies filters on all 4 dimensions simultaneously using `Promise.all()`.

**Validates**:
- Coordinated filtering works correctly
- No race conditions between dimensions
- Final state is consistent

**Why It Matters**: Real applications often have multiple interactive filters. They must work together correctly.

#### 3. Rapid Filter and Reset Cycles

**Test**: `rapid filter and reset cycles`

Performs 15 rapid filter→reset cycles without waiting between operations.

**Validates**:
- Reset operations work correctly
- No state corruption from rapid state changes
- Final state returns to original

**Why It Matters**: Users might rapidly click "Clear Filter" buttons. The system must handle this.

#### 4. Mouse Drag with Direction Changes

**Test**: `mouse drag with rapid direction changes`

Simulates a jittery mouse drag with rapid back-and-forth movements.

**Validates**:
- Brush interaction remains stable
- Final filter range is valid
- No errors from rapid position updates

**Why It Matters**: Real mouse input is never perfectly smooth. The system must handle jittery input.

#### 5. Interleaved Operations Stress Test

**Test**: `interleaved filter operations stress test`

Runs 10 concurrent async operations that each apply filters, wait random times, and reset.

**Validates**:
- No race conditions
- Operations complete in correct order
- Final state is consistent

**Why It Matters**: This simulates the chaos of real user interactions with multiple async operations in flight.

#### 6. Filter During Data Loading

**Test**: `filter during data loading edge case`

Attempts to apply a filter immediately upon page load, before data is fully initialized.

**Validates**:
- System handles early interactions gracefully
- No crashes if user interacts before ready
- Recovery to valid state

**Why It Matters**: Users don't wait for loading spinners. The UI must be resilient.

#### 7. Double-Click Spam Resilience

**Test**: `double-click spam resilience`

Performs 10 rapid double-clicks to test filter clear functionality.

**Validates**:
- Multiple clear operations handled correctly
- No errors from rapid double-clicks
- Final state is correct

**Why It Matters**: Users might impatiently double-click multiple times. This shouldn't break the system.

#### 8. Brush and Reset Race Condition

**Test**: `brush and reset button race condition`

Simultaneously applies brushes and clicks reset buttons in parallel.

**Validates**:
- No race between UI interactions
- Final state is valid
- No data corruption

**Why It Matters**: User might click reset while still dragging. These operations must not conflict.

#### 9. Memory Stability During 100 Operations

**Test**: `memory stability during 100 filter operations`

Performs 100 filter operations and measures memory growth.

**Validates**:
- Memory doesn't grow excessively (< 50MB)
- No memory leaks
- Data remains consistent

**Why It Matters**: Long-running applications must not leak memory. This validates proper cleanup.

#### 10. Coordinated Filtering with Rapid Changes

**Test**: `coordinated filtering with rapid changes`

Applies filters on 3 dimensions in rapid succession, then resets all simultaneously.

**Validates**:
- Multiple dimensions filter correctly together
- Reset of all dimensions works
- Data returns to original state

**Why It Matters**: This is the core coordinated filtering behavior users expect.

### Running Edge Case Tests

```bash
# Run all edge case tests
npm run test:e2e -- rapid-interaction-edge-cases.spec.ts

# Run specific test
npm run test:e2e -- rapid-interaction-edge-cases.spec.ts -g "rapid slider drags"
```

---

## Performance Benchmarks

### Purpose

Measures actual performance characteristics for comparison and regression detection.

### Benchmark Tests

#### 1. Data Ingestion Performance

**Measures**:
- Time to ingest and index 50,000 rows
- Throughput (rows/second)
- Total page load + initialization time

**Expected**:
- < 5 seconds for 50k rows
- > 10,000 rows/second throughput

#### 2. Filter Application Performance

**Measures**:
- Single filter operation latency
- Time from mouse up to filter applied

**Expected**:
- < 500ms for single operation
- < 100ms for optimal responsiveness

#### 3. Rapid Filter Performance

**Measures**:
- Average time per operation over 100 filters
- Total time for 100 operations
- Throughput (operations/second)

**Expected**:
- < 50ms average per operation
- > 20 ops/second

#### 4. Histogram Rendering Performance

**Measures**:
- Time to filter + update all 4 histograms

**Expected**:
- < 300ms for complete update cycle

#### 5. Reset Performance

**Measures**:
- Time to reset all 4 dimensions

**Expected**:
- < 500ms for all resets

#### 6. Memory Usage Patterns

**Measures**:
- Initial memory footprint
- Memory growth after 50 operations
- Memory after operations (leak detection)

**Expected**:
- < 20MB growth for 50 operations
- Stable memory (no runaway growth)

#### 7. End-to-End Interaction Latency

**Measures**:
- Complete cycle: user action → filter applied → UI updated
- Average, min, max latencies over 10 operations

**Expected**:
- < 200ms average latency
- Consistent performance (low variance)

#### 8. Comprehensive Performance Profile

Runs all benchmarks and outputs a complete performance profile.

**Outputs**:
```
=== CrossfilterX Performance Profile ===
Ingest Time: 1234.56ms
First Filter: 45.23ms
50 Rapid Filters: 1567.89ms (31.36ms avg)
Histogram Update: 123.45ms
Reset All: 234.56ms
Memory Used: 45.67MB
=========================================
```

### Running Performance Benchmarks

```bash
# Run all performance tests
npm run test:e2e -- performance-benchmarks.spec.ts

# Run specific benchmark
npm run test:e2e -- performance-benchmarks.spec.ts -g "comprehensive performance profile"

# Run with performance profiling
npm run test:e2e -- performance-benchmarks.spec.ts --reporter=html
```

### Interpreting Results

**Good Performance Indicators**:
- ✅ Ingest time < 2000ms for 50k rows
- ✅ Average filter time < 30ms
- ✅ Memory growth < 10MB for 50 operations
- ✅ Latency < 100ms average

**Warning Indicators**:
- ⚠️ Ingest time > 3000ms
- ⚠️ Average filter time > 50ms
- ⚠️ Memory growth > 20MB
- ⚠️ Latency > 200ms

**Problem Indicators**:
- ❌ Ingest time > 5000ms
- ❌ Average filter time > 100ms
- ❌ Memory growth > 50MB
- ❌ Latency > 500ms

---

## Comparison Demo

### Purpose

Provides a side-by-side comparison between CrossfilterX and the original Crossfilter library to validate:

1. **Drop-in Replacement** - Same API, same behavior
2. **Performance Improvements** - Faster operations
3. **Data Consistency** - Same filtered results

### Features

#### Visual Comparison

- Two columns showing both implementations
- Same dataset (50,000 generated flights)
- Same dimensions (hour, delay)
- Same visualizations

#### Performance Metrics

Displays key metrics for comparison:
- **Ingest Time** - How long to load and index data
- **Filter Time** - Average filter operation time
- **Total/Active Rows** - Data counts for validation

Winners are highlighted automatically.

#### Interactive Tests

Three built-in tests:

1. **Rapid Filter Test**
   - Performs 50 rapid filter operations
   - Compares average filter time
   - Validates data consistency

2. **Concurrent Operations Test**
   - Applies multiple filters simultaneously
   - Tests coordinated filtering
   - Validates same results from both

3. **Memory Test**
   - Runs 100 operations
   - Measures memory growth
   - Detects leaks

### Running the Comparison Demo

#### In Browser

1. Start the dev server:
   ```bash
   npm run dev
   ```

2. Navigate to:
   ```
   http://localhost:5173/comparison.html
   ```

3. Click test buttons to run comparisons

#### With Tests

```bash
npm run test:e2e -- comparison-demo.spec.ts
```

### Adding Original Crossfilter

To enable full comparison, add the original Crossfilter library:

1. Add to `packages/demo/index.html`:
   ```html
   <script src="https://cdn.jsdelivr.net/npm/crossfilter2@1.5.4/crossfilter.min.js"></script>
   ```

2. The comparison demo will automatically detect and use it

Without the original library, the demo still works but only shows CrossfilterX metrics.

---

## Running the Tests

### All Tests

```bash
# Run all e2e tests
npm run test:e2e

# Run all tests (unit + e2e)
npm run test:all
```

### Specific Test Suites

```bash
# Edge cases only
npm run test:e2e -- rapid-interaction-edge-cases.spec.ts

# Performance only
npm run test:e2e -- performance-benchmarks.spec.ts

# Comparison demo only
npm run test:e2e -- comparison-demo.spec.ts
```

### With Different Browsers

```bash
# Chromium only
npm run test:e2e -- --project=chromium

# All browsers (Chromium, Firefox, WebKit)
npm run test:e2e
```

### With Debugging

```bash
# Debug mode (shows browser)
npm run test:e2e -- --headed

# Debug specific test
npm run test:e2e -- --headed -g "rapid slider drags"

# Pause on failure
npm run test:e2e -- --debug
```

---

## Expected Results

### Edge Case Tests

All 11 tests should **PASS**.

If any fail, it indicates:
- Race conditions
- Memory leaks
- Data corruption
- Poor async handling

### Performance Benchmarks

All 8 tests should **PASS** with acceptable performance.

Typical results (50k rows, modern hardware):
- Ingest: 500-2000ms
- Single filter: 20-100ms
- 100 rapid filters: 2000-5000ms (20-50ms avg)
- Memory growth: 5-15MB

### Comparison Tests

Should **PASS** with:
- Successful initialization
- All test buttons functional
- Metrics displayed correctly
- Data consistency maintained

If original Crossfilter is loaded:
- Should show side-by-side metrics
- Data counts should match (±1% tolerance for binning differences)
- CrossfilterX should be faster or comparable

---

## Continuous Integration

These tests are designed to run in CI/CD pipelines:

```yaml
# Example GitHub Actions
- name: Run E2E Tests
  run: npm run test:e2e

- name: Run Performance Benchmarks
  run: npm run test:e2e -- performance-benchmarks.spec.ts --reporter=json
```

Performance metrics can be tracked over time to detect regressions.

---

## Troubleshooting

### Tests Timeout

If tests timeout:
1. Increase timeout in test: `{ timeout: 60000 }`
2. Check if WASM is building correctly
3. Verify dev server is running

### Memory Tests Fail

Memory API (`performance.memory`) is only available in Chrome/Chromium. These tests will skip in other browsers.

### Comparison Demo Shows N/A

This is expected if original Crossfilter isn't loaded. To enable comparison:
1. Add Crossfilter script to HTML
2. Reload page
3. Both implementations will be compared

### Flaky Tests

Edge case tests intentionally stress the system. If tests are flaky:
1. Check system resources (CPU/memory)
2. Increase wait times slightly
3. Run tests individually to isolate issues

---

## Contributing

When adding new features to CrossfilterX:

1. Add edge case tests for new async behavior
2. Add performance benchmarks for new operations
3. Update comparison demo if API changes
4. Ensure all tests pass before submitting PR

---

## Summary

This testing suite provides comprehensive validation that CrossfilterX:

✅ Handles edge cases correctly (no race conditions, no corruption)
✅ Performs well (fast filters, low latency, stable memory)
✅ Is a true drop-in replacement (same API, same results, better performance)

Run these tests regularly to ensure quality and catch regressions early.
