# Architektur

Stand: Phase 0 ist gebaut und in QEMU getestet. Phase 1 bis 6 sind umgesetzt:
Basissystem, Umbrel, acht Kacheln in Design A, Kiosk, AirPlay,
Webcam-Regelung, Steuerung für Bildschirm und Funktionen, Betriebsanleitung
und Sicherheitsprüfung ([sicherheit.md](sicherheit.md)). WLAN, Display,
Audio, Kamera und Backlight müssen am XPS praktisch verifiziert werden.

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
│                               Server-Sent Events; liefert Frontend und
│                               Steuerung aus; entscheidet, was das Display zeigt
├── xps-control ............... root, ohne Netz: setzt die Entscheidung um
│                               (Kiosk, AirPlay, Backlight, Display aus)
├── xps-kiosk ................. cage + Chromium im Vollbild auf dem Display,
│                               als eigener Benutzer ohne Rechte
├── Lautsprecher .............. shairport-sync (AirPlay) und go-librespot
│                               (Spotify Connect) → Kopfhörerbuchse,
│                               Titel und Cover ans Dashboard
├── xps-ambient ............... Webcam → Raumhelligkeit, ohne Netzwerkzugriff
└── xps-services .............. Docker-Statistik für die Dienste-Kachel
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
| Apple Kalender | iCalendar-Links der Kalender-App (*Öffentlicher Kalender*), Serientermine rechnet `server/sources/ics.js` selbst aus |
| Apple Erinnerungen | ein Kurzbefehl auf dem iPhone schickt die Liste und holt die Änderungen der Wand ab (`server/sources/reminders.js`) |
| Minifunk | der verschlüsselte Raum der Knuddl-App in deren Firebase-Datenbank (`server/knuddl.js`) |
| Hintergrundvideos | Mixkit-Luftaufnahmen, beim Setup geladen (`dashboard/scripts/backgrounds.txt`) |
| Wetter | Open-Meteo, ohne Schlüssel |
| Songinfos und Cover | Metadaten von shairport-sync |
| Raumhelligkeit | `xps-ambient`, nur eine Zahl |

### Updates, Akku und Fernzugriff

Der Installer aktiviert Debian `unattended-upgrades` für die von Debian
freigegebenen Sicherheitsupdates. Paketlisten werden täglich erneuert,
Installationen laufen nur am Netzteil; verlangt ein Update einen Neustart
(Kernel, libc), startet der XPS um 04:30 neu. Kernelpakete bleiben erhalten,
damit ein vorheriger Kernel als Rückweg verfügbar ist (siehe „Kernel-Updates
und der WLAN-Treiber“).

Damit der XPS ohne Pflege läuft, wachen mehrere Stellen: der
Hardware-Watchdog des Chipsatzes startet ihn bei einem Hänger neu,
`xps-wifi-watchdog` verbindet das WLAN nach drei Minuten ohne Router neu,
lädt nach sechs den Treiber neu und startet nach 15 Minuten neu (höchstens
alle sechs Stunden), Standby ist abgeschaltet, das Journal bleibt unter
500 MB, und der Kiosk-Browser startet jede Nacht frisch. `xps-mdns-alias`
kündigt `umbrel.local` mit der Adresse des XPS an, weil Umbrels eigener
mDNS-Dienst im Container das Heimnetz nicht erreicht.

Zram belegt höchstens die Hälfte des Arbeitsspeichers oder 4 GiB, je nachdem,
welcher Wert kleiner ist. Ein systemd-logind-Drop-in ignoriert das Zuklappen,
damit Display und Server weiterlaufen. Die Akku-Ladeschwelle (Start 50 %, Stop
60 %) wird im Dell-BIOS gesetzt, weil der Debian-13-Kernel sie beim XPS 9350
noch nicht steuern kann; `xps-battery-care` setzt sie, sobald ein neuerer
Kernel das anbietet.

Tailscale wird nach der Installation mit `sudo xps-setup-tailscale` eingerichtet.
Das Skript installiert den offiziellen Debian-Paketquellen-Eintrag und startet
den einmaligen Login im Terminal. Es speichert weder Auth-Key noch Geheimnis im
Repository oder Installer-Stick.

### Umbrel-Container und Updates

Der Host-Docker-Dienst und Docker Compose kommen aus Debian und werden offline
vom Installer-Stick eingerichtet. GitHub Actions
(`.github/workflows/xps-umbrel-image.yml`) baut bei jeder Änderung an Umbrels
Code ein `linux/amd64`-Image mit `BASE_VARIANT=-container` und schiebt es nach
GHCR, als `branch-<Branch>` (wandert mit) und `sha-<Commit>` (fest). Der XPS
muss so keine großen Umbrel-Images selbst bauen. Compose hält den
persistenten Datenbereich `umbrel-data` getrennt vom Image und
veröffentlicht die Umbrel-Ports sowie dynamische App-Ports (außer 22 und 7777,
dem Dashboard).

