# 16 Sep Next Steps – CrossfilterX

## Project Goals & Context
- Build a next-generation **CrossfilterX** capable of 60 FPS brushing on 5–10M rows and ≤200 dims using a single worker.
- Maintain drop-in compatibility (legacy crossfilter API via adapter) so dashboards migrate with minimal edits.
- Provide deterministic worker-based updates, CSR-backed deltas, and benchmarks to protect performance claims.
- Deliver an airline-style browser demo (`packages/demo`) showcasing responsive filtering on large synthetic datasets.
- Track progress via automated CLI benchmarks (`npm run bench`), legacy comparisons (`scripts/compare-crossfilter.mjs`), and documentation (`BENCHMARKS.md`).

- Repository structure highlights:
  - `packages/core/` – worker protocol, SAB layout, CSR logic, public API.
  - `packages/bench/` – CLI benchmarks and reports.
  - `packages/demo/` – browser demo (airline-style UI).
  - `scripts/` – automation (`run-bench.mjs`, `compare-crossfilter.mjs`).
  - `BENCHMARKS.md` / `16sepnextsteps.md` – consolidated results and plans.
## Current Snapshot
- **Core status**
  - Worker protocol builds CSR indexes lazily, reports metrics via `INDEX_BUILT`, and supports incremental deltas when range changes stay within the same dimension.
  - Controller/public API exposes `buildIndex(name)` and `indexStatus(name)` so tooling can prebuild or inspect per-dimension readiness.
  - Tests cover CSR deltas (sorted/unsorted, multi-dimension), index API, and the simple engine sandbox (`packages/core/test/*`).
- **Benchmarks**
  - `npm run bench` rebuilds core → bench → runs `packages/bench/dist/runner.js` and logs ingest/index/filter/clear metrics under `packages/bench/reports/`.
  - `scripts/compare-crossfilter.mjs` compares CrossfilterX vs. legacy `crossfilter-community` for 100k/200k/500k rows.
  - Latest baseline: `baseline-1758039813831.json` (≈29 ms ingest, ≈0.93 ms index, ≈2.90 ms filter for 100 k × 6 dims).
  - Latest comparison: `comparison-1758039829471.json` (crossfilterX filters <3 ms; ingest still heavier than legacy).
- **Demo**
  - `packages/demo` hosts an airline-style dashboard (distance slider, carrier bars, summary cards) that remains responsive with 200k rows; slider labels show actual distance ranges and active-flight counts.
- **Docs**
  - `BENCHMARKS.md` summarizes baseline/comparison results with an ELI5 section.
## Findings So Far
1. CrossfilterX pays a noticeable ingest cost (quantization + CSR prep) compared to legacy crossfilter’s pointer-based ingest.
2. Delta path is incremental only when CSR is already available and the filter change is a pure range tweak; new dimensions or clears fall back to recompute.
3. Bench workloads are still light (single range, 6 dims); we need heavier scenarios (multiple filters, high bin counts, ≥1 M rows) to make the worker/CSR design shine.
## Optimization Roadmap
1. **Ingest/Index Pipeline**
   - Stream quantization directly into the SharedArrayBuffer (avoid intermediate arrays).
   - Accept typed inputs (Float32Array/arrow buffers) to skip numeric coercion.
   - Build CSR in background frames or batches; measure ingest/index for 1–5 M rows.
2. **Delta Engine Refinements**
   - Ensure every filter change uses `diffRanges`; avoid full recompute when widening/narrowing.
   - Track “visible” groups so histogram updates only touch needed charts.
   - Add multi-dimension benchmarks (e.g., 5 simultaneous filters) to compare against legacy crossfilter.
3. **Bin Coarsening & Async CSR**
   - Implement coarsening estimator and coarse histogram swap during drag.
   - Support asynchronous CSR builds (split loops, report progress) to prevent frame stalls on cold dimensions.
   - Re-run benchmarks on multi-million-row datasets; log improvements in `BENCHMARKS.md`.
4. **Demo Enhancements**
   - Add FPS/timing overlay to visualize interaction latency.
   - Compare directly with the legacy airline demo when the above optimizations land.
## Action Items After Restart
- Run `npm run lint`, `npm run test`, and `npm run bench` to establish the baseline before editing.
- Rebuild context by reviewing `BENCHMARKS.md`, this `16sepnextsteps.md`, and the latest reports in `packages/bench/reports/`.
- Begin with Optimization Step 1 (ingest/index) on ≥1 M-row datasets; capture before/after metrics in `BENCHMARKS.md`.
- Continue through the roadmap, ensuring each change has automated tests and updated docs/benchmarks.

## Workstreams (19 Sep)

1. **Benchmark Automation**
   - [x] Add GitHub Action or CI script to run `node scripts/run-bench-suite.mjs`.
   - [x] Extend suite with multi-filter + microbench runs (outputs land under `packages/bench/reports/`).
   - [ ] Upload `packages/bench/reports-summary.json` and comparison outputs as artifacts (Action uploads reports; add summary comment later).
   - [ ] Post summary comment with key metrics (ingest, filter, clear) for rows vs columnar.

2. **Histogram Performance**
   - [x] Profile wide-band clears with `BENCH_PROFILE_CLEAR=1` and capture before/after stats.
   - [x] Prototype SIMD/block accumulation (JS stub) behind a feature flag.
   - [x] Add regression tests ensuring histogram totals remain stable and record profiling improvement.
   - [x] Wire `BENCH_HIST_MODE` + microbench to compare direct vs buffered clears.
   - [x] Replace the JS stub with a wasm kernel (current implementation mirrors JS gather; SIMD optimisations still pending).

3. **Columnar Categorical Support**
   - [x] Accept dictionary-encoded categorical columns in columnar ingest.
   - [x] Update comparison script and demo to include mixed (numeric + categorical) scenarios.
   - [ ] Document expected dataset formats for columnar ingest.

4. **Contributor Experience**
   - [ ] Break down remaining roadmap items into GitHub issues/milestones.
   - [ ] Document bench/demo scripts (toggle, suite, summary generator) in README/CONTRIBUTING.
   - [ ] Ensure `scripts/run-bench.mjs` and suite commands are referenced in CI/local dev docs.

## Completed (Function Dimensions)
- [x] Support accessor-based dimensions by materialising derived columns inside the worker; `dimension(fn)` handles numeric and categorical results.
