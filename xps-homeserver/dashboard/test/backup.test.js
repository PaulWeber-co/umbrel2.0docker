import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import backup, { demoSample, toWidgetData } from '../server/widgets/backup.js';
import { render } from '../web/js/widgets/backup.js';

const sample = {
  capturedAt: 1793125726899,
  people: [
    { name: 'Paul', photos: 292, videos: 82, bytes: 6633079214 },
    { name: 'Jane', photos: 0, videos: 0, bytes: 0 },
  ],
  error: null,
};

test('photos.json becomes people and a total', () => {
  const data = toWidgetData(sample);
  assert.deepEqual(data.people[0], { name: 'Paul', photos: 292, videos: 82, bytes: 6633079214 });
  assert.deepEqual(data.total, { photos: 292, videos: 82, bytes: 6633079214 });
});

test('odd entries are cleaned, a reported error throws', () => {
  const data = toWidgetData({ people: [{ name: ' Jana ', photos: -3, videos: 'x', bytes: 1.6 }, { name: '' }, null] });
  assert.deepEqual(data.people, [{ name: 'Jana', photos: 0, videos: 0, bytes: 2 }]);
  assert.throws(() => toWidgetData({ people: [], error: 'Umbrel-Daten nicht gefunden (/x)' }), /nicht gefunden/);
  assert.throws(() => toWidgetData({}), /unerwartetes Format/);
});

test('fetch reads the file the root service writes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'xps-backup-'));
  const file = join(dir, 'photos.json');
  writeFileSync(file, JSON.stringify(sample));
  const config = { get: (key, fallback) => (key === 'DASH_PHOTOS_FILE' ? file : fallback) };
  assert.equal(backup.isConfigured(config), true);
  const data = await backup.fetch({ config });
  assert.equal(data.people.length, 2);
  assert.equal(backup.isConfigured({ get: () => join(dir, 'missing.json') }), false);
});

test('demo data has the shape of real data', () => {
  const shape = (data) => JSON.stringify(data, (key, value) => (typeof value === 'number' ? 0 : typeof value === 'string' ? '' : value));
  assert.equal(shape(backup.demo()), shape(toWidgetData({ ...demoSample(), people: sample.people })));
});

test('the tile shows each person with photos, videos and size', () => {
  const html = render(toWidgetData(sample));
  assert.match(html, /Paul/);
  assert.match(html, /<b>292<\/b> Fotos/);
  assert.match(html, /82 Videos/);
  assert.match(html, /6,2 GB/);
  assert.match(html, /Jane/);
  assert.match(html, /<b>0<\/b> Fotos/);
});

test('the tile escapes names and copes with many or no accounts', () => {
  const people = ['<b>A</b>', 'B', 'C'].map((name) => ({ name, photos: 1, videos: 1, bytes: 1024 ** 3 }));
  const many = render({ people, total: {} });
  assert.ok(!many.includes('<b>A</b>'));
  assert.match(many, /bk-lines/);
  assert.match(render({ people: [], total: {} }), /Noch kein Konto/);
  assert.match(render(null), /Lädt/);
  assert.match(render({ people: [{ name: 'X', photos: 1, videos: 1, bytes: 0 }], total: {} }), /1<\/b> Foto<.*1 Video</s);
});

test('long photo counts get a smaller size', async () => {
  const { fit } = await import('../web/js/widgets/backup.js');
  assert.equal(fit('292'), '');
  assert.equal(fit('4.812'), ' bk-l5');
  assert.equal(fit('999.999'), ' bk-l7');
});
