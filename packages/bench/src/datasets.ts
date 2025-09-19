export type DatasetConfig = {
  rows: number;
  dimensions: number;
  min?: number;
  max?: number;
};

export function buildUniformRows(config: DatasetConfig) {
  const { rows, dimensions } = config;
  const min = config.min ?? 0;
  const max = config.max ?? 1_000;
  const span = max - min;

  const output: Record<string, number>[] = new Array(rows);
  for (let row = 0; row < rows; row++) {
    const entry: Record<string, number> = {};
    for (let dim = 0; dim < dimensions; dim++) {
      entry[`dim${dim}`] = min + Math.random() * span;
    }
    output[row] = entry;
  }
  return output;
}

export function buildUniformColumnar(config: DatasetConfig) {
  const { rows, dimensions } = config;
  const min = config.min ?? 0;
  const max = config.max ?? 1_000;
  const span = max - min;

  const columns: Record<string, Float32Array> = {};
  for (let dim = 0; dim < dimensions; dim++) {
    const values = new Float32Array(rows);
    for (let row = 0; row < rows; row++) {
      values[row] = min + Math.random() * span;
    }
    columns[`dim${dim}`] = values;
  }
  return { columns, length: rows };
}
