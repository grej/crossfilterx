import { createProtocol } from './protocol';

// Add error handler to catch initialization errors
self.onerror = (error) => {
  console.error('[WORKER ERROR]', error);
  self.postMessage({ t: 'ERROR', message: String(error) });
  return true;
};

self.onunhandledrejection = (event) => {
  console.error('[WORKER UNHANDLED REJECTION]', event.reason);
  self.postMessage({ t: 'ERROR', message: String(event.reason) });
};

try {
  const { handleMessage } = createProtocol((message) => {
    // eslint-disable-next-line no-restricted-globals
    self.postMessage(message);
  });

  self.onmessage = (event: MessageEvent) => {
    try {
      handleMessage(event.data);
    } catch (error) {
      console.error('[WORKER MESSAGE ERROR]', error);
      self.postMessage({ t: 'ERROR', message: String(error) });
    }
  };

  console.log('[WORKER] Initialized successfully');
} catch (error) {
  console.error('[WORKER INIT ERROR]', error);
  self.postMessage({ t: 'ERROR', message: String(error) });
}
