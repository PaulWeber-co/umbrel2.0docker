# Betrieb und Notfallplan

Alles, was nach dem [Installer-Stick](../installer/README.md) kommt. Befehle
laufen per SSH vom Mac (`ssh paul@xps.local`). Die erste Installation von
Anfang bis Ende: [installation.md](installation.md).

## Einmalig auf GitHub

Der XPS lädt das Umbrel-Image, das GitHub Actions aus dem Fork baut. Nach dem
ersten erfolgreichen Lauf von **XPS Umbrel container image** (Reiter
*Actions* im Fork) das Paket öffentlich stellen, damit der XPS es ohne
Passwort laden kann: Profil → *Packages* → `xps-homeserver-umbrelos` →
*Package settings* → *Change visibility* → **Public**. Das Image enthält nur
Code aus dem öffentlichen Fork, keine Geheimnisse.

## Einrichten

```sh
sudo git clone --filter=blob:none --sparse https://github.com/PaulWeber-co/umbrel2.0docker.git /opt/xps-homeserver
sudo git -C /opt/xps-homeserver sparse-checkout set xps-homeserver
sudo /opt/xps-homeserver/xps-homeserver/scripts/setup-xps.sh
```

Das Skript installiert fehlende Pakete, die Grundsystem-Dienste
(Kernel-Wächter, Watchdogs, `umbrel.local`, Akku), Dashboard, Steuerung,
Kiosk, AirPlay, Webcam-Sensor und Dienste-Statistik, lädt einmalig die
Hintergrundvideos und startet Umbrel. Den Kiosk-Browser startet es als
eigenen Benutzer `xps-kiosk` ohne Rechte. Es lässt sich jederzeit erneut
ausführen.

Danach:

- Dashboard: auf dem Display und unter `http://xps.local:7777`
- Steuerung: `http://xps.local:7777/steuerung` (aufs Handy legen) oder der
  runde Knopf unten rechts auf dem Display
- Umbrel: `http://umbrel.local` (beim ersten Mal Konto anlegen)
- AirPlay: auf dem iPhone „XPS Lautsprecher“ wählen
- Tailscale für unterwegs: `sudo xps-setup-tailscale`

## Steuerung: was der Bildschirm wann zeigt

Bildschirm, Zeitplan, Automatik und Funktionen stellst du in der Steuerung
ein; das gilt sofort, für alle Geräte und über Neustarts hinweg. Der
Wandbildschirm kennt vier Zustände:

| Zustand | Was passiert |
| --- | --- |
| An | das Dashboard, je nach Tageszeit mit eigenem Video |
| Nachtuhr | nur die gedimmte Uhr |
| Schwarz | schwarz, Hintergrundbeleuchtung und Webcam aus; Antippen weckt |
| Aus | Kiosk-Browser gestoppt, Display aus; der XPS ist nur Server |

Wer entscheidet, von oben nach unten (das Erste, das zutrifft, gilt):

1. eine **Schnellaktion** („Aus · 1 Std.“, „Aus bis morgen“) bis zu ihrem Ende
2. **Akkubetrieb** (Netzteil weg, z. B. Stromausfall): Aus, damit Umbrel länger läuft
3. Modus **Immer an** oder **Aus (nur Server)**
4. im Modus **Automatisch**: angetippt → einige Minuten an; AirPlay spielt →
   an; niemand zu Hause (Home-Assistant-Entität) → schwarz oder aus;
   außerhalb des Zeitplans → Nachtuhr, schwarz oder aus; dunkler Raum →
   Nachtuhr; sonst an

Auf einem Mac oder Handy zeigt das Dashboard immer die Kacheln; ein Hinweis
oben nennt den Zustand der Wand. Von der Kommandozeile:

```sh
xps-display                  # Zustand, Grund, nächster Wechsel
xps-display aus 120          # zwei Stunden aus
xps-display schwarz          # eine Stunde schwarz
xps-display morgen           # aus bis zum Zeitplan morgen früh
xps-display auto             # zurück zur Automatik (beendet auch "modus aus")
xps-display modus aus        # dauerhaft nur Server
```

