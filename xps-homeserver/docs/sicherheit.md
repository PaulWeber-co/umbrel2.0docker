# Sicherheit

Stand der Prüfung: 23.10.2026, vor der ersten Installation. Geprüft wurden
Installer, Grundsystem, alle Dienste und ihre systemd-Units, das Dashboard
(Server, Oberfläche, API) und die Skripte für Updates und Backup.

## Kurz

Der XPS ist für ein Heimnetz gut abgesichert: Von außen ist nichts erreichbar,
SSH geht nur mit deinem Schlüssel, jeder Dienst läuft so eingeschränkt wie
möglich, und das Dashboard kann nichts ändern außer dem, wofür es da ist. Die
größten Restrisiken sind ein gestohlener Laptop (SSD unverschlüsselt) und
Geräte im eigenen WLAN, denen du nicht traust. Für beides steht unten, was du
tun kannst.

## Wie der XPS geschützt ist

| Schicht | Schutz |
| --- | --- |
| Router | Keine Portweiterleitung: Aus dem Internet erreicht nichts den XPS. Unterwegs nur über Tailscale. |
| SSH | Nur mit Schlüssel, kein Passwort, kein root-Login (`/etc/ssh/sshd_config.d/10-xps.conf`). |
| Updates | Debian-Sicherheitsupdates jede Nacht automatisch, auch für Chromium und Node.js; Neustart um 04:30, wenn nötig. Der Kernel-Wächter sorgt dafür, dass ein Update nie das WLAN kostet. |
| Dashboard | Läuft als eigener Benutzer ohne Rechte, mit schreibgeschütztem System (`ProtectSystem=strict`). Tokens stehen nur in `/etc/xps-homeserver/dashboard.env` (nur root) und gehen nie an den Browser. |
| Dashboard-API | Änderungen nur als JSON vom Dashboard selbst (keine fremde Webseite kann Licht schalten oder den Bildschirm ausmachen), nur unter bekannten Hostnamen (Schutz gegen DNS-Rebinding), optional mit PIN (`DASH_PIN`). Jede Eingabe wird geprüft. |
| Browser-Seite | Content-Security-Policy: nur eigene Skripte, keine fremden Verbindungen, kein Einbetten in fremde Seiten. Jeder Wert aus dem Netz wird vor der Anzeige maskiert. Keine Anfragen an Google mehr (Schrift liegt lokal). |
| Kiosk-Browser | Läuft als eigener Benutzer `xps-kiosk` ohne Passwort, ohne sudo, ohne Shell. |
| Steuerung | Was der Bildschirm macht, entscheidet das Dashboard ohne Rechte; der Root-Dienst `xps-control` nimmt aus `host-state.json` nur fünf geprüfte Schalter an (Kiosk, AirPlay, Helligkeit, Webcam, Anzeige) und hat kein Netz. |
| Webcam | `xps-ambient` hat kein Netzwerk (`PrivateNetwork=yes`), darf nur `/dev/video0`, liest 16×12 Graupunkte, verwirft sie sofort und schreibt nur Zahlen. Bei dunklem oder ausgeschaltetem Bildschirm ist die Kamera aus. |
| Docker | Nur `xps-services` (ohne Netz) fragt die Docker-Sockets und schreibt Namen und Zahlen in eine Datei; das Dashboard bekommt nie Docker-Zugriff. |
| Geheimnisse | Nichts davon im öffentlichen Repo (`.gitignore`); das öffentliche Umbrel-Image enthält nur Code. |

## In dieser Prüfung behoben

| Problem | Folge | Jetzt |
| --- | --- | --- |
| Der Kiosk-Browser lief als `paul`, der sudo ohne Passwort hat. | Eine Lücke in Chromium (es zeigt Daten aus dem Netz: AirPlay-Cover, Home-Assistant-Namen) wäre sofort root gewesen. | Eigener Benutzer `xps-kiosk` ohne Rechte. |
| Die Dashboard-API las jeden Request-Body als JSON. | Eine präparierte Webseite, im Heimnetz geöffnet, hätte per Formular Licht schalten, To-dos anlegen oder das Layout ändern können (CSRF). | Nur `application/json` vom eigenen Origin. |
| Jeder Hostname wurde beantwortet. | Eine fremde Seite hätte per DNS-Rebinding Kalender, To-dos und Dienste auslesen können. | Nur Heimnetz-, IP- und Tailscale-Namen, eigene über `DASH_ALLOWED_HOSTS`. |
| Keine Sicherheits-Header. | Einbetten in fremde Seiten (Clickjacking), kein Schutz bei einem XSS-Fehler. | CSP, `X-Frame-Options`, `nosniff`, kein Referrer. |
| Schrift von Google Fonts. | Jeder Kiosk-Start meldete die IP an Google; ohne Internet falsche Schrift. | Schrift liegt im Dashboard (SIL OFL). |
| Kein Schutz vor anderen Geräten im WLAN. | Gäste konnten alles schalten. | Optionale PIN für Änderungen von anderen Geräten. |
| `%h`/`%U` in der Kiosk-Unit zeigten auf root. | HOME=/root für den Browser. | Ein Startskript setzt HOME und den Laufzeitordner richtig. |

