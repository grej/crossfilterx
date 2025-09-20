#!/usr/bin/env node

/**
 * @fileoverview A script to generate a single, large context file for AI models.
 * It reads a curated list of the most architecturally significant files in the
 * CrossfilterX project and concatenates them into a single text file, with
 * clear separators, to be used as context for analysis.
 *
 * To run: `node scripts/create_context.mjs` from the project root.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// --- Configuration ---

// The curated list of 16 key files for maximum architectural context.
const keyFiles = [
  // Core Architecture & Algorithms
  'packages/core/src/protocol.ts',
  'packages/core/src/controller.ts',
  'packages/core/src/memory/layout.ts',
  'packages/core/src/worker/clear-planner.ts',
  'packages/core/src/wasm/kernels/src/lib.rs',
  'packages/core/src/indexers/csr.ts',
  'packages/core/src/index.ts',

  // Essential Implementation
  'packages/core/src/worker/ingest-executor.ts',
  'packages/core/src/memory/ingest.ts',
  'packages/core/src/wasm/simd.ts',
  'packages/core/src/worker.ts',

  // Project Vision & Validation
  '16sepnextsteps.md',
  'packages/bench/reports-summary.json',
  'scripts/run-bench-suite.mjs',
  'packages/demo/src/main.ts',
  'package.json',
];

const OUTPUT_FILENAME = 'crossfilterx_context.txt';

// --- Script Logic ---

function main() {
  console.log('🚀 Starting context file generation...');

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(__dirname, '..');
  const outputPath = path.join(projectRoot, OUTPUT_FILENAME);

  const contentBlocks = [];

  for (const relativePath of keyFiles) {
    const fullPath = path.join(projectRoot, relativePath);
    console.log(`   -> Processing: ${relativePath}`);

    const separator = `================================================\nFile: ${relativePath}\n================================================\n`;
    contentBlocks.push(separator);

    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      contentBlocks.push(content);
    } catch (error) {
      const errorMessage = `[Error: Could not read file. Details: ${error.message}]`;
      console.warn(`   ⚠️  Warning: Failed to read ${relativePath}. Skipping.`);
      contentBlocks.push(errorMessage);
    }
  }

  const combinedContent = contentBlocks.join('\n\n');

  try {
    fs.writeFileSync(outputPath, combinedContent);
    console.log(`\n✅ Success! Context file created at: ${outputPath}`);
    console.log(`   Total characters written: ${combinedContent.length.toLocaleString()}`);
  } catch (error) {
    console.error(`\n❌ Error: Failed to write output file. Details: ${error.message}`);
    process.exit(1);
  }
}

main();