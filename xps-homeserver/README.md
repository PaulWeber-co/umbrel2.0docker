# xps-homeserver

Ein Dell XPS 13 9350 als Homeserver, der jahrelang ohne Pflege läuft:

- **Umbrel** mit allen Apps, als Container aus diesem Fork (Image baut GitHub)
- ein **Wand-Dashboard** (Design A · Glas) im Vollbild auf dem eingebauten
  Display, auch im Browser unter `http://xps.local:7777`
- ein **Lautsprecher für AirPlay 2 und Spotify Connect** „XPS Lautsprecher“
  über die Kopfhörerbuchse, mit Cover, Fortschritt und Farbschein im
  Musikmodus des Dashboards
- **automatische Helligkeit und Nachtansicht** über die Webcam, ohne dass je
  ein Bild gespeichert wird
- **Luftaufnahmen** wie beim Apple TV hinter den Kacheln: Städte, Küsten,
  Berge, jeden Tag andere, sparsam in der Grafik dekodiert
- **Apple Kalender und Erinnerungen** auf der Wand: Kalender über ihren Link,
  eine Erinnerungsliste (z. B. Einkauf) über einen Kurzbefehl, in beide
  Richtungen
- **Minifunk** aus der Knuddl-App: kurze Nachrichten, Listen und ein Foto am
  Tag erscheinen unter der Uhr, mit Namen, Ende-zu-Ende verschlüsselt
- eine **Steuerung** auf dem Display und am Handy (`http://xps.local:7777/steuerung`):
  Bildschirm automatisch, immer an oder aus (nur Server), Zeitplan,
  Schnellaktionen, Regeln (dunkler Raum, Musik, Antippen, Stromausfall,
  niemand zu Hause) und jede Funktion einzeln an oder aus

**Installieren**: [docs/installation.md](docs/installation.md), Schritt für Schritt.
Wie die Teile zusammenhängen: [docs/architektur.md](docs/architektur.md).
Einrichten, Steuerung, Updates, Backup und Notfälle: [docs/betrieb.md](docs/betrieb.md).
Sicherheitsprüfung und Empfehlungen: [docs/sicherheit.md](docs/sicherheit.md).
Läuft etwas nicht: `sudo xps-doctor` auf dem XPS prüft alles und sagt, woran es liegt.

## Stand

| Teil | Inhalt | Stand |
| --- | --- | --- |
| [Installer-Stick](installer/README.md) | Debian 13 mit Broadcom-WLAN-Treiber, ohne Netz installierbar | gebaut, in QEMU getestet |
| Grundsystem | Sicherheitsupdates mit Neustartfenster, Kernel-Wächter für den WLAN-Treiber, WLAN- und Hardware-Watchdog, kein Standby, zram, Journal-Limit, Akku bis 60 %, `umbrel.local`, Tailscale | eingebaut, in QEMU getestet; am XPS abzunehmen |
| Umbrel | Container-Image aus dem Fork (GitHub Actions → GHCR), Update mit Healthcheck und automatischem Rückfall, manueller Rollback | eingebaut; erster Start am XPS offen |
| [Dashboard](dashboard/README.md) | Wetter, Arbeitsweg mit Stau, Fotos, Kalender (Apple, Home Assistant), Dienste, To-dos (Apple Erinnerungen, Home Assistant), XPS-Werte, Zuhause, Minifunk; Bearbeiten-Modus, Glas-Regler, täglich wechselnde Luftaufnahmen, Kiosk als eigener Benutzer | fertig, getestet; Display am XPS abzunehmen |
| Steuerung | Modi, Zeitplan, Schnellaktionen, Regeln, Funktionsschalter; `xps-control` setzt sie um, `xps-display` auf der Kommandozeile | fertig, getestet; Backlight und „Aus“ am XPS abzunehmen |
| Sicherheit | CSRF- und DNS-Rebinding-Schutz, optionale PIN, CSP, Schrift lokal, Dienste ohne Rechte und ohne Netz | geprüft am 23.10.2026 |
| Lautsprecher | Shairport Sync 5.5 mit AirPlay 2 (Metadaten-Pipe) und go-librespot 0.10 für Spotify Connect (lokale API), Musikmodus | eingebaut; Ton am XPS abzunehmen |
| Webcam | Helligkeit messen, Display regeln, Nachtansicht im Dunkeln | eingebaut; Kamera am XPS abzunehmen |

## Ordner

| Ordner | Inhalt |
| --- | --- |
| `installer/` | baut den USB-Stick; `installer/iso/xps/host/` ist die Server-Konfiguration des Grundsystems |
| `dashboard/` | Server (Node.js, ohne Abhängigkeiten) und Oberfläche |
| `deploy/` | Umbrel-Compose, Lautsprecher-Compose (AirPlay, Spotify), systemd-Units |
| `scripts/` | `setup-xps.sh` richtet alles ein, `update-xps.sh` aktualisiert, `xps-doctor.py` prüft alles, Umbrel-Update/-Rollback, Steuerung (`xps-control.py`, `xps-display.py`), Kiosk-Start, Webcam- und Dienste-Messung |
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
  des Dashboards, die Knuddl-Einladung und die Kalender-Links (Vorlage
  `dashboard.env.example`)
- `/etc/xps-homeserver/host.env` auf dem XPS: optionale Feineinstellungen der
  Hintergrunddienste (Vorlage `host.env.example`)
