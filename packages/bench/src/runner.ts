/**
 * @fileoverview Implements the default CLI benchmark harness. It prepares
 *   synthetic datasets, drives the CrossfilterX worker end-to-end (ingest →
 *   filter → clear), and emits structured metrics consumed by the automation
 *   scripts. The module depends on dataset builders from `datasets.ts` and the
 *   compiled core bundle under `packages/core/dist`. Downstream tooling such as
 *   `scripts/run-bench-suite.mjs` imports the generated JavaScript to automate
 *   regression checks.
 */

/* eslint-disable import/no-unresolved */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { buildUniformColumnar, buildUniformRows } from './datasets.js';
import type { ClearPlannerSnapshot } from '../../core/src/worker/clear-planner.js';

const env = ((globalThis as unknown as { process?: { env?: Record<string, string> } }).process?.env ?? {}) as Record<string, string>;
const ROWS = Number(env.BENCH_ROWS ?? '100000');
const DIMS = Number(env.BENCH_DIMS ?? '6');
const RANGE_MIN = Number(env.BENCH_MIN ?? '0');
const RANGE_MAX = Number(env.BENCH_MAX ?? '1000');
const RANGE_FRACTION_LO = clampFraction(Number(env.BENCH_LO_FRACTION ?? '0.25'));
const RANGE_FRACTION_HI = clampFraction(Number(env.BENCH_HI_FRACTION ?? '0.75'));
const PROFILE_CLEAR = env.BENCH_PROFILE_CLEAR === '1';
const COLUMNAR_MODE = env.BENCH_COLUMNAR === '1';
const HISTOGRAM_MODE = env.BENCH_HIST_MODE;
const SCENARIO = (env.BENCH_SCENARIO ?? 'single') as 'single' | 'multi';
const OUTPUT_PATH = env.BENCH_OUTPUT;
const PROFILE_SHARD = env.BENCH_PROFILE_SHARD === '1';

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
const core = (await import('../../core/dist/index.js')) as typeof import('../../core/src/index');
const { crossfilterX } = core;
// @ts-expect-error dist bundle omits type metadata; treat as untyped.
const simdModule = (await import('../../core/dist/wasm/simd.js')) as Record<string, unknown>;
const waitForWasmReady =
  typeof (simdModule as { waitForWasmReady?: () => Promise<unknown> }).waitForWasmReady === 'function'
    ? ((simdModule as { waitForWasmReady: () => Promise<unknown> }).waitForWasmReady)
    : null;

type SingleScenarioResult = {
  scenario: 'single';
  rows: number;
  dimensions: number;
  range: { min: number; max: number };
  filterFractions: { lo: number; hi: number };
  columnar: boolean;
  ingestMs: number;
  index: { ms: number; bytes: number };
  filter: { ms: number; activeCount: number };
  clearMs: number;
  clearActiveCount: number;
  profile: unknown;
  shardProfile?: HistogramShardSample[];
  plannerSnapshot?: ClearPlannerSnapshot;
  timestamp: string;
};

type MultiScenarioResult = {
  scenario: 'multi';
  rows: number;
  dimensions: number;
  columnar: boolean;
  range: { min: number; max: number };
  ingestMs: number;
  filterFractions: Array<{ dim: string; lo: number; hi: number; bins: [number, number] }>;
  index: Array<{ dim: string; ms: number; bytes: number }>;
  filters: Array<{ dim: string; ms: number; activeCount: number; shardProfile?: HistogramShardSample[] }>;
  clears: Array<{ dim: string; ms: number; activeCount: number; profile: unknown; shardProfile?: HistogramShardSample[] }>;
  shardSummary?: HistogramShardSummary;
  plannerSnapshot?: ClearPlannerSnapshot;
  timestamp: string;
};

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

type HistogramShardSummary = {
  totalFlushes: number;
  totalEvictions: number;
  totalBins: number;
  totalRows: number;
  perDimension: Array<{
    dim: string;
    flushes: number;
    evictions: number;
    bins: number;
    rows: number;
  }>;
};

