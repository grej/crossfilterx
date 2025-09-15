import { quantize, type QuantizeScale } from './quantize';

export type ColumnDescriptor = {
  name: string;
  scale?: QuantizeScale;
  dictionary?: Map<string, number>;
};

export type IngestColumn = {
  data: Uint16Array;
};

export function ingestRows(rows: Record<string, unknown>[], descriptors: ColumnDescriptor[]) {
  const rowCount = rows.length;
  const buffers = descriptors.map(() => new Uint16Array(rowCount));

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
    const row = rows[rowIndex];
    for (let dim = 0; dim < descriptors.length; dim++) {
      const descriptor = descriptors[dim];
      const value = row[descriptor.name];
      if (descriptor.scale) {
        buffers[dim][rowIndex] = quantize(Number(value), descriptor.scale);
      } else if (descriptor.dictionary) {
        const key = String(value);
        const mapped = descriptor.dictionary.get(key);
        buffers[dim][rowIndex] = mapped ?? 0;
      } else {
        buffers[dim][rowIndex] = 0;
      }
    }
  }

  return buffers;
}
