import type { TypedArray } from '../types';
import { quantize, type QuantizeScale } from './quantize';

export type ColumnDescriptor = {
  name: string;
  scale?: QuantizeScale;
  dictionary?: Map<string, number>;
  dictionaryFallback?: number;
  labels?: string[];
};

export function ingestRows(
  rows: Record<string, unknown>[],
  descriptors: ColumnDescriptor[],
  targets?: Uint16Array[],
  columnar?: Map<string, ColumnarSource>
) {
  const rowCount = columnar ? determineRowCount(columnar) : rows.length;
  const buffers = targets ?? descriptors.map(() => new Uint16Array(rowCount));

  if (columnar) {
    ingestColumnar(columnar, descriptors, buffers, rowCount);
    return buffers;
  }

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
    const row = rows[rowIndex];
    for (let dim = 0; dim < descriptors.length; dim++) {
      const descriptor = descriptors[dim];
      const value = row[descriptor.name];
      const buffer = buffers[dim];
      if (descriptor.scale) {
        buffer[rowIndex] = quantize(Number(value), descriptor.scale);
      } else if (descriptor.dictionary) {
        const key = value === undefined ? '' : String(value);
        const mapped = descriptor.dictionary.get(key);
        const fallback = descriptor.dictionaryFallback ?? 0;
        buffer[rowIndex] = mapped ?? fallback;
      } else {
        buffers[dim][rowIndex] = 0;
      }
    }
  }

  return buffers;
}

function determineRowCount(columnar: Map<string, ColumnarSource>) {
  const iterator = columnar.values().next();
  return iterator.done ? 0 : iterator.value.data.length;
}

function ingestColumnar(
  columnar: Map<string, ColumnarSource>,
  descriptors: ColumnDescriptor[],
  buffers: Uint16Array[],
  rowCount: number
) {
  for (let dim = 0; dim < descriptors.length; dim++) {
    const descriptor = descriptors[dim];
    const buffer = buffers[dim];
    const source = columnar.get(descriptor.name);
    if (!source) {
      buffer.fill(0);
      continue;
    }
    if (descriptor.scale) {
      for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
        buffer[rowIndex] = quantize(Number(source.data[rowIndex]), descriptor.scale);
      }
      continue;
    }
    if (descriptor.dictionary) {
      for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
        const raw = Number(source.data[rowIndex]);
        const label = descriptor.labels?.[raw] ?? String(raw);
        const mapped = descriptor.dictionary.get(label);
        const fallback = descriptor.dictionaryFallback ?? 0;
        buffer[rowIndex] = mapped ?? fallback;
      }
      continue;
    }
    buffer.fill(0);
  }
}

export type ColumnarSource = {
  data: TypedArray;
  labels?: string[];
};
