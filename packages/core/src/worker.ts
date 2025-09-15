import { createProtocol } from './protocol';

const { handleMessage } = createProtocol((message) => {
  // eslint-disable-next-line no-restricted-globals
  self.postMessage(message);
});

self.onmessage = (event: MessageEvent) => {
  handleMessage(event.data);
};
