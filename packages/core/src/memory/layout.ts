export type HistogramView = {
  front: Uint32Array;
  back: Uint32Array;
};

export type BufferLayout = {
  buffer: SharedArrayBuffer | ArrayBuffer;
  columns: Uint16Array[];
  refcount: Uint32Array;
  activeMask: Uint8Array;
  histograms: HistogramView[];
  coarseHistograms: HistogramView[];
  byteLength: number;
};

export type LayoutPlan = {
  rowCount: number;
  dimensions: Array<{ bins: number; coarseTargetBins?: number }>;
};

export function createLayout(plan: LayoutPlan): BufferLayout {
  const { rowCount, dimensions } = plan;
  if (rowCount === 0 || dimensions.length === 0) {
    return {
      buffer: new ArrayBuffer(0),
      columns: dimensions.map(() => new Uint16Array(0)),
      refcount: new Uint32Array(0),
      activeMask: new Uint8Array(0),
      histograms: dimensions.map(() => ({ front: new Uint32Array(0), back: new Uint32Array(0) })),
      coarseHistograms: dimensions.map(() => ({ front: new Uint32Array(0), back: new Uint32Array(0) })),
      byteLength: 0
    };
  }

  const allocator = new BufferAllocator();
  const columnBytes = rowCount * 2;
  const refcountBytes = rowCount * 4;
  const maskBytes = Math.ceil(rowCount / 8);

  let offset = 0;
  const columnOffsets = dimensions.map(() => {
    offset = allocator.align(offset);
    const start = offset;
    offset += columnBytes;
    return start;
  });

  offset = allocator.align(offset);
  const refcountOffset = offset;
  offset += refcountBytes;

  offset = allocator.align(offset);
  const maskOffset = offset;
  offset += maskBytes;

  const histogramOffsets = dimensions.map((dim) => {
    offset = allocator.align(offset);
    const front = offset;
    offset += dim.bins * 4;

    // NEW: Coarse histogram allocation
    let coarseFront: number | undefined;
    let coarseBins: number | undefined;
    if (dim.coarseTargetBins) {
      coarseBins = Math.min(dim.coarseTargetBins, dim.bins);
      coarseFront = offset;
      offset += coarseBins * 4;
    }

    // Back buffers (same pattern)
    offset = allocator.align(offset);
    const back = offset;
    offset += dim.bins * 4;

    let coarseBack: number | undefined;
    if (dim.coarseTargetBins) {
      coarseBack = offset;
      offset += coarseBins! * 4;
    }

    return {
      front,
      back,
      bins: dim.bins,
      coarseFront,
      coarseBack,
      coarseBins
    };
  });

  const totalBytes = allocator.align(offset);
  const buffer = supportsSharedArrayBuffer()
    ? new SharedArrayBuffer(totalBytes)
    : new ArrayBuffer(totalBytes);

  const columns = columnOffsets.map((start) => new Uint16Array(buffer, start, rowCount));
  const refcount = new Uint32Array(buffer, refcountOffset, rowCount);
  const activeMask = new Uint8Array(buffer, maskOffset, maskBytes);
  const histograms: HistogramView[] = histogramOffsets.map(({ front, back, bins }) => ({
    front: new Uint32Array(buffer, front, bins),
    back: new Uint32Array(buffer, back, bins)
  }));
  const coarseHistograms: HistogramView[] = histogramOffsets.map(
    ({ coarseFront, coarseBack, coarseBins }) => {
      if (coarseFront && coarseBack && coarseBins) {
        return {
          front: new Uint32Array(buffer, coarseFront, coarseBins),
          back: new Uint32Array(buffer, coarseBack, coarseBins)
        };
      }
      return { front: new Uint32Array(0), back: new Uint32Array(0) };
    }
  );

  return {
    buffer,
    columns,
    refcount,
    activeMask,
    histograms,
    coarseHistograms,
    byteLength: totalBytes
  };
}

class BufferAllocator {
  align(value: number, alignment = 8) {
    const remainder = value % alignment;
    return remainder === 0 ? value : value + (alignment - remainder);
  }
}

function supportsSharedArrayBuffer(): boolean {
  return typeof SharedArrayBuffer === 'function';
}