`scripts/update-umbrel.sh` lädt `branch-<Branch>`, merkt sich dessen Digest
(`…@sha256:…`) als unveränderliche Referenz und startet Umbrel nur neu, wenn
sich das Image geändert hat. Erst wenn der Healthcheck grün ist, wird die
neue Referenz gespeichert und die alte als Rückfall behalten
(`rollback-umbrel.sh`). Wird das neue Image nicht gesund, startet sofort
wieder das alte; das Datenvolume bleibt dabei immer unberührt. Das
GHCR-Paket muss öffentlich lesbar sein, damit der XPS ohne Registry-Passwort
laden kann.

`sudo update-xps` ist das eine Update für alles: `git pull`, dann
`setup-xps.sh`, das Konfiguration, Dienste und Umbrel auf den neuen Stand
bringt. Debians Sicherheitsupdates laufen davon unabhängig jede Nacht.

### Kernel-Updates und der WLAN-Treiber

Ohne das Broadcom-Modul `wl` hat der XPS kein Netz. DKMS baut es für jeden
neuen Kernel; `xps-wl-guard` prüft danach (Kernel-Hooks, beim Booten und
täglich), ob es für den neuesten Kernel da ist. Wenn nicht, versucht es den
Bau erneut und stellt GRUB auf den neuesten Kernel, der `wl` hat. Der Hook
scheitert nie: ein fehlgeschlagener Treiberbau darf `dpkg` nicht blockieren,
sonst kämen auch keine Sicherheitsupdates mehr an. Startet der XPS trotzdem
einmal in einen Kernel ohne `wl`, bootet er einmalig in den letzten guten
neu. Deshalb darf unattended-upgrades nach Kernel-Updates um 04:30 neu
starten.

### Steuerung: wer den Bildschirm schaltet

Was das Display zeigt (an, Nachtuhr, schwarz, aus), entscheidet das
Dashboard in `server/control.js`: Modus, Zeitplan, Schnellaktionen und die
Regeln (dunkler Raum über die Webcam, AirPlay, Antippen, Akkubetrieb,
Anwesenheit aus Home Assistant). Dort laufen alle Eingaben zusammen, und dort
ist die Logik testbar. Die Einstellungen liegen in `control.json`, die
Entscheidung schreibt das Dashboard nach `host-state.json`, beide im
Datenordner `/var/lib/xps-dashboard`.

Umsetzen braucht root (systemctl, `/sys/class/backlight`), das Dashboard
bekommt aber nie Rechte. Deshalb liest `xps-control` (`scripts/xps-control.py`)
die Datei jede Sekunde, nimmt daraus nur fünf geprüfte Schalter an und
handelt: Kiosk und AirPlay starten oder stoppen, beim gestoppten Kiosk das
Panel über den Framebuffer abschalten, die Helligkeit setzen (automatisch
nach der Webcam, fest oder aus). Eine fehlende oder kaputte Datei heißt
„alles an“. Ein Schalter wird nur bei einer Änderung umgesetzt, ein von Hand
gestarteter Dienst wird also nicht heimlich wieder gestoppt. `xps-kiosk` und
`xps-airplay` fragen in `ExecCondition=` dieselbe Datei, so bleibt ein
ausgeschalteter Bildschirm auch nach einem Neustart aus.

`xps-ambient` misst nur noch und schreibt Zahlen; ist der Bildschirm schwarz
oder aus, bleibt die Kamera aus. Die Helligkeitskurve liegt in `xps-control`,
der einzigen Stelle, die das Backlight schreibt.

Nur der Kiosk (`http://127.0.0.1:7777/?kiosk=1`) wird schwarz und lässt sich
durch Antippen wecken; ein Browser am Mac oder Handy zeigt immer die Kacheln
und nennt den Zustand der Wand. `/steuerung` ist dieselbe Steuerung als
eigene Seite fürs Handy, `xps-display` dasselbe für die Kommandozeile.

### Kiosk als eigener Benutzer

Chromium ist das größte Programm auf dem XPS und zeigt Daten aus dem Netz
(AirPlay-Cover, Namen aus Home Assistant). Es läuft deshalb als `xps-kiosk`:
ein normales Konto, damit logind ihm den Bildschirm gibt, aber ohne Passwort,
sudo und Shell. `scripts/xps-kiosk.sh` setzt HOME und den Laufzeitordner
selbst, weil `%h` und `%U` in Systemunits immer root meinen.

### Dashboard-Zugriff

Ansehen geht im Heimnetz ohne Anmeldung. Änderungen nimmt das Dashboard nur
als JSON vom eigenen Origin an (CSRF), Anfragen nur unter Heimnetz-, IP- und
Tailscale-Namen (DNS-Rebinding), optional mit PIN für andere Geräte
(`DASH_PIN`); der Kiosk auf 127.0.0.1 fragt nie. Jede Seite hat eine
Content-Security-Policy, die Schrift liegt lokal.

