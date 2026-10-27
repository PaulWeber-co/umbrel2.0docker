// Photo backup ("Fotos-Backup"): what the Umbrel app's photo backup holds for
// each Umbrel account – photos, videos and their size. The figures come from
// scripts/xps-services.py, the small root service that may read Umbrel's
// Docker volume and writes /run/xps-services/photos.json every 2 minutes;
// the dashboard never reads the photos themselves.
//
// Settings:
//   DASH_PHOTOS_FILE   default /run/xps-services/photos.json
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

export const DEFAULT_FILE = '/run/xps-services/photos.json';

const count = (value) => (Number.isFinite(value) && value >= 0 ? Math.round(value) : 0);

// photos.json → { people: [{ name, photos, videos, bytes }], total }
export function toWidgetData(sample) {
  if (!sample || !Array.isArray(sample.people)) throw new Error('photos.json hat ein unerwartetes Format');
  if (sample.error) throw new Error(sample.error);
  const people = sample.people
    .filter((person) => person && typeof person.name === 'string' && person.name.trim())
    .map((person) => ({ name: person.name.trim(), photos: count(person.photos), videos: count(person.videos), bytes: count(person.bytes) }));
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
    return toWidgetData(JSON.parse(await readFile(ctx.config.get('DASH_PHOTOS_FILE', DEFAULT_FILE), 'utf8')));
  },

  demo: () => toWidgetData(demoSample()),
};