Home Assistant kann den Bildschirm genauso schalten, z. B. beim Verlassen
des Hauses. In `configuration.yaml`:

```yaml
rest_command:
  xps_bildschirm:
    url: http://xps.local:7777/api/control/override
    method: POST
    content_type: application/json
    headers:
      x-dashboard-pin: !secret xps_dashboard_pin   # nur nötig mit DASH_PIN
    payload: '{"state": "{{ state }}", "minutes": {{ minutes | default(60) }}}'
```

`state` ist `on`, `night`, `sleep` oder `off` (Aufruf z. B. mit
`state: off, minutes: 120`); ein zweiter `rest_command` mit dem Payload
`{"clear": true}` beendet es wieder.

## Einstellungen

| Datei | Inhalt | Danach |
| --- | --- | --- |
| `/etc/xps-homeserver/dashboard.env` | Name, Ort, Schlüssel und Tokens der Kacheln (Vorlage `dashboard.env.example`) | `sudo systemctl restart xps-dashboard` |
| `/etc/xps-homeserver/host.env` | Watchdog-Ziel, mDNS-Namen, Akkugrenze, Webcam-Kalibrierung, Helligkeitskurve, Messabstände (Vorlage `host.env.example`) | betroffenen Dienst neu starten |
| `/var/lib/xps-dashboard/control.json` | alles aus der Steuerung; pflegt das Dashboard | – |
| `/etc/xps-homeserver/umbrel.env` | welches Umbrel-Image läuft; pflegt `update-umbrel.sh` | – |

Bearbeiten mit `sudoedit /etc/xps-homeserver/dashboard.env`. Die Dateien sind
nur für root lesbar und kommen nie ins Repo.

Ohne Eintrag zeigt eine Kachel Beispieldaten mit der Marke „Beispiel“. Was
jede Kachel braucht, steht in [dashboard/README.md](../dashboard/README.md).
Zwei Hinweise:

- **Kalender** und **To-dos** kommen aus Apple Kalender und Erinnerungen
  (nächster Abschnitt) oder aus Home Assistant
  (`DASH_HA_CALENDAR_ENTITY`, `DASH_HA_TODO_ENTITY`). Beim Kalender laufen
  beide zusammen.
- **Dienste** braucht keine Einstellung. Eigene Projekte erscheinen
  automatisch, sobald sie als docker-compose-Projekt auf dem XPS laufen
  (`docker compose up -d` in ihrem Ordner) oder als Umbrel-App installiert
  sind. Anzeigenamen und Ausblenden: `DASH_SERVICES_NAMES`,
  `DASH_SERVICES_HIDE`.

## Apple Kalender und Erinnerungen

### Kalender

1. iPhone: App *Kalender* → *Kalender* (unten) → beim Kalender auf ⓘ →
   *Öffentlicher Kalender* einschalten → *Link teilen* → kopieren. Am Mac:
   Rechtsklick auf den Kalender → *Teilen* → *Öffentlicher Kalender*.
2. Den `webcal://…`-Link eintragen, mehrere Kalender durch Kommas getrennt:
   `DASH_CALENDAR_ICS=webcal://p52-caldav.icloud.com/published/2/…`
3. `sudo systemctl restart xps-dashboard`

Die Wand holt die Kalender alle fünf Minuten und zeigt die nächsten sieben
Tage, mit Serienterminen, verschobenen Einzelterminen und ganztägigen
Terminen. Wer den Link kennt, kann den Kalender lesen. Er steht deshalb nur in
der dashboard.env, die nur root lesen kann. Ein neuer Link (Freigabe aus und
wieder an) macht den alten ungültig.

### Erinnerungen (z. B. die Einkaufsliste)

Apple lässt keinen Server an Erinnerungen heran, die App *Kurzbefehle* auf dem
iPhone aber schon. Ein Kurzbefehl schickt die offene Liste an die Wand und
bekommt zurück, was dort inzwischen abgehakt oder dazugeschrieben wurde. Das
trägt er dann in Erinnerungen ein.

1. `DASH_REMINDERS_LIST=Einkauf` eintragen (der Name der Liste), dann
   `sudo systemctl restart xps-dashboard`. Die To-do-Kachel heißt jetzt
   „Einkauf“ und wartet auf den ersten Abgleich.
