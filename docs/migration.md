# Migration Guide: crossfilter2 → CrossfilterX

This guide helps you migrate from crossfilter2 to CrossfilterX.

## Key Differences

### 1. Async Operations

**crossfilter2**: Synchronous
```javascript
const cf = crossfilter(data);
const dim = cf.dimension(d => d.distance);
dim.filter([100, 500]);
const results = dim.top(10); // Immediate
```

**CrossfilterX**: Async (WebWorker-based)
```typescript
const cf = crossfilterX(data);
const dim = cf.dimension('distance');
dim.filter([100, 500]);
await cf.whenIdle(); // Wait for worker
const bins = group.bins(); // Get histogram
```

### 2. Dimension Access

**crossfilter2**: Function-based accessors
```javascript
cf.dimension(d => d.distance)
cf.dimension(d => d.date.getTime())
```

**CrossfilterX**: String-based field names
```typescript
cf.dimension('distance')
cf.dimension('timestamp')
```

### 3. Groups and Reduce

**crossfilter2**: Custom reduce functions
```javascript
const group = dim.group();
group.reduce(
  (p, v) => p + v.value, // add
  (p, v) => p - v.value, // remove
  () => 0                // init
);
const results = group.all();
```

**CrossfilterX**: Histogram bins
```typescript
const group = cf.group('distance');
await cf.whenIdle();
const bins = group.bins(); // Uint32Array of counts
```

### 4. Filtering

**crossfilter2**: Value-based filtering
```javascript
dim.filter([100, 500]); // Values
dim.filterExact(100);
dim.filterRange([100, 500]);
dim.filterFunction(d => d > 100);
```

**CrossfilterX**: Bin-based filtering
```typescript
// Convert value to bin index first
const minBin = valueToBin(100, scale, bins);
const maxBin = valueToBin(500, scale, bins);
dim.filter([minBin, maxBin]);
await cf.whenIdle();
```

### 5. Top/Bottom Records

**crossfilter2**: Direct access
```javascript
dim.top(10); // Top 10 records
dim.bottom(10); // Bottom 10 records
```

**CrossfilterX**: Not yet implemented
```typescript
// Workaround: Filter and iterate bins to estimate
// Or keep a separate copy of data and filter client-side
```

## Feature Parity Matrix

| Feature | crossfilter2 | CrossfilterX | Notes |
|---------|-------------|--------------|-------|
| Basic filtering | ✅ | ✅ | Bin-based in CrossfilterX |
| Multiple dimensions | ✅ | ✅ | |
| Groups/Aggregation | ✅ | ✅ | Histogram bins only |
| Custom reduce | ✅ | ❌ | Use histogram bins |
| top()/bottom() | ✅ | ❌ | Planned |
| filterAll() | ✅ | ✅ | Called `clear()` |
| filterExact() | ✅ | ❌ | Use range filter |
| filterRange() | ✅ | ✅ | |
| filterFunction() | ✅ | ❌ | Not supported |
| Async support | ❌ | ✅ | WebWorker-based |
| SIMD acceleration | ❌ | ✅ | Via WebAssembly |
| Columnar data | ❌ | ✅ | 27% faster |
| TypeScript | ⚠️ | ✅ | Native support |

## Migration Examples

### Example 1: Simple Filtering

**Before (crossfilter2)**
```javascript
const cf = crossfilter(flights);
const distDim = cf.dimension(d => d.distance);
distDim.filterRange([500, 1000]);
const count = cf.groupAll().reduceCount().value();
console.log(`Matching: ${count}`);
```

**After (CrossfilterX)**
```typescript
const cf = crossfilterX(flights, { bins: 1024 });
const distDim = cf.dimension('distance');
const group = cf.group('distance');

// Convert values to bins
const minBin = valueToBin(500, { min: 0, max: 3000 }, 1024);
const maxBin = valueToBin(1000, { min: 0, max: 3000 }, 1024);
distDim.filter([minBin, maxBin]);

await cf.whenIdle();
const bins = group.bins();
const count = bins.reduce((sum, bin) => sum + bin, 0);
console.log(`Matching: ${count}`);
```

