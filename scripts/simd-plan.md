# SIMD Histogram Plan (for discussion)

## Goal
Reduce wide-band clear latency by accelerating histogram updates. Target: bring the “outside” phase from ~12 ms down to ~6 ms on 1M × 6 datasets.

## Approach Options
1. **Chunked JS Accumulation (Done – now behind a runtime toggle)**
   - Buffered histogram updates are available when `__CFX_HIST_MODE='buffered'` (or `BENCH_HIST_MODE=buffered`).
   - The `bench:micro` script exercises the path on 1M×6 datasets; current runs show parity within ±1 ms versus direct mode, so auto mode keeps the buffered path disabled below 2M toggled rows.
   - Profiling snapshots record `buffered: true/false` so we can gather data while iterating.

2. **WASM Loader Stub (Done)**
   - `packages/core/src/wasm/simd.ts` now attempts to load the `wasm-pack` bundle and falls back to JS if unavailable, so the worker code stays synchronous while we iterate on the native kernel.
   - Initial Rust kernel mirrors the JS gather implementation; current iteration batches lanes via `wasm32` SIMD and exposes a reusable scratch buffer so JS writes directly into wasm memory. Further SIMD scatter optimisations remain open.

2. **WebAssembly SIMD Prototype**
   - Implement delta accumulation loops in Rust/C++ via wasm-pack/emscripten.
   - Export functions accepting row ID pointers and histogram buffers.
   - Add a feature flag in the worker to toggle between JS/Wasm paths.

## Profiling Workflow
1. Run `BENCH_LO_FRACTION=0.1 BENCH_HI_FRACTION=0.9 BENCH_PROFILE_CLEAR=1 npm run bench` to capture `profile.clear` data.
2. Iterate on chunked/wasm implementation; re-run the benchmark to validate improvements.
3. Add automated regression tests comparing histogram totals and verifying fallback behavior.

## Next Steps
- [x] Add microbench to isolate histogram update cost per dimension.
- [x] Prototype Wasm/SIMD accumulation (single dimension first, feature flag).
- [ ] Profile against 1M × 6 datasets with the wasm path; target outside phase ≤8 ms.
- [ ] Implement actual SIMD intrinsics in Rust (replace gather loop) and profile improvements.
- [ ] Document findings (improvements or regressions) in `BENCHMARKS.md` and CI artifacts.

## SIMD Prototype Design (WIP)

### Tooling Choice
- Use **Rust + wasm-pack** (opt for `--target bundler`) so we can emit pure `.wasm` + JS glue without node-ABI dependencies. Existing scripts already assume `npm` tooling; we can add `scripts/build-wasm.mjs` to wrap `wasm-pack` later.
- Keep the generated package under `packages/core/src/wasm/pkg/` (ignored by git); provide a loader shim in TypeScript to defer loading until the histogram feature flag is enabled.

### Kernel API
- Export a single function signature from Rust:
  ```rust
  #[wasm_bindgen]
  pub fn apply_histogram_delta(
      rows_ptr: *const u32,
      rows_len: usize,
      bins_ptr: *const u16,
      hist_ptr: *mut u32,
      hist_len: usize,
      delta: i32,
  );
  ```
  - `rows_ptr` iterates row IDs (sorted by CSR slice).
  - `bins_ptr` points at the source column (`Uint16Array` view in SAB).
  - `hist_ptr` targets either the front/back histogram or a temporary buffer; we’ll start with direct writes to keep parity.
  - `delta` is `+1` for activations, `-1` for deactivations.

### Integration Strategy
- Extend the histogram mode to accept `"simd"`; loading the wasm module switches `activateRow`/`deactivateRow` over to batched calls. We can keep the fallback JS loops as-is for unsupported browsers.
- Update `createHistogramBuffers` to expose raw `Int32Array` data so the wasm path can read/merge without extra copies.
- Add a thin TypeScript wrapper in `packages/core/src/wasm/index.ts` that:
  1. Lazily instantiates the wasm module (cached Promise).
  2. Provides helper functions (`applyDelta(rows: Uint32Array, column: Uint16Array, histogram: Uint32Array, delta: 1 | -1)`).
- Hook inside `clearFilterRange` and the activation/deactivation helpers; when the wasm flag is active, accumulate row IDs for the current CSR slice into a scratch `Uint32Array` (re-usable per thread) and pass to the wasm helper.

### Testing & Bench Hooks
- Add Vitest coverage that compares SIMD vs JS outputs on synthetic slices (small CSR segments) to guarantee deterministic counts.
- Extend the microbench to accept `MICRO_HIST_MODES=direct,buffered,simd` so perf deltas are obvious.
- Document the build step in `AGENTS.md` once the wasm packager lands; for now, leave TODO markers in `scripts/run-histogram-microbench.mjs` noting the duplication with `run-bench.mjs` (cleanup after SIMD lands).