2. In *Kurzbefehle* einen neuen Kurzbefehl „Wand-Abgleich“ anlegen:
   1. **Erinnerungen suchen**: Liste ist *Einkauf*, nur nicht erledigte.
   2. **Text kombinieren**: die Erinnerungen, getrennt durch *Neue Zeile*.
   3. **Inhalte von URL abrufen**: `http://xps.local:7777/api/widgets/todo/actions/sync`,
      Methode *POST*. Mit `DASH_PIN` einen Header `x-dashboard-pin` mit der
      PIN. Hauptteil der Anforderung *JSON*, ein Feld `text` (Text) mit dem
      kombinierten Text.
   4. **Wörterbuchwert abrufen**: Wert für `result`. Daraus noch einmal
      **Wörterbuchwert abrufen**: Wert für `done`.
   5. **Wiederholen mit jedem** Objekt darin: **Erinnerungen suchen**
      (Liste *Einkauf*, Titel ist *Wiederholungsobjekt*, nicht erledigt,
      Limit 1), dann **Erinnerung bearbeiten** → *Ist erledigt* einschalten.
   6. Wie in Schritt 4 den Wert für `add` aus `result` holen, dann
      **Wiederholen mit jedem**: **Neue Erinnerung hinzufügen** mit
      *Wiederholungsobjekt* auf der Liste *Einkauf*.
3. Unter *Automation* starten lassen, *Sofort ausführen*: bei *App* →
   *Erinnerungen* → *Wird geschlossen*, dazu bei *Tageszeit* (z. B. 7, 12 und
   18 Uhr) und bei *Ankommen* zu Hause.

Was an der Wand abgehakt oder eingetippt wird, steht ab sofort so an der Wand.
In Erinnerungen kommt es beim nächsten Lauf des Kurzbefehls an. Bis dahin ist
Neues in der Kachel etwas blasser. Geht ein Lauf schief, bekommt der nächste
dieselbe Antwort, doppelt wird nichts. Teilt ihr die Liste über iCloud, kann
der Kurzbefehl auf beiden iPhones laufen. Abgeglichen wird über den Titel,
weil Kurzbefehle keine feste Kennung einer Erinnerung kennen. Änderungen, die
eine Woche lang kein Kurzbefehl abholt, verfallen.

## Minifunk

Aus der Knuddl-App (*Wir* → *Heute*, unter der Frage des Tages) schickt ihr
einen Satz, eine Liste oder eine Erinnerung an die Wand, dazu höchstens ein
Foto pro Person und Tag. Es geht nur an den Bildschirm, nicht aufs andere
Handy. Die Wand zeigt es unter der Uhr, solange keine Musik läuft: Text in
einer Glaskarte, deren Schrift sich nach der Länge richtet, ein Foto an der
Stelle des Covers mit dem Text darüber. Ein Tipp auf × entfernt eine
Nachricht.

Einrichten: in Knuddl *Mehr* → *Verbindung* die Einladung kopieren (sieht aus
wie `ABC123-K7F2M9QX…`) und eintragen:

```sh
sudoedit /etc/xps-homeserver/dashboard.env   # DASH_KNUDDL_INVITE=ABC123-…
sudo systemctl restart xps-dashboard
journalctl -u xps-dashboard | grep minifunk  # "verbunden mit dem Knuddl-Raum"
```

In der App erscheint der Minifunk nur, solange die Wand das Dashboard zeigt.
Die Wand meldet sich dafür jede Minute verschlüsselt im Raum. Ist sie aus, im
Nachtmodus oder offline, verschwindet die Karte nach spätestens zweieinhalb
Minuten. Text bleibt 24 Stunden an der Wand, Fotos 6 Stunden, dann löscht der
XPS die Datei (`DASH_MINIFUNK_HOURS`, `DASH_MINIFUNK_PHOTO_HOURS`). Aus der
Datenbank verschwindet jede Nachricht, sobald sie auf dem XPS ist.

Abschalten: `DASH_KNUDDL_INVITE` leeren. Verbindet ihr euch in Knuddl neu,
gibt es ein neues Geheimnis, und die neue Einladung gehört hier hinein.

