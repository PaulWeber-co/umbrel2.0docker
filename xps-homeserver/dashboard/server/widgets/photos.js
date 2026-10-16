const API_PREFIX = '/api';

export function toWidgetData(statistics, url = '') {
  const photos = Number(statistics?.photos ?? statistics?.photosCount);
  const videos = Number(statistics?.videos ?? statistics?.videosCount);
  const usage = Number(statistics?.usage ?? statistics?.usageBytes);
  const number = (value) => Number.isFinite(value) && value >= 0 ? value : null;
  return { photos: number(photos), videos: number(videos), usageBytes: number(usage), url };
}

export default {
  id: 'fotos',
  intervalMs: 30 * 60_000,
  isConfigured: (config) => Boolean(config.get('DASH_IMMICH_URL') && config.get('DASH_IMMICH_API_KEY')),

  async fetch({ config, fetchJson }) {
    const base = config.get('DASH_IMMICH_URL').replace(/\/+$/, '');
    const path = config.get('DASH_IMMICH_STATS_PATH', `${API_PREFIX}/server/statistics`);
    const url = new URL(path, `${base}/`);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('DASH_IMMICH_URL muss mit http:// oder https:// beginnen');
    const statistics = await fetchJson(url.toString(), { headers: { 'x-api-key': config.get('DASH_IMMICH_API_KEY') } });
    return toWidgetData(statistics, `${base}/photos`);
  },

  demo: () => ({ photos: 12_483, videos: 438, usageBytes: 56 * 1024 ** 3 }),
};
