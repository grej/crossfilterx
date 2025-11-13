# Benchmark Guide

## Performance Benchmark Suite

The performance benchmark suite measures CrossfilterX operations at different scales to validate optimizations and track performance over time.

### Running Benchmarks

```bash
# Build and run full performance suite
npm run bench:perf

# The --expose-gc flag enables memory measurements
```

### What Gets Tested

The suite tests **6 core operations** at **3 dataset sizes** (100K, 500K, 1M rows):

1. **Ingest (columnar)** - Loading data into CrossfilterX
2. **Filter (delta)** - Applying a filter with index support
3. **Clear (delta)** - Clearing a filter via delta updates
4. **Clear (recompute)** - Clearing a filter via full recompute
5. **Index build** - Building a CSR index for a dimension
6. **Multi-filter** - Applying 5 filters across dimensions

Each test runs **5 iterations** and reports:
- Average time ± standard deviation
- Min/max times
- Memory usage (when available)

### Output Format

```
========================================
BENCHMARK RESULTS
========================================

ingest_columnar_100000:
  avg: 145.23ms ± 8.45ms
  min: 138.12ms
  max: 157.89ms
  memory: 12.34 MB

filter_delta_100000:
  avg: 8.45ms ± 0.67ms
  min: 7.89ms
  max: 9.23ms

...
```

### Result Files

Results are saved to `benchmark-results-{timestamp}.json` in the project root. This allows:
- Comparison across optimizations
- Performance regression tracking
- CI/CD integration

### Interpreting Results

#### Target Performance (1M rows)

| Operation | Target | Good | Needs Work |
|-----------|--------|------|------------|
| Ingest (columnar) | < 1000ms | < 1500ms | > 2000ms |
| Filter (delta) | < 50ms | < 100ms | > 200ms |
| Clear (delta) | < 50ms | < 100ms | > 200ms |
| Clear (recompute) | < 200ms | < 300ms | > 500ms |
| Index build | < 100ms | < 150ms | > 250ms |
| Multi-filter | < 200ms | < 300ms | > 500ms |

#### Memory Usage (1M rows, 10 dimensions)

- **Target:** < 30 MB
- **Good:** < 40 MB
- **Needs work:** > 50 MB

### Benchmarking Best Practices

1. **Close other applications** - Reduce system noise
2. **Run multiple times** - The suite already does 5 iterations
3. **Check for outliers** - Look at std deviation
4. **Compare before/after** - Save baseline results before optimizations
5. **Use same hardware** - For valid comparisons

### Example Workflow

```bash
# 1. Baseline before optimization
git checkout main
npm run bench:perf > baseline-results.txt

# 2. Apply optimization
git checkout feature/optimization
npm run bench:perf > optimized-results.txt

# 3. Compare
diff baseline-results.txt optimized-results.txt
```

### Adding New Benchmarks

To add a new benchmark to the suite:

1. Edit `packages/bench/src/suite-performance.ts`
2. Add your benchmark function following the pattern:
   ```typescript
   async function benchMyOperation(size: number, iteration: number) {
     // Setup
     const data = generateColumnarData(size, DIMENSIONS);
     const cf = crossfilterX(data);

     // Measure
     const start = performance.now();
     // ... your operation ...
     const elapsed = performance.now() - start;

     // Record
     results.push({
       operation: 'my_operation',
       size,
       iteration,
       timeMs: elapsed
     });

     // Cleanup
     cf.dispose();
   }
   ```
3. Add to `runBenchmarks()` function
4. Rebuild and run

### Continuous Performance Tracking

For CI/CD integration, you can:

1. **Fail on regression:**
   ```javascript
   if (avgTime > BASELINE * 1.1) {
     console.error('Performance regression detected!');
     process.exit(1);
   }
   ```

2. **Track over time:**
   - Save results to database
   - Plot trends
   - Alert on degradation

### Micro-Benchmarks

For more targeted testing, use the existing micro-benchmarks:

```bash
# Histogram operation micro-benchmarks
npm run bench:micro

# General benchmarks
npm run bench
```

### Memory Profiling

For deeper memory analysis:

1. **Chrome DevTools:**
   - Load demo with large dataset
   - Take heap snapshot
   - Analyze allocations

2. **Node.js:**
   ```bash
   node --expose-gc --inspect scripts/run-performance-bench.mjs
   # Connect Chrome DevTools to inspect process
   ```

3. **Clinic.js:**
   ```bash
   npm install -g clinic
   clinic doctor -- node scripts/run-performance-bench.mjs
   ```

### Performance Tips

Based on benchmark results, you may want to:

- **Slow ingest?** → Use columnar format instead of row objects
- **Slow filter?** → Ensure indexes are built
- **Slow clear?** → Check if recompute path is being used unnecessarily
- **High memory?** → Reduce bin count or use coarse histograms
- **Variable times?** → Indicates GC pressure or system contention

### Next Steps

After running benchmarks:

1. **Document baseline** - Save current performance characteristics
2. **Identify bottlenecks** - Look at slowest operations
3. **Optimize** - Focus on biggest impact
4. **Re-benchmark** - Validate improvements
5. **Repeat** - Continuous improvement

See `PERFORMANCE_OPTIMIZATION.md` for specific optimization recommendations based on benchmark results.
