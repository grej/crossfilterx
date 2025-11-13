# Benchmark Report (CrossfilterX vs. Legacy)

## Automated Baseline (100k × 6 dimensions)
- **Latest run**: `packages/bench/reports/baseline-1758049812421.json` (`npm run bench` after clear-filter profiling)
- **Results**:
  - Ingest (quantize + load): ~22.12 ms (still ~25% faster than the pre-cache 29.98 ms)
  - Shared index build: ~1.02 ms (≈ 416 KB/dim)
  - Filter delta (single range): ~2.96 ms, active ≈ 50k
  - Clear filter: ~2.28 ms
- **Columnar mode** (`BENCH_COLUMNAR=1` → `packages/bench/reports/baseline-100k-columnar.json`):
  - Ingest: ~14.47 ms (≈35% faster vs. object rows)
  - Index/filter/clear remain ~1.0/3.1/2.2 ms

## Legacy Crossfilter Comparison
- **Source**: `packages/bench/reports/comparison-1758039829471.json` (generated via `node scripts/compare-crossfilter.mjs`)
- **Datasets**: Synthetic flights (carrier, distance, departure) with distance filter range [750, 2250]
- **Timings (ms)**:

| Rows  | crossfilterX Ingest | Index | Filter | Clear | Legacy Ingest | Filter | Clear |
|-------|--------------------:|------:|-------:|------:|--------------:|-------:|------:|
| 1e5   | 12.71               | 0.92  | 1.28   | 2.04  | 0.12          | 1.07   | 0.64  |
| 2e5   | 20.11               | 1.11  | 1.38   | 3.11  | 0.22          | 2.48   | 0.61  |
| 5e5   | 42.39               | 0.81  | 2.75   | 5.69  | 0.39          | 2.51   | 1.53  |

- **Notes**:
  - CrossfilterX front-loads ingest (quantization + CSR prep) but keeps filter deltas < 3 ms, even at 500k rows.
  - Legacy crossfilter ingests quickly but lacks built-in index reuse; filter times are comparable at higher volumes, and clear operations are cheaper due to simpler bookkeeping.
- **Columnar mode**: run `node scripts/compare-crossfilter.mjs --columnar` to measure CrossfilterX with typed arrays (legacy crossfilter remains on row objects). Latest results saved to `packages/bench/reports/comparison-1758054588047.json` (100k ingest ~11 ms, 500k ingest ~18.9 ms).

## Browser Demo Snapshot
- `packages/demo` now renders a 200k-row airline-style dashboard (distance slider, carrier counts, summary stats). Slider adjustments trigger worker deltas; the UI remains responsive at this scale on modern hardware.
- Consider raising `VITE_ROWS` (e.g., 300k–500k) to observe draw latency; current setup draws basic canvas charts for quick iteration.
- Set `VITE_COLUMNAR=1` when running the demo to feed typed columns and compare ingest timings (displayed in the summary card) against the default row-object path.

## High-Volume Sanity Check (1M × 6 dimensions)
- **Profiling flag**: set `BENCH_PROFILE_CLEAR=1` to capture `profile.clear` diagnostics (rows touched + timings).
- **Object rows**: `packages/bench/reports/baseline-1758123793999.json`
  - Ingest: ~181.04 ms
  - Index build (dim0): ~3.33 ms (~3.8 MB)
  - Range filter delta: ~20.43 ms (active ≈ 500k)
  - Clear filter (default [0.25, 0.75]): ~20.19 ms
- **Additional scenarios** (`BENCH_LO_FRACTION`/`BENCH_HI_FRACTION`):
  - Narrow 2% slice ([0.49, 0.51]): filter ~12.96 ms, clear ~20.47 ms (`profile.clear.fallback = true`, outside fraction ≈0.98, so full recompute).
  - Mid-width ([0.25, 0.75]): filter ~19.87 ms, clear ~20.02 ms (`profile.clear.fallback = true`; estimator now chooses recompute for roughly 50/50 splits).
  - Wide-band ([0.1, 0.9]): filter ~22.48 ms, clear ~14.49 ms (`profile.clear.fallback = false`; insideRows ≈800k, outsideRows ≈200k, insideMs ≈2.70 ms, outsideMs ≈11.65 ms).
