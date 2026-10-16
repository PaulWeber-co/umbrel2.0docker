# Betrieb und Notfallplan

Diese Anleitung gilt für den ausgewählten Branch des Forks. Die XPS-Hardware
muss nach dem Einrichten einmal vor Ort geprüft werden; bis dahin bleiben WLAN,
Display, Audio, Kamera und Backlight die offenen Abnahmepunkte.

## Erstinstallation

1. Debian mit dem [Installer](../installer/README.md) auf dem XPS installieren
   und per SSH anmelden.
2. Im GitHub-Containerpaket `xps-homeserver-umbrelos` die Sichtbarkeit auf
   **Public** setzen, damit der XPS das Image ohne Registry-Login laden kann.
3. Den Fork auf dem gewünschten Branch klonen und Umbrel einrichten:

   ```sh
   BRANCH=codex/xps-dashboard-system-widget # bei Bedarf auf den Ziel-Branch ändern
   git clone --branch "$BRANCH" https://github.com/PaulWeber-co/umbrel2.0docker.git ~/umbrel2.0docker
   cd ~/umbrel2.0docker
   sudo ./xps-homeserver/scripts/install-umbrel.sh
   ```

4. Dashboard, Kiosk, AirPlay und Webcam-Dienst installieren:

   ```sh
   sudo ./xps-homeserver/scripts/install-xps-dashboard.sh "$(id -un)"
   ```

   Der Installer legt das Checkout unter `/opt/xps-homeserver` an. Design A
   läuft auf `tty1` und ist im Heimnetz unter `http://xps.local:8080` erreichbar.

## Verbindungen einrichten

Geheimnisse und Integrationen stehen in `/etc/xps-homeserver/dashboard.env`.
Die Datei hat Modus `0600`; Schlüssel gehören nicht in Git.

| Einstellung | Zweck |
| --- | --- |
| `DASH_PLACE`, `DASH_LAT`, `DASH_LON`, `DASH_TIMEZONE` | Wetter und Uhr |
| `DASH_HA_URL`, `DASH_HA_TOKEN` | Home-Assistant-API |
| `DASH_HA_CALENDAR_ENTITY`, `DASH_HA_TODO_ENTITY` | Kalender und Aufgabenliste |
| `DASH_HA_HOME_ENTITIES` | Kommagetrennte Liste erlaubter Geräte; nur Licht, Schalter, Lüfter und Eingabe-Schalter sind schaltbar |
| `DASH_IMMICH_URL`, `DASH_IMMICH_API_KEY` | Foto-/Videozahlen und Link zu Immich |
| `DASH_COMMUTE_ORIGIN`, `DASH_COMMUTE_DESTINATION` | Koordinaten als `Breite,Länge` für den Arbeitsweg |

Nach einer Änderung:

```sh
sudo chmod 600 /etc/xps-homeserver/dashboard.env
sudo systemctl restart xps-dashboard
```

Die Webcam-Regelung wird über `/etc/xps-homeserver/ambient.env` kalibriert.
Standardmäßig liest sie `/dev/video0`, sucht das Backlight unter
`/sys/class/backlight` und misst alle zehn Sekunden. Dunkel-Ein/Aus-Schwellen,
Helligkeitsbereich und Gamma-Kurve lassen sich dort einstellen. Danach:

```sh
sudo systemctl restart xps-ambient
```

Die Kameraaufnahme bleibt im RAM. Der Dienst hat mit `PrivateNetwork=yes`
keinen Netzwerkzugriff und schreibt nur Messwerte nach
`/run/xps-ambient/ambient.json`.

## Dienste prüfen

| Dienst | Prüfen | Protokoll |
| --- | --- | --- |
| Dashboard | `sudo systemctl status xps-dashboard` | `sudo journalctl -u xps-dashboard -f` |
| Kiosk | `sudo systemctl status "xps-kiosk@$(id -un).service"` | `sudo journalctl -u "xps-kiosk@$(id -un).service" -f` |
| AirPlay | `sudo systemctl status xps-airplay` | `sudo docker logs --tail 100 xps-airplay` |
| Webcam/Backlight | `sudo systemctl status xps-ambient` | `sudo journalctl -u xps-ambient -f` |
| Umbrel | `sudo docker compose --project-name xps-homeserver --env-file /etc/xps-homeserver/umbrel.env -f /opt/xps-homeserver/xps-homeserver/deploy/compose.yaml ps` | `sudo docker logs --tail 100 umbrel` |

Die Demo-Kacheln bedeuten, dass ihre optionale Quelle noch nicht konfiguriert
ist. Ein fehlender oder alter Webcam-Messwert schaltet den Nachtmodus ab, lässt
die übrigen Dashboard-Widgets aber laufen. Kein AirPlay-Ton: zuerst
`sudo docker logs xps-airplay` und `aplay -l` prüfen, dann Kopfhörerbuchse und
Backlight/Kamera direkt am Gerät testen.

## Updates und Rückrollen

Das Update verlangt ein sauberes Git-Checkout des installierten Branches. Es
holt den Branch, lädt dessen SHA-Image und wartet auf den Umbrel-Healthcheck:

```sh
sudo /opt/xps-homeserver/xps-homeserver/scripts/update-umbrel.sh
```

Bei einem fehlgeschlagenen Healthcheck rollt das Skript automatisch auf das
vorherige Image zurück. Nach einem später bemerkten Fehler kann das letzte
erfolgreich ersetzte Image manuell aktiviert werden:

