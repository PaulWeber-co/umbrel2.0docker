// Runs every widget on its own schedule, keeps its latest result and tells
// subscribers (the browsers connected to /api/events) about each change.
//
// A failing source keeps its last good data, records the error and retries
// with backoff. A widget whose settings are missing, or the whole dashboard in
// demo mode, serves the widget's sample data instead, marked demo: true.
//
// The widget contract (see server/widgets/weather.js for a complete example):
//   id           string, matches the front-end module in web/js/widgets/
//   intervalMs   how often fetch() runs
//   isConfigured(config) -> boolean, optional: false means "use demo()"
//   fetch(ctx)   -> data, the real source
//   demo(ctx)    -> data, the same shape as fetch() with sample values
//   actions      optional { name: async (ctx & { payload, demo }) => result }
//   watch(ctx, emit) optional, for sources that push (the AirPlay metadata
//                pipe): called once at start unless in demo mode, emit(data)
//                publishes at once, returns a function that stops watching.
//                fetch() still runs every intervalMs and returns the current state.
//   ctx = { config, store, log, now, fetchJson, fetchText, fetchBytes, peek }
//   fetchBytes(url, { maxBytes }) → { bytes, type } for small images
//   peek(id) is the latest data of another widget (Minifunk asks for music)
//
// Updates whose data did not change are not sent to the browsers again.

export class Hub {
  #widgets = new Map();
  #entries = new Map();
  #timers = new Map();
  #failures = new Map();
  #listeners = new Set();
  #watchers = [];
  #running = false;

  constructor({ widgets, config, store, fetchImpl = globalThis.fetch, log = console, timeoutMs = 15000 }) {
    for (const widget of widgets) this.#widgets.set(widget.id, widget);
    this.config = config;
    this.store = store;
    this.log = log;
    this.ctx = {
      config,
      store,
      log,
      now: () => new Date(),
      fetchJson: (url, options) => fetchJson(fetchImpl, url, { timeoutMs, ...options }),
      fetchText: (url, options) => fetchText(fetchImpl, url, { timeoutMs, ...options }),
      fetchBytes: (url, options) => fetchBytes(fetchImpl, url, { timeoutMs, ...options }),
      peek: (id) => this.#entries.get(id)?.data ?? null,
    };
  }

  usesDemo(widget) {
    return Boolean(this.config.demo || (widget.isConfigured && !widget.isConfigured(this.config)));
  }

  async refresh(id) {
    const widget = this.#widgets.get(id);
    if (!widget) throw new Error(`Unbekanntes Widget ${id}`);
    const demo = this.usesDemo(widget);
    const previous = this.#entries.get(id);
    try {
      const data = demo ? await widget.demo(this.ctx) : await widget.fetch(this.ctx);
      this.#failures.set(id, 0);
      this.#set({ id, data, demo, updatedAt: Date.now(), error: null });
    } catch (error) {
      this.#failures.set(id, (this.#failures.get(id) ?? 0) + 1);
      this.log.warn(`[${id}] ${error.message}`);
      this.#set({ id, data: previous?.data ?? null, demo, updatedAt: previous?.updatedAt ?? null, error: error.message });
    }
    return this.#entries.get(id);
  }

  // After a failure retry after 30 s, then 60 s, 120 s ... but never later than
  // the widget's normal interval.
  delayFor(id) {
    const widget = this.#widgets.get(id);
    const failures = this.#failures.get(id) ?? 0;
    if (!failures) return widget.intervalMs;
    return Math.min(widget.intervalMs, 30_000 * 2 ** (failures - 1));
  }

  start() {
    this.#running = true;
    for (const [id, widget] of this.#widgets) {
      if (widget.watch && !this.usesDemo(widget)) this.#watch(id, widget);
      this.#loop(id);
    }
  }

