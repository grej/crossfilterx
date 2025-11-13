# Contributing to CrossfilterX

Thank you for your interest in contributing to CrossfilterX! This document provides guidelines and instructions for contributing.

## Code of Conduct

Be respectful, inclusive, and collaborative. We welcome contributions from developers of all skill levels.

## Getting Started

### Prerequisites

- Node.js 18+ and npm 9+
- Git
- wasm-pack (for WASM kernel development)

### Installation

```bash
# Clone the repository
git clone https://github.com/YOUR_ORG/crossfilterx.git
cd crossfilterx

# Install dependencies
npm install

# Build all packages
npm run build --workspaces

# Run tests
npm run test:all
```

### Development Workflow

```bash
# Start development server
npm run dev

# Run unit tests in watch mode
npm run test

# Run e2e tests
npm run test:e2e

# Run e2e tests with UI
npm run test:e2e:ui

# Run benchmarks
npm run bench
```

## Project Structure

```
crossfilterx/
├── packages/
│   ├── core/                    # Core library
│   │   ├── src/
│   │   │   ├── index.ts        # Public API
│   │   │   ├── controller.ts   # Main thread
│   │   │   ├── worker.ts       # WebWorker
│   │   │   ├── protocol.ts     # Communication protocol
│   │   │   └── wasm/           # Rust WASM kernels
│   │   │       └── kernels/
│   │   │           ├── src/
│   │   │           │   └── lib.rs  # Rust implementation
│   │   │           └── Cargo.toml
│   │   └── test/               # Unit tests
│   ├── adapter-crossfilter/    # Compatibility layer
│   ├── demo/                   # Demo applications
│   └── bench/                  # Benchmarks
├── tests/e2e/                  # Playwright tests
├── docs/                       # Documentation
└── scripts/                    # Build scripts
```

## How to Contribute

### Reporting Bugs

1. Check existing issues to avoid duplicates
2. Create a new issue with:
   - Clear description of the bug
   - Steps to reproduce
   - Expected vs actual behavior
   - Browser/OS information
   - Code sample if possible

### Suggesting Features

1. Check existing issues and discussions
2. Create a new issue with:
   - Use case description
   - Proposed API or behavior
   - Example code if possible
   - Why it's important

### Pull Requests

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass: `npm run test:all`
6. Commit with clear messages
7. Push to your fork
8. Open a pull request

#### PR Guidelines

- **One feature per PR** - Keep PRs focused
- **Write tests** - All new features need test coverage
- **Update docs** - Update README/docs if needed
- **Follow conventions** - Match existing code style
- **Explain your changes** - Clear PR description

## Development Guidelines

### Code Style

- Use TypeScript for all new code
- Follow existing naming conventions
- Use ESLint rules (configured in project)
- Prefer functional programming patterns
- Comment complex logic

### Testing

#### Unit Tests (Vitest)

```typescript
// packages/core/test/example.test.ts
import { describe, it, expect } from 'vitest';
import { myFunction } from '../src/index';

describe('myFunction', () => {
  it('should do something', () => {
    expect(myFunction(input)).toBe(expected);
  });
});
```

Run: `npm run test`

#### E2E Tests (Playwright)

```typescript
// tests/e2e/feature.spec.ts
import { test, expect } from '@playwright/test';

test('feature works correctly', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.element')).toBeVisible();
});
```

Run: `npm run test:e2e`

### WASM Development

If you need to modify the Rust WASM kernels:

```bash
# Install wasm-pack
curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

# Build WASM
cd packages/core/src/wasm/kernels
wasm-pack build --target web --out-dir ../../target/wasm32-unknown-unknown/release

# Test in demo
cd ../../../../../
npm run dev
```

### Benchmarking

Always benchmark performance-critical changes:

```bash
npm run bench

# Or specific suite
cd packages/bench
npm run bench:filter
```

Include benchmark results in your PR description.

## Commit Messages

Follow conventional commits:

```
feat: Add dimension.top() support
fix: Resolve worker initialization bug
docs: Update migration guide
test: Add e2e tests for filtering
perf: Optimize bin quantization
refactor: Simplify protocol message handling
```

## Release Process

(For maintainers only)

```bash
# Update versions
npm version minor

# Build all packages
npm run build --workspaces

# Run full test suite
npm run test:all

# Publish to npm
npm publish --workspace=packages/core
npm publish --workspace=packages/adapter-crossfilter

# Tag release
git tag v0.2.0
git push --tags
```

## Architecture Guidelines

### Adding New Features

1. **Main thread (controller.ts)**
   - Public API methods
   - Message dispatch to worker
   - Handle async responses

2. **Worker (worker.ts + protocol.ts)**
   - Process messages
   - Update data structures
   - Send results back

3. **WASM (lib.rs)**
   - Performance-critical operations
   - SIMD-accelerated kernels
   - Pure computation functions

### Performance Considerations

- Use `SharedArrayBuffer` for large data
- Minimize message passing overhead
- Prefer WASM for hot paths
- Use coarse bins for visualization
- Batch operations when possible

## Documentation

- Update README.md for user-facing changes
- Update docs/migration.md for API changes
- Add JSDoc comments for public APIs
- Include code examples in docs
- Update CHANGELOG.md

## Questions?

- Open a discussion on GitHub
- Check existing issues
- Review docs/architecture.md
- Look at existing tests for examples

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to CrossfilterX! 🎉