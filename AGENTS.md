# Repository Guidelines

## Project Structure & Module Organization
- `packages/core/` – Worker protocol, shared memory layout, ingest, and controller code compiled via TypeScript (`tsc --build`).
- `packages/bench/` – Benchmark harness compiled to `dist/` (`npm --workspace packages/bench run build`). Contains `src/runner.ts` (single-range + multi-range scenarios) and `src/micro/histogram.ts` (clear-path microbench).
- `packages/demo/` – Vite-powered airline demo (`npm run dev`) that exercises the worker in the browser; toggles live under `window.VITE_*`.
- `docs/` – Hero page (`docs/site/index.html`), high-level README, and progress logs.
- `scripts/` – Automation (`run-bench.mjs`, `run-bench-suite.mjs`, `run-histogram-microbench.mjs`, comparison + summary generators). Each script assumes the project root as the working directory.

## Build, Test, and Development Commands
- `npm run test` – Runs the Vitest suite via `run-tests.js`; required after every engine change.
- `npm run bench` – Rebuilds core + bench, patches `.js` specifiers, and executes `packages/bench/dist/runner.js` using the default single-range scenario.
- `npm run bench:micro` – Invokes `scripts/run-histogram-microbench.mjs`, which builds both workspaces and runs the histogram microbench (outputs `packages/bench/reports/micro-*.json`).
- `node scripts/run-bench-suite.mjs` – Full regression pipeline (baselines, comparisons, 1 M suite, multi-filter stress tests, histogram microbench, summary generation).
- `npm run dev` – Starts the Vite dev server through `scripts/dev-server.mjs` with the COOP/COEP headers required for SharedArrayBuffer.

## Columnar Datasets & Histogram Modes
CrossfilterX accepts either row objects or columnar datasets:

```ts
import type { ColumnarData } from '@crossfilterx/core';

const flights: ColumnarData = {
  columns: {
    distance: Float32Array.from([...]),
    departure: Float32Array.from([...])
  },
  categories: {
    carrier: ['AA', 'DL', 'UA', 'WN', 'B6', 'AS']
  },
  length: 1_000_000
};
```

- Columnar ingest skips per-row coercion and is toggled via `BENCH_COLUMNAR=1 npm run bench`, `BENCH_COLUMNAR=1 node scripts/run-bench.mjs`, or `VITE_COLUMNAR=1 npm run dev`.
- Buffered histogram mode is exposed through `BENCH_HIST_MODE=buffered` (CLI) or `globalThis.__CFX_HIST_MODE = 'buffered'` for targeted profiling. The default `'auto'` mode only enables buffering when ≥2 M rows toggle.
- SIMD staging: set `BENCH_HIST_MODE=simd` (or `globalThis.__CFX_HIST_MODE = 'simd'`) to route histogram updates through the wasm-backed accumulator in `packages/core/src/wasm/simd.ts`.
- Function-based dimensions are supported: `const dim = cf.dimension(row => row.value * 2); await dim; dim.group()` returns a derived dimension backed by the worker. Numeric accessors are quantized automatically, and string accessors build dictionary columns on the fly.

## WebAssembly Kernels
- Rust sources live under `packages/core/src/wasm/kernels`. Build them via:
  ```bash
  wasm-pack build packages/core/src/wasm/kernels --release --target web --out-dir packages/core/src/wasm/pkg
  ```
- The TypeScript loader attempts to import `./pkg/crossfilterx_kernels.js`; if the build artifacts are missing the system falls back to the JS accumulator and logs a warning.
- `scripts/run-bench.mjs` and `scripts/run-histogram-microbench.mjs` automatically copy `src/wasm/pkg` into `dist/` after rebuilding so Node-based benchmarks can load the wasm bundle. Regenerate the wasm output whenever the Rust code changes so `BENCH_HIST_MODE=simd` exercises the native path.
- Profiling clear paths attaches `profile.clear` snapshots when `BENCH_PROFILE_CLEAR=1` or `globalThis.__CFX_PROFILE_CLEAR = true` (used by the microbench and targeted runs).

## Demo & Runtime Toggles
- `VITE_COLUMNAR` – Controls the ingest mode in the demo at build time; can be overridden at runtime via `window.VITE_COLUMNAR_OVERRIDE = 'rows' | 'columnar'`.
- `VITE_ROWS` – Adjusts the synthetic dataset size in the demo.
- Bench runner env vars: `BENCH_SCENARIO=multi` (multi-dimension stress), `BENCH_ROWS`, `BENCH_DIMS`, `BENCH_LO_FRACTION`, `BENCH_HI_FRACTION`, `BENCH_OUTPUT` (explicit JSON path), `MICRO_ITERATIONS`, and `MICRO_HIST_MODES`.

## Coding Style & Naming Conventions
- Use two-space indentation, ES2022 modules, and strongly-typed TypeScript.
- Add a top-of-file docstring summarising dependencies and consumers for every source/automation file you touch.
- Document non-trivial helpers with brief comments describing intent; avoid obvious restatements of the code.
- Prefer named exports; reserve default exports for package entry points (`packages/core/src/index.ts`).

## Testing & Validation
- Unit tests live under `packages/core/test/`, mirroring the source modules. Add scenarios exercising both row and columnar ingest when modifying ingest/histogram code.
- After algorithmic changes, run `npm run test`, `npm run bench`, and (when relevant) `npm run bench:micro` to guard performance regressions.
- Benchmark outputs accumulate in `packages/bench/reports/`; keep notable JSON filenames referenced in `BENCHMARKS.md` and progress logs.

## Commit & Pull Request Guidelines
- Follow Conventional Commits (`feat: add columnar ingest buffers`) and include performance callouts or benchmark JSON links in the body.
- Ensure CI-critical commands pass locally (`npm run lint`, `npm run test`, `npm run bench`) before opening a PR.
- Include repro steps or dataset links when fixing bugs, and update docs (`BENCHMARKS.md`, `docs/README.md`, hero page) when benchmarks or toggles change.
