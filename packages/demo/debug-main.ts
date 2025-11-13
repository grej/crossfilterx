import { crossfilterX } from '@crossfilterx/core';

console.log('1. Script started');

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing app container');

console.log('2. App container found');

app.innerHTML = `
  <h1>CrossfilterX Debug</h1>
  <div id="status">Initializing...</div>
`;

const statusEl = document.getElementById('status')!;

function updateStatus(msg: string) {
  console.log('STATUS:', msg);
  statusEl.textContent = msg;
}

async function init() {
  try {
    updateStatus('Creating test data...');
    const data = Array.from({ length: 100 }, (_, i) => ({
      id: i,
      value: Math.random() * 100,
      category: Math.floor(Math.random() * 5),
    }));

    updateStatus('Creating crossfilterX instance...');
    const cf = crossfilterX(data);

    updateStatus('Creating dimension...');
    const dim = cf.dimension('value');

    updateStatus('Creating group...');
    const group = cf.group('category');

    updateStatus('Waiting for idle...');
    await cf.whenIdle();

    updateStatus('SUCCESS! CrossfilterX initialized');

    const count = group.count();
    statusEl.innerHTML = `
      <h2 style="color: green;">✓ Success!</h2>
      <p>Total records: ${count}</p>
      <p>Worker: Active</p>
      <p>SharedArrayBuffer: ${typeof SharedArrayBuffer !== 'undefined' ? 'Yes' : 'No'}</p>
    `;
  } catch (error: any) {
    updateStatus('ERROR: ' + error.message);
    console.error('Full error:', error);
    statusEl.innerHTML = `
      <h2 style="color: red;">✗ Error</h2>
      <pre>${error.message}\n${error.stack}</pre>
    `;
  }
}

updateStatus('Starting initialization...');
init();