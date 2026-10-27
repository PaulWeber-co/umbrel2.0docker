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
| Dashboard | Läuft als eigener Benutzer ohne Rechte, mit schreibgeschütztem System (`ProtectSystem=strict`), ohne Capabilities, Namespaces und Geräte, nur mit IP- und lokalen Sockets (`systemd-analyze security`: 3,1 „OK“). Tokens stehen nur in `/etc/xps-homeserver/dashboard.env` (nur root) und gehen nie an den Browser. |
| Dashboard-API | Änderungen nur als JSON vom Dashboard selbst (keine fremde Webseite kann Licht schalten oder den Bildschirm ausmachen), nur unter bekannten Hostnamen (Schutz gegen DNS-Rebinding), optional mit PIN (`DASH_PIN`; fünf Fehlversuche sperren ein Gerät für 10 Minuten, 20 im ganzen Netz alle außer dem Kiosk). Jede Eingabe wird geprüft, Aktionen gibt es nur, wenn eine Kachel sie wirklich hat. |
| Browser-Seite | Content-Security-Policy: nur eigene Skripte, keine fremden Verbindungen, kein Einbetten in fremde Seiten. Jeder Wert aus dem Netz wird vor der Anzeige maskiert. Keine Anfragen an Google mehr (Schrift liegt lokal). |
| Kiosk-Browser | Läuft als eigener Benutzer `xps-kiosk` ohne Passwort, ohne sudo, ohne Shell. |
| Steuerung | Was der Bildschirm macht, entscheidet das Dashboard ohne Rechte; der Root-Dienst `xps-control` nimmt aus `host-state.json` nur fünf geprüfte Schalter an (Kiosk, AirPlay, Helligkeit, Webcam, Anzeige) und hat kein Netz. |
| Webcam | `xps-ambient` hat kein Netzwerk (`PrivateNetwork=yes`), darf nur `/dev/video0`, liest 16×12 Graupunkte, verwirft sie sofort und schreibt nur Zahlen. Bei dunklem oder ausgeschaltetem Bildschirm ist die Kamera aus. |
| AirPlay | shairport-sync im offiziellen Container in fester Version; ans Dashboard gehen nur Metadaten über eine Pipe. Läuft so, wie das Image gebaut ist, im Container als root mit Zugang zum System-D-Bus (für avahi), siehe Restrisiken. |
| Spotify Connect | go-librespot läuft im Container als eigener Benutzer `xps-spotify` (nicht root), ohne Linux-Capabilities, mit schreibgeschütztem Dateisystem und nur seinem eigenen Ordner; seine Steuer-API lauscht nur auf 127.0.0.1. Das Dashboard holt Cover nur per HTTPS von Spotifys Bildservern. |
| Docker | Nur `xps-services` (ohne Netz) fragt die Docker-Sockets und schreibt Namen und Zahlen in eine Datei; das Dashboard bekommt nie Docker-Zugriff. |
| Minifunk | Das Dashboard kennt das gemeinsame Knuddl-Geheimnis (nur in der dashboard.env) und nutzt im Raum nur `x/status` und `x/funk`, nie eure Postfächer. Alles darin ist Ende-zu-Ende verschlüsselt (AES-GCM, wie in der App). Was ankommt, wird geprüft: Text höchstens 500 Zeichen und maskiert angezeigt, Fotos nur als echtes JPEG bis 1,5 MB, eins pro Person und Tag. Fotos liegen nur im Datenordner des Dashboards und werden nach 6 Stunden gelöscht. |
| Kalender | Die Kalender-Links stehen nur in der dashboard.env, in Fehlermeldungen nur als „Kalender-Link (Host)“. |
| To-dos und Bucketlist | Kommen verschlüsselt wie der Minifunk aus dem Raum (`x/liste`), nur Titel, Termine, Namen, Farben und Stimmen, keine Notizen. Die Wand prüft jedes Feld, zeigt alles maskiert und kann nichts ändern: abgehakt wird nur in der App. |
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
| Über den Aktionsnamen `constructor` antwortete der Server mit seinem internen Zustand. | Jedes Gerät im WLAN (mit PIN: erst nach Eingabe) sah Datenpfade und die Koordinaten aus der dashboard.env, keine Tokens. | Nur Aktionen, die eine Kachel wirklich hat. |
| Fehler des Kalenders nannten den ganzen Freigabe-Link. | Jeder im WLAN konnte ihn in der Kachel lesen und den Kalender abonnieren. | Nur noch „Kalender-Link (Host)“. |
| Die PIN-Sperre zählte nur pro Adresse. | Wer im WLAN viele Adressen benutzt, hätte eine kurze PIN durchprobieren können. | Zusätzlich sperren 20 Fehlversuche im ganzen Netz für 10 Minuten. |
| Spotify Connect lief im Container als root, mit Zugang zum System-D-Bus. | Über D-Bus darf root systemd alles starten: Eine Lücke in go-librespot wäre der ganze XPS gewesen. | Eigener Benutzer `xps-spotify` mit der Gruppe audio. |
| Hostnamen mit `@` oder Leerzeichen galten als bekannt, wenn sie auf `.local` endeten. | Kein Angriff aus dem Browser (der sendet so etwas nicht), aber ein unnötiges Loch im Schutz gegen DNS-Rebinding. | Nur Zeichen, die in Hostnamen vorkommen. |
| Das Dashboard, der einzige Dienst im Netz, hatte nur die Grund-Sperren von systemd. | Nach einer Lücke im Dashboard mehr Angriffsfläche im Kernel. | Weitere Sperren, Bewertung 3,1 statt 7,4. |