## Hintergrundvideos

Die Luftaufnahmen lädt `setup-xps.sh` bei jedem Update (anfangs etwa 1 GB,
danach nur Neues) nach `dashboard/web/media/`. Die Auswahl steht in
`dashboard/scripts/backgrounds.txt`: Zeile dazu oder weg, `sudo update-xps`,
fertig. Pro Tag laufen zwei Clips je Tageszeit, am nächsten Tag die nächsten
zwei. In der Steuerung schaltet *Videos* sie ab, dann bleibt das Standbild des
Clips stehen und die Grafik hat Ruhe.

## Updates

| Was | Wie |
| --- | --- |
| Debian-Sicherheitsupdates | automatisch jede Nacht; verlangt ein Update einen Neustart, startet der XPS um 04:30 |
| Dieses Projekt und Umbrel | `sudo update-xps` (git pull, Einrichtung, neues Umbrel-Image) |
| Umbrel aus dem Original | im Fork *Sync fork* auf GitHub, dann `sudo update-xps` |
| Umbrel-Apps | wie gewohnt in der Umbrel-Oberfläche |

`update-umbrel.sh` startet Umbrel nur neu, wenn sich das Image geändert hat,
wartet bis zu 15 Minuten auf den Healthcheck und kehrt sonst sofort zum
vorherigen Image zurück. Fällt ein Fehler erst später auf:

```sh
sudo /opt/xps-homeserver/xps-homeserver/scripts/rollback-umbrel.sh
```

Der Rollback tauscht nur das Image; Umbrels Daten (Volume
`xps-homeserver_umbrel-data`) bleiben, wie sie sind.

## Dienste prüfen

```sh
systemctl --failed                      # alles, was nicht läuft
xps-display                             # was der Bildschirm zeigt und warum
systemctl status xps-dashboard          # Dashboard
systemctl status xps-kiosk              # Display (Kiosk-Browser)
systemctl status xps-control            # setzt die Steuerung um: Kiosk, AirPlay, Helligkeit
systemctl status xps-airplay            # AirPlay (Logs: sudo docker logs xps-airplay)
systemctl status xps-ambient            # Webcam-Helligkeit
systemctl status xps-services           # Dienste-Statistik
sudo docker ps                          # Umbrel und Co. (Logs: sudo docker logs umbrel)
cat /var/lib/xps-homeserver/wl-status   # Kernel-Wächter: "ok <Kernel>" oder "pinned …"
journalctl -u xps-wifi-watchdog         # WLAN-Aussetzer und was der Watchdog tat
```

Typische Fälle:

- **Kein Ton**: `sudo docker logs xps-airplay`, `aplay -l`, dann
  `alsamixer` (Master und Headphone nicht stumm, `M` schaltet um) und
  `sudo alsactl store`.
- **Display bleibt schwarz**: zuerst `xps-display`: steht dort „aus“ oder
  „schwarz“, ist das die Steuerung (Grund steht dabei; `xps-display auto`
  oder Modus Automatisch). Sonst `journalctl -u xps-kiosk -b` und
  `journalctl -u xps-control -b`. Vom Mac aus lässt sich das Dashboard
  jederzeit im Browser öffnen.
- **Display geht nachts nicht aus / tagsüber nicht an**: Zeitplan und
  Modus in der Steuerung prüfen; `xps-display` nennt den Grund.
- **Nachtuhr bei Dunkelheit kommt zu früh oder zu spät**: in `host.env` die
  Schwellen `XPS_AMBIENT_DARK_ON`/`_OFF` anpassen und
  `sudo systemctl restart xps-ambient`; `cat /run/xps-ambient/ambient.json`
  zeigt den aktuellen Messwert. Ganz abschalten: Steuerung → Automatik →
  „Dunkler Raum → Nachtuhr“.
- **Display zu hell oder zu dunkel**: Steuerung → Funktionen (feste
  Helligkeit), oder die Kurve in `host.env` (`XPS_BACKLIGHT_*`) und
  `sudo systemctl restart xps-control`.
