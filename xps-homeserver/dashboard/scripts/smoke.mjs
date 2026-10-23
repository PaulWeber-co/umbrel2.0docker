// Starts the real server in demo mode on a free port, checks the main
// endpoints and the front-end files, then stops it. Always finishes within
// 30 seconds, so it is safe in scripts and unattended runs: npm run smoke
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const child = spawn(process.execPath, ['server/index.js', '--demo'], {
  cwd: root,
  env: { ...process.env, DASH_PORT: '0', DASH_HOST: '127.0.0.1', DASH_DATA_DIR: mkdtempSync(join(tmpdir(), 'dash-smoke-')) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const stop = (code, message) => {
  console[code ? 'error' : 'log'](message);
  child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 300);
};
setTimeout(() => stop(1, '✗ Zeitlimit: Der Server hat nicht in 30 s geantwortet'), 30_000).unref();

let output = '';
child.stderr.on('data', (chunk) => process.stderr.write(chunk));
child.on('exit', (code) => {
  if (code) stop(1, `✗ Server beendet mit Code ${code}\n${output}`);
});
child.stdout.on('data', async (chunk) => {
  output += chunk;
  const match = output.match(/localhost:(\d+)/);
  if (!match || output.includes('__checking__')) return;
  output += '__checking__';
  const base = `http://127.0.0.1:${match[1]}`;
  try {
    const check = async (path, test) => {
      const response = await fetch(base + path, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
      await test(response);
      console.log(`✓ ${path}`);
    };
    await new Promise((resolve) => setTimeout(resolve, 500)); // first widget round
    await check('/', async (r) => { if (!(await r.text()).includes('id="stage"')) throw new Error('/ ist nicht das Dashboard'); });
    await check('/css/dashboard.css', async () => {});
    await check('/js/app.js', async () => {});
    await check('/api/state', async (r) => {
      const state = await r.json();
      const ids = Object.keys(state.widgets);
      if (!ids.length) throw new Error('/api/state: keine Widgets');
      const broken = ids.filter((id) => state.widgets[id].error);
      if (broken.length) throw new Error(`/api/state: Fehler in ${broken.join(', ')}`);
      console.log(`  Widgets: ${ids.join(', ')}`);
    });
    await check('/api/layout', async (r) => { if (!Array.isArray((await r.json()).tiles)) throw new Error('/api/layout ohne tiles'); });
    await check('/steuerung', async (r) => { if (!(await r.text()).includes('id="control"')) throw new Error('/steuerung ist nicht die Steuerung'); });
    await check('/api/control', async (r) => {
      const control = await r.json();
      if (!control.effective?.display) throw new Error('/api/control ohne Bildschirmzustand');
      console.log(`  Bildschirm: ${control.effective.display} (${control.effective.reason})`);
    });
    stop(0, '✓ Smoke-Test bestanden');
  } catch (error) {
    stop(1, `✗ ${error.message}`);
  }
});
