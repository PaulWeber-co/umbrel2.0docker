# Architektur

Stand: Phase 0 ist gebaut und in QEMU getestet. Phase 1 bis 5 sind eingerichtet:
Basissystem, Umbrel, sieben Widgets in Design A, Kiosk, AirPlay und
Webcam-Regelung. Die Betriebsanleitung aus Phase 6 ist noch offen. WLAN,
Display, Audio, Kamera und Backlight müssen am XPS praktisch verifiziert werden.

## Überblick

```
Dell XPS 13 9350 · Debian 13 ohne Desktop · nur WLAN
│
├── NetworkManager + Broadcom-Treiber wl (DKMS)
├── unattended-upgrades .. Sicherheitsupdates am Netzteil, ohne Auto-Neustart
├── zram .................. komprimierter Swap bis 4 GiB
├── systemd-logind ........ Zuklappen schaltet den Server nicht aus
├── avahi: xps.local und umbrel.local
│
├── Docker (Host)
│   ├── umbrel ................ privilegierter Container aus dem Fork, bootet
│   │                           umbrelOS mit systemd; die Umbrel-Apps laufen
│   │                           in seinem eigenen Docker
│   └── umbrel-port-publisher . macht App-Ports im Heimnetz erreichbar
│
├── xps-dashboard ............. Backend: sammelt Daten, cached, verteilt sie per
│                               WebSocket; liefert das Frontend aus
├── kiosk ..................... cage + Chromium im Vollbild auf dem Display
├── AirPlay ................... shairport-sync → Kopfhörerbuchse, Metadaten
│                               ans Dashboard
└── xps-ambient ............... Webcam → Raumhelligkeit, ohne Netzwerkzugriff
```

## Entscheidungen

### Debian als Basis, nicht umbrelOS direkt

umbrelOS bringt keinen Treiber für die Broadcom-WLAN-Karte mit (nur Intel,
Realtek, Atheros) und ist ein schreibgeschütztes A/B-System, in das sich keiner
nachinstallieren lässt. Außerdem hat es keine Bildschirmausgabe für ein
Dashboard und keinen vorgesehenen Zugriff auf Kopfhörerbuchse, Backlight und
Webcam.

### Umbrel mit eigenem Docker im Container statt Geschwister-Containern

umbreld behandelt seinen Docker-Daemon als Eigentum: Startet die
App-Umgebung nicht, stoppt und löscht es alle Container und räumt die
Netzwerke ab (`cleanDockerState` in
`packages/umbreld/source/modules/apps/apps.ts`). Außerdem räumt es Images ab
und setzt eigene nftables-Regeln. Am Docker des Hosts würde das die eigenen
Dienste treffen. Ein Umbau wären Eingriffe in den Kern von umbreld, die bei
jedem Umbrel-Update kollidieren.

Die Apps laufen im Umbrel-Container als normale Prozesse ohne Virtualisierung,
und `/var/lib/docker` liegt auf einem Volume statt auf Overlay-auf-Overlay. Die
Mehrkosten sind ein zweiter Docker-Daemon mit systemd. Der Speicherbedarf wird
in Phase 2 gemessen.

### Umbrel-Updates ohne Konflikte

Der Fork ändert am Umbrel-Code nur die Container-Variante, fast
ausschließlich in neuen Dateien. Dieses Projekt liegt in einem eigenen Ordner,
den es im Original nicht gibt, greift von außen auf Umbrel zu und ändert keinen
Umbrel-Code. Ein Update heißt: `upstream` mergen, Image bauen, Container neu
erstellen. Daten bleiben im Volume, das alte Image bleibt als Rückfallebene.

### Dashboard, Kiosk, AirPlay und Webcam auf dem Host, nicht in Umbrel

Diese Teile brauchen Display, Backlight, Kamera und Soundkarte des XPS. Auf dem
Host ist dieser Zugriff direkt. Außerdem hängen sie dann nicht von
Umbrel-Updates ab.

### Woher das Dashboard seine Daten bekommt

