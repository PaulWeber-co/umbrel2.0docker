# Ein Widget hinzufügen

Ein Widget besteht aus zwei Dateien mit derselben ID, zum Beispiel `wetter`:

| Datei | Aufgabe |
| --- | --- |
| `server/widgets/<name>.js` | holt die Daten, läuft im Server |
| `web/js/widgets/<id>.js` | zeichnet die Kachel, läuft im Browser |

Dazu kommen ein Eintrag in `server/widgets/index.js` und in
`web/js/widgets/index.js`, ein Test unter `test/` und die Einstellungen in
`xps-homeserver/.env.example`. Das vollständige Vorbild ist das Wetter:
`server/widgets/weather.js`, `web/js/widgets/wetter.js`, `test/weather.test.js`.
Das Server-Widget liest lokale Host-Werte aus `/proc`, `/sys` und Node.js und
braucht dafür keine Einträge in `.env`.

## Server: `server/widgets/<name>.js`

```js
export default {
  id: 'fotos',                      // a-z, 0-9, -; gleich der Datei in web/js/widgets/
  intervalMs: 30 * 60_000,          // wie oft fetch() läuft
  isConfigured: (config) => Boolean(config.get('DASH_IMMICH_KEY')),
  async fetch(ctx) { ... },         // echte Daten
  demo(ctx) { ... },                // Beispieldaten, gleiche Form wie fetch()
  actions: { async toggle(ctx) { ... } },   // optional, ctx.payload, ctx.demo
  watch(ctx, emit) { ...; return stop },    // optional, nur für Quellen, die selbst melden
};
```

`ctx` enthält:

- `config`: `config.get('DASH_X', fallback)` und `config.num('DASH_X', fallback)`
  lesen Einstellungen, außerdem `config.lat`, `config.lon`, `config.place`,
  `config.timezone`, `config.name`.
- `fetchJson(url, { method, headers, body })` und `fetchText(...)`, beide mit
  15 s Zeitlimit; bei HTTP-Fehlern werfen sie eine Exception.
- `store.read(name, fallback)` und `store.write(name, value)` für JSON-Dateien
  im Datenordner.
- `now()` (für Tests ersetzbar) und `log`.

Regeln:

- Wirft `fetch()`, behält der Hub die letzten guten Daten, zeigt einen kleinen
  Warnpunkt an der Kachel und versucht es nach 30 s, 60 s, 120 s … erneut.
- Fehlen Einstellungen (`isConfigured` liefert `false`) oder läuft der Server
  mit `--demo`, kommt `demo()`. Beispieldaten sind realistisch, auf Deutsch
  und haben genau die Form der echten Daten. Der Test vergleicht beide.
- Die Umwandlung API-Antwort → Widget-Daten steht in einer reinen Funktion
  (wie `toWidgetData` im Wetter), damit Tests sie mit einer Fixture prüfen
  können.
- Schlüssel und Tokens gehören in Header oder werden mit `redact()` aus
  `server/hub.js` aus Meldungen entfernt; niemals loggen.
- Aktionen prüfen ihren `payload`, denn jeder im Heimnetz kann sie aufrufen.

## Browser: `web/js/widgets/<id>.js`

```js
import { esc, icon, num } from '../util.js';
export const label = 'Fotos';               // Name im Bearbeiten-Modus
export function render(data, { compact }) { // HTML für den Kachelinhalt
  if (!data) return `<div class="lbl">${icon('photo')}Fotos</div><div class="loading">Lädt …</div>`;
  ...
}
```

- `data` ist `null`, solange noch nichts geladen ist.
- `compact` ist im Musik-Modus `true`, dann ist die Kachel schmaler.
- Jeder Wert vom Server geht durch `esc()`. Zahlen formatiert `num(18432)`
  als „18.432“.
- Klicks: `<button data-action="toggle" data-payload='{"id":"x"}'>` oder
  `<form data-action="add">` (die Formularfelder sind der Payload). Das
  Ergebnis kommt automatisch über `/api/events` zurück.

### Größen (Design A, Fläche 1920×1080)

| Kachel | außen | innen (ohne 28/30 px Rand) |
| --- | --- | --- |
| 1×1 | 248 × 290 | 188 × 234 |
| 2×1 | 520 × 290 | 460 × 234 |
| 1×1 im Musik-Modus | 232 × 290 | 172 × 234 |
| 2×1 im Musik-Modus | 488 × 290 | 428 × 234 |

Text darf nie abgeschnitten werden: lieber kürzen, kleinere Schrift (`.big.long`)
oder Zeilen weglassen.

### Bausteine aus `web/css/dashboard.css`

`.lbl` (Kopfzeile mit Icon, `<em>` rechts), `.big` / `.big small` / `.big.long`,
`.sub`, `.foot` (unten), `.pill` (Hinweis, z. B. Stau), `.ph` (Platzhalter),
`.loading`, `.row` (Icon + Text), `.switch` mit `.knob` und `aria-pressed`,
`.check` mit `.box` und `aria-pressed`, `.bar > i` (Balken, Breite über
`transform: scaleX(0.6)`). Eigene Regeln für ein Widget stehen in
`web/css/w-<id>.css` und werden in `web/index.html` eingebunden.

Icons (`icon('name')`): sun, cloud, cloudsun, rain, snow, storm, fog, car,
train, cal, check, list, cpu, temp, photo, home, bulb, washer, note, trend, x,
plus, airplay, wifi-off.

## Prüfen

```sh
node --test test/<name>.test.js   # nur das eigene Widget
npm test                          # alles, inklusive Vertragstest für jedes Widget
npm run check                     # Syntax aller Dateien
npm run smoke                     # echter Server im Demo-Modus
npm run demo                      # ansehen: http://localhost:8080
```

Tests greifen nie aufs Netz zu: `fetchJson` wird im Test durch eine Funktion
ersetzt, die eine Fixture zurückgibt.
