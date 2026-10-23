# Dashboard

Das Wand-Dashboard in **Design A · Glas**: ein kleiner Node.js-Server ohne
Abhängigkeiten sammelt die Daten, die Oberfläche läuft im Chromium-Kiosk auf
dem XPS-Display und in jedem Browser unter `http://xps.local:7777`.
`scripts/setup-xps.sh` richtet Dienst und Kiosk ein (siehe
[Betrieb](../docs/betrieb.md)).

## Kacheln

| Kachel | Quelle | Einstellungen |
| --- | --- | --- |
| Wetter | Open-Meteo, ohne Schlüssel | `DASH_PLACE`, `DASH_LAT`, `DASH_LON` |
| Arbeitsweg | TomTom mit Verkehrslage, nur im eingestellten Zeitfenster | `DASH_TOMTOM_KEY`, `DASH_HOME_*`, `DASH_WORK_*`, `DASH_COMMUTE_*` |
| Fotos | Immich: Fotos, Videos, diese Woche neu | `DASH_IMMICH_URL`, `DASH_IMMICH_KEY` |
| Kalender | Home-Assistant-Kalender (z. B. iCloud über CalDAV) | `DASH_HA_CALENDAR_ENTITY` |
| Dienste | Umbrel-Apps und eigene docker-compose-Projekte: Status, CPU, RAM, Laufzeit | `DASH_SERVICES_NAMES`, `DASH_SERVICES_HIDE` |
| To-dos | Home-Assistant-Liste, abhaken und hinzufügen | `DASH_HA_TODO_ENTITY` |
| XPS | CPU, RAM, SSD, Temperatur des XPS selbst | – |
| Zuhause | Home-Assistant-Entitäten, Licht und Schalter tippbar | `DASH_HA_ENTITIES` |

Zugriff: `DASH_PIN` (Sperre für Änderungen von anderen Geräten),
`DASH_ALLOWED_HOSTS` (eigene Hostnamen).

Alle Einstellungen mit Beispielen stehen in
[`dashboard.env.example`](../dashboard.env.example). Fehlt einer Kachel eine
Pflicht-Einstellung, zeigt sie Beispieldaten und oben rechts die Marke
„Beispiel“.

**Dienste** zeigt alles, was auf dem XPS in Docker läuft: jede Umbrel-App und
jedes eigene Compose-Projekt (Frontend, Backend, Datenbank …) als eine Zeile,
Probleme zuerst. Die Werte sammelt `xps-services.service`
(`scripts/xps-services.py`) als root, weil der Docker-Socket root-gleich ist;
das Dashboard selbst bekommt nie Zugriff auf Docker. Ein Projekt ist „Problem“,
wenn ein Container, der laufen soll, steht, neu startet oder als ungesund
gemeldet wird. Einmalige Aufgaben (Migration, Init), die erfolgreich beendet
sind, zählen nicht als Problem.

## Bedienung

- **Steuerung**: der runde Knopf unten rechts, oder `http://xps.local:7777/steuerung`
  am Handy. Bildschirm automatisch, immer an oder aus (nur Server),
  Schnellaktionen, Zeitplan, Regeln, Funktionen, Kacheln ein/aus und der
  Systemzustand; alles gilt sofort für alle Geräte. Was wann gilt, steht in
  [docs/betrieb.md](../docs/betrieb.md#steuerung-was-der-bildschirm-wann-zeigt).
- **Bearbeiten**: lange auf eine Kachel drücken (oder Steuerung → „Kacheln
  anordnen“). Dann Kacheln gleicher Größe
  tauschen, auf freie Felder ziehen, mit × entfernen und unten wieder
  hinzufügen; „Fertig“ speichert die Anordnung für alle Bildschirme.
- **Glas-Effekt**: in der Steuerung unter Funktionen, von klar bis milchig.
  Der Wert gilt für alle Browser und den Kiosk (`DASH_DATA_DIR/settings.json`;
  `DASH_GLASS` ist nur der Startwert).
- **Musikmodus**: Sobald etwas per AirPlay läuft, gleiten die Kacheln zur
  Seite, Cover, Titel und Fortschritt erscheinen, der Hintergrund nimmt die
  Farbe des Covers an. Nach dem Ende oder fünf Minuten Pause geht es zurück.
  Abschaltbar in der Steuerung; auf Wunsch weckt Musik den Bildschirm.
- **Tageszeiten**: Morgen, Tag, Abend und später Abend haben eigene Videos
  und Farben (in der Steuerung abschaltbar). Außerhalb des Zeitplans bleibt
  nur eine gedimmte Uhr, ein schwarzer oder ein ausgeschalteter Bildschirm;
  ist der Raum dunkel (Webcam), kommt die Nachtuhr auch tagsüber. Antippen
  zeigt das Dashboard für ein paar Minuten.
- **Andere Geräte**: Ein Browser am Mac oder Handy zeigt immer die Kacheln,
  auch wenn die Wand schwarz ist; oben steht dann „Wandbildschirm aus“.

## Datenschutz und Sicherheit

Der Webcam-Dienst liest wenige Bilder in 16×12 Graupunkten in den Speicher,
nimmt den Median und verwirft die Pixel sofort; er hat keinen
Netzwerkzugang und schreibt nur Zahlen nach `/run/xps-ambient/ambient.json`.
Bei schwarzem oder ausgeschaltetem Bildschirm bleibt die Kamera aus.
AirPlay-Metadaten bleiben im Speicher des Dashboard-Prozesses.

Die Dashboard-Seite ist im Heimnetz ohne Anmeldung lesbar (von unterwegs
über Tailscale). Änderungen (Licht, To-dos, Kacheln, Steuerung) nimmt der
Server nur als JSON vom Dashboard selbst und nur unter Heimnetz-Namen an; mit
`DASH_PIN` brauchen andere Geräte zusätzlich einmal die PIN, der Kiosk nie.
Mehr in [docs/sicherheit.md](../docs/sicherheit.md).

## Entwickeln

```sh
cd dashboard
npm run demo        # Beispieldaten, http://localhost:7777
npm test            # Unit-Tests
npm run check       # Syntax aller Dateien
npm run smoke       # Server starten und Seiten abrufen
```

Eine neue Kachel: [WIDGETS.md](WIDGETS.md). Echte Daten lokal: im Ordner
`xps-homeserver/` `cp dashboard.env.example dashboard.env`, ausfüllen,
`npm start`.

## Entwürfe und Hintergrundvideos

`mockup/wand-dashboard.html` zeigt die drei Design-Richtungen, aus denen
Design A gewählt wurde (B · Panorama und C · Leitstand bleiben zur
Dokumentation). `scripts/backgrounds.txt` listet die Clips von Mixkit; sie
dürfen genutzt, aber nicht weiterverteilt werden und liegen deshalb nicht im
Repo. `scripts/fetch-backgrounds.sh` lädt sie und macht nahtlose Schleifen
daraus (setup-xps.sh erledigt das auf dem XPS einmalig):

```sh
dashboard/scripts/fetch-backgrounds.sh dashboard/mockup/media 720
open dashboard/mockup/wand-dashboard.html
```
