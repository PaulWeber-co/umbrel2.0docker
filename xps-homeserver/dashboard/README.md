# Dashboard

Noch im Entwurf. Hier entsteht das Wand-Dashboard für das Display des XPS.

## Entwürfe

`mockup/wand-dashboard.html` zeigt drei Design-Richtungen auf einer simulierten
1920×1080-Fläche:

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
