import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadConfig, parseEnv } from '../server/config.js';

test('parseEnv keeps values literally', () => {
  const vars = parseEnv('# comment\nA=1\nB="two words"\nC=a$b`c`=d\r\n\nBAD\nD=\n');
  assert.deepEqual(vars, { A: '1', B: 'two words', C: 'a$b`c`=d', D: '' });
});

test('environment wins over .env, only DASH_ keys count', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dash-'));
  const envFile = join(dir, '.env');
  writeFileSync(envFile, 'DASH_PORT=9000\nDASH_NAME=Paul\nXPS_WIFI_PSK=secret\n');
  const config = loadConfig({ argv: [], env: { DASH_PORT: '9100', HOME: '/x' }, envFile });
  assert.equal(config.port, 9100);
  assert.equal(config.name, 'Paul');
  assert.equal(config.get('XPS_WIFI_PSK'), 'secret');
  assert.equal(config.demo, false);
});

test('--demo and defaults', () => {
  const config = loadConfig({ argv: ['--demo'], env: {}, envFile: '/nonexistent' });
  assert.equal(config.demo, true);
  assert.equal(config.port, 8080);
  assert.equal(config.timezone, 'Europe/Berlin');
});
