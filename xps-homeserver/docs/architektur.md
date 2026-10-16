# Architektur

Stand: Phase 0 gebaut. Das Dashboard aus Phase 3 hat ein Grundgerüst in Design A
mit Wetter- und Server-Widget; Grundsystem, Umbrel-Container, Kiosk, AirPlay,
Webcam und Betriebsanleitung sind noch offen.

## Überblick

```
Dell XPS 13 9350 · Debian 13 ohne Desktop · nur WLAN
│
├── NetworkManager + Broadcom-Treiber wl (DKMS)
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
| Anzahl Fotos und Videos, belegter Platz | API der Foto-App mit eigenem Schlüssel (siehe „Offen“) |
| Smart Home | Home Assistant (Umbrel-App), Long-Lived Access Token |
| Wetter | Open-Meteo, ohne Schlüssel |
| Songinfos und Cover | Metadaten von shairport-sync |
| Raumhelligkeit | `xps-ambient`, nur eine Zahl |

### Webcam: Bilder können das Gerät technisch nicht verlassen

`xps-ambient` läuft als eigener Dienst mit `PrivateNetwork=yes`. Er hat damit
keinerlei Netzwerkzugang, nicht einmal localhost. Er nimmt ein Bild im
Arbeitsspeicher auf, berechnet die Helligkeit, verwirft das Bild und gibt nur
die Zahl über eine Datei in `/run` weiter.

### AirPlay 2

Debian 13 hat `shairport-sync` 4.3.7, aber kein `nqptp`, das AirPlay 2
braucht. Kandidat ist das offizielle Docker-Image von shairport-sync
(enthält nqptp, AirPlay 2), mit `network_mode: host` und Zugriff auf
`/dev/snd`. Wird in Phase 4 entschieden.

## Offen

- Umbrel-Image bauen: auf dem XPS oder vorgebaut per GitHub Actions
- Fotos: Immich oder Umbrels eigene Fotos-App
- To-dos, Kalender, Arbeitsweg: Quellen und Anbieter
- DynamicChicken: statisch hosten mit Firebase oder selbst gehostet
