// Starts the dashboard server.
//
//   node server/index.js          real data where settings exist, sample data elsewhere
//   node server/index.js --demo   sample data everywhere (no network needed)
import { join } from 'node:path';
import { DASHBOARD_DIR, loadConfig } from './config.js';
import { createControl } from './control.js';
import { createApp } from './http.js';
import { Hub } from './hub.js';
import { DEFAULT_LAYOUT } from './layout.js';
import { createStore } from './store.js';
import widgets from './widgets/index.js';

const config = loadConfig();
const store = createStore(config.dataDir);
const hub = new Hub({ widgets, config, store });
const control = createControl({ store, config, hub });
const server = createApp({ hub, store, config, control, webDir: join(DASHBOARD_DIR, 'web'), defaultLayout: DEFAULT_LAYOUT });

server.listen(config.port, config.host, () => {
  const { port } = server.address();
  console.log(`Dashboard läuft auf http://localhost:${port}${config.demo ? ' (Beispieldaten)' : ''}`);
  hub.start();
  control.start().catch((error) => console.error('Steuerung:', error));
});

function shutdown() {
  hub.stop();
  control.stop();
  server.close(() => process.exit(0));
  server.closeAllConnections();
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
