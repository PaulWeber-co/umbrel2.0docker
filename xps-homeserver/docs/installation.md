# Installation: vom leeren XPS zum fertigen Homeserver

Die ganze Strecke in einer Reihenfolge, zum Abhaken. Rechne mit etwa zwei
Stunden, das meiste davon Warten. Einzelheiten zum Stick stehen in
[installer/README.md](../installer/README.md), alles für danach in
[betrieb.md](betrieb.md), die Sicherheitsprüfung in
[sicherheit.md](sicherheit.md).

## Was du brauchst

- den Mac mit **Docker Desktop** und deinem SSH-Schlüssel (`~/.ssh/id_ed25519.pub`)
- einen **USB-Stick** ab 2 GB (wird gelöscht)
- den **XPS 13 9350** mit Netzteil; **alle Daten darauf sind danach weg**
- WLAN-Name und -Passwort des Speedport
- später, für echte Daten in den Kacheln: TomTom-Schlüssel, Immich-API-Schlüssel,
  Home-Assistant-Token (alles kostenlos, siehe Schritt 9)

## 0. Vorher

- [ ] Was du vom XPS noch brauchst, sichern.
- [ ] Dieser Stand muss auf `master` liegen, denn der XPS lädt `master`: den
      Pull Request des Branches `claude/determined-lamport-2jjf67` auf GitHub
      mergen.
- [ ] Auf GitHub unter *Actions → XPS Umbrel container image* ist der letzte
      Lauf auf `master` grün, und das Paket `xps-homeserver-umbrelos` ist
      öffentlich (beides am 23.10.2026 geprüft: ja). Ändert sich etwas unter
      `packages/`, baut GitHub das Image von selbst neu.

## 1. Mac vorbereiten

```sh
git clone https://github.com/PaulWeber-co/umbrel2.0docker ~/Programs/umbrel2.0docker
cd ~/Programs/umbrel2.0docker/xps-homeserver
cp .env.example .env
open -e .env
```

In `.env` nur `XPS_WIFI_SSID` und `XPS_WIFI_PSK` eintragen; `XPS_PASSWORD`
leer lassen (das Skript fragt beim Bauen und speichert es nirgends). Im
Speedport unter *WLAN → Sicherheit* **WPA2** oder **WPA2/WPA3** lassen: Der
Broadcom-Treiber kann kein reines WPA3.

## 2. Stick bauen und schreiben

```sh
./installer/build.sh
```

Ergebnis: `installer/out/xps-installer.iso`. Mit
[balenaEtcher](https://etcher.balena.io) auf den Stick schreiben (Image
wählen, Stick wählen, *Flash*).

## 3. BIOS am XPS (einmalig)

Netzteil an, einschalten, mehrmals **F2**:

| Wo | Einstellung |
| --- | --- |
| System Configuration → SATA Operation | **AHCI** |
| Secure Boot → Secure Boot Enable | **Disabled** |
| General → Boot Sequence | **UEFI** |
| Power Management → AC Behavior | **Wake on AC** (nach Stromausfall startet er selbst) |
| Power Management → Primary Battery Charge Configuration | **Custom: Start 50 %, Stop 60 %** |
| Wireless → Wireless Device Enable | **WLAN an** |

*Apply*, *Exit*.

## 4. Debian installieren

1. Stick rein, einschalten, mehrmals **F12**, unter *UEFI Boot* den Stick wählen.
2. **„XPS automatisch installieren (löscht die interne SSD!)“** wählen.
3. Nichts tun, 10–20 Minuten. Der XPS startet neu; dann Stick abziehen.
4. Am Bildschirm steht `XPS-Homeserver | IP: 192.168.2.x | ssh paul@xps.local`.

Vom Mac:

```sh
ssh paul@xps.local
```

Klappt das nicht: Tabelle „Wenn etwas nicht klappt“ in
[installer/README.md](../installer/README.md).

## 5. Alles einrichten

Auf dem XPS (per SSH):

```sh
sudo git clone --filter=blob:none --sparse https://github.com/PaulWeber-co/umbrel2.0docker.git /opt/xps-homeserver
sudo git -C /opt/xps-homeserver sparse-checkout set xps-homeserver
sudo /opt/xps-homeserver/xps-homeserver/scripts/setup-xps.sh
```

