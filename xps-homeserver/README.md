# xps-homeserver

Ein Dell XPS 13 9350 als Homeserver, der jahrelang ohne Pflege läuft:

- **Umbrel** mit allen Apps, als Container aus diesem Fork (Image baut GitHub)
- ein **Wand-Dashboard** (Design A · Glas) im Vollbild auf dem eingebauten
  Display, auch im Browser unter `http://xps.local:7777`
- ein **AirPlay-2-Lautsprecher** „XPS Lautsprecher“ über die Kopfhörerbuchse,
  mit Cover, Fortschritt und Farbschein im Musikmodus des Dashboards
- **automatische Helligkeit und Nachtansicht** über die Webcam, ohne dass je
  ein Bild gespeichert wird
- eine **Steuerung** auf dem Display und am Handy (`http://xps.local:7777/steuerung`):
  Bildschirm automatisch, immer an oder aus (nur Server), Zeitplan,
  Schnellaktionen, Regeln (dunkler Raum, Musik, Antippen, Stromausfall,
  niemand zu Hause) und jede Funktion einzeln an oder aus

**Installieren**: [docs/installation.md](docs/installation.md), Schritt für Schritt.
Wie die Teile zusammenhängen: [docs/architektur.md](docs/architektur.md).
Einrichten, Steuerung, Updates, Backup und Notfälle: [docs/betrieb.md](docs/betrieb.md).
Sicherheitsprüfung und Empfehlungen: [docs/sicherheit.md](docs/sicherheit.md).

## Stand

| Teil | Inhalt | Stand |
| --- | --- | --- |
| [Installer-Stick](installer/README.md) | Debian 13 mit Broadcom-WLAN-Treiber, ohne Netz installierbar | gebaut, in QEMU getestet |
| Grundsystem | Sicherheitsupdates mit Neustartfenster, Kernel-Wächter für den WLAN-Treiber, WLAN- und Hardware-Watchdog, kein Standby, zram, Journal-Limit, Akku bis 60 %, `umbrel.local`, Tailscale | eingebaut, in QEMU getestet; am XPS abzunehmen |
| Umbrel | Container-Image aus dem Fork (GitHub Actions → GHCR), Update mit Healthcheck und automatischem Rückfall, manueller Rollback | eingebaut; erster Start am XPS offen |
| [Dashboard](dashboard/README.md) | Wetter, Arbeitsweg mit Stau, Fotos, Kalender, Dienste, To-dos, XPS-Werte, Zuhause; Bearbeiten-Modus, Glas-Regler, Tageszeit-Videos, Kiosk als eigener Benutzer | fertig, getestet; Display am XPS abzunehmen |
| Steuerung | Modi, Zeitplan, Schnellaktionen, Regeln, Funktionsschalter; `xps-control` setzt sie um, `xps-display` auf der Kommandozeile | fertig, getestet; Backlight und „Aus“ am XPS abzunehmen |
| Sicherheit | CSRF- und DNS-Rebinding-Schutz, optionale PIN, CSP, Schrift lokal, Dienste ohne Rechte und ohne Netz | geprüft am 23.10.2026 |
| AirPlay | Shairport Sync 5.5 mit AirPlay 2, Metadaten-Pipe, Musikmodus | eingebaut; Ton am XPS abzunehmen |
| Webcam | Helligkeit messen, Display regeln, Nachtansicht im Dunkeln | eingebaut; Kamera am XPS abzunehmen |

## Ordner

| Ordner | Inhalt |
| --- | --- |
| `installer/` | baut den USB-Stick; `installer/iso/xps/host/` ist die Server-Konfiguration des Grundsystems |
| `dashboard/` | Server (Node.js, ohne Abhängigkeiten) und Oberfläche |
| `deploy/` | Umbrel-Compose, AirPlay-Compose, systemd-Units |
| `scripts/` | `setup-xps.sh` richtet alles ein, `update-xps.sh` aktualisiert, Umbrel-Update/-Rollback, Steuerung (`xps-control.py`, `xps-display.py`), Kiosk-Start, Webcam- und Dienste-Messung |
| `docs/` | Installation, Architektur, Betrieb und Notfallplan, Sicherheit |

## Wo das liegt

Dieser Ordner liegt in deinem Fork von umbrelOS. Das Original-Umbrel hat keinen
Ordner `xps-homeserver/`, deshalb kommen sich Umbrel-Updates und dieses Projekt
nie in die Quere. Der Fork ist öffentlich: Code ja, Geheimnisse nie.

## Geheimnisse

Nichts davon kommt ins Repo (`.gitignore`):

- `.env` auf dem Mac: WLAN-Passwort und Benutzer für den Installer-Stick
  (Vorlage `.env.example`)
- `/etc/xps-homeserver/dashboard.env` auf dem XPS: API-Schlüssel und Tokens
  des Dashboards (Vorlage `dashboard.env.example`)
- `/etc/xps-homeserver/host.env` auf dem XPS: optionale Feineinstellungen der
  Hintergrunddienste (Vorlage `host.env.example`)
