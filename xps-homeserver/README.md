# xps-homeserver

Ein Dell XPS 13 9350 als Homeserver, der jahrelang ohne Pflege läuft:

- **Umbrel** mit allen Apps, im Container aus dem Umbrel-Teil dieses Repos
  (`compose.yaml` eine Ebene höher, siehe `DOCKER.md`)
- ein **Wand-Dashboard** im Vollbild auf dem eingebauten Display, auch im
  Browser erreichbar
- ein **AirPlay-Lautsprecher** über die Kopfhörerbuchse, mit Cover und
  Songinfos auf dem Dashboard
- **automatische Helligkeit und Nachtmodus** über die Webcam

Wie die Teile zusammenhängen und warum sie so gebaut sind:
[docs/architektur.md](docs/architektur.md).

Für eine unabhängige Prüfung und die Weiterarbeit mit Opus 5.5 gibt es den
[Hand-off mit Review-Prompt](OPUS_5_5_HANDOFF.md).

## Phasen

| Phase | Inhalt | Stand |
| --- | --- | --- |
| 0 | [Installer-Stick](installer/README.md): Debian 13 mit WLAN-Treiber, ohne Netz installierbar | gebaut, in QEMU getestet |
| 1 | Grundsystem: Updates, Treiber-Schutz bei Kernel-Updates, Server-Betrieb, Akku, zram, Tailscale | eingebaut; am XPS zu verifizieren |
| 2 | Umbrel-Container aus dem Fork, Update-Skript mit Rückfallebene | eingebaut; XPS-Deployment offen |
| 3 | Dashboard: [Design-Entwürfe](dashboard/README.md), Backend, Frontend, Kiosk | Design A mit Wetter, Server, Arbeitsweg, Fotos, Kalender, To-dos und Zuhause; Kiosk-Installer eingebaut; XPS-Display noch zu verifizieren |
| 4 | AirPlay und Musik-Modus | Shairport Sync mit AirPlay 2, Titel/Cover und automatischer Musikansicht eingebaut; XPS-Audio noch zu verifizieren |
| 5 | Webcam-Helligkeit und Nachtmodus | Isolierter Kameradienst, automatische Backlight-Regelung und Nachtmodus eingebaut; XPS-Kamera/Display noch zu verifizieren |
| 6 | [Bedienungsanleitung und Notfallplan](docs/betrieb.md) | Betrieb, Update, Rückrollen, Backup und Wiederherstellung dokumentiert |

## Wo das liegt

Dieser Ordner liegt in deinem Fork von umbrelOS. Das Original-Umbrel hat keinen
Ordner `xps-homeserver/`, deshalb kommen sich Umbrel-Updates und dieses Projekt
nie in die Quere. Der Fork ist öffentlich: Code ja, Geheimnisse nie.

## Geheimnisse

Das WLAN-Passwort für den Installer steht lokal in `.env`; die Datei steht in
`.gitignore`, und `.env.example` zeigt die nötigen Werte. Dashboard-API-Schlüssel
liegen auf dem XPS separat in `/etc/xps-homeserver/dashboard.env`; das Beispiel
dafür ist `dashboard.env.example`. Beide Dateien gehören nicht ins Repo.
