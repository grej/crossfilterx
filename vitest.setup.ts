if (typeof globalThis.Worker !== 'undefined') {
  // Ensure tests use the in-process protocol implementation instead of spawning real workers.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).Worker = undefined;
}

process.on('uncaughtException', (error) => {
  if ((error as { code?: string }).code === 'ERR_WORKER_OUT_OF_MEMORY') {
    return;
  }
  throw error;
});