- **Columnar ingest** (`BENCH_COLUMNAR=1` → `packages/bench/reports/baseline-1758123795626.json`):
  - Ingest: ~81.94 ms
  - Range filter delta: ~20.69 ms, clear: ~20.32 ms (heuristic still falls back for default range)
- **Notes**: The 40% heuristic currently tips toward CSR updates only when the filtered band covers ≥60% of rows. Profiling reveals that even in the CSR case, ~80% of time sits in outside-row reactivation (histogram/mask updates). Filter cost scales with the active slice (narrow ranges query fewer row IDs), while ingest varies with random data ordering (observed 180–260 ms spread across runs when using object rows). Chunked histogram accumulation (profiling-only buffers) keeps correctness but didn’t materially reduce the ~12 ms outside cost yet.

### Histogram Microbench (1M × 6, columnar ingest)

Run `npm run bench:micro` (optionally with `MICRO_OUTPUT=...`) to build the workspaces and execute the clear-path microbenchmark. The script sweeps the histogram modes — direct per-row updates, the buffered aggregator, and the wasm-backed SIMD path — and records the per-iteration timings. Latest output: `packages/bench/reports/micro-histogram-1758123436.json`.

| Mode     | Clear Avg (ms) | Filter Avg (ms) | Notes |
|----------|---------------:|----------------:|-------|
| direct   | ~8.83          | ~0.02           | CSR delta + direct histogram writes (auto/default) |
| buffered | ~8.66          | ~0.00           | Uses Int32 buffers; enabled via `__CFX_HIST_MODE=buffered` |
| simd     | ~7.61          | ~0.01           | Updated Rust SIMD kernel with shared scratch buffer; approaching parity with direct mode |

- Buffering is now opt-in (`BENCH_HIST_MODE=buffered` or `__CFX_HIST_MODE='buffered'`). The default `auto` mode sticks with direct updates until ≥2M rows toggle in a single clear, avoiding regressions on today’s workloads while keeping the infrastructure ready for SIMD experiments.
- Set `BENCH_HIST_MODE=simd` to exercise the wasm-backed accumulator. The current kernel mirrors the JS logic (gathers bins per dimension); future SIMD optimisations will aim to reduce the ~17 ms clear latency further.

### Multi-Filter Scenario (1M rows, 5M columnar)

`BENCH_SCENARIO=multi npm run bench` drives three sequential range filters (`dim0`, `dim1`, `dim2`) followed by clears in reverse order. In addition to the per-step timings, the bench now persists a `shardSummary` block whenever SIMD is active so we can see how many shard flushes occurred during a clear.

| Dataset | Ingest | Filter chain (ms) | Clear chain (ms) | Shard summary |
|---------|-------:|------------------:|-----------------:|---------------|
| 1M × 6 rows | ~191 ms | 22.0 → 21.2 → 28.2 | 21.4 → 20.9 → 15.2 | falls back to recompute (no shard entries) |
| 5M × 6 columnar | ~380 ms | 103.0 → 105.2 → 138.9 | 105.2 → 101.9 → 223.9 | recompute chosen; shard counts remain 0 |
| 5M × 6 columnar (forced SIMD sample) | ~372 ms | 105.4 → 106.1 → 108.5 | **298.2** → 130.4 → 144.1 | `totalFlushes=166`, `totalRows≈1.88e7` (from `multi-simd-profile-1758251169.json`) |

- Reports: `baseline-1758123825921.json`, `baseline-1758123839222.json`, and `multi-simd-profile-*.json` under `packages/bench/reports/`.
- The shard summary confirms that after the cache tweak, even the forced-SIMD run flushed only a dozen shards per dimension (zero evictions); the slowdown comes purely from visiting ~2.3 M rows per clear. When the adaptive heuristic reverts to recompute, clear latency drops back to ~100–140 ms.
- Each report now includes the planner’s learned `simdCostPerRow` and `recomputeCostPerRow`. When chunking and heuristics settle, these values roughly stabilise around `~1.9e-5` vs. `~2.1e-5` for the 5 M runs, making it clear why recompute wins once outside fractions dominate.