### Dienste-Statistik

`xps-services` fragt alle 30 Sekunden beide Docker-Daemons ab (den des Hosts
und den im Umbrel-Container) und schreibt nur Namen, Zustände, CPU, RAM und
Startzeiten nach `/run/xps-services/services.json`. Der Dienst läuft als root,
weil der Docker-Socket root-gleich ist; das Dashboard liest nur die Datei und
bekommt nie Docker-Zugriff.

### Webcam: Bilder können das Gerät technisch nicht verlassen

`xps-ambient` läuft als eigener Dienst mit `PrivateNetwork=yes`. Er hat damit
keinerlei Netzwerkzugang, nicht einmal localhost. Alle 45 Sekunden (im Dunkeln
alle zwei Minuten) stellt er die Belichtung der Kamera fest ein, liest wenige
Bilder in 16×12 Graupunkten in den Arbeitsspeicher, nimmt den Median, verwirft
die Pixel und schreibt nur Helligkeits-Prozentwerte sowie den Dunkel-Schalter
in eine JSON-Datei unter `/run`. Die feste Belichtung ist nötig, weil die
Automatik einen dunklen Raum sonst hell rechnet.

### AirPlay 2

Der offizielle `mikebrady/shairport-sync`-Container enthält Shairport Sync und
NQPTP und nutzt `network_mode: host` für AirPlay 2. Er verwendet den
avahi-daemon des XPS (`ENABLE_AVAHI=0`), damit nicht zwei mDNS-Dienste
denselben Namen ankündigen. Titel, Interpret, Album, Cover und Fortschritt
kommen über eine Named Pipe unter `/run/shairport-sync/`, die das Dashboard
liest (`server/sources/shairport.js`); Start, Pause und Ende des Streams
steuern den Musikmodus.

### Minifunk über den Knuddl-Raum

Die Knuddl-App spricht ohne eigenen Server direkt mit einer Firebase-Datenbank,
und alles darin ist mit einem Geheimnis verschlüsselt, das nur die beiden
Handys kennen. Der XPS wird mit derselben Einladung zum dritten Teilnehmer:
Er leitet daraus Raum und Schlüssel genauso ab wie die App und nutzt zwei
eigene Pfade. Unter `x/status` meldet er jede Minute, ob das Dashboard
gerade zu sehen ist (nur dann bietet die App den Minifunk an). Unter
`x/funk` holt er Nachrichten über einen Live-Stream ab und löscht sie sofort.
So braucht es weder einen Port nach außen noch einen Dienst in der Cloud,
und die Datenbank sieht nur Zufallsdaten.

### Erinnerungen über einen Kurzbefehl

Für Erinnerungen gibt es keine Schnittstelle, die ein Server erreicht
(CalDAV kennt iCloud-Erinnerungen seit Jahren nicht mehr). Kurzbefehle auf dem
iPhone dürfen sie aber lesen und ändern. Ein Kurzbefehl schickt deshalb die
Liste an die Wand und bekommt in derselben Antwort zurück, was dort
abgehakt oder eingetippt wurde. Das bleibt offen, bis ein späterer Abgleich
es bestätigt, damit ein abgebrochener Lauf nichts verliert oder verdoppelt.

### Spotify Connect

go-librespot macht den XPS in der Spotify-App zum Gerät „XPS Lautsprecher“,
neben AirPlay und in derselben Compose-Datei, also mit demselben Schalter in
der Steuerung. Es meldet sich wie shairport-sync über den avahi-daemon des
XPS an (D-Bus), braucht keine Anmeldung (Zeroconf: wer es auswählt, bringt
sein Konto mit) und darf im Container nur die Soundkarte und seinen eigenen
Ordner `/var/lib/xps-spotify`. Es läuft als Benutzer `xps-spotify` mit der
Gruppe audio, nicht als root: Wer als root am System-D-Bus hängt, kann systemd
alles starten lassen. setup-xps.sh legt den Benutzer an und schreibt seine
Nummern nach `/etc/xps-homeserver/spotify.env`, die `xps-airplay.service` an
Compose weitergibt. Beide Empfänger nutzen das ALSA-Gerät
`default`. go-librespot gibt es beim Pausieren frei, shairport-sync nach dem
Ende einer Sitzung, so wechseln sie sich ab. Das Dashboard fragt die lokale
API von go-librespot (`127.0.0.1:3678/status`) alle zwei Sekunden, solange
etwas spielt, sonst alle fünf, und zeigt die Quelle, die gerade spielt
(`server/widgets/music.js`).

## Offen

- Dashboard-Integrationen am XPS konfigurieren und physisch prüfen.
- AirPlay- und Spotify-Ton am XPS prüfen.
- Webcam-Regelung, Backlight und „Bildschirm aus“ am XPS prüfen.
- Installer, Ausfall und Wiederherstellung am XPS praktisch durchspielen.

Die Abnahmeliste dafür: [installation.md](installation.md), Schritt 10.
