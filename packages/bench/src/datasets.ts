export type DatasetConfig = {
  rows: number;
  dimensions: number;
  bits: number;
};

export function buildUniformDataset(config: DatasetConfig) {
  const { rows, dimensions, bits } = config;
  const max = 1 << bits;
  const data: number[][] = new Array(dimensions);
  for (let dim = 0; dim < dimensions; dim++) {
    const column = new Array<number>(rows);
    for (let row = 0; row < rows; row++) {
      column[row] = Math.floor(Math.random() * max);
    }
    data[dim] = column;
  }
  return data;
}
