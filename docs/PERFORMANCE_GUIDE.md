# CrossfilterX Performance Guide

## The Golden Rule: Use Columnar Data

Row-based objects are slow. Every property access is a pointer dereference, 
and JavaScript engines cannot optimize iteration over heterogeneous objects.

### Slow (Row Objects)
```javascript
const data = [
  { carrier: "United", distance: 2500, delay: 15 },
  { carrier: "Delta", distance: 1200, delay: -5 },
  // ... 5 million rows
];
```
**Performance:** 250ms ingest for 1M rows

### Fast (Columnar Typed Arrays)
```javascript
const data = {
  columns: {
    carrier: new Uint16Array([0, 1, 0, 2, ...]),
    distance: new Float32Array([2500, 1200, ...]),
    delay: new Int8Array([15, -5, ...])
  },
  categories: {
    carrier: ["United", "Delta", "American"]
  },
  length: 5000000
};
```
**Performance:** 45ms ingest for 1M rows (5.5x faster!)

## Mastering High-Cardinality Strings

Dictionary encoding transforms expensive string operations into cheap integer 
comparisons. This is especially critical for dimensions with many unique values.

**IMPORTANT:** CrossfilterX uses Uint16Array for dimension storage, limiting 
each dimension to 65,535 unique values. Plan accordingly.

### Manual Dictionary Encoding
```javascript
// Transform your data once
function encodeStrings(data, field) {
  const dictionary = new Map();
  const codes = new Uint16Array(data.length);
  
  data.forEach((row, i) => {
    const value = row[field];
    if (!dictionary.has(value)) {
      if (dictionary.size >= 65535) {
        throw new Error('Exceeded 65,535 unique values');
      }
      dictionary.set(value, dictionary.size);
    }
    codes[i] = dictionary.get(value);
  });
  
  return {
    codes,
    labels: Array.from(dictionary.keys())
  };
}

// Use with CrossfilterX
const carrierEncoding = encodeStrings(flights, 'carrier');
const cf = crossfilterX({
  columns: {
    carrier: carrierEncoding.codes,
    // ... other columns
  },
  categories: {
    carrier: carrierEncoding.labels
  },
  length: flights.length
});
```

### Performance Impact
- **String comparison:** ~50 CPU cycles per operation
- **Integer comparison:** ~1 CPU cycle per operation
- **SIMD potential:** Can process 8-16 integers in parallel
- **Memory usage:** 2 bytes per row vs. 8+ bytes for string references

## Understanding the Ingest Trade-Off

CrossfilterX does more work up-front than traditional crossfilter:
- Quantizes numeric values into 16-bit bins
- Builds compressed data structures
- Allocates SharedArrayBuffers for zero-copy updates

This pays off during interaction:
- Filter updates: 2-5ms for 1M rows (vs. 50-100ms traditional)
- CSR indexes enable delta updates instead of full recomputation
- SIMD kernels process 4-8 elements per CPU cycle

### Pre-Quantization for Zero-Overhead Ingest
```javascript
// If you know your data ranges, pre-quantize:
function quantize(value, min, max, bits = 12) {
  const range = (1 << bits) - 1;
  const normalized = (value - min) / (max - min);
  return Math.round(normalized * range);
}

const distanceColumn = new Uint16Array(flights.map(f => 
  quantize(f.distance, 0, 5000, 12)
));
```

## Function Dimensions: Main Thread Warning

Function-based dimensions (e.g., `dimension(d => d.x + d.y)`) are computed 
on the main thread before being sent to the worker. For datasets > 250K rows, 
this can block the UI. Consider pre-computing derived columns.
