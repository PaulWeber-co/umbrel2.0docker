# Betrieb und Notfallplan

Alles, was nach dem [Installer-Stick](../installer/README.md) kommt. Befehle
laufen per SSH vom Mac (`ssh paul@xps.local`).

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
sudo /opt/xps-homeserver/xps-homeserver/scripts/setup-xps.sh paul
```

`paul` ist der Benutzer, der auf dem Display angemeldet wird. Das Skript
installiert fehlende Pakete, die Grundsystem-Dienste (Kernel-Wächter,
Watchdogs, `umbrel.local`, Akku), Dashboard, Kiosk, AirPlay, Webcam-Sensor
und Dienste-Statistik, lädt einmalig die Hintergrundvideos und startet
Umbrel. Es lässt sich jederzeit erneut ausführen.

Danach:

- Dashboard: auf dem Display und unter `http://xps.local:7777`
- Umbrel: `http://umbrel.local` (beim ersten Mal Konto anlegen)
- AirPlay: auf dem iPhone „XPS Lautsprecher“ wählen
- Tailscale für unterwegs: `sudo xps-setup-tailscale`

## Einstellungen

| Datei | Inhalt | Danach |
| --- | --- | --- |
| `/etc/xps-homeserver/dashboard.env` | Name, Ort, Schlüssel und Tokens der Kacheln (Vorlage `dashboard.env.example`) | `sudo systemctl restart xps-dashboard` |
| `/etc/xps-homeserver/host.env` | Watchdog-Ziel, mDNS-Namen, Akkugrenze, Webcam-Kalibrierung, Messabstände (Vorlage `host.env.example`) | betroffenen Dienst neu starten |
| `/etc/xps-homeserver/umbrel.env` | welches Umbrel-Image läuft; pflegt `update-umbrel.sh` | – |

Bearbeiten mit `sudoedit /etc/xps-homeserver/dashboard.env`. Die Dateien sind
nur für root lesbar und kommen nie ins Repo.

Ohne Eintrag zeigt eine Kachel Beispieldaten mit der Marke „Beispiel“. Was
jede Kachel braucht, steht in [dashboard/README.md](../dashboard/README.md).
Zwei Hinweise:

- **Kalender** und **To-dos** kommen aus Home Assistant. iCloud bindest du in
  Home Assistant über die CalDAV-Integration ein und trägst dann die Entität
  ein, z. B. `DASH_HA_CALENDAR_ENTITY=calendar.privat`.
- **Dienste** braucht keine Einstellung. Eigene Projekte erscheinen
  automatisch, sobald sie als docker-compose-Projekt auf dem XPS laufen
  (`docker compose up -d` in ihrem Ordner) oder als Umbrel-App installiert
  sind. Anzeigenamen und Ausblenden: `DASH_SERVICES_NAMES`,
  `DASH_SERVICES_HIDE`.

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
systemctl status xps-dashboard          # Dashboard
systemctl status "xps-kiosk@paul"       # Display
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
- **Display bleibt schwarz**: `journalctl -u "xps-kiosk@paul" -b`. Vom Mac aus
  lässt sich das Dashboard jederzeit im Browser öffnen.
- **Nachtansicht kommt zu früh oder zu spät**: in `host.env` die Schwellen
  `XPS_AMBIENT_DARK_ON`/`_OFF` anpassen;
  `cat /run/xps-ambient/ambient.json` zeigt den aktuellen Messwert.
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
   `cat /var/lib/xps-homeserver/wl-status`, `systemctl --failed`.
4. Startet der XPS gar nicht mehr: im GRUB-Menü (beim Start `Esc`) unter
   *Advanced options* einen älteren Kernel wählen.
5. Im schlimmsten Fall neu installieren und das Backup zurückspielen; Umbrel,
   Dashboard und Einstellungen sind danach wieder wie vorher. Tailscale neu
   anmelden mit `sudo xps-setup-tailscale`.
