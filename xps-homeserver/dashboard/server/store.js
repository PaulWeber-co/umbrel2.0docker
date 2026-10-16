// Small JSON files in the data directory: the saved layout, the to-do list and
// anything else the dashboard must keep across restarts. Writes go to a
// temporary file first, so a power cut never leaves half a file behind.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function createStore(dir, log = console) {
  return {
    dir,
    async read(name, fallback) {
      try {
        return JSON.parse(await readFile(join(dir, name), 'utf8'));
      } catch (error) {
        if (error.code === 'ENOENT') return fallback;
        if (error instanceof SyntaxError) {
          log.warn(`[store] ${name} ist kein gültiges JSON, nehme den Standardwert`);
          return fallback;
        }
        throw error;
      }
    },
    async write(name, value) {
      await mkdir(dir, { recursive: true });
      const file = join(dir, name);
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
      await rename(tmp, file);
    },
  };
}