Dazu Fehler, die den Betrieb gestört hätten: Das Dashboard startete nach
einem Neustart erst nach AirPlay (fehlendes Verzeichnis), der WLAN-Watchdog
gab nach einem ausgelassenen Neustart für immer auf, und `umbrel.local`
verschwand, wenn avahi neu startete. Alle drei sind behoben.

## Restrisiken und was du tun kannst

Nach Wichtigkeit:

1. **Diebstahl des Laptops.** Die SSD ist nicht verschlüsselt, damit der XPS
   nach einem Stromausfall ohne Eingabe wieder startet. Wer ihn mitnimmt, kann
   Umbrel-Daten, Fotos, Tokens und das WLAN-Passwort lesen. Ihn nicht sichtbar
   ans Fenster stellen; Backups nur auf ein verschlüsseltes Laufwerk; nach
   einem Diebstahl WLAN-Passwort, Home-Assistant-Token und Immich-Schlüssel
   ändern.
2. **Geräte im eigenen WLAN.** Das Dashboard ist im Heimnetz ohne Anmeldung
   lesbar (es hängt ja auch sichtbar an der Wand). **`DASH_PIN` setzen**,
   sobald Gäste oder unbekannte Geräte im WLAN sind, und Gäste ins
   Gäste-WLAN des Speedport schicken. AirPlay kann jeder im WLAN benutzen
   (shairport-sync kennt bei AirPlay 2 kein Passwort); schaltbar in der
   Steuerung.
3. **Umbrel-Apps.** Umbrel läuft als privilegierter Container; eine
   bösartige App hätte praktisch den ganzen XPS. Nur bekannte Apps aus dem
   offiziellen Umbrel-App-Store installieren, Umbrel-Passwort stark und mit
   Zwei-Faktor-Anmeldung.
4. **sudo ohne Passwort für `paul`.** Anmelden geht nur mit deinem
   SSH-Schlüssel oder am Gerät mit Passwort; der Schlüssel auf dem Mac ist
   damit so wertvoll wie root. Ihm eine Passphrase geben
   (`ssh-keygen -p -f ~/.ssh/id_ed25519`). Wer sudo mit Passwort will:
   `sudo rm /etc/sudoers.d/90-xps-paul` (danach fragt `sudo` nach dem
   Passwort aus der Installation).
5. **Router.** Keine Portweiterleitung, UPnP aus, die IPv6-Firewall des
   Speedport an lassen (Standard). Für unterwegs Tailscale mit
   Zwei-Faktor-Anmeldung im Tailscale-Konto.
6. **Umbrel- und Projekt-Updates sind manuell.** Debian aktualisiert sich
   selbst, Umbrel und dieses Projekt nicht. Etwa einmal im Monat im Fork
   *Sync fork* und `sudo update-xps`; schlägt ein Umbrel-Update fehl, kehrt
   es von selbst zum alten Image zurück.
7. **Installer-Stick.** Enthält das WLAN-Passwort im Klartext; nach der
   Installation neu formatieren.

## Wie geprüft wurde

- Code-Durchsicht aller Skripte, Units und des Dashboards.
- 150 automatische Tests des Dashboards (`npm test`), darunter Tests für
  CSRF, DNS-Rebinding, PIN mit Sperre nach fünf Fehlversuchen,
  Eingabeprüfung und die Regeln der Steuerung; Smoke-Test des echten Servers.
- Tests der Root-Dienste gegen nachgebaute `/sys`-Dateien und ein falsches
  `systemctl` (`python3 -m unittest discover -s scripts/tests`), u. a. dass
  ungültige Wünsche nie mehr als die erlaubten Schalter bewirken.
- `shellcheck` für alle Shell-Skripte, `systemd-analyze verify` für die Units.
- Die Oberfläche im echten Browser durchgeklickt (Playwright), ohne
  CSP-Verstöße oder Skriptfehler.

Nicht ohne den echten XPS prüfbar: Broadcom-WLAN, Display und Kiosk-Sitzung,
Backlight, Webcam und Ton. Die Abnahmeliste dafür steht in
[installation.md](installation.md), Schritt 10.
