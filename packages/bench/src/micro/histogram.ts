/**
 * @fileoverview Provides a focused benchmark for histogram clear performance,
 *   contrasting direct per-row updates with buffered aggregation. The script is
 *   executed from the bench workspace after compilation (via `tsc`) and relies
 *   on `crossfilterX` from the core package together with the synthetic dataset
 *   helpers under `datasets.ts`. Results feed into the wider SIMD plan by
 *   offering reproducible measurements for clear-heavy workloads.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { buildUniformColumnar } from '../datasets.js';

const env = ((globalThis as unknown as { process?: { env?: Record<string, string> } }).process?.env ?? {}) as Record<string, string>;
const ROWS = Number(env.BENCH_ROWS ?? '1000000');
const DIMS = Number(env.BENCH_DIMS ?? '6');
const RANGE_MIN = Number(env.BENCH_MIN ?? '0');
const RANGE_MAX = Number(env.BENCH_MAX ?? '1000');
const RANGE_FRACTION_LO = clampFraction(Number(env.BENCH_LO_FRACTION ?? '0.1'));
const RANGE_FRACTION_HI = clampFraction(Number(env.BENCH_HI_FRACTION ?? '0.9'));
const ITERATIONS = Math.max(1, Number(env.MICRO_ITERATIONS ?? '5'));
const MODES = (env.MICRO_HIST_MODES ?? 'direct,buffered').split(',').map((value) => value.trim()).filter(Boolean) as HistogramMode[];
const OUTPUT = env.MICRO_OUTPUT;
const PROFILE_SHARD = env.BENCH_PROFILE_SHARD === '1';

const HIST_FLAG = '__CFX_HIST_MODE' as const;
const PROFILE_FLAG = '__CFX_PROFILE_CLEAR' as const;
const SHARD_FLAG = '__CFX_PROFILE_SHARDS' as const;

type HistogramMode = 'direct' | 'buffered' | 'auto';

type HistogramShardMetrics = {
  flushes: number;
  evictions: number;
  finalFlushes: number;
  bins: number;
  rows: number;
};

type HistogramShardSample = {
  dim: number;
  delta: number;
  rows: number;
  copyMs: number;
  wasmMs: number;
  metrics: HistogramShardMetrics | null;
};

type ClearSample = {
  filterMs: number;
  clearMs: number;
  profile: unknown;
  activeCount: number;
  filterShardProfile?: HistogramShardSample[];
  clearShardProfile?: HistogramShardSample[];
};

type ModeResult = {
  mode: HistogramMode;
  rows: number;
  dimensions: number;
  iterations: number;
  ingestMs: number;
  filterAvgMs: number;
  clearAvgMs: number;
  samples: ClearSample[];
};

const perfNow = () => {
  const perf = (globalThis as { performance?: { now(): number } }).performance;
  if (perf?.now) return perf.now();
  const processRef = (globalThis as unknown as { process?: { hrtime: () => [number, number] } }).process;
  if (processRef?.hrtime) {
    const [sec, nsec] = processRef.hrtime();
    return sec * 1_000 + nsec / 1_000_000;
  }
  return Date.now();
};

// @ts-expect-error - compiled core output used for runtime benchmark
const core = (await import('../../../core/dist/index.js')) as typeof import('../../../core/src/index');
const { crossfilterX } = core;
// The dist bundle does not ship explicit typings; treat as untyped module.
// @ts-expect-error dist bundle does not ship explicit TypeScript metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
const simdModule = (await import('../../../core/dist/wasm/simd.js')) as Record<string, unknown>;
const waitForWasmReady =
  typeof (simdModule as { waitForWasmReady?: () => Promise<unknown> }).waitForWasmReady === 'function'
    ? ((simdModule as { waitForWasmReady: () => Promise<unknown> }).waitForWasmReady)
    : null;

async function main() {
  (globalThis as Record<string, unknown>)[PROFILE_FLAG] = true;
  if (PROFILE_SHARD) {
    (globalThis as Record<string, unknown>)[SHARD_FLAG] = true;
    if (waitForWasmReady) {
      await waitForWasmReady();
    }
  }
  const results: ModeResult[] = [];

  for (const mode of MODES) {
    console.log(`Running histogram microbench mode=${mode} rows=${ROWS}`);
    (globalThis as Record<string, unknown>)[HIST_FLAG] = mode;
    const result = await runMode(mode);
    results.push(result);
    console.log(
      `  clearAvg=${result.clearAvgMs.toFixed(2)} ms filterAvg=${result.filterAvgMs.toFixed(2)} ms`
    );
    delete (globalThis as Record<string, unknown>)[HIST_FLAG];
  }

  delete (globalThis as Record<string, unknown>)[PROFILE_FLAG];
  if (PROFILE_SHARD) {
    delete (globalThis as Record<string, unknown>)[SHARD_FLAG];
    delete (globalThis as Record<string, unknown>).__CFX_HIST_PROFILE_LOG;
    delete (globalThis as Record<string, unknown>).__CFX_SHARD_PROFILED;
    delete (globalThis as Record<string, unknown>).__CFX_SHARD_SKIPPED;
    delete (globalThis as Record<string, unknown>).__CFX_SIMD_CREATED;
    delete (globalThis as Record<string, unknown>).__CFX_WASM_USED;
    delete (globalThis as Record<string, unknown>).__CFX_WASM_PROMISE;
  }

  if (OUTPUT) {
    await mkdir(dirname(OUTPUT), { recursive: true });
    await writeFile(OUTPUT, JSON.stringify(results, null, 2));
    console.log(`Wrote microbench results to ${OUTPUT}`);
  }
}

void main().catch((error) => {
  console.error('Histogram microbench failed', error);
  const proc = (globalThis as unknown as { process?: { exitCode?: number } }).process;
  if (proc) proc.exitCode = 1;
});

async function runMode(mode: HistogramMode): Promise<ModeResult> {
  const dataset = buildUniformColumnar({
    rows: ROWS,
    dimensions: DIMS,
    min: RANGE_MIN,
    max: RANGE_MAX
  });

  const ingestStart = perfNow();
  const cf = crossfilterX(dataset, { bins: 4096 });
  await cf.whenIdle();
  const ingestMs = perfNow() - ingestStart;

  const dimName = 'dim0';
  await cf.buildIndex(dimName);

  const loFraction = Math.min(RANGE_FRACTION_LO, RANGE_FRACTION_HI);
  const hiFraction = Math.max(RANGE_FRACTION_LO, RANGE_FRACTION_HI);
  const loBin = quantizeFraction(loFraction, 12);
  const hiBin = quantizeFraction(hiFraction, 12);

  const dimension = cf.dimension(dimName);
  const group = cf.group(dimName);
  const samples: ClearSample[] = [];

  for (let iteration = 0; iteration < ITERATIONS; iteration++) {
    const filterStart = perfNow();
    dimension.filter([loBin, hiBin]);
    await cf.whenIdle();
    const filterMs = perfNow() - filterStart;
    const filterShardProfile = PROFILE_SHARD ? consumeShardProfile() : undefined;

    const clearStart = perfNow();
    dimension.clear();
    await cf.whenIdle();
    const clearMs = perfNow() - clearStart;
    const profile = cf.profile()?.clear ?? null;
    const clearShardProfile = PROFILE_SHARD ? consumeShardProfile() : undefined;
    samples.push({
      filterMs,
      clearMs,
      profile,
      activeCount: group.count(),
      filterShardProfile,
      clearShardProfile
    });
  }

  cf.dispose();

  const filterAvg = samples.reduce((acc, sample) => acc + sample.filterMs, 0) / samples.length;
  const clearAvg = samples.reduce((acc, sample) => acc + sample.clearMs, 0) / samples.length;

  return {
    mode,
    rows: ROWS,
    dimensions: DIMS,
    iterations: ITERATIONS,
    ingestMs,
    filterAvgMs: filterAvg,
    clearAvgMs: clearAvg,
    samples
  };
}

function quantizeFraction(fraction: number, bits: number) {
  const clamped = Math.min(1, Math.max(0, fraction));
  const range = (1 << bits) - 1;
  return Math.round(clamped * range);
}

function clampFraction(value: number) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function consumeShardProfile(): HistogramShardSample[] {
  const root = globalThis as Record<string, unknown> & { __CFX_HIST_PROFILE_LOG?: unknown };
  if (!Array.isArray(root.__CFX_HIST_PROFILE_LOG)) {
    return [];
  }
  const log = root.__CFX_HIST_PROFILE_LOG as HistogramShardSample[];
  root.__CFX_HIST_PROFILE_LOG = [];
  return log.slice();
}