- **Änderungen vom Handy gehen nicht („Gesperrt“)**: `DASH_PIN` ist gesetzt;
  die PIN oben in der Steuerung eingeben.
- **`wl-status` meldet `pinned`**: Der neueste Kernel hat keinen WLAN-Treiber,
  der XPS bootet weiter den alten. `sudo dkms autoinstall` und danach
  `sudo xps-wl-guard`; Ausgabe an Claude schicken, falls es nicht klappt.

## Backup

Ein externes, verschlüsseltes Laufwerk unter `/media/backup` einhängen. Für
ein konsistentes Backup hält Umbrel kurz an:

```sh
BACKUP_DIR="/media/backup/xps/$(date +%Y-%m-%d)"
COMPOSE="sudo docker compose --project-name xps-homeserver --env-file /etc/xps-homeserver/umbrel.env -f /opt/xps-homeserver/xps-homeserver/deploy/compose.yaml"
VOLUME=$(sudo docker volume inspect --format '{{.Mountpoint}}' xps-homeserver_umbrel-data)
sudo install -d -m 700 "$BACKUP_DIR"
$COMPOSE stop
sudo tar -czf "$BACKUP_DIR/umbrel-data.tgz" -C "$VOLUME" .
sudo tar -czf "$BACKUP_DIR/dashboard-data.tgz" -C /var/lib/xps-dashboard .
sudo tar -czf "$BACKUP_DIR/config.tgz" -C /etc/xps-homeserver .
$COMPOSE up -d
```

`config.tgz` enthält Tokens und gehört nur auf das verschlüsselte Laufwerk.

## Wiederherstellung

1. XPS mit dem Stick neu installieren und wie unter „Einrichten“ einrichten.
2. Backup zurückspielen (`BACKUP_DIR` auf den Ordner des Backups setzen):

```sh
COMPOSE="sudo docker compose --project-name xps-homeserver --env-file /etc/xps-homeserver/umbrel.env -f /opt/xps-homeserver/xps-homeserver/deploy/compose.yaml"
VOLUME=$(sudo docker volume inspect --format '{{.Mountpoint}}' xps-homeserver_umbrel-data)
$COMPOSE stop
sudo find "$VOLUME" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
sudo tar -xzf "$BACKUP_DIR/umbrel-data.tgz" -C "$VOLUME"
sudo tar -xzf "$BACKUP_DIR/dashboard-data.tgz" -C /var/lib/xps-dashboard
sudo chown -R xps-dashboard:xps-dashboard /var/lib/xps-dashboard
sudo tar -xzf "$BACKUP_DIR/config.tgz" -C /etc/xps-homeserver
$COMPOSE up -d
sudo systemctl restart xps-dashboard
```

Der `find`-Befehl leert das Umbrel-Volume; vorher prüfen, dass `$VOLUME` auf
`…/xps-homeserver_umbrel-data/_data` zeigt. `docker compose down -v` nie
verwenden, das löscht das Volume.

## Wenn der XPS nicht erreichbar ist

1. Warten: Nach 3, 6 und 15 Minuten ohne Netz greift der WLAN-Watchdog
   (neu verbinden, Treiber neu laden, Neustart).
2. Speedport prüfen; die feste IP direkt probieren (`ssh paul@192.168.2.x`),
   falls `xps.local` nicht auflöst.
3. Am Gerät: `Strg+Alt+F2` öffnet eine Konsole neben dem Kiosk, Anmeldung mit
   Benutzer und Passwort. Dort `nmcli device wifi list`,
   `cat /var/lib/xps-homeserver/wl-status`, `systemctl --failed`. Steht die
   Steuerung auf „Aus“, ist das Display dunkel: blind anmelden und
   `xps-display auto` tippen, dann wird es wieder hell.
4. Startet der XPS gar nicht mehr: im GRUB-Menü (beim Start `Esc`) unter
   *Advanced options* einen älteren Kernel wählen.
5. Im schlimmsten Fall neu installieren und das Backup zurückspielen; Umbrel,
   Dashboard und Einstellungen sind danach wieder wie vorher. Tailscale neu
   anmelden mit `sudo xps-setup-tailscale`.
