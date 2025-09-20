/**
 * @fileoverview Provides the high-level ingest routine used by the worker. It
 * accepts the schema description, either row-oriented or columnar payloads, and
 * produces the fully-populated layout + typed column views expected by the core
 * engine. Keeping this logic in one place makes the protocol handler easier to
 * follow and allows us to unit test the descriptor / dictionary logic in
 * isolation.
 */

import type { ColumnDescriptor, ColumnarSource } from '../memory/ingest';
import { ingestRows } from '../memory/ingest';
import { createLayout } from '../memory/layout';
import type { TypedArray } from '../types';

export type ColumnarPayload = {
  kind: 'columnar';
  rowCount: number;
  columns: Array<{ name: string; data: TypedArray }>;
  categories?: Array<{ name: string; labels: string[] }>;
};

export type ColumnarSources = Map<string, ColumnarSource>;

export type IngestDimSpec = {
  name: string;
  type: 'number' | 'string';
  bits: number;
  coarseTargetBins?: number;
};

export type IngestDatasetArgs = {
  schema: IngestDimSpec[];
  rows: Record<string, unknown>[];
  columnarPayload?: ColumnarPayload | null;
  valueColumnNames?: string[];
};

export type IngestDatasetResult = {
  rowCount: number;
  descriptors: ColumnDescriptor[];
  layout: ReturnType<typeof createLayout>;
  columns: Uint16Array[];
  columnarSources?: ColumnarSources;
  binsPerDimension: number[];
  valueColumns?: Map<string, Float32Array>;
};

export function ingestDataset(args: IngestDatasetArgs): IngestDatasetResult {
  const { schema, rows } = args;
  const columnarSources = args.columnarPayload ? buildColumnarSources(args.columnarPayload) : undefined;
  const rowCount = args.columnarPayload ? args.columnarPayload.rowCount : rows.length;
  const binsPerDimension = schema.map(binsForSpec);
  const descriptors = buildDescriptors(schema, rows, columnarSources);
  const layout = createLayout({
    rowCount,
    dimensions: schema.map((s, i) => ({ bins: binsPerDimension[i], coarseTargetBins: s.coarseTargetBins }))
  });
  const columns = ingestRows(rows, descriptors, layout.columns, columnarSources);

  checkPerformanceWarnings(descriptors, rowCount, !!columnarSources);

  // NEW: Store value columns without quantization
  const valueColumns = new Map<string, Float32Array>();

  if (args.valueColumnNames) {
    for (const colName of args.valueColumnNames) {
      const values = new Float32Array(rowCount);

      if (columnarSources) {
        // Direct copy from typed array
        const source = columnarSources.get(colName);
        if (source) values.set(source.data);
      } else {
        // Extract from row objects
        for (let i = 0; i < rowCount; i++) {
          values[i] = Number(rows[i][colName]) || 0;
        }
      }

      valueColumns.set(colName, values);
    }
  }

  return {
    rowCount,
    descriptors,
    layout,
    columns,
    columnarSources,
    binsPerDimension,
    valueColumns
  };
}

function buildColumnarSources(payload: ColumnarPayload): ColumnarSources {
  const map = new Map<string, ColumnarSource>();
  const categoryLookup = new Map<string, string[]>();
  if (payload.categories) {
    for (const entry of payload.categories) {
      categoryLookup.set(entry.name, entry.labels);
    }
  }
  for (const column of payload.columns) {
    if (column.data.length !== payload.rowCount) {
      throw new Error(`Column "${column.name}" length mismatch (expected ${payload.rowCount}, got ${column.data.length}).`);
    }
    const labels = categoryLookup.get(column.name);
    map.set(column.name, { data: column.data, labels });
  }
  return map;
}

