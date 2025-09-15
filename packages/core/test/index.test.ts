import { describe, expect, it } from 'vitest';
import { buildCsr } from '../src/indexers/csr';

describe('buildCsr', () => {
  it('groups rows by bin', () => {
    const column = new Uint16Array([0, 1, 0, 2]);
    const csr = buildCsr(column, 3);
    expect(Array.from(csr.binOffsets)).toEqual([0, 2, 3, 4]);
    expect(Array.from(csr.rowIdsByBin)).toEqual([0, 2, 1, 3]);
  });
});