```sh
sudo /opt/xps-homeserver/xps-homeserver/scripts/rollback-umbrel.sh
```

Der Rollback stellt nur das Container-Image zurück. Er setzt das persistente
Umbrel-Datenvolume nicht zurück. Bei beschädigten App-Daten aus einem Backup
wiederherstellen.

## Backup

Ein konsistentes Backup hält Umbrel kurz an. Ein externes, verschlüsseltes
Laufwerk unter `/media/backup` einhängen und die Befehle aus einer SSH-Sitzung
ausführen. `BACKUP_DIR` bleibt in der Sitzung gesetzt:

```sh
BACKUP_DIR="/media/backup/xps/$(date -u +%Y%m%dT%H%M%SZ)"
sudo install -d -m 700 "$BACKUP_DIR"
VOLUME=$(sudo docker volume inspect --format '{{.Mountpoint}}' xps-homeserver_umbrel-data)
sudo systemctl stop xps-ambient xps-airplay xps-dashboard
sudo docker compose --project-name xps-homeserver --env-file /etc/xps-homeserver/umbrel.env -f /opt/xps-homeserver/xps-homeserver/deploy/compose.yaml stop umbrel port-publisher
sudo tar -czf "$BACKUP_DIR/umbrel-data.tgz" -C "$VOLUME" .
sudo tar -czf "$BACKUP_DIR/dashboard-data.tgz" -C /var/lib/xps-dashboard .
sudo tar -czf "$BACKUP_DIR/host-config.tgz" -C /etc/xps-homeserver .
sudo chmod 600 "$BACKUP_DIR"/*.tgz
sudo docker compose --project-name xps-homeserver --env-file /etc/xps-homeserver/umbrel.env -f /opt/xps-homeserver/xps-homeserver/deploy/compose.yaml up -d
sudo systemctl start xps-dashboard xps-airplay xps-ambient
```

Die Konfigurationssicherung enthält API-Tokens und Registry-Einstellungen.
Sie muss verschlüsselt und außerhalb des XPS aufbewahrt werden. Der Projektcode
liegt im Git-Branch; die Sicherung enthält Daten, lokale Dashboard-Anordnung
und `/etc/xps-homeserver`.

## Wiederherstellung

Debian und denselben Projektbranch neu installieren, `install-umbrel.sh`
ausführen, dann die Dienste und Umbrel stoppen. Das `umbrel-data`-Volume bleibt
bei `docker compose down` bestehen; `-v` darf bei der Wiederherstellung nicht
angegeben werden.

```sh
BACKUP_DIR=/media/backup/xps/20261016T120000Z # durch den Ordner des Backups ersetzen
KIOSK_USER=dein-linux-benutzer # auf den angelegten XPS-Benutzer setzen
sudo test -f "$BACKUP_DIR/umbrel-data.tgz"
sudo systemctl stop xps-ambient xps-airplay xps-dashboard
sudo docker compose --project-name xps-homeserver --env-file /etc/xps-homeserver/umbrel.env -f /opt/xps-homeserver/xps-homeserver/deploy/compose.yaml down
VOLUME=$(sudo docker volume inspect --format '{{.Mountpoint}}' xps-homeserver_umbrel-data)
sudo find "$VOLUME" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
sudo tar -xzf "$BACKUP_DIR/umbrel-data.tgz" -C "$VOLUME"
sudo find /var/lib/xps-dashboard -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
sudo tar -xzf "$BACKUP_DIR/dashboard-data.tgz" -C /var/lib/xps-dashboard
sudo chown -R xps-dashboard:xps-dashboard /var/lib/xps-dashboard
sudo tar -xzf "$BACKUP_DIR/host-config.tgz" -C /etc/xps-homeserver
sudo chmod 600 /etc/xps-homeserver/*.env
sudo docker compose --project-name xps-homeserver --env-file /etc/xps-homeserver/umbrel.env -f /opt/xps-homeserver/xps-homeserver/deploy/compose.yaml up -d
sudo systemctl start xps-dashboard xps-airplay xps-ambient
sudo systemctl start "xps-kiosk@${KIOSK_USER}.service"
```

Die `find`-Befehle löschen den Inhalt des jeweiligen Wiederherstellungsziels.
Vorher sicherstellen, dass `$VOLUME` auf
`xps-homeserver_umbrel-data` zeigt und das richtige Backup-Laufwerk eingehängt
ist.

## Wenn der XPS nicht erreichbar ist

1. Speedport und WLAN prüfen; die reservierte IP-Adresse direkt per SSH
   probieren, falls `xps.local`/mDNS nicht auflöst.
2. `sudo systemctl --failed` und die passenden `journalctl -u ...`-Logs prüfen.
3. Bei Umbrel-Containerfehlern `docker logs umbrel` ansehen und dann das
   Rollback-Skript verwenden. Das Volume nicht löschen.
4. Bei fehlendem Bildschirmlogin von SSH aus den Kiosk stoppen:
   `sudo systemctl disable --now "xps-kiosk@$(id -un).service"`.
5. Wenn der Host ausfällt: mit Installer/BIOS-Anleitung neu installieren,
   Git-Branch auschecken, Umbrel-Stack anlegen und Backup wiederherstellen.
   Tailscale danach mit `sudo xps-setup-tailscale` erneut anmelden.