  stop() {
    this.#running = false;
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
    for (const stopWatching of this.#watchers.splice(0)) stopWatching?.();
  }

  #watch(id, widget) {
    const emit = (data) => {
      if (this.#running) this.#set({ id, data, demo: false, updatedAt: Date.now(), error: null });
    };
    try {
      this.#watchers.push(widget.watch(this.ctx, emit));
    } catch (error) {
      this.log.warn(`[${id}] watch: ${error.message}`);
    }
  }

  async #loop(id) {
    if (!this.#running) return;
    await this.refresh(id);
    if (!this.#running) return;
    const timer = setTimeout(() => this.#loop(id), this.delayFor(id));
    timer.unref?.();
    this.#timers.set(id, timer);
  }

  async action(id, name, payload) {
    const widget = this.#widgets.get(id);
    // Only the widget's own actions: names like "constructor" or "toString"
    // would otherwise reach Object.prototype through the URL
    const run = widget?.actions && Object.hasOwn(widget.actions, name) ? widget.actions[name] : null;
    if (typeof run !== 'function') {
      const error = new Error(`Widget ${id} kennt die Aktion ${name} nicht`);
      error.status = 404;
      throw error;
    }
    const result = await run({ ...this.ctx, payload, demo: this.usesDemo(widget) });
    await this.refresh(id);
    return result ?? null;
  }

  snapshot() {
    return Object.fromEntries(this.#entries);
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #set(entry) {
    const previous = this.#entries.get(entry.id);
    this.#entries.set(entry.id, entry);
    const same =
      previous &&
      previous.error === entry.error &&
      previous.demo === entry.demo &&
      JSON.stringify(previous.data) === JSON.stringify(entry.data);
    if (same) return;
    for (const listener of this.#listeners) listener(entry);
  }
}

// Keeps API keys out of logs and error messages.
export function redact(url) {
  return String(url).replace(/([?&](?:key|token|auth|apikey|api_key|access_token)=)[^&]+/gi, '$1…');
}

// "fetch failed" says nothing; the cause does (ENOTFOUND, ECONNREFUSED, a
// certificate problem), and the log and the tile's error show it
export function networkReason(error) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'keine Antwort (Zeitüberschreitung)';
  const cause = error?.cause;
  const code = cause?.code ?? error?.code;
  const known = {
    ENOTFOUND: 'Name nicht gefunden (Tippfehler oder kein Internet?)',
    EAI_AGAIN: 'Name nicht auflösbar (kein Internet?)',
    ECONNREFUSED: 'Verbindung abgelehnt (läuft der Dienst?)',
    EHOSTUNREACH: 'Rechner nicht erreichbar',
    ENETUNREACH: 'kein Netz',
    ECONNRESET: 'Verbindung abgebrochen',
  };
  return known[code] ?? (code ? `${code}${cause?.message ? ` – ${cause.message}` : ''}` : cause?.message || error?.message || String(error));
}

async function request(fetchImpl, url, { timeoutMs = 15000, method = 'GET', headers = {}, body } = {}) {
  let response;
  try {
    response = await fetchImpl(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new Error(`${method} ${redact(url)}: ${networkReason(error)}`, { cause: error });
  }
  if (!response.ok) throw new Error(`${method} ${redact(url)}: HTTP ${response.status}`);
  return response;
}

export async function fetchJson(fetchImpl, url, options = {}) {
  const response = await request(fetchImpl, url, { ...options, headers: { accept: 'application/json', ...options.headers } });
  return response.json();
}

export async function fetchText(fetchImpl, url, options = {}) {
  const response = await request(fetchImpl, url, options);
  return response.text();
}

// A small binary file (a picture): refused before and after download when it
// is larger than maxBytes
export async function fetchBytes(fetchImpl, url, { maxBytes = 1024 * 1024, ...options } = {}) {
  const response = await request(fetchImpl, url, options);
  const tooLarge = () => new Error(`GET ${redact(url)}: größer als ${maxBytes} Bytes`);
  if (Number(response.headers.get('content-length')) > maxBytes) throw tooLarge();
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw tooLarge();
  return { bytes, type: response.headers.get('content-type') ?? '' };
}
