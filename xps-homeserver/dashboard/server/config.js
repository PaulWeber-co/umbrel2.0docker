// Settings come from the environment and from xps-homeserver/.env (the same
// file the installer uses). The dashboard only reads keys that start with
// DASH_; widgets read their own keys through config.get() and config.num().
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DASHBOARD_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_ENV_FILE = join(DASHBOARD_DIR, '..', '.env');

// KEY=VALUE per line without shell expansion, like installer/build.sh: a value
// is everything after the first "=", one pair of surrounding quotes is removed.
export function parseEnv(text) {
  const vars = {};
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1);
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) value = value.slice(1, -1);
    vars[key] = value;
  }
  return vars;
}

export function loadConfig({ argv = process.argv.slice(2), env = process.env, envFile = DEFAULT_ENV_FILE } = {}) {
  let fileVars = {};
  try {
    fileVars = parseEnv(readFileSync(envFile, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const vars = { ...fileVars };
  for (const [key, value] of Object.entries(env)) if (key.startsWith('DASH_')) vars[key] = value;

  const get = (key, fallback = '') => (vars[key] !== undefined && vars[key] !== '' ? vars[key] : fallback);
  const num = (key, fallback) => {
    const value = Number(get(key, ''));
    return get(key, '') === '' || Number.isNaN(value) ? fallback : value;
  };

  return {
    get,
    num,
    demo: argv.includes('--demo') || get('DASH_DEMO') === '1',
    port: num('DASH_PORT', 8080),
    host: get('DASH_HOST', '0.0.0.0'),
    name: get('DASH_NAME', ''),
    place: get('DASH_PLACE', 'Hamburg'),
    lat: num('DASH_LAT', 53.55),
    lon: num('DASH_LON', 10.0),
    timezone: get('DASH_TIMEZONE', 'Europe/Berlin'),
    haUrl: get('DASH_HA_URL'),
    haToken: get('DASH_HA_TOKEN'),
    commuteOrigin: get('DASH_COMMUTE_ORIGIN'),
    commuteDestination: get('DASH_COMMUTE_DESTINATION'),
    immichUrl: get('DASH_IMMICH_URL'),
    ambientFile: get('DASH_AMBIENT_FILE', '/run/xps-ambient/ambient.json'),
    dataDir: get('DASH_DATA_DIR', join(DASHBOARD_DIR, 'data')),
    mediaDir: get('DASH_MEDIA_DIR', join(DASHBOARD_DIR, 'web', 'media')),
  };
}
