// Syntax check of every JavaScript file, front end included: node --check per
// file. Fast, no dependencies; run with npm run check.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'media' || entry.name === 'data') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (/\.(m?js)$/.test(entry.name)) files.push(path);
  }
};
for (const dir of ['server', 'web/js', 'test', 'scripts']) walk(join(root, dir));

let failed = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', timeout: 20_000 });
  if (result.status !== 0) {
    failed++;
    console.error(`✗ ${relative(root, file)}\n${result.stderr.trim()}\n`);
  }
}
console.log(`${files.length - failed} von ${files.length} Dateien ohne Syntaxfehler`);
process.exit(failed ? 1 : 0);
