# CrossfilterX Progress Log

_Last updated: 2025-09-17_

## 0. Setup & Prerequisites
- Node.js ≥ 20 (CI workflow/example uses v20).
- `npm install` (preferably with `--prefer-offline`) after cloning or resuming work.
- TypeScript builds live under `packages/core/dist` and `packages/bench/dist`; `node scripts/run-bench.mjs` rebuilds these automatically.

Files of interest:
- Top-level automation lives in `scripts/` (bench suite, summary generator, comparison script, SIMD plan).
- Benchmark outputs are written to `packages/bench/reports/` and summarised in `packages/bench/reports-summary.json`.
- Demo served via `packages/demo` (`npm run dev` starts the Vite server configured in `scripts/dev-server.mjs`).
- Legacy comparison expects a sibling checkout at `../crossfilter-community`; run `npm install` (and build if needed) inside that repo before invoking `scripts/compare-crossfilter.mjs`.
- Environment toggles: `VITE_COLUMNAR=1` (demo), `BENCH_COLUMNAR=1`, `BENCH_PROFILE_CLEAR=1`, `BENCH_LO_FRACTION`, `BENCH_HI_FRACTION` (benchmarks).

## 1. Core Engine Enhancements
- ✅ **Columnar Ingest (Numeric + Categorical)**
  - `crossfilterX` now accepts columnar datasets via `ColumnarData` with optional `categories`. Numeric columns ingest directly into the SAB; categorical columns use dictionary lookups so histograms match row-object results.
  - Covered by updated tests (`packages/core/test/ingest-descriptor.test.ts`).
  - Example structure:
    ```ts
    const dataset = {
      columns: {
        distance: Float32Array.from([...]),
        carrier: Uint16Array.from([...]),
        departure: Uint16Array.from([...])
      },
      categories: {
        carrier: ['AA', 'DL', 'UA', 'WN', 'B6', 'AS']
      },
      length: rows
    } satisfies ColumnarData;
    ```
- ✅ **Buffered Histogram Profiling Hook**
  - Profiling runs (`BENCH_PROFILE_CLEAR=1`) now use temporary buffers to batch histogram updates, preserving totals while logging inside/outside timings. No perf win yet, but groundwork is ready for JS/Wasm SIMD.
- ✅ **Clear-Path Estimator Tuning**
  - 50/50 clears now correctly fall back to `fullRecompute`, while wide-band ranges use CSR deltas. Profiling confirms outside phase still dominates (~12 ms), guiding next optimisation work.
- ✅ **SIMD Accumulator Stub**
  - `BENCH_HIST_MODE=simd` routes histogram updates through `packages/core/src/wasm/simd.ts`, batching row IDs in preparation for the wasm kernel. The interface mirrors the planned Rust implementation and passes the new Vitest coverage (`histogram-simd.test.ts`).
  - Rust sources live in `packages/core/src/wasm/kernels`; build via `wasm-pack build ... --target web --out-dir packages/core/src/wasm/pkg`. Without the generated bundle the loader falls back to JS and logs a warning.
  - Current wasm path uses SIMD gather + shared scratch buffers to avoid JS→wasm copies; microbench parity with direct mode is ~17–18 ms clear (see `micro-histogram-1758125784.json`).
  - `scripts/run-bench.mjs` and `scripts/run-histogram-microbench.mjs` copy the wasm bundle into `packages/core/dist/` after each build so Node-based benches can import it.
- ✅ **Function Dimensions**
  - Accessor-based dimensions now materialise columns inside the worker. `const dim = cf.dimension(row => row.value * 2); await dim; dim.group()` mirrors legacy Crossfilter semantics for numeric and string accessors.

## 2. Benchmarks & Automation
- ✅ **Unified Bench Suite** — `scripts/run-bench-suite.mjs` now runs:
  1. 100 k baselines (rows + columnar)
  2. Legacy comparisons (rows + columnar via `--columnar`)
  3. 1 M baselines (rows + columnar)
  4. Multi-filter stress runs (1 M rows + 5 M columnar)
  5. Histogram microbench (`npm run bench:micro` via the orchestration script; includes direct/buffered/SIMD sweeps)
  6. Generates `packages/bench/reports-summary.json`
- ✅ **GitHub Action Template** — `.github/workflows/bench-suite.yml` sets up a manual (workflow_dispatch) run that executes the suite and uploads reports + summary artifacts.
- ✅ **Comparison Script Enhancements** — `scripts/compare-crossfilter.mjs` now accepts `--columnar`, generates typed columnar data with carrier labels, and records `mode` in comparison outputs.
- ✅ **Benchmark Docs** — `BENCHMARKS.md` covers baseline tables, the multi-filter scenario, and the histogram microbench results (with opt-in buffered mode guidance).

## 3. Demo & Docs
- ✅ **Airline Demo Upgrades** (`packages/demo/src/main.ts`)
  - Displays ingest time and the active ingest mode (rows/columnar).
  - Adds a toggle button to switch modes without rebuilding (`window.VITE_COLUMNAR_OVERRIDE`).
