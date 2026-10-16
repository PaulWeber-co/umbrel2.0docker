# Dashboard

Das Wand-Dashboard für den XPS wird in **Design A · Glas** umgesetzt. Der
Installer richtet den Node.js-Server und den Chromium-Kiosk ein. Wetter- und
Hostdaten kommen direkt vom XPS; Kalender, To-dos und schaltbare Geräte lassen
sich über Home Assistant anbinden, Fotos über Immich.

## Einrichtung

`sudo xps-homeserver/scripts/install-xps-dashboard.sh <Linux-Benutzer>` klont
den gerade ausgecheckten Branch nach `/opt/xps-homeserver`, legt den
Dashboard-Dienst an und startet Design A auf `tty1`. Zugangsdaten stehen in
`/etc/xps-homeserver/dashboard.env`; das Beispiel liegt hier in
`dashboard.env.example`. Nach Änderungen daran den Dienst neu starten:

```sh
sudo systemctl restart xps-dashboard
```

## Glas-Effekt

Über das Reglersymbol unten rechts lässt sich die Glaswirkung zwischen klar
und milchig einstellen. Der Wert wird für alle Dashboard-Browser und den
XPS-Kiosk gemeinsam unter `DASH_DATA_DIR/settings.json` gespeichert. Auf dem
XPS ist das standardmäßig `/var/lib/xps-dashboard/settings.json`; `DASH_GLASS`
in `/etc/xps-homeserver/dashboard.env` legt den Startwert fest, wenn noch keine
Einstellung gespeichert wurde. Zum Zurücksetzen die Datei `settings.json`
entfernen und den Dienst neu starten.

Die Integrationen sind optional. Ohne Konfiguration zeigen Kalender, To-dos,
Zuhause, Arbeitsweg und Fotos ihre Demo-Ansicht. Für Zuhause werden nur die in
`DASH_HA_HOME_ENTITIES` freigegebenen `light`, `switch`, `fan` und
`input_boolean` schaltbar; andere Home-Assistant-Entitäten werden nur gelesen.
Die Dashboard-API ist im Heimnetz erreichbar und setzt voraus, dass dieses
Netzwerk vertrauenswürdig ist.

Ein AirPlay-Stream blendet automatisch den Musikmodus ein. Shairport Sync
liefert Titel, Interpret, Album und Cover über UDP auf `127.0.0.1`; die
Metadaten bleiben im Speicher des Dashboard-Prozesses.

Der Kameradienst misst nur den Median eines 16×12-Graubilds im Arbeitsspeicher,
passt damit die Backlight-Helligkeit an und verwirft das Bild sofort. Er läuft
ohne Netzwerk in `xps-ambient.service`; nur Prozentwerte und der Nachtmodus
werden in `/run/xps-ambient/ambient.json` abgelegt. Kamera, Schwellen und
Backlight-Kurve stehen in `/etc/xps-homeserver/ambient.env`.

## Entwürfe

`mockup/wand-dashboard.html` zeigt drei Design-Richtungen auf einer simulierten
1920×1080-Fläche. Design A ist ausgewählt; B und C bleiben als verworfene
Alternativen zur Dokumentation im Mockup:

- **A · Glas**: Milchglas-Kacheln wie in umbrelOS 2.0
- **B · Panorama**: viel Bild, Infos ruhig in einer Zeile
- **C · Leitstand**: dunkles Rauchglas, mehr Live-Daten

Die Seite lässt sich zwischen den Entwürfen, Tageszeiten, Musik-Modus und
Bearbeiten-Modus umschalten. Alle Zahlen darin sind Beispieldaten.

Lokal ansehen (die Videos werden heruntergeladen, nicht mitgeliefert):

```sh
dashboard/scripts/fetch-backgrounds.sh dashboard/mockup/media 720
open dashboard/mockup/wand-dashboard.html
```

## Hintergrundvideos

`scripts/backgrounds.txt` listet die Clips von Mixkit (frei nutzbar, aber
nicht weiterverteilbar, deshalb nicht im Repo). `scripts/fetch-backgrounds.sh`
lädt sie und macht daraus nahtlose Schleifen mit niedriger Bitrate.
