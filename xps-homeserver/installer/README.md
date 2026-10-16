# Installer-Stick für den XPS

Ein USB-Stick, der Debian 13 ohne Rückfragen und ohne Netzwerk auf den XPS
installiert. Nach dem ersten Start ist der XPS schon im WLAN und per
`ssh <user>@xps.local` erreichbar, mit deinem Mac-Schlüssel und ohne Passwort.

Auf dem Stick liegt das offizielle Debian-13-ISO und zusätzlich:

- eine kleine Offline-Paketquelle mit dem Broadcom-WLAN-Treiber
  (`broadcom-sta-dkms`), dem passenden Kernel samt Headern, NetworkManager,
  SSH, mDNS und Intel-Firmware,
- eine Antwortdatei (`preseed.cfg`) mit Sprache, Zeitzone, Benutzer und
  Partitionierung,
- dein WLAN-Name samt Passwort und dein öffentlicher SSH-Schlüssel.

Am Ende der Installation baut DKMS den WLAN-Treiber. Klappt das nicht, bricht
die Installation mit einer Fehlermeldung ab, statt ein System ohne Netz zu
hinterlassen.

> **Achtung:** Der Menüpunkt „XPS automatisch installieren“ löscht die interne
> SSD vollständig, ohne nachzufragen. Auf dem Stick steht dein WLAN-Passwort im
> Klartext, also gut aufbewahren und nach der Installation löschen.

## 1. Auf dem Mac vorbereiten (einmalig)

1. **Docker Desktop** installieren und starten.
2. **SSH-Schlüssel**: Falls `~/.ssh/id_ed25519.pub` noch nicht existiert:
   ```sh
   ssh-keygen -t ed25519
   ```
3. **Einstellungen**:
   ```sh
   git clone https://github.com/PaulWeber-co/umbrel2.0docker ~/Programs/umbrel2.0docker
   cd ~/Programs/umbrel2.0docker/xps-homeserver
   cp .env.example .env
   open -e .env
   ```
   WLAN-Name (`XPS_WIFI_SSID`) und WLAN-Passwort (`XPS_WIFI_PSK`) eintragen.
   Den Rest kannst du so lassen. `XPS_PASSWORD` leer lassen, dann fragt das
   Skript beim Bauen danach.
4. **Speedport**: Unter *WLAN → Sicherheit* WPA2 oder den Mischmodus
   WPA2/WPA3 lassen. Der Broadcom-Treiber kann kein reines WPA3.

## 2. Stick bauen

```sh
./installer/build.sh
```

Das dauert beim ersten Mal ein paar Minuten (Download von etwa 1 GB). Ergebnis:
`installer/out/xps-installer.iso`.

## 3. Auf den USB-Stick schreiben

Ein Stick ab 2 GB reicht. Alles darauf wird gelöscht.

