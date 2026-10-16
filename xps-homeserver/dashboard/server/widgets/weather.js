// Weather from Open-Meteo (https://open-meteo.com): free, no API key, one
// request every 10 minutes. DASH_LAT, DASH_LON and DASH_PLACE choose the place.
//
// This is the reference widget: the other widgets follow the same pattern of
// a pure toWidgetData() that tests can feed with a fixture, a fetch() that
// only downloads and converts, and a demo() with the same shape.

const API = 'https://api.open-meteo.com/v1/forecast';

// WMO weather codes → German text and an icon name from web/index.html's sprite
const CODES = [
  [[0], 'Klar', 'sun'],
  [[1], 'Überwiegend klar', 'cloudsun'],
  [[2], 'Teils bewölkt', 'cloudsun'],
  [[3], 'Bedeckt', 'cloud'],
  [[45, 48], 'Nebel', 'fog'],
  [[51, 53, 55, 56, 57], 'Nieselregen', 'rain'],
  [[61, 63, 65, 66, 67], 'Regen', 'rain'],
  [[71, 73, 75, 77], 'Schnee', 'snow'],
  [[80, 81, 82], 'Regenschauer', 'rain'],
  [[85, 86], 'Schneeschauer', 'snow'],
  [[95, 96, 99], 'Gewitter', 'storm'],
];

export function describe(code) {
  const match = CODES.find(([codes]) => codes.includes(code));
  return match ? { text: match[1], icon: match[2] } : { text: 'Unbekannt', icon: 'cloud' };
}

const WINDS = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
export const compass = (degrees) => WINDS[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];

// "2026-10-15T07:46" → "07:46"; Open-Meteo already returns local time.
const clock = (iso) => iso.slice(11, 16);
const hourLabel = (iso) => `${Number(iso.slice(11, 13))} Uhr`;

export function toWidgetData(json, { place }) {
  const { current, hourly, daily } = json;
  const today = current.time.slice(0, 10);
  const later = hourly.time.map((time, i) => ({ time, i })).filter(({ time }) => time > current.time);

  // The next five forecasts two hours apart: 10 Uhr, 12 Uhr, ...
  const hours = later
    .filter((_, n) => n % 2 === 1)
    .slice(0, 5)
    .map(({ time, i }) => ({
      label: hourLabel(time),
      temp: Math.round(hourly.temperature_2m[i]),
      icon: describe(hourly.weather_code[i]).icon,
      rain: hourly.precipitation_probability[i],
    }));

  const restOfToday = later.filter(({ time }) => time.startsWith(today));
  const wet = restOfToday.find(({ i }) => hourly.precipitation_probability[i] >= 50);
  const rainMax = Math.max(0, ...restOfToday.map(({ i }) => hourly.precipitation_probability[i]));
  const now = describe(current.weather_code);

  return {
    place,
    now: {
      temp: Math.round(current.temperature_2m),
      feels: Math.round(current.apparent_temperature),
      text: now.text,
      icon: now.icon,
      wind: Math.round(current.wind_speed_10m),
      windFrom: compass(current.wind_direction_10m),
    },
    today: {
      max: Math.round(daily.temperature_2m_max[0]),
      min: Math.round(daily.temperature_2m_min[0]),
      rainFrom: wet ? hourLabel(wet.time) : null,
      rainMax,
    },
    hours,
    sun: { sunrise: clock(daily.sunrise[0]), sunset: clock(daily.sunset[0]) },
  };
}

export default {
  id: 'wetter',
  intervalMs: 10 * 60_000,
  isConfigured: (config) => Number.isFinite(config.lat) && Number.isFinite(config.lon),

  async fetch({ config, fetchJson }) {
    const params = new URLSearchParams({
      latitude: config.lat,
      longitude: config.lon,
      current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m',
      hourly: 'temperature_2m,precipitation_probability,weather_code',
      daily: 'temperature_2m_max,temperature_2m_min,sunrise,sunset',
      timezone: config.timezone,
      forecast_days: 2,
    });
    return toWidgetData(await fetchJson(`${API}?${params}`), { place: config.place });
  },

  demo: ({ config }) => ({
    place: config.place,
    now: { temp: 14, feels: 12, text: 'Teils bewölkt', icon: 'cloudsun', wind: 18, windFrom: 'W' },
    today: { max: 16, min: 9, rainFrom: '17 Uhr', rainMax: 70 },
    hours: [
      { label: '10 Uhr', temp: 13, icon: 'cloudsun', rain: 0 },
      { label: '12 Uhr', temp: 15, icon: 'cloudsun', rain: 10 },
      { label: '14 Uhr', temp: 16, icon: 'cloud', rain: 15 },
      { label: '16 Uhr', temp: 15, icon: 'cloud', rain: 45 },
      { label: '18 Uhr', temp: 13, icon: 'rain', rain: 70 },
    ],
    sun: { sunrise: '07:46', sunset: '18:24' },
  }),
};