Das Skript braucht 10–30 Minuten (Pakete, Hintergrundvideos, das Umbrel-Image
mit gut 1 GB). Es richtet Grundsystem-Dienste, Dashboard, Steuerung, Kiosk,
AirPlay, Webcam-Sensor und Umbrel ein. Am Ende steht „Fertig.“ mit allen
Adressen. Es lässt sich jederzeit erneut starten.

## 6. Erster Check

```sh
systemctl --failed            # sollte leer sein
xps-display                   # Bildschirm: an – Zeitplan (bis 22:30)
sudo docker ps                # umbrel, umbrel-port-publisher, xps-airplay
```

- [ ] Das Dashboard erscheint auf dem XPS-Display.
- [ ] `http://xps.local:7777` zeigt es auch im Browser am Mac.
- [ ] `http://umbrel.local`: Umbrel-Konto anlegen, **starkes Passwort** und
      unter *Einstellungen* die **Zwei-Faktor-Anmeldung** einschalten.
- [ ] Auf dem iPhone im Kontrollzentrum AirPlay → „XPS Lautsprecher“; die
      Musik kommt aus der Kopfhörerbuchse, das Dashboard zeigt Cover und Titel.

## 7. Speedport

- [ ] *Heimnetz → Heimnetz (LAN) → Heimnetzwerk*: den XPS wählen, **Immer
      dieselbe IP-Adresse vergeben**.
- [ ] **Keine Portweiterleitung** zum XPS einrichten und **UPnP aus** lassen.
      Von unterwegs geht es über Tailscale (Schritt 11).

## 8. Steuerung aufs Handy

`http://xps.local:7777/steuerung` im Safari öffnen, *Teilen → Zum
Home-Bildschirm*. Dort stellst du ein, was der Wandbildschirm wann zeigt:

| Bereich | Was | Vorgabe |
| --- | --- | --- |
| Bildschirm | **Automatisch** (Zeitplan und Regeln), **Immer an**, **Aus** (nur Server: Kiosk aus, Display dunkel) | Automatisch |
| Schnell | An / Schwarz / Aus für 1 Std., Aus bis morgen früh; „Zurück zur Automatik“ beendet es | – |
| Zeitplan | Mo–Fr und Sa/So je an/aus; außerhalb Nachtuhr, Schwarz oder Aus | 06:00–22:30, Sa/So 07:00–23:30, Nachtuhr |
| Automatik | dunkler Raum → Nachtuhr; Musik weckt; Antippen weckt (Minuten); Akkubetrieb → aus; niemand zu Hause → schwarz/aus | alles an, Antippen 5 Min., Anwesenheit aus |
| Funktionen | automatische oder feste Helligkeit, AirPlay, Musikansicht, Hintergrundvideos, Glas-Effekt | alles an |
| Kacheln | jede Kachel ein/aus, „Beispiel“ = Einstellung fehlt | alle an |

Dieselbe Steuerung öffnet sich auf dem Wandbildschirm über den runden Knopf
unten rechts. Per SSH geht es auch: `xps-display aus 120`, `xps-display auto`,
`xps-display modus aus` (siehe `xps-display hilfe`).

**Nur als Umbrel-Server nutzen**: Bildschirm → **Aus**. Der Kiosk-Browser
stoppt, Display und Webcam sind aus, Umbrel, AirPlay und alles andere laufen
weiter. Zurück mit **Automatisch** oder **Immer an**; das bleibt auch nach
einem Neustart so.

## 9. Kacheln mit echten Daten

```sh
sudoedit /etc/xps-homeserver/dashboard.env
sudo systemctl restart xps-dashboard
```

