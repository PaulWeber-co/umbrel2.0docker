const coordinate = (value) => {
  const [lat, lon] = value.split(',').map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
};

export function toWidgetData(route, destination) {
  const trip = route.routes?.[0];
  if (!trip || !Number.isFinite(trip.duration) || !Number.isFinite(trip.distance)) throw new Error('Kein Arbeitsweg gefunden');
  return {
    destination,
    minutes: Math.max(1, Math.round(trip.duration / 60)),
    kilometers: Math.round((trip.distance / 1000) * 10) / 10,
  };
}

export default {
  id: 'weg',
  intervalMs: 15 * 60_000,
  isConfigured: (config) => Boolean(coordinate(config.get('DASH_COMMUTE_ORIGIN')) && coordinate(config.get('DASH_COMMUTE_DESTINATION'))),

  async fetch({ config, fetchJson }) {
    const from = coordinate(config.get('DASH_COMMUTE_ORIGIN'));
    const to = coordinate(config.get('DASH_COMMUTE_DESTINATION'));
    const base = config.get('DASH_OSRM_BASE_URL', 'https://router.project-osrm.org').replace(/\/+$/, '');
    const params = new URLSearchParams({ overview: 'false', alternatives: 'false', steps: 'false' });
    const route = await fetchJson(`${base}/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?${params}`);
    return toWidgetData(route, config.get('DASH_COMMUTE_DESTINATION_NAME', 'Arbeitsweg'));
  },

  demo: () => ({ destination: 'Büro', minutes: 32, kilometers: 18.4 }),
};