- ✅ **Hero Landing Page** (`docs/site/index.html`)
  - Fetches `packages/bench/reports-summary.json` to render live benchmark tables (with a refresh button).
  - Links to the airline demo and highlights the core value proposition.
- ✅ **Documentation Quick Links** (`docs/README.md`) now reference the hero page, benchmark doc, and roadmap.
- ✅ **SIMD Plan Doc** (`scripts/simd-plan.md`) summarises current status (chunked buffering done) and next steps (microbench + Wasm/SIMD prototype).

## 4. Current Benchmarks (latest suite)
| Dataset | Mode | Ingest | Index | Filter | Clear | Report |
|---------|------|-------:|------:|-------:|------:|--------|
| 100k × 6 | rows | ~22 ms | ~0.96 ms | ~3.1 ms | ~2.2 ms | `baseline-1758111378104.json` |
| 100k × 6 | columnar | ~15 ms | ~0.94 ms | ~3.2 ms | ~2.1 ms | `baseline-1758111379158.json` |
| 1M × 6 | rows | ~194 ms | ~3.5 ms | ~21.0 ms | ~20.7 ms | `baseline-1758111381513.json` |
| 1M × 6 | columnar | ~83 ms | ~3.5 ms | ~20.9 ms | ~20.6 ms | `baseline-1758111382931.json` |
| Multi 1M rows | rows | ~183 ms | 3.3/1.7/1.7 ms | 22.7 → 21.5 → 28.8 | 17.4 → 31.0 → 19.1 | `multi-rows-1758111383866.json` |
| Multi 5M | columnar | ~382 ms | 10.0/8.2/8.1 ms | 105.2 → 107.6 → 142.9 | 361.7 → 590.8 → 247.1 | `multi-columnar-1758111385363.json` |
| Histogram microbench | columnar | ~72–83 ms | – | ~21 ms | 15.5–16.5 ms (avg) | `micro-histogram-1758111388312.json` |
| Histogram microbench (simd) | columnar | ~69–78 ms | – | ~20.2 ms | ~16.4 ms | `micro-histogram-simd-1758112172.json` |
| Wide-band clear (profiled) | rows | – | – | – | ~19–20 ms | `baseline-1m-wideband-prof.json` |

## 5. Outstanding Workstreams
1. **CI Integration**
   - Extend the GitHub Action to post summary comments or threshold checks.
   - Consider scheduled runs for nightly regression tracking.
2. **Histogram Optimisation**
   - Implement the wasm-backed accumulator using the stubbed interface and compare perf via `MICRO_HIST_MODES=direct,simd`.
   - Evaluate buffered mode on ≥2 M-row clears using the new microbench output.
3. **Columnar Documentation & Mixed Datasets**
   - Document the `ColumnarData` format (`columns`, `categories`).
   - Update demo/comparison README so users can try mixed numeric + categorical scenarios.
4. **Contributor Experience**
   - Break `16sepnextsteps.md` items into issues/milestones.
   - Ensure scripts (`run-bench-suite`, `generate-bench-summary`, demo toggles) are referenced in CONTRIBUTING/dev docs.

## 6. Quick Commands
- `npm run test` — sequential core test suite.
- `node scripts/run-bench-suite.mjs` — full benchmark pipeline + summary (`reports-summary.json`).
- `node scripts/compare-crossfilter.mjs --columnar` — compare CrossfilterX (typed) vs legacy crossfilter (rows).
- `BENCH_COLUMNAR=1 npm run bench` — single columnar benchmark (rows by default).
- `BENCH_PROFILE_CLEAR=1 BENCH_LO_FRACTION=0.1 BENCH_HI_FRACTION=0.9 npm run bench` — profile wide-band clears.
- `npm run bench:micro` — build + execute histogram microbenchmark (outputs to `packages/bench/reports/micro-*.json`). Use `MICRO_HIST_MODES=direct,simd` to compare the wasm shim.
- `npm run dev` — launch Vite dev server for the demo (relying on `scripts/dev-server.mjs`).
- `node scripts/generate-bench-summary.mjs` — regenerate `reports-summary.json` manually after running individual benches.

## 7. Recent Key Files
- Engine: `packages/core/src/index.ts`, `packages/core/src/memory/ingest.ts`, `packages/core/src/protocol.ts`
- Tests: `packages/core/test/ingest-descriptor.test.ts`, `packages/core/test/clear-heuristic.test.ts`
- Bench Scripts: `scripts/run-bench.mjs`, `scripts/run-bench-suite.mjs`, `scripts/generate-bench-summary.mjs`, `scripts/compare-crossfilter.mjs`
- Docs/Demo: `docs/site/index.html`, `packages/demo/src/main.ts`, `.github/workflows/bench-suite.yml`
- Plans: `16sepnextsteps.md`, `scripts/simd-plan.md`

This document summarises the current state so development can resume seamlessly even after a restart.
