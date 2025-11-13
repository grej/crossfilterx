/* eslint-env node */
import { spawn } from 'node:child_process';

const testFiles = [
  'packages/core/test/index.test.ts',
  'packages/core/test/layout.test.ts',
  'packages/core/test/simple-engine.test.ts',
  'packages/core/test/protocol.test.ts',
  'packages/core/test/protocol-delta.test.ts',
  'packages/core/test/csr-delta.test.ts',
  'packages/core/test/multidim-delta.test.ts',
  'packages/core/test/clear-heuristic.test.ts',
  'packages/core/test/controller-index.test.ts',
  'packages/core/test/ingest-descriptor.test.ts',
  'packages/core/test/coarsening.test.ts',
  'packages/core/test/reductions.test.ts',
  'packages/core/test/top-k.test.ts',
  // 'packages/core/test/memory-management.test.ts', // Skipped: Vitest OOMs due to worker pool limitation (see FIX2_COMPLETION_SUMMARY.md)
  'packages/core/test/function-dimension-removal.test.ts'
];

let index = 0;

function runNext() {
  if (index >= testFiles.length) {
    console.log('All tests passed sequentially.');
    return;
  }
  const file = testFiles[index++];
  console.log(`Running ${file}`);
  const child = spawn('npx', ['vitest', 'run', '--config', 'vitest.config.single.ts'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      VITEST_FILE: file
    }
  });
  child.on('exit', (code) => {
    if (code !== 0) {
      console.error(`Test failed for ${file}`);
      process.exit(code ?? 1);
    }
    runNext();
  });
}

runNext();
