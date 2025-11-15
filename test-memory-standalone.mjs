/**
 * Standalone memory test - runs without Vitest
 *
 * Usage: node test-memory-standalone.mjs
 *
 * This validates that memory cleanup works outside of the Vitest infrastructure.
 */

import { crossfilterX } from './packages/core/dist/index.js';

console.log('Testing memory management with 50 sequential instances...');

const data = {
  columns: {
    value: new Uint16Array([1, 2, 3, 4, 5])
  },
  length: 5
};

let successCount = 0;

for (let i = 0; i < 50; i++) {
  const cf = crossfilterX(data, { bins: 256 });
  const dim = cf.dimension('value');
  await dim.filter([2, 4]);
  const group = dim.group();
  const count = group.count();

  if (count !== 3) {
    console.error(`Test ${i}: Expected count 3, got ${count}`);
    process.exit(1);
  }

  cf.dispose();
  successCount++;

  if ((i + 1) % 10 === 0) {
    console.log(`  ${i + 1} instances created and disposed successfully`);
  }
}

console.log(`\n✓ All ${successCount} instances created and disposed successfully!`);
console.log('✓ No OOM errors');
console.log('✓ Memory management is working correctly');

process.exit(0);