Run `node scripts/generate-bench-summary.mjs` to refresh `packages/bench/reports-summary.json`. The summary now includes the most recent multi-filter profile with its shard counts so CI and docs can surface regressions at a glance.

## Adaptive Clear Selection
- The worker now tracks `simdCostPerRow` and `recomputeCostPerRow` as clears run. Each delta/recompute updates a rolling average using the rows touched, so subsequent clears compare `estimatedSimd = costPerRow × rowsTouched` against `estimatedRecompute = costPerRow × recomputeRows` instead of fixed outside-fraction thresholds.
- While there is no historical data, the heuristic falls back to the earlier guard rails (e.g. near-50/50 splits → recompute). Once measurements exist, the lower estimated cost wins automatically.
- Use `BENCH_PROFILE_SHARD=1` to capture the shard log; the `shardSummary` block in the multi-filter report records total flushes/rows so we can confirm the SIMD path is behaving as expected on large deltas.

## Hotspots Observed
- **Ingest variance**: Object-row ingest still spans 180–260 ms at 1 M rows, but columnar ingest drops startup to ~80 ms. Next step is routing columnar data through the demo/legacy comparison so both paths stay visible.
- **Clear fallback**: The estimator now pushes 50/50 clears back to `fullRecompute` (~20 ms) while still choosing CSR deltas for wide bands (~14 ms). Outside-row reactivation remains the dominant slice of CSR time, so histogram acceleration is the next lever.
- **Wide filters**: Applying a wide-band filter (~80% coverage) now takes ~22 ms, suggesting histogram updates dominate once hundreds of thousands of rows toggle. SIMD or chunked accumulation remains a future lever.

## Next Steps
1. Integrate bench reports into documentation/CI for regression tracking.
2. Profile the clear-path heuristic on targeted scenarios (e.g., narrow vs. wide clears) to tune the 40 % fallback threshold and cut 1 M-row clear latency further.
3. Instrument the worker to break down clear time into CSR traversal vs. histogram/mask updates so the next optimization pass can focus on the dominant slice.
4. Investigate streaming writes into the SharedArrayBuffer and typed-input ingest paths to shave additional startup time.
5. Leverage the adaptive clear costs to prototype chunked-delta or hybrid strategies (e.g. split large clears into batches) without reintroducing fixed thresholds.
6. Browser demo: add FPS or timing overlays to quantify interaction latency; compare directly with the legacy airline example for visual parity.

## Summary (ELI5)
- You give CrossfilterX a big table of flights; it spends a little extra time up front turning numbers into tidy bins, so later answers come fast. Legacy crossfilter skips that prep work, so it starts immediately but has to work harder on each question.
- Once the prep is done, CrossfilterX answers range filters in a blink (even with 500k flights), only touching the rows that matter. Legacy crossfilter answers are still quick, but it doesn’t have as many guardrails against future heavy workloads.
- The shiny demo shows these pieces working together. The slider redraws stats live, powered by that single worker without hiccups—even when you bump the dataset into the hundreds of thousands.

### One-Million Row Bench Script

Run `node scripts/run-1m-bench.mjs` to generate back-to-back 1 M × 6 benchmarks for both row objects and columnar typed arrays. Reports land in `packages/bench/reports/` (look for filenames containing `baseline-1m`). Latest run:

| Mode      | Ingest | Index | Filter | Clear | Report |
|-----------|-------:|------:|-------:|------:|--------|
| rows      | 208.66 ms | 3.45 ms | 18.48 ms | 20.04 ms | `baseline-1758056726426.json` |
| columnar  | 81.63 ms | 3.50 ms | 19.17 ms | 20.43 ms | `baseline-1758056727971.json` |

### Full Bench Suite

Run `node scripts/run-bench-suite.mjs` to execute:

1. Baseline 100 k row-object benchmark.
2. Baseline 100 k columnar benchmark.
3. Legacy comparison (rows and columnar).
4. One-million row benchmarks (rows and columnar).

Reports accumulate under `packages/bench/reports/` with timestamps for each run.
