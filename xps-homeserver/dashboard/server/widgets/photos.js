// Photo library numbers from Immich (https://immich.app), the photo app on
// Umbrel: how many photos and videos it holds, how much disk space they take
// and how many were taken in the last seven days. Three small requests every
// 30 minutes, the API key always in the x-api-key header, never in the URL:
//   GET  /api/assets/statistics   photos and videos of the key's user (required)
//   GET  /api/server/statistics   disk usage, needs an admin key (else null)
//   POST /api/search/statistics   assets taken in the last 7 days (else null)
//
// Settings: DASH_IMMICH_URL (e.g. http://umbrel.local:2283) and DASH_IMMICH_KEY
// (Immich → Kontoeinstellungen → API-Schlüssel).
//
// The weekly count deliberately does not use /api/search/metadata: Immich sets
// its assets.total to the length of the returned page, so with size: 1 it
// could never exceed 1. /api/search/statistics returns the real match count.

const WEEK_MS = 7 * 24 * 60 * 60_000;

// "http://umbrel.local:2283/" → "http://umbrel.local:2283"
export const baseUrl = (url) => String(url ?? '').trim().replace(/\/+$/, '');

const apiKey = (config) => String(config.get('DASH_IMMICH_KEY', '')).trim();

// A count or byte size from Immich, or null when it is missing or nonsense.
const amount = (value) => (Number.isFinite(value) && value >= 0 ? value : null);

// assets: /api/assets/statistics, server: /api/server/statistics,
// week: /api/search/statistics. The last two may be null when they failed.
export function toWidgetData(assets, server = null, week = null) {
  const images = amount(assets?.images);
  const videos = amount(assets?.videos);
  if (images === null || videos === null) throw new Error('Immich: unerwartete Antwort von /api/assets/statistics');
  return {
    images,
    videos,
    total: amount(assets.total) ?? images + videos,
    usageBytes: amount(server?.usage),
    addedThisWeek: amount(week?.total),
  };
}

export default {
  id: 'fotos',
  intervalMs: 30 * 60_000,
  isConfigured: (config) => Boolean(baseUrl(config.get('DASH_IMMICH_URL', '')) && apiKey(config)),

  async fetch({ config, fetchJson, now }) {
    const url = baseUrl(config.get('DASH_IMMICH_URL', ''));
    if (!/^https?:\/\//i.test(url)) throw new Error('DASH_IMMICH_URL muss mit http:// oder https:// beginnen');
    const headers = { 'x-api-key': apiKey(config) };
    const takenAfter = new Date(now().getTime() - WEEK_MS).toISOString();

    // Only the asset statistics are required; the other two just add detail.
    const [assets, server, week] = await Promise.allSettled([
      fetchJson(`${url}/api/assets/statistics`, { headers }),
      fetchJson(`${url}/api/server/statistics`, { headers }),
      fetchJson(`${url}/api/search/statistics`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ takenAfter }),
      }),
    ]);
    if (assets.status === 'rejected') throw assets.reason;
    const optional = (result) => (result.status === 'fulfilled' ? result.value : null);
    return toWidgetData(assets.value, optional(server), optional(week));
  },

  demo: () => ({ images: 18432, videos: 1204, total: 19636, usageBytes: 103079215104, addedThisWeek: 37 }),
};