type ScenarioContext = {
  cf: ReturnType<typeof crossfilterX>;
  ingestMs: number;
};

type BaseMetadata = {
  rows: number;
  dimensions: number;
  rangeMin: number;
  rangeMax: number;
  columnar: boolean;
};

async function main() {
  if (PROFILE_CLEAR) {
    (globalThis as unknown as { __CFX_PROFILE_CLEAR?: boolean }).__CFX_PROFILE_CLEAR = true;
  }
  if (HISTOGRAM_MODE) {
    (globalThis as Record<string, unknown>).__CFX_HIST_MODE = HISTOGRAM_MODE;
  }
  if (PROFILE_SHARD) {
    (globalThis as Record<string, unknown>).__CFX_PROFILE_SHARDS = true;
    if (waitForWasmReady) {
      await waitForWasmReady();
    }
  } else if (HISTOGRAM_MODE === 'simd' && waitForWasmReady) {
    await waitForWasmReady();
  }

  console.log(
    `Generating dataset rows=${ROWS} dims=${DIMS} mode=${COLUMNAR_MODE ? 'columnar' : 'rows'} scenario=${SCENARIO}`
  );
  const dataset = COLUMNAR_MODE
    ? buildUniformColumnar({ rows: ROWS, dimensions: DIMS, min: RANGE_MIN, max: RANGE_MAX })
    : buildUniformRows({ rows: ROWS, dimensions: DIMS, min: RANGE_MIN, max: RANGE_MAX });

  const ingestStart = perfNow();
  const cf = crossfilterX(dataset, { bins: 4096 });
  await cf.whenIdle();
  const ingestMs = perfNow() - ingestStart;
  console.log(`Ingest: ${ingestMs.toFixed(2)} ms`);

  const context: ScenarioContext = { cf, ingestMs };
  const metadata: BaseMetadata = {
    rows: ROWS,
    dimensions: DIMS,
    rangeMin: RANGE_MIN,
    rangeMax: RANGE_MAX,
    columnar: COLUMNAR_MODE
  };

  let results: SingleScenarioResult | MultiScenarioResult;
  if (SCENARIO === 'multi') {
    results = await runMultiScenario(context, metadata);
  } else {
    results = await runSingleScenario(context, metadata);
  }

  cf.dispose();

  if (OUTPUT_PATH) {
    await mkdir(dirname(OUTPUT_PATH), { recursive: true });
    await writeFile(OUTPUT_PATH, JSON.stringify(results, null, 2));
    console.log(`Wrote results to ${OUTPUT_PATH}`);
  }

  if (HISTOGRAM_MODE) {
    delete (globalThis as Record<string, unknown>).__CFX_HIST_MODE;
  }
  if (PROFILE_CLEAR) {
    delete (globalThis as Record<string, unknown>).__CFX_PROFILE_CLEAR;
  }
  if (PROFILE_SHARD) {
    delete (globalThis as Record<string, unknown>).__CFX_PROFILE_SHARDS;
    delete (globalThis as Record<string, unknown>).__CFX_HIST_PROFILE_LOG;
    delete (globalThis as Record<string, unknown>).__CFX_SHARD_PROFILED;
    delete (globalThis as Record<string, unknown>).__CFX_SHARD_SKIPPED;
    delete (globalThis as Record<string, unknown>).__CFX_SIMD_CREATED;
    delete (globalThis as Record<string, unknown>).__CFX_WASM_PROMISE;
    delete (globalThis as Record<string, unknown>).__CFX_WASM_USED;
  }
}

void main().catch((error) => {
  console.error('Benchmark failed', error);
  const proc = (globalThis as unknown as { process?: { exitCode?: number } }).process;
  if (proc) proc.exitCode = 1;
});