| Daten | Quelle |
| --- | --- |
| CPU, RAM, Temperatur, Speicher, Netzwerk, WLAN-Signal, Akku, Uptime | direkt vom Linux-Kernel des XPS (`/proc`, `/sys`). Umbrel liest dieselben Werte, nur ohne Umweg. |
| Umbrel-Apps (installiert, läuft, CPU/RAM je App, Update verfügbar), Umbrel-Version | Umbrels offizielle MCP-Schnittstelle unter `http://umbrel.local/mcp` mit einem Zugangstoken aus den Umbrel-Einstellungen. `get_system_info`, `get_system_resources` und `list_apps` brauchen keine Freigaben. Der Token kann also nur lesen, nichts ändern (geprüft in `packages/umbreld/source/modules/mcp/tools/`). |
| Anzahl Fotos und Videos, belegter Platz | Immich-API mit eigenem API-Schlüssel |
| Smart Home, To-dos, Kalender | Home Assistant (Umbrel-App), Long-Lived Access Token |
| Wetter | Open-Meteo, ohne Schlüssel |
| Songinfos und Cover | Metadaten von shairport-sync |
| Raumhelligkeit | `xps-ambient`, nur eine Zahl |

### Updates, Akku und Fernzugriff

Der Installer aktiviert Debian `unattended-upgrades` für die von Debian
freigegebenen Sicherheitsupdates. Paketlisten werden täglich erneuert,
Installationen laufen nur am Netzteil und lösen keinen automatischen Neustart
aus. Kernelpakete bleiben erhalten, damit ein vorheriger Kernel als Rückweg
verfügbar ist. Ein Kernel-Postinst-Hook prüft nach DKMS, ob `wl` für den neuen
Kernel vorhanden ist; ohne Modul schlägt die Paketkonfiguration fehl.

Zram belegt höchstens die Hälfte des Arbeitsspeichers oder 4 GiB, je nachdem,
welcher Wert kleiner ist. Ein systemd-logind-Drop-in ignoriert das Zuklappen,
damit Display und Server weiterlaufen. Die Akku-Ladeschwelle (Start 50 %, Stop
60 %) wird im Dell-BIOS gesetzt, weil diese Grenze unter Debian nicht zuverlässig
verwaltet werden kann.

Tailscale wird nach der Installation mit `sudo xps-setup-tailscale` eingerichtet.
Das Skript installiert den offiziellen Debian-Paketquellen-Eintrag und startet
den einmaligen Login im Terminal. Es speichert weder Auth-Key noch Geheimnis im
Repository oder Installer-Stick.

### Umbrel-Container und Updates

Der Host-Docker-Dienst und Docker Compose kommen aus Debian und werden offline
vom Installer-Stick eingerichtet. GitHub Actions baut für jeden relevanten
Push ein `linux/amd64`-Image mit `BASE_VARIANT=-container` und versieht es mit
dem vollständigen Commit-SHA. Der XPS muss dadurch keine großen Umbrel-Images
selbst bauen. Compose hält den persistenten Datenbereich `umbrel-data` getrennt
vom Image und veröffentlicht die Umbrel-Ports sowie dynamische App-Ports.

`scripts/update-umbrel.sh` aktualisiert zuerst den ausgecheckten Branch,
lädt dessen unveränderliches SHA-Image und wartet auf den Healthcheck. Erst
danach wird die aktive Image-Referenz gespeichert. Bei einem Fehler startet es
das zuvor gespeicherte Image wieder; das Datenvolume wird dabei nicht entfernt.
Das vorige Image bleibt lokal und kann so lange als Rückfall dienen. Der
GitHub-Container muss öffentlich lesbar sein, damit der XPS ohne zusätzliches
Registry-Passwort pullen kann.

### Webcam: Bilder können das Gerät technisch nicht verlassen

`xps-ambient` läuft als eigener Dienst mit `PrivateNetwork=yes`. Er hat damit
keinerlei Netzwerkzugang, nicht einmal localhost. Er nimmt ein Bild im
Arbeitsspeicher auf, berechnet daraus den Median eines 16×12-Graubilds, verwirft
die Pixel und schreibt nur Helligkeits-Prozentwerte sowie einen Nachtmodus-Schalter
in eine JSON-Datei unter `/run`.

### AirPlay 2

Der offizielle `mikebrady/shairport-sync` Container enthält Shairport Sync und
NQPTP, nutzt `network_mode: host` für mDNS und AirPlay und erhält nur Zugriff
auf `/dev/snd`. Ein lokaler UDP-Metadatenstrom auf Port 5555 versorgt das
Dashboard mit Titel, Interpret, Album und Cover. Die Stream-Erkennung läuft
über Shairport Syncs Fortschrittsmeldungen.

## Offen

- Umbrel-Image muss nach Push in GHCR veröffentlicht und als öffentlich
  lesbares Paket eingerichtet werden.
- Dashboard-Integrationen am XPS konfigurieren und physisch prüfen.
- AirPlay-Audio am XPS prüfen.
- Webcam-Regelung und Backlight am XPS prüfen.
- Notfallplan fertigstellen.
