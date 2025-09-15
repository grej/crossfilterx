import { brushSweep } from './scenarios';

async function main() {
  console.log('Running benchmark scenarios...');
  for await (const message of brushSweep.script()) {
    console.log('Dispatch message', message);
  }
}

void main();
