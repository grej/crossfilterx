# CrossfilterX

Modern, high-performance multidimensional filtering library with WebWorker and SIMD acceleration.

## Features

- 🚀 **Near drop-in replacement** for crossfilter2 with improved performance
- ⚡ **WebWorker-based** for non-blocking UI updates
- 🔥 **SIMD acceleration** via WebAssembly (Rust/wasm-pack)
- 📊 **Columnar data support** for 27% faster ingestion
- 🎯 **SharedArrayBuffer** for zero-copy data sharing
- ✅ **TypeScript native** with full type safety
- 🧪 **Comprehensive testing** with Playwright across all major browsers

## Performance

Based on real-world benchmarks with airline flight data:

| Dataset Size | Ingest Time (row) | Ingest Time (columnar) | Filter Time | Clear Time |
|-------------|-------------------|------------------------|-------------|------------|
| 50k rows    | 41ms              | 30ms                   | <0.1ms      | <0.02ms    |
| 100k rows   | <150ms            | <100ms                 | <50ms       | <0.05ms    |
| 500k rows   | <800ms            | <600ms                 | <150ms      | <0.1ms     |

## Quick Start

### Installation

```bash
npm install @crossfilterx/core
```

### Basic Usage

```typescript
import { crossfilterX } from '@crossfilterx/core';

// Your data
const flights = [
  { date: '2001-01-01', distance: 500, delay: 10 },
  { date: '2001-01-02', distance: 1200, delay: -5 },
  // ... more data
];

// Create crossfilter instance
const cf = crossfilterX(flights, { bins: 1024 });

// Create dimensions
const distanceDim = cf.dimension('distance');
const delayDim = cf.dimension('delay');

// Create groups for aggregation
const distanceGroup = cf.group('distance');
const delayGroup = cf.group('delay');

// Apply filters
distanceDim.filter([500, 2000]); // Filter by distance range
await cf.whenIdle(); // Wait for worker to process

// Get results
const bins = distanceGroup.bins(); // Histogram data
const keys = delayGroup.keys(); // Unique values
const count = bins.reduce((sum, bin) => sum + bin, 0);

console.log(`Matching flights: ${count}`);
```

### Columnar Data (Faster)

For better performance, use columnar format:

```typescript
const columnarData = {
  columns: {
    distance: new Float32Array([500, 1200, 800, ...]),
    delay: new Int16Array([10, -5, 3, ...]),
    carrier: new Uint16Array([1, 2, 1, ...])
  },
  length: 50000
};

const cf = crossfilterX(columnarData, { bins: 1024 });
```

## Browser Support

CrossfilterX requires `SharedArrayBuffer` support:

- Chrome 92+ ✅
- Firefox 79+ ✅
- Safari 15.2+ ✅
- Edge 92+ ✅

**Important:** Your server must send these headers for `SharedArrayBuffer` to work:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

## API Overview

### `crossfilterX(data, options?)`

Creates a new crossfilter instance.

```typescript
const cf = crossfilterX(data, {
  bins: 1024, // Histogram bins (power of 2)
  // ... other options
});
```

### Dimension Methods

```typescript
const dim = cf.dimension('fieldName');

// Filter by range
dim.filter([min, max]);

// Clear filter
dim.clear();

// Create group for aggregation
const group = dim.group();
```

### Group Methods

```typescript
const group = cf.group('fieldName', {
  coarseTargetBins: 64 // For downsampling
});

// Get histogram bins
const bins = group.bins(); // Uint32Array

// Get coarsened bins (faster for visualization)
const coarse = group.coarse()?.bins();

// Get unique keys
const keys = group.keys();
```

### CrossFilter Methods

```typescript
// Wait for all operations to complete
await cf.whenIdle();

// Get performance snapshot (if available)
const snapshot = cf.clearPlannerSnapshot?.();
```

## Migrating from crossfilter2

See [MIGRATION.md](./docs/migration.md) for a detailed migration guide.

Key differences:

1. **Async operations**: Use `await cf.whenIdle()` after mutations
2. **Bin-based filtering**: Filters use bin indices, not raw values
3. **No reduce functions**: Groups return histogram bins directly
4. **Dimension filters**: Only range filters supported (for now)

## Examples

Check out the `/packages/demo` directory for working examples:

- **Basic Demo** (`index.html`) - Simple 2-chart demo with distance filtering
- **Enhanced Demo** (`enhanced.html`) - 4-chart coordinated views like official crossfilter

Run the demo:

```bash
npm run dev
open http://localhost:5173
```

## Development

### Prerequisites

- Node.js 18+
- npm 9+
- wasm-pack (for WASM compilation)

### Setup

```bash
# Install dependencies
npm install

# Build all packages
npm run build --workspaces

# Run tests
npm run test        # Unit tests
npm run test:e2e    # End-to-end tests
npm run test:all    # All tests

# Start dev server
npm run dev
```

### Project Structure

```
crossfilterx/
├── packages/
│   ├── core/                    # Core library
│   │   ├── src/
│   │   │   ├── index.ts        # Public API
│   │   │   ├── controller.ts   # Main thread controller
│   │   │   ├── worker.ts       # WebWorker entry
│   │   │   ├── protocol.ts     # Worker protocol
│   │   │   └── wasm/           # WASM kernels (Rust)
│   │   └── dist/
│   ├── adapter-crossfilter/    # Compatibility adapter
│   ├── demo/                   # Demo applications
│   └── bench/                  # Benchmarks
├── tests/e2e/                  # Playwright tests
├── docs/                       # Documentation
└── playwright.config.ts        # Test configuration
```

## Performance Tips

1. **Use columnar data** when possible (27% faster ingestion)
2. **Choose appropriate bin count** - 1024 bins good for most use cases
3. **Use coarsened bins** for visualizations (`group.coarse()`)
4. **Batch filter operations** and await once
5. **Reuse dimensions** instead of creating new ones

## Contributing

We welcome contributions! See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

MIT License - see [LICENSE](./LICENSE) file for details.

## Acknowledgments

- Inspired by [Square's Crossfilter](https://github.com/square/crossfilter)
- Built with WebAssembly (Rust) for SIMD acceleration
- Tested with Playwright across all major browsers

## Related Projects

- [crossfilter2](https://github.com/crossfilter/crossfilter) - Original crossfilter
- [dc.js](https://dc-js.github.io/dc.js/) - Dimensional charting library
- [d3.js](https://d3js.org/) - Data visualization

---

**Status**: Alpha - API may change. Use in production at your own risk.

For questions, issues, or feature requests, please [open an issue](https://github.com/YOUR_ORG/crossfilterx/issues).