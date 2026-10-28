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
  const data = toWidgetData({ people: [{ name: ' Jane ', photos: -3, videos: 'x', bytes: 1.6 }, { name: '' }, null] });
  assert.deepEqual(data.people, [{ name: 'Jane', photos: 0, videos: 0, bytes: 2 }]);
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

test('folder names map to people', async () => {
  const { parseNames } = await import('../server/widgets/backup.js');
  assert.deepEqual([...parseNames('Paul/iPhone=Paul, iPhone (2) = Jane,kaputt,=x,y=')], [['Paul/iPhone', 'Paul'], ['iPhone (2)', 'Jane']]);
  assert.equal(parseNames('').size, 0);
});

test('with names each phone folder counts for its person', async () => {
  const { parseNames } = await import('../server/widgets/backup.js');
  const sample = {
    people: [{ name: 'Paul', photos: 9, videos: 9, bytes: 9 }, { name: 'Jane', photos: 0, videos: 0, bytes: 0 }],
    devices: [
      { account: 'Paul', folder: 'iPhone', photos: 1739, videos: 300, bytes: 2000 },
      { account: 'Paul', folder: 'iPhone (2)', photos: 400, videos: 5, bytes: 600 },
      { account: 'Paul', folder: '', photos: 2, videos: 0, bytes: 10 },
    ],
    error: null,
  };
  const names = parseNames('Paul/iPhone=Paul,Paul/iPhone (2)=Jane');
  const { people, total } = toWidgetData(sample, { names });
  assert.deepEqual(people, [
    { name: 'Paul', photos: 1741, videos: 300, bytes: 2010 },
    { name: 'Jane', photos: 400, videos: 5, bytes: 600 },
  ], 'loose files stay with the account, Jane gets her folder');
  assert.deepEqual(total, { photos: 2141, videos: 305, bytes: 2610 });
  // Later Jane backs up in her own account: her "iPhone" is not Paul's
  const later = { ...sample, devices: [...sample.devices, { account: 'Jane', folder: 'iPhone', photos: 7, videos: 0, bytes: 70 }] };
  assert.equal(toWidgetData(later, { names }).people.find((p) => p.name === 'Jane').photos, 407);
  // Without names it stays per account, also for an older photos.json without devices
  assert.deepEqual(toWidgetData(sample).people.map((p) => p.name), ['Paul', 'Jane']);
  assert.equal(toWidgetData({ people: sample.people }, { names }).people[0].photos, 9);
});

test('an account without folders still shows, unless a name covers it', async () => {
  const { parseNames } = await import('../server/widgets/backup.js');
  const sample = {
    people: [{ name: 'Paul' }, { name: 'Gast' }],
    devices: [{ account: 'Paul', folder: 'iPhone', photos: 1, videos: 0, bytes: 1 }],
  };
  const people = toWidgetData(sample, { names: parseNames('iPhone=Paul') }).people;
  assert.deepEqual(people.map((p) => [p.name, p.photos]), [['Paul', 1], ['Gast', 0]]);
});
