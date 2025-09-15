import { createServer } from 'vite';

async function start() {
  const server = await createServer({
    root: 'packages/demo',
    server: {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp'
      }
    }
  });

  await server.listen();
  server.printUrls();
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
