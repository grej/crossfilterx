export type MsgToWorker =
  | { t: 'INGEST'; schema: DimSpec[]; rows: ArrayBuffer | unknown[] }
  | { t: 'BUILD_INDEX'; dimId: number }
  | { t: 'FILTER_SET'; dimId: number; lo: number; hi: number; seq: number }
  | { t: 'FILTER_CLEAR'; dimId: number; seq: number }
  | { t: 'ESTIMATE'; dimId: number; lo: number; hi: number }
  | { t: 'SWAP' };

export type MsgFromWorker =
  | { t: 'READY'; n: number; dims: DimMeta[] }
  | { t: 'INDEX_BUILT'; dimId: number; ms: number; bytes: number }
  | { t: 'FRAME'; seq: number; activeCount: number; groups: GroupSnapshot[] }
  | { t: 'PROGRESS'; phase: string; done: number; total: number }
  | { t: 'ERROR'; message: string };

export type DimSpec = {
  name: string;
  type: 'number' | 'string';
  bits: number;
};

export type DimMeta = {
  name: string;
  bins: number;
};

export type GroupSnapshot = {
  id: number;
  bins: ArrayBuffer;
  count: number;
};

import { ingestRows, type ColumnDescriptor } from './memory/ingest';
import { buildHistogram } from './reduce/histogram';

type EngineState = {
  rowCount: number;
  dims: DimSpec[];
  descriptors: ColumnDescriptor[];
  columns: Uint16Array[];
  histograms: Uint32Array[];
  activeCount: number;
};

export function createProtocol(post: (message: MsgFromWorker) => void) {
  const state: EngineState = {
    rowCount: 0,
    dims: [],
    descriptors: [],
    columns: [],
    histograms: [],
    activeCount: 0
  };

  return {
    handleMessage(message: MsgToWorker) {
      switch (message.t) {
        case 'INGEST':
          handleIngest(message, state, post);
          break;
        case 'BUILD_INDEX':
          break;
        case 'FILTER_SET':
          handleFrame(message.seq, state, post);
          break;
        case 'FILTER_CLEAR':
          handleFrame(message.seq, state, post);
          break;
        case 'ESTIMATE':
        case 'SWAP':
          // TODO: implement worker handlers
          break;
        default:
          exhaustive(message);
      }
    }
  };
}

function handleIngest(
  msg: Extract<MsgToWorker, { t: 'INGEST' }>,
  state: EngineState,
  post: (message: MsgFromWorker) => void
) {
  const rows = Array.isArray(msg.rows) ? (msg.rows as Record<string, unknown>[]) : [];
  const descriptors = buildDescriptors(msg.schema, rows);
  const columns = ingestRows(rows, descriptors);
  const histograms = columns.map((column, index) =>
    buildHistogram(column, resolveBinCount(msg.schema[index]))
  );

  state.rowCount = rows.length;
  state.dims = msg.schema;
  state.descriptors = descriptors;
  state.columns = columns;
  state.histograms = histograms;
  state.activeCount = rows.length;

  post({
    t: 'READY',
    n: state.rowCount,
    dims: msg.schema.map((dim) => ({
      name: dim.name,
      bins: resolveBinCount(dim)
    }))
  });
  handleFrame(0, state, post);
}

function handleFrame(seq: number, state: EngineState, post: (message: MsgFromWorker) => void) {
  post({
    t: 'FRAME',
    seq,
    activeCount: state.activeCount,
    groups: state.histograms.map((histogram, id) => ({
      id,
      bins: histogram.slice().buffer,
      count: state.activeCount
    }))
  });
}

function exhaustive(value: never): never {
  throw new Error(`Unhandled message type: ${JSON.stringify(value)}`);
}

function buildDescriptors(schema: DimSpec[], rows: Record<string, unknown>[]) {
  return schema.map<ColumnDescriptor>((dim) => {
    const bins = resolveBinCount(dim);
    if (dim.type === 'number') {
      return {
        name: dim.name,
        scale: computeScale(rows, dim.name, bins)
      };
    }
    return {
      name: dim.name,
      dictionary: buildDictionary(rows, dim.name, bins)
    };
  });
}

function computeScale(rows: Record<string, unknown>[], key: string, bins: number) {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    const value = Number(row[key]);
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    min = 0;
    max = bins;
  }
  return { min, max, bits: Math.ceil(Math.log2(bins)) };
}

function buildDictionary(rows: Record<string, unknown>[], key: string, bins: number) {
  const limit = Math.max(1, bins);
  const map = new Map<string, number>();
  let next = 0;
  for (const row of rows) {
    const raw = row[key];
    const value = raw === undefined ? '' : String(raw);
    if (map.has(value)) continue;
    if (next >= limit) {
      map.set(value, limit - 1);
    } else {
      map.set(value, next++);
    }
  }
  return map;
}

function resolveBinCount(dim: DimSpec) {
  return Math.max(1, 1 << Math.min(dim.bits, 16));
}
