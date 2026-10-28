// Photo backup ("Fotos-Backup"): what the Umbrel app's photo backup holds for
// each Umbrel account – photos, videos and their size – or, with
// DASH_PHOTOS_NAMES, for each person whose phone has its own backup folder,
// also when two phones back up into one account. The figures come from
// scripts/xps-services.py, the small root service that may read Umbrel's
// Docker volume and writes /run/xps-services/photos.json every 2 minutes;
// the dashboard never reads the photos themselves.
//
// Settings:
//   DASH_PHOTOS_FILE   default /run/xps-services/photos.json
//   DASH_PHOTOS_NAMES  backup folder → person, e.g. "Paul/iPhone=Paul,Paul/iPhone (2)=Jane"
//                      (account/folder; a bare folder name matches it in any
//                      account). A person with several folders gets their
//                      sum, folders without a name count for their account.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

export const DEFAULT_FILE = '/run/xps-services/photos.json';

const count = (value) => (Number.isFinite(value) && value >= 0 ? Math.round(value) : 0);

// "Paul/iPhone=Paul, iPhone (2) = Jane" → Map { "Paul/iPhone" → "Paul", "iPhone (2)" → "Jane" }
export function parseNames(text) {
  const names = new Map();
  for (const part of String(text ?? '').split(',')) {
    const eq = part.lastIndexOf('=');
    const folder = part.slice(0, eq).trim();
    const name = part.slice(eq + 1).trim();
    if (eq > 0 && folder && name && !names.has(folder)) names.set(folder, name);
  }
  return names;
}

const figures = (entry) => ({ photos: count(entry.photos), videos: count(entry.videos), bytes: count(entry.bytes) });
const valid = (text) => typeof text === 'string' && text.trim() !== '';

// Named folders go to their person, the rest to their account. People come in
// the order of DASH_PHOTOS_NAMES, then accounts in Umbrel's order; an account
// whose folders all belong to named people is left out unless it is one of them.
function byFolder(sample, names) {
  const groups = new Map([...new Set(names.values())].map((name) => [name, { photos: 0, videos: 0, bytes: 0 }]));
  const add = (name, entry) => {
    const sum = groups.get(name) ?? { photos: 0, videos: 0, bytes: 0 };
    const more = figures(entry);
    groups.set(name, { photos: sum.photos + more.photos, videos: sum.videos + more.videos, bytes: sum.bytes + more.bytes });
  };
  const accounts = sample.people.filter((person) => person && valid(person.name)).map((person) => person.name.trim());
  for (const device of sample.devices) {
    if (!device || !valid(device.account) || typeof device.folder !== 'string') continue;
    const account = device.account.trim();
    add(names.get(`${account}/${device.folder}`) ?? names.get(device.folder) ?? account, device);
  }
  // An account without any folder yet still shows with 0, unless all its
  // phones are named after people
  for (const account of accounts) {
    if (!groups.has(account) && !sample.devices.some((device) => device?.account === account)) add(account, {});
  }
  return [...groups].map(([name, sum]) => ({ name, ...sum }));
}

// photos.json → { people: [{ name, photos, videos, bytes }], total }
export function toWidgetData(sample, { names = new Map() } = {}) {
  if (!sample || !Array.isArray(sample.people)) throw new Error('photos.json hat ein unerwartetes Format');
  if (sample.error) throw new Error(sample.error);
  const people = names.size && Array.isArray(sample.devices)
    ? byFolder(sample, names)
    : sample.people
      .filter((person) => person && valid(person.name))
      .map((person) => ({ name: person.name.trim(), ...figures(person) }));
  const total = people.reduce((sum, person) => ({
    photos: sum.photos + person.photos,
    videos: sum.videos + person.videos,
    bytes: sum.bytes + person.bytes,
  }), { photos: 0, videos: 0, bytes: 0 });
  return { people, total };
}

export const demoSample = () => ({
  capturedAt: Date.now(),
  people: [
    { name: 'Paul', photos: 4812, videos: 377, bytes: 61.4 * 1024 ** 3 },
    { name: 'Jana', photos: 2290, videos: 141, bytes: 27.8 * 1024 ** 3 },
  ],
  error: null,
});

export default {
  id: 'backup',
  // Only a small file: once a minute, so after a reboot the real figures
  // replace the example within a minute of xps-services writing them
  intervalMs: 60_000,
  isConfigured: (config) => existsSync(config.get('DASH_PHOTOS_FILE', DEFAULT_FILE)),

  async fetch(ctx) {
    const sample = JSON.parse(await readFile(ctx.config.get('DASH_PHOTOS_FILE', DEFAULT_FILE), 'utf8'));
    return toWidgetData(sample, { names: parseNames(ctx.config.get('DASH_PHOTOS_NAMES', '')) });
  },

  demo: () => toWidgetData(demoSample()),
};