Dazu Fehler, die den Betrieb gestört hätten: Das Dashboard startete nach
einem Neustart erst nach AirPlay (fehlendes Verzeichnis), der WLAN-Watchdog
gab nach einem ausgelassenen Neustart für immer auf, und `umbrel.local`
verschwand, wenn avahi neu startete. In der zweiten Runde: `xps-services`
startete ohne laufendes Docker gar nicht (226/NAMESPACE) statt das in der
Kachel zu melden, und was der Kiosk-Browser meldete, landete auf dem
Bildschirm statt im Journal. Alles behoben.

## Restrisiken und was du tun kannst

Nach Wichtigkeit:

1. **Diebstahl des Laptops.** Die SSD ist nicht verschlüsselt, damit der XPS
   nach einem Stromausfall ohne Eingabe wieder startet. Wer ihn mitnimmt, kann
   Umbrel-Daten, Fotos, Tokens, das WLAN-Passwort und das Knuddl-Geheimnis
   lesen. Ihn nicht sichtbar ans Fenster stellen; Backups nur auf ein
   verschlüsseltes Laufwerk; nach einem Diebstahl WLAN-Passwort,
   Home-Assistant-Token und Immich-Schlüssel ändern, in Knuddl neu verbinden
   (neues Geheimnis) und die Kalender-Freigaben aus- und wieder einschalten
   (neue Links).
2. **Geräte im eigenen WLAN.** Das Dashboard ist im Heimnetz ohne Anmeldung
   lesbar (es hängt ja auch sichtbar an der Wand), auch Minifunk-Fotos,
   solange sie angezeigt werden. **`DASH_PIN` setzen**,
   sobald Gäste oder unbekannte Geräte im WLAN sind, und Gäste ins
   Gäste-WLAN des Speedport schicken. AirPlay und Spotify Connect kann jeder
   im WLAN benutzen (shairport-sync kennt bei AirPlay 2 kein Passwort,
   Spotify Connect meldet sich ohne Konto an); beides gemeinsam schaltbar in der
   Steuerung.
3. **AirPlay-Empfänger.** shairport-sync läuft im Container als root und
   darf auf den System-D-Bus (für avahi); so ist das offizielle Image gebaut,
   und ohne root startet sein Zeitdienst für AirPlay 2 nicht. Eine Lücke
   darin, ausgenutzt von einem Gerät im WLAN, hätte den ganzen XPS. Wer
   AirPlay nicht braucht, schaltet es in der Steuerung aus (gemeinsam mit
   Spotify Connect).
4. **Umbrel-Apps.** Umbrel läuft als privilegierter Container; eine
   bösartige App hätte praktisch den ganzen XPS. Nur bekannte Apps aus dem
   offiziellen Umbrel-App-Store installieren, Umbrel-Passwort stark und mit
   Zwei-Faktor-Anmeldung.
5. **sudo ohne Passwort für `paul`.** Anmelden geht nur mit deinem
   SSH-Schlüssel oder am Gerät mit Passwort; der Schlüssel auf dem Mac ist
   damit so wertvoll wie root. Ihm eine Passphrase geben
   (`ssh-keygen -p -f ~/.ssh/id_ed25519`). Wer sudo mit Passwort will:
   `sudo rm /etc/sudoers.d/90-xps-paul` (danach fragt `sudo` nach dem
   Passwort aus der Installation).
6. **Router.** Keine Portweiterleitung, UPnP aus, die IPv6-Firewall des
   Speedport an lassen (Standard). Für unterwegs Tailscale mit
   Zwei-Faktor-Anmeldung im Tailscale-Konto.
7. **Umbrel- und Projekt-Updates sind manuell.** Debian aktualisiert sich
   selbst, Umbrel und dieses Projekt nicht. Etwa einmal im Monat im Fork
   *Sync fork* und `sudo update-xps`; schlägt ein Umbrel-Update fehl, kehrt
   es von selbst zum alten Image zurück.
8. **Installer-Stick.** Enthält das WLAN-Passwort im Klartext; nach der
   Installation neu formatieren.

## Wie geprüft wurde

- Code-Durchsicht aller Skripte, Units und des Dashboards.
- 181 automatische Tests des Dashboards (`npm test`), darunter Tests für
  CSRF, DNS-Rebinding, PIN mit Sperre pro Gerät und im ganzen Netz,
  Eingabeprüfung, die Regeln der Steuerung, die Verschlüsselung des Minifunks
  gegen die der Knuddl-App, das Listen-Paket der App (mit ihrem Code verschlüsselt);
  Smoke-Test des echten Servers.
- Tests der Root-Dienste gegen nachgebaute `/sys`-Dateien und ein falsches
  `systemctl` (`python3 -m unittest discover -s scripts/tests`), u. a. dass
  ungültige Wünsche nie mehr als die erlaubten Schalter bewirken.
- `shellcheck` für alle Shell-Skripte, `systemd-analyze verify` und
  `systemd-analyze security` für die Units.
- Das Setup in einem frischen Debian 13 durchgespielt, die Dienste dann unter
  echtem systemd 257 gestartet: Dashboard mit allen Sperren (antwortet, DNS
  und Verbindungen gehen), Steuerung, Webcam- und Docker-Dienst.
- PIN, Cookie und beide Sperren über das Netz von einer fremden Adresse aus;
  go-librespot als `xps-spotify` mit avahi über D-Bus.
- Die Oberfläche im echten Browser durchgeklickt (Playwright), ohne
  CSP-Verstöße oder Skriptfehler.

Nicht ohne den echten XPS prüfbar: Broadcom-WLAN, Display und Kiosk-Sitzung,
Backlight, Webcam und Ton. Die Abnahmeliste dafür steht in
[installation.md](installation.md), Schritt 10.