function buildDescriptors(
  schema: IngestDimSpec[],
  rows: Record<string, unknown>[],
  columnar?: ColumnarSources
): ColumnDescriptor[] {
  const dimensionCount = schema.length;
  const binCounts = schema.map(binsForSpec);
  const descriptors: ColumnDescriptor[] = new Array(dimensionCount);

  const minValues = new Array<number>(dimensionCount).fill(Number.POSITIVE_INFINITY);
  const maxValues = new Array<number>(dimensionCount).fill(Number.NEGATIVE_INFINITY);
  const dictionaries = new Array<Map<string, number> | undefined>(dimensionCount);
  const nextCodes = new Array<number>(dimensionCount).fill(0);
  const fallbackBins = new Array<number>(dimensionCount).fill(0);

  const numericDims: number[] = [];
  const stringDims: number[] = [];

  for (let dim = 0; dim < dimensionCount; dim++) {
    const spec = schema[dim];
    if (spec.type === 'number') {
      numericDims.push(dim);
    } else {
      stringDims.push(dim);
      dictionaries[dim] = new Map<string, number>();
      const bins = binCounts[dim];
      fallbackBins[dim] = bins > 0 ? bins - 1 : 0;
    }
  }

  if (columnar) {
    for (const dim of numericDims) {
      const source = columnar.get(schema[dim].name);
      if (!source) continue;
      const data = source.data;
      for (let i = 0; i < data.length; i++) {
        const value = Number(data[i]);
        if (!Number.isFinite(value)) continue;
        if (value < minValues[dim]) minValues[dim] = value;
        if (value > maxValues[dim]) maxValues[dim] = value;
      }
    }
    for (const dim of stringDims) {
      const source = columnar.get(schema[dim].name);
      const labels = source?.labels;
      if (!labels) {
        throw new Error(`Columnar dataset missing categories for dimension "${schema[dim].name}".`);
      }
      const dictionary = dictionaries[dim] ?? new Map<string, number>();
      dictionaries[dim] = dictionary;
      for (let idx = 0; idx < labels.length; idx++) {
        dictionary.set(labels[idx], idx);
      }
      fallbackBins[dim] = labels.length > 0 ? labels.length - 1 : 0;
    }
  } else {
    for (const row of rows) {
      for (const dim of numericDims) {
        const value = Number(row[schema[dim].name]);
        if (!Number.isFinite(value)) continue;
        if (value < minValues[dim]) minValues[dim] = value;
        if (value > maxValues[dim]) maxValues[dim] = value;
      }
      for (const dim of stringDims) {
        const raw = row[schema[dim].name];
        const key = raw === undefined ? '' : String(raw);
        const dictionary = dictionaries[dim]!;
        if (dictionary.has(key)) continue;
        const limit = binCounts[dim];
        const next = nextCodes[dim];
        if (next < limit) {
          dictionary.set(key, next);
          nextCodes[dim] = next + 1;
        } else {
          dictionary.set(key, fallbackBins[dim]);
        }
      }
    }
  }

  for (let dim = 0; dim < dimensionCount; dim++) {
    const spec = schema[dim];
    const bins = binCounts[dim];
    const bits = Math.ceil(Math.log2(Math.max(bins, 1)));
    if (spec.type === 'number') {
      let min = minValues[dim];
      let max = maxValues[dim];
      if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
        min = 0;
        max = bins;
      }
      const range = (1 << bits) - 1;
      const span = max - min;
      const safeSpan = span > 0 && Number.isFinite(span) ? span : 1;
      const invSpan = range / safeSpan;
      descriptors[dim] = {
        name: spec.name,
        scale: { min, max, bits, range, invSpan }
      };
    } else {
      const dictionary = dictionaries[dim] ?? new Map<string, number>();
      descriptors[dim] = {
        name: spec.name,
        dictionary,
        dictionaryFallback: fallbackBins[dim]
      };
      if (columnar) {
        const labels = columnar.get(spec.name)?.labels;
        if (labels) descriptors[dim].labels = labels;
      }
    }
  }

  return descriptors;
}

export function binsForSpec(spec: IngestDimSpec) {
  const clampedBits = Math.max(1, Math.min(16, spec.bits));
  return 1 << clampedBits;
}

function checkPerformanceWarnings(
  descriptors: ColumnDescriptor[],
  rowCount: number,
  isColumnarData: boolean
): void {
  for (const desc of descriptors) {
    if (desc.dictionary && desc.dictionary.size > 10000) {
      console.warn(
        `[CrossfilterX] Dimension '${desc.name}' has ${desc.dictionary.size} ` +
          `unique values (high cardinality). For better performance, consider ` +
          `providing pre-encoded columnar data with a categories map. ` +
          `See: https://github.com/crossfilterx/crossfilterx/blob/main/docs/PERFORMANCE_GUIDE.md`
      );
    }
  }

  if (rowCount > 100000 && !isColumnarData) {
    console.warn(
      `[CrossfilterX] Processing ${rowCount} rows as objects. ` +
        `Columnar format would be 3-5x faster for datasets of this size.`
    );
  }
}
