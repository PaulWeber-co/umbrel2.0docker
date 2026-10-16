# Dashboard

Das Wand-Dashboard für den XPS wird in **Design A · Glas** umgesetzt. Backend,
Frontend sowie Wetter- und Server-Widget sind vorhanden. Die Kiosk-Integration
und die übrigen Datenquellen sind noch offen.

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
