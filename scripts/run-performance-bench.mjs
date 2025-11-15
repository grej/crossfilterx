/**
 * Performance benchmark runner
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

// Enable GC for memory benchmarks (requires --expose-gc flag)
if (global.gc) {
  console.log('✓ GC available for memory benchmarks\n');
} else {
  console.log('⚠ GC not available. Run with --expose-gc for memory benchmarks\n');
}

// Load and run the benchmark suite
async function main() {
  const benchPath = join(__dirname, '../packages/bench/dist/suite-performance.js');

  try {
    const { runBenchmarks } = await import(benchPath);
    await runBenchmarks();
  } catch (error) {
    console.error('Error running benchmarks:', error);
    console.error('\nMake sure to build first: npm run build');
    process.exit(1);
  }
}

main();