async function runSingleScenario(
  context: ScenarioContext,
  metadata: BaseMetadata
): Promise<SingleScenarioResult> {
  const { cf, ingestMs } = context;
  const { rows, dimensions, rangeMin, rangeMax, columnar } = metadata;

  const dimName = 'dim0';
  const loFraction = Math.min(RANGE_FRACTION_LO, RANGE_FRACTION_HI);
  const hiFraction = Math.max(RANGE_FRACTION_LO, RANGE_FRACTION_HI);
  const loValue = rangeMin + (rangeMax - rangeMin) * loFraction;
  const hiValue = rangeMin + (rangeMax - rangeMin) * hiFraction;
  const loBin = quantize(loValue, rangeMin, rangeMax, 12);
  const hiBin = quantize(hiValue, rangeMin, rangeMax, 12);

  const buildStart = perfNow();
  await cf.buildIndex(dimName);
  const buildMs = perfNow() - buildStart;
  const buildStatus = cf.indexStatus(dimName);
  console.log(`Index build: ${buildMs.toFixed(2)} ms (${buildStatus?.bytes ?? 0} bytes)`);

  const filterStart = perfNow();
  cf.dimension(dimName).filter([loBin, hiBin]);
  await cf.whenIdle();
  const filterMs = perfNow() - filterStart;
  const activeCount = cf.group(dimName).count();
  console.log(`Filter: ${filterMs.toFixed(2)} ms, active=${activeCount}`);

  const clearStart = perfNow();
  cf.dimension(dimName).clear();
  await cf.whenIdle();
  const clearMs = perfNow() - clearStart;
  const clearActiveCount = cf.group(dimName).count();
  console.log(`Clear: ${clearMs.toFixed(2)} ms`);
  const profileSnapshot = typeof cf.profile === 'function' ? cf.profile() : null;
  const shardProfile = PROFILE_SHARD ? consumeShardProfile() : undefined;

  return {
    scenario: 'single',
    rows,
    dimensions,
    range: { min: rangeMin, max: rangeMax },
    filterFractions: { lo: loFraction, hi: hiFraction },
    columnar,
    ingestMs,
    index: { ms: buildMs, bytes: buildStatus?.bytes ?? 0 },
    filter: { ms: filterMs, activeCount },
    clearMs,
    clearActiveCount,
    profile: profileSnapshot,
    shardProfile,
    plannerSnapshot: typeof cf.clearPlannerSnapshot === 'function' ? cf.clearPlannerSnapshot() : undefined,
    timestamp: new Date().toISOString()
  };
}

async function runMultiScenario(
  context: ScenarioContext,
  metadata: BaseMetadata
): Promise<MultiScenarioResult> {
  const { cf, ingestMs } = context;
  const { rows, dimensions, rangeMin, rangeMax, columnar } = metadata;
  const dimensionCount = Math.min(dimensions, MULTI_FILTERS.length);
  const targets = Array.from({ length: dimensionCount }, (_, index) => `dim${index}`);

  const indexStats: Array<{ dim: string; ms: number; bytes: number }> = [];
  for (const dimName of targets) {
    const buildStart = perfNow();
    await cf.buildIndex(dimName);
    const buildMs = perfNow() - buildStart;
    const status = cf.indexStatus(dimName);
    indexStats.push({ dim: dimName, ms: buildMs, bytes: status?.bytes ?? 0 });
  }

  const filterSnapshots: Array<{ dim: string; ms: number; activeCount: number; shardProfile?: HistogramShardSample[] }> = [];
  const clearSnapshots: Array<{ dim: string; ms: number; activeCount: number; profile: unknown; shardProfile?: HistogramShardSample[] }> = [];
  const binRanges: Array<{ dim: string; lo: number; hi: number; bins: [number, number] }> = [];

  for (let idx = 0; idx < targets.length; idx++) {
    const dimName = targets[idx];
    const fractions = MULTI_FILTERS[idx];
    const loBin = quantize(rangeMin + (rangeMax - rangeMin) * fractions.lo, rangeMin, rangeMax, 12);
    const hiBin = quantize(rangeMin + (rangeMax - rangeMin) * fractions.hi, rangeMin, rangeMax, 12);
    const filterStart = perfNow();
    cf.dimension(dimName).filter([loBin, hiBin]);
    await cf.whenIdle();
    const filterMs = perfNow() - filterStart;
    const activeCount = cf.group(dimName).count();
    console.log(`Filter dim=${dimName} ms=${filterMs.toFixed(2)} active=${activeCount}`);
    const shardProfile = PROFILE_SHARD ? consumeShardProfile() : undefined;
    filterSnapshots.push({ dim: dimName, ms: filterMs, activeCount, shardProfile });
    binRanges.push({ dim: dimName, lo: fractions.lo, hi: fractions.hi, bins: [loBin, hiBin] });
  }

  for (let idx = targets.length - 1; idx >= 0; idx--) {
    const dimName = targets[idx];
    const clearStart = perfNow();
    cf.dimension(dimName).clear();
    await cf.whenIdle();
    const clearMs = perfNow() - clearStart;
    const activeCount = cf.group(dimName).count();
    const profileSnapshot = typeof cf.profile === 'function' ? cf.profile()?.clear ?? null : null;
    console.log(`Clear dim=${dimName} ms=${clearMs.toFixed(2)} active=${activeCount}`);
    const shardProfile = PROFILE_SHARD ? consumeShardProfile() : undefined;
    clearSnapshots.push({ dim: dimName, ms: clearMs, activeCount, profile: profileSnapshot, shardProfile });
  }

  clearSnapshots.reverse();

  const shardSummary = PROFILE_SHARD ? summarizeShardProfiles(clearSnapshots) : undefined;

  return {
    scenario: 'multi',
    rows,
    dimensions,
    columnar,
    range: { min: rangeMin, max: rangeMax },
    ingestMs,
    filterFractions: binRanges,
    index: indexStats,
    filters: filterSnapshots,
    clears: clearSnapshots,
    shardSummary,
    plannerSnapshot: typeof cf.clearPlannerSnapshot === 'function' ? cf.clearPlannerSnapshot() : undefined,
    timestamp: new Date().toISOString()
  };
}

const MULTI_FILTERS: Array<{ lo: number; hi: number }> = [
  { lo: 0.15, hi: 0.85 },
  { lo: 0.3, hi: 0.65 },
  { lo: 0.45, hi: 0.75 }
];

function quantize(value: number, min: number, max: number, bits: number) {
  if (max <= min) return 0;
  const range = (1 << bits) - 1;
  const clamped = Math.min(Math.max(value, min), max);
  const normalized = (clamped - min) / (max - min);
  return Math.round(normalized * range);
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

function summarizeShardProfiles(
  snapshots: Array<{ dim: string; shardProfile?: HistogramShardSample[] }>
): HistogramShardSummary {
  let totalFlushes = 0;
  let totalEvictions = 0;
  let totalBins = 0;
  let totalRows = 0;
  const perDimension = new Map<string, { flushes: number; evictions: number; bins: number; rows: number }>();

  for (const snapshot of snapshots) {
    const { dim, shardProfile } = snapshot;
    if (!shardProfile) continue;
    const aggregate = perDimension.get(dim) ?? { flushes: 0, evictions: 0, bins: 0, rows: 0 };
    for (const entry of shardProfile) {
      const metrics = entry.metrics;
      if (!metrics) continue;
      aggregate.flushes += metrics.flushes;
      aggregate.evictions += metrics.evictions;
      aggregate.bins += metrics.bins;
      aggregate.rows += metrics.rows;
      totalFlushes += metrics.flushes;
      totalEvictions += metrics.evictions;
      totalBins += metrics.bins;
      totalRows += metrics.rows;
    }
    perDimension.set(dim, aggregate);
  }

  return {
    totalFlushes,
    totalEvictions,
    totalBins,
    totalRows,
    perDimension: Array.from(perDimension.entries()).map(([dim, agg]) => ({
      dim,
      flushes: agg.flushes,
      evictions: agg.evictions,
      bins: agg.bins,
      rows: agg.rows
    }))
  };
}
