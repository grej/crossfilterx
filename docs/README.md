# CrossfilterX Docs

Initial technical notes live in `AGENTS.md`. This README tracks navigation to the most relevant references and toggles for contributors.

## Quick Links
- [Hero Landing Page](site/index.html) — renders the latest numbers from `packages/bench/reports-summary.json`.
- [Benchmark Report](../BENCHMARKS.md) — single-range, multi-range, and microbench results with ELI5 commentary.
- [Roadmap (16 Sep)](../16sepnextsteps.md) — day-by-day plan with outstanding workstreams.
- [Progress Log (17 Sep)](../PROGRESS_AND_NEXT_STEPS_17_SEP.md) — current status, scripts, and configuration cheat sheet.

## Dataset Formats & Flags
- **Row objects** (`Array<Record<string, unknown>>`): default for `npm run bench` and the legacy comparison script.
- **Columnar datasets** (`ColumnarData`): enable via `BENCH_COLUMNAR=1` or `VITE_COLUMNAR=1`. Supply `categories` for dictionary-encoded dimensions when passing typed arrays.
- **Histogram buffering**: opt in with `BENCH_HIST_MODE=buffered` or set `globalThis.__CFX_HIST_MODE = 'buffered'` in bespoke harnesses. Auto mode only buffers when ≥2 M rows toggle.
- **SIMD staging**: `BENCH_HIST_MODE=simd` (or `__CFX_HIST_MODE='simd'`) uses the wasm-ready accumulator stub so you can validate wiring before the actual kernel lands.
- **Building wasm kernels**: run `wasm-pack build packages/core/src/wasm/kernels --release --target web --out-dir packages/core/src/wasm/pkg` to regenerate the wasm bundle. The bench/micro scripts copy the output into `packages/core/dist/wasm/pkg` automatically before running.
- **Function dimensions**: pass an accessor to `dimension(row => ...)`, `await` the returned handle, then call `dim.group()` as usual. Numeric results are quantized; string results build dictionary-backed columns behind the scenes.
- **Profiling toggles**: `BENCH_PROFILE_CLEAR=1` (or `globalThis.__CFX_PROFILE_CLEAR = true`) records `profile.clear` snapshots for clears.

## Automation Cheatsheet
- `npm run bench` — single-range scenario; respects the env vars above.
- `npm run bench:micro` — builds both workspaces and executes the histogram microbench.
- `node scripts/run-bench-suite.mjs` — orchestrates baselines, comparisons, 1 M suite, multi-filter stress tests, microbench, and summary regeneration.
- `node scripts/compare-crossfilter.mjs [--columnar]` — compares CrossfilterX vs. the community crossfilter checkout (`../crossfilter-community`).

## Demo Toggles
- `npm run dev` starts the Vite demo server (COOP/COEP headers included).
- Update dataset size with `VITE_ROWS`; switch ingest mode at runtime with `window.VITE_COLUMNAR_OVERRIDE = 'rows' | 'columnar'`.
- The demo HUD reports ingest duration, active mode, and active row counts to help validate performance changes.
