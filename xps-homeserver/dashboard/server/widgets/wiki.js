// Wikipedia tile: what the German main page shows today, by time of day.
// Mornings "Was geschah am 27. Oktober?", afternoons "Schon gewusst?", evenings
// the article of the day. Events and facts take turns once a minute. No key:
// one request to Wikimedia's feed per day (again after FEED_MAX_AGE_MS), the
// small picture of the item on show fetched by the server and sent as a data
// URI, since the page's CSP loads no images from elsewhere.
//   GET https://api.wikimedia.org/feed/v1/wikipedia/de/featured/YYYY/MM/DD
//
// The feed is the main page itself: onthisday are its "Was geschah am" items,
// dyk its "Schon gewusst?" and tfa its "Artikel des Tages".

const FEED = 'https://api.wikimedia.org/feed/v1/wikipedia/de/featured';
// Wikimedia asks every client to say who it is
const HEADERS = { 'api-user-agent': 'xps-homeserver-dashboard (https://github.com/PaulWeber-co/umbrel2.0docker)' };
const FEED_MAX_AGE_MS = 3 * 3600_000;
const IMAGE_HOST = /^https:\/\/(upload|thumb)\.wikimedia\.org\//;
const IMAGE_TYPE = /^image\/(jpeg|png|webp|gif)$/;
const MAX_IMAGE_BYTES = 256 * 1024;
const MAX_TEXT = 280;

const HEADINGS = { events: null, facts: 'Schon gewusst?', article: 'Artikel des Tages' };

// "Marie von Olfers (Bild), deutsche …" → "Marie von Olfers, deutsche …": the
// main page's picture is not the one on the wall
export function clean(text) {
  return String(text ?? '')
    .replace(/\s*\((?:im |siehe )?Bild(?: [a-zäöü]+)?\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Long article extracts end at the last full sentence that fits
export function shorten(text, max = MAX_TEXT) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return end > max / 2 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(' '))} …`;
}

const thumbOf = (page) => {
  const url = page?.thumbnail?.source;
  return typeof url === 'string' && IMAGE_HOST.test(url) ? url : null;
};
const titleOf = (page) => page?.titles?.normalized ?? (typeof page?.title === 'string' ? page.title.replace(/_/g, ' ') : null);

// The feed's answer → { events, facts, article }, every text cleaned
export function toFeed(json) {
  const events = (Array.isArray(json?.onthisday) ? json.onthisday : [])
    .filter((item) => typeof item?.text === 'string' && item.text.trim())
    .map((item) => {
      const page = Array.isArray(item.pages) ? item.pages.find(thumbOf) ?? item.pages[0] : null;
      return { year: Number.isInteger(item.year) ? item.year : null, title: titleOf(page), text: clean(item.text), thumb: thumbOf(page) };
    })
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  const facts = (Array.isArray(json?.dyk) ? json.dyk : [])
    .filter((item) => typeof item?.text === 'string' && item.text.trim())
    .map((item) => ({ year: null, title: null, text: clean(item.text), thumb: null }));
  const tfa = json?.tfa;
  const article = tfa && typeof tfa.extract === 'string' && tfa.extract.trim()
    ? { year: null, title: titleOf(tfa), text: shorten(clean(tfa.extract)), thumb: thumbOf(tfa) }
    : null;
  return { events, facts, article };
}

// Parts of the date and the hour where the wall hangs
export function localDay(now, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  return {
    key: `${parts.year}/${parts.month}/${parts.day}`,
    hour: Number(parts.hour),
    label: now.toLocaleDateString('de-DE', { timeZone, day: 'numeric', month: 'long' }),
  };
}

// Before noon the day's events, until six the facts, then the article. A part
// that is empty today falls back to the next one. Within a part the items
// take turns every minute.
export function pick(feed, now, timeZone) {
  const day = localDay(now, timeZone);
  const order = day.hour < 12 ? ['events', 'facts', 'article'] : day.hour < 18 ? ['facts', 'events', 'article'] : ['article', 'events', 'facts'];
  for (const kind of order) {
    const items = kind === 'article' ? (feed.article ? [feed.article] : []) : feed[kind];
    if (!items.length) continue;
    const index = Math.floor(now.getTime() / 60_000) % items.length;
    const item = items[index];
    return {
      date: day.label,
      kind,
      heading: HEADINGS[kind] ?? `Am ${day.label}`,
      year: item.year,
      title: item.title,
      text: item.text,
      thumb: item.thumb,
      position: index + 1,
      count: items.length,
    };
  }
  return null;
}

export function createWikiWidget() {
  let cache = { key: null, at: 0, feed: null };
  const images = new Map();

  async function feedFor(ctx, key) {
    const fresh = cache.key === key && ctx.now().getTime() - cache.at < FEED_MAX_AGE_MS;
    if (fresh) return cache.feed;
    try {
      const feed = toFeed(await ctx.fetchJson(`${FEED}/${key}`, { headers: HEADERS }));
      cache = { key, at: ctx.now().getTime(), feed };
      return feed;
    } catch (error) {
      // Today's feed from a little while ago is still today's
      if (cache.key === key) return cache.feed;
      throw error;
    }
  }

  // A picture is a nice extra: when it fails, the tile shows the text alone
  async function imageFor(ctx, url) {
    if (!url || !ctx.fetchBytes) return null;
    if (images.has(url)) return images.get(url);
    let image = null;
    try {
      const { bytes, type } = await ctx.fetchBytes(url, { headers: HEADERS, maxBytes: MAX_IMAGE_BYTES });
      const mime = String(type).split(';')[0].trim().toLowerCase();
      if (IMAGE_TYPE.test(mime)) image = `data:${mime};base64,${bytes.toString('base64')}`;
    } catch (error) {
      ctx.log?.warn?.(`[wiki] Bild nicht geladen: ${error.message}`);
    }
    if (images.size >= 16) images.clear();
    images.set(url, image);
    return image;
  }

  return {
    id: 'wiki',
    intervalMs: 60_000,

    async fetch(ctx) {
      const now = ctx.now();
      const timeZone = ctx.config.timezone;
      const shown = pick(await feedFor(ctx, localDay(now, timeZone).key), now, timeZone);
      if (!shown) throw new Error('Wikipedia hat heute nichts für die Hauptseite geliefert');
      const { thumb, ...data } = shown;
      return { ...data, image: await imageFor(ctx, thumb) };
    },

    demo: () => ({
      date: '27. Oktober',
      kind: 'events',
      heading: 'Am 27. Oktober',
      year: 1996,
      title: 'Nationalpark Donau-Auen',
      text: 'Der National­park Donau-Auen wird mit der Unter­zeichnung eines Staats­vertrags zwischen der Republik Österreich und den Bundes­ländern Wien und Nieder­österreich offiziell eröffnet.',
      position: 1,
      count: 5,
      image: null,
    }),
  };
}

export default createWikiWidget();