**Am einfachsten** mit [balenaEtcher](https://etcher.balena.io): Image wählen,
Stick wählen, *Flash*.

**Oder im Terminal:**

```sh
diskutil list                     # Stick finden, z. B. /dev/disk4 (external, physical)
diskutil unmountDisk /dev/disk4
sudo dd if=installer/out/xps-installer.iso of=/dev/rdisk4 bs=4m
diskutil eject /dev/disk4
```

Bei `dd` die Nummer dreimal prüfen: Die falsche Nummer überschreibt eine
andere Festplatte. Mit `Ctrl+T` siehst du den Fortschritt. Meldet macOS danach
„Volume nicht lesbar“, auf *Auswerfen* klicken, das ist normal.

## 4. BIOS am XPS einstellen

Netzteil anschließen, einschalten und sofort mehrmals **F2** drücken.

| Wo | Einstellung | Warum |
| --- | --- | --- |
| *System Configuration → SATA Operation* | **AHCI** (statt RAID On) | Sonst sieht Linux die SSD nicht |
| *Secure Boot → Secure Boot Enable* | **Disabled** | Der selbst gebaute WLAN-Treiber ist nicht von Microsoft signiert |
| *General → Boot Sequence* | **UEFI** | Der Installer-Eintrag ist nur im UEFI-Menü |
| *Power Management → AC Behavior* | **Wake on AC**, falls vorhanden | Nach einem Stromausfall startet der XPS von selbst |
| *Power Management → Primary Battery Charge Configuration* | **Custom: Start 50 %, Stop 60 %**, sonst **Primarily AC Use** | Schont den Akku im Dauerbetrieb am Netz |
| *Wireless → Wireless Device Enable* | **WLAN** an | |

*Apply*, dann *Exit*.

## 5. Installieren

1. Stick einstecken, XPS einschalten und mehrmals **F12** drücken (einmaliges
   Bootmenü).
2. Unter *UEFI Boot* den USB-Stick wählen.
3. Im Debian-Menü **„XPS automatisch installieren (löscht die interne SSD!)“**
   wählen. Die normalen Debian-Einträge darunter installieren interaktiv.
4. Nichts mehr tun. Nach etwa 10–20 Minuten startet der XPS neu. Stick
   abziehen.
5. Am Anmeldebildschirm steht die IP-Adresse:
   `XPS-Homeserver | IP: 192.168.2.x | ssh paul@xps.local`

Vom Mac aus:

```sh
ssh paul@xps.local
```

Damit ist Phase 0 fertig.

## 6a. Grundsystem nach dem ersten Start

Der Installer richtet den Serverbetrieb bereits ein: Debian-Sicherheitsupdates
werden täglich geprüft und nur am Netzteil installiert. Der XPS startet nach
einem Update nicht selbst neu, und ein Kernel-Update wird zurückgewiesen, falls
DKMS den Broadcom-Treiber `wl` für den neuen Kernel nicht bereitgestellt hat.
Der vorherige Kernel bleibt als Rückfallmöglichkeit erhalten. Zram nutzt
komprimierten Arbeitsspeicher als Swap; das Zuklappen des Displays hält den
Server wach. Die Akku-Ladeschwelle wird wie oben beschrieben einmalig im BIOS
gesetzt.

Tailscale ist optional. Wenn du den XPS zusätzlich von unterwegs erreichen
möchtest, einmal per SSH starten und den angezeigten Link im Browser bestätigen:

```sh
sudo xps-setup-tailscale
```

Danach zeigt `tailscale status` die Verbindung. Es wird kein Auth-Key im Repo
oder auf dem Installationsstick abgelegt.

Der Installer bringt außerdem den Docker-Host und Docker Compose mit. Das
Umbrel-Image baut GitHub Actions als `linux/amd64`-Container aus dem Fork. Nach
dem ersten erfolgreichen Workflow das Paket
`xps-homeserver-umbrelos` in GitHub Container Registry auf **Public** stellen,
damit der XPS Images ohne Registry-Zugangsdaten laden kann. Dann den Fork auf
dem XPS auschecken und den Stack starten:

```sh
git clone --branch <branch> https://github.com/PaulWeber-co/umbrel2.0docker.git ~/umbrel2.0docker
cd ~/umbrel2.0docker
sudo ./xps-homeserver/scripts/install-umbrel.sh
```

Künftige manuelle Updates laufen mit `sudo
./xps-homeserver/scripts/update-umbrel.sh`. Das Skript aktualisiert den Branch,
holt das dazugehörige unveränderliche Image, wartet auf den Healthcheck und
startet bei einem Fehler das vorherige Image wieder. Umbrel-Daten liegen im
Docker-Volume `umbrel-data` und werden beim Rollback nicht gelöscht.

## 7. Feste IP im Speedport

Damit der XPS immer dieselbe Adresse bekommt: Speedport-Oberfläche
(`http://speedport.ip`) → *Heimnetz → Heimnetz (LAN) → Heimnetzwerk*, den XPS
in der Geräteliste wählen und **Immer dieselbe IP-Adresse vergeben**
aktivieren. Der XPS meldet sich immer mit seiner echten MAC-Adresse an, die
Zuordnung bleibt also bestehen.

## Wenn etwas nicht klappt

| Problem | Lösung |
| --- | --- |
| Stick erscheint nicht unter F12 | Anderen USB-Anschluss nehmen; im BIOS *Boot Sequence → UEFI* prüfen. |
| Installation stoppt mit „Keine interne SSD gefunden“ | BIOS: *SATA Operation* auf **AHCI**. |
| Installation stoppt mit „Execution of preseeded command failed“ | Der WLAN-Treiber ließ sich nicht bauen. Mit `Alt+F4` siehst du das Protokoll. Foto davon machen und an Claude schicken. |
| XPS startet, ist aber nicht im WLAN | Am Gerät anmelden, dann `nmcli device wifi list` (sieht er Netze?), `nmcli connection up heim-wlan` und `sudo journalctl -b -u NetworkManager`. Häufigste Ursachen: Tippfehler im WLAN-Passwort (in `.env` korrigieren und Stick neu bauen, oder `sudo nmtui`) oder WPA3-only im Speedport. |
| `xps.local` geht nicht, die IP schon | mDNS blockiert, z. B. durch ein VPN auf dem Mac. Erstmal die IP nehmen. |

## Testen ohne XPS

`installer/test/qemu-test.sh` baut ein Test-ISO, installiert es in einer
virtuellen Maschine (UEFI, NVMe-SSD, Stick per USB, kein Netz) und prüft das
Ergebnis per SSH: Treiber gebaut, WLAN-Profil korrekt, SSH nur mit Schlüssel
und so weiter. Läuft unter Linux mit QEMU und OVMF. Eine Broadcom-Karte hat die
VM nicht, deshalb wird nur geprüft, ob der Treiber für den Kernel gebaut und
installiert ist, nicht ob er funkt.