| Kachel | Eintragen | Woher |
| --- | --- | --- |
| Begrüßung, Wetter | `DASH_NAME`, `DASH_PLACE`, `DASH_LAT`, `DASH_LON` | Koordinaten z. B. aus Google Maps (Rechtsklick) |
| Arbeitsweg | `DASH_TOMTOM_KEY`, `DASH_HOME_ADDRESS`, `DASH_WORK_ADDRESS`, Zeitfenster | [developer.tomtom.com](https://developer.tomtom.com), kostenlos |
| Fotos | `DASH_IMMICH_KEY` | Immich in Umbrel installieren → Kontoeinstellungen → API-Schlüssel |
| Kalender (Apple) | `DASH_CALENDAR_ICS` | Kalender-App → Kalender → ⓘ → *Öffentlicher Kalender* → Link ([betrieb.md](betrieb.md#apple-kalender-und-erinnerungen)) |
| To-dos (Apple Erinnerungen) | `DASH_REMINDERS_LIST` | Name der Liste, dazu der Kurzbefehl „Wand-Abgleich“ ([betrieb.md](betrieb.md#erinnerungen-z-b-die-einkaufsliste)) |
| Zuhause, Kalender, To-dos | `DASH_HA_TOKEN`, `DASH_HA_ENTITIES`, `DASH_HA_CALENDAR_ENTITY`, `DASH_HA_TODO_ENTITY` | Home Assistant in Umbrel → Profil → Sicherheit → Langlebige Zugriffstoken |
| Minifunk | `DASH_KNUDDL_INVITE` | Knuddl-App → *Mehr* → *Verbindung* → Einladung kopieren ([betrieb.md](betrieb.md#minifunk)) |
| Dienste, XPS | nichts | kommt von selbst |
| Sperre | `DASH_PIN` (empfohlen) | eine Zahl deiner Wahl |

Solange eine Einstellung fehlt, zeigt die Kachel Beispieldaten mit der Marke
„Beispiel“; die Steuerung listet unter *Kacheln*, welche das sind.

## 10. Abnahme am Gerät

Was sich ohne den echten XPS nicht prüfen ließ, einmal durchgehen:

- [ ] **WLAN** bleibt über Nacht stabil (`journalctl -u xps-wifi-watchdog`).
- [ ] **Display**: Kiosk startet nach einem Neustart von selbst
      (`sudo reboot`, nach zwei Minuten schauen).
- [ ] **Steuerung → Schwarz · 1 Std.**: Display wird schwarz, Antippen (bei
      Touch-Display) oder **Zurück zur Automatik** bringt es zurück.
- [ ] **Steuerung → Aus · 1 Std.**: Display geht ganz aus
      (`systemctl status xps-kiosk` → inactive); Zurück zur Automatik schaltet
      es nach wenigen Sekunden wieder ein.
- [ ] **Helligkeit**: Raum abdunkeln → Display wird dunkler, bei Dunkelheit
      kommt die Nachtuhr (`cat /run/xps-ambient/ambient.json`). Feste Helligkeit
      in der Steuerung ändert das Display sofort.
- [ ] **Webcam-LED** ist aus, solange der Bildschirm schwarz oder aus ist.
- [ ] **Ton** über AirPlay; Lautstärke ggf. mit `alsamixer`, dann `sudo alsactl store`.
- [ ] **Zuklappen**: Server und Dashboard laufen weiter.
- [ ] **Netzteil ziehen**: nach etwa 30 Sekunden geht der Bildschirm aus
      (Akkubetrieb), Umbrel läuft weiter; Netzteil wieder dran → Bildschirm an.

Stimmt etwas nicht: [betrieb.md](betrieb.md), Abschnitt „Dienste prüfen“.

## 11. Tailscale für unterwegs (optional)

```sh
sudo xps-setup-tailscale
```

Den angezeigten Link öffnen und anmelden. Danach erreichst du Dashboard,
Steuerung und Umbrel von überall über den Tailscale-Namen des XPS, ohne Port
im Router zu öffnen. Im Tailscale-Konto die Zwei-Faktor-Anmeldung einschalten.

## 12. Aufräumen und Backup

- [ ] Den Stick neu formatieren: Auf ihm steht dein WLAN-Passwort.
- [ ] Ein verschlüsseltes externes Laufwerk für Backups vorbereiten und das
      erste Backup machen ([betrieb.md](betrieb.md), Abschnitt „Backup“).

Danach läuft alles von selbst: Sicherheitsupdates jede Nacht, Updates von
Umbrel und diesem Projekt mit `sudo update-xps`, wann immer du willst.