### Example 2: Multi-Dimensional Filtering

**Before (crossfilter2)**
```javascript
const cf = crossfilter(flights);
const distDim = cf.dimension(d => d.distance);
const delayDim = cf.dimension(d => d.delay);

distDim.filterRange([500, 1000]);
delayDim.filterRange([-10, 20]);

const results = distDim.top(50);
```

**After (CrossfilterX)**
```typescript
const cf = crossfilterX(flights, { bins: 1024 });
const distDim = cf.dimension('distance');
const delayDim = cf.dimension('delay');

distDim.filter([valueToBin(500, distScale, 1024), valueToBin(1000, distScale, 1024)]);
delayDim.filter([valueToBin(-10, delayScale, 1024), valueToBin(20, delayScale, 1024)]);

await cf.whenIdle();

// top() not available yet - workaround needed
// Consider keeping filtered data client-side or using bins
```

### Example 3: Coordinated Views

**Before (crossfilter2)**
```javascript
const cf = crossfilter(data);
const hourDim = cf.dimension(d => d.hour);
const distDim = cf.dimension(d => d.distance);

const hourGroup = hourDim.group();
const distGroup = distDim.group();

// Apply filter on one dimension
hourDim.filterRange([6, 18]);

// Other dimension updates automatically
console.log(distGroup.all());
```

**After (CrossfilterX)**
```typescript
const cf = crossfilterX(data, { bins: 1024 });
const hourDim = cf.dimension('hour');
const distDim = cf.dimension('distance');

const hourGroup = cf.group('hour');
const distGroup = cf.group('distance');

// Apply filter
hourDim.filter([valueToBin(6, hourScale, 1024), valueToBin(18, hourScale, 1024)]);
await cf.whenIdle();

// All groups update automatically
console.log(distGroup.bins());
```

## Compatibility Adapter

For easier migration, use the `@crossfilterx/adapter-crossfilter` package:

```typescript
import { crossfilter } from '@crossfilterx/adapter-crossfilter';

// More compatible API (still async)
const cf = await crossfilter(data);
const dim = cf.dimension('distance');
await dim.filter([500, 1000]);
const group = dim.group();
const bins = await group.bins();
```

**Note**: The adapter is not a perfect drop-in replacement. Some features are still missing.

## Common Pitfalls

### 1. Forgetting await

```typescript
// ❌ Wrong - filter not applied yet
dim.filter([10, 50]);
const bins = group.bins(); // Stale data!

// ✅ Correct
dim.filter([10, 50]);
await cf.whenIdle();
const bins = group.bins();
```

### 2. Using value instead of bins

```typescript
// ❌ Wrong - raw values
dim.filter([500, 1000]);

// ✅ Correct - bin indices
dim.filter([
  valueToBin(500, scale, bins),
  valueToBin(1000, scale, bins)
]);
```

### 3. Expecting top() to work

```typescript
// ❌ Not implemented yet
const top10 = dim.top(10);

// ✅ Workaround - use bins or keep data client-side
```

## Browser Requirements

CrossfilterX requires `SharedArrayBuffer`, which needs:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Add these headers in your dev server (Vite example):

```typescript
// vite.config.ts
export default {
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  }
};
```

## Performance Considerations

CrossfilterX is generally faster than crossfilter2, especially for:

- Large datasets (100k+ rows)
- Multiple dimensions (6+)
- Frequent filter updates
- Columnar data formats

Expect:
- **27% faster** ingestion with columnar data
- **Sub-100ms** filters on 200k rows
- **Non-blocking UI** during operations

## Getting Help

- Check [API documentation](./api-reference.md)
- See [examples](../packages/demo/src/)
- Open an [issue](https://github.com/YOUR_ORG/crossfilterx/issues)

## Roadmap

Planned features for compatibility:

- [ ] `dimension.top(k)` / `dimension.bottom(k)`
- [ ] `filterExact()` support
- [ ] Custom reduce functions
- [ ] `groupAll()` support
- [ ] Better adapter layer
- [ ] Migration tooling

---

Last updated: September 29, 2025