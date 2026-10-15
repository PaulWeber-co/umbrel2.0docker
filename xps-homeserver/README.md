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

## Phasen

| Phase | Inhalt | Stand |
| --- | --- | --- |
| 0 | [Installer-Stick](installer/README.md): Debian 13 mit WLAN-Treiber, ohne Netz installierbar | gebaut, in QEMU getestet |
| 1 | Grundsystem: Updates, Treiber-Schutz bei Kernel-Updates, Server-Betrieb, Akku, zram, Tailscale | offen |
| 2 | Umbrel-Container aus dem Fork, Update-Skript mit Rückfallebene | offen |
| 3 | Dashboard: Design-Entwürfe, Backend, Frontend, Kiosk | offen |
| 4 | AirPlay und Musik-Modus | offen |
| 5 | Webcam-Helligkeit und Nachtmodus | offen |
| 6 | Bedienungsanleitung und Notfallplan | offen |

## Wo das liegt

Dieser Ordner liegt in deinem Fork von umbrelOS. Das Original-Umbrel hat keinen
Ordner `xps-homeserver/`, deshalb kommen sich Umbrel-Updates und dieses Projekt
nie in die Quere. Der Fork ist öffentlich: Code ja, Geheimnisse nie.

## Geheimnisse

WLAN-Passwort, API-Schlüssel und Adressen stehen nur in `.env`. Die Datei
steht in `.gitignore` und landet nie im Repo; `.env.example` zeigt, was
hineingehört.
