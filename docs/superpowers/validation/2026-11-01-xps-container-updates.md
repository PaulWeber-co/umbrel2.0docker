# XPS-Container-Updates: Verifikation

Freigegebener Quellstand: `4faf23b8a2e9b08fd4ebf978bd31f278a7f36612`.
Produktivwechsel am **2. November 2026 erfolgreich abgeschlossen und nachgeprüft**.

## Bestandene Prüfungen

- Offizieller 2.0.1-Merge: `e1fcb5d8`. Alter XPS reproduzierte die erwarteten
  Abweichungen bei Version, libde265 und System-CA-Option. Der neue lokale
  amd64-Kandidat besteht alle sieben tatsächlichen Image-Prüfungen, einschließlich
  OpenSSL-Zertifikaterzeugung und Watchman.
- Backend nach Review-Korrekturen: 136 Testdateien, **1.618 Tests bestanden**,
  Linux/Node 22 im Kandidaten mit seinen nativen Produktions-Bindings.
- UI nach Review-Korrekturen: 117 Testdateien, **890 Tests bestanden**, Linux/Node 22.13.
- Gezielte Python-Update-Suite: **53 Tests bestanden**. Reale temporäre Archive,
  Integritätsfehler, Wiederherstellung einzelner Zustandsordner, SQLite-WAL/SHM,
  Erhalt fremder Medien, begrenzte Socketanfragen, parallele Statusabfragen,
  sichere Wiederherstellung, widersprüchliche Statusdaten, abgestürzte Worker,
  vertrauenswürdige Kandidatenherkunft und Kompatibilitätsbindung werden geprüft.
- Vollständige abschließende Linux-Host-Suite: **73 bestanden**, sieben explizite
  Image-Prüfungen separat ausgeführt (80 Fälle insgesamt).
- Beide Typechecks, sechs Backend-Sockettests und vier UI-Recoverytests bestanden.
- Dashboard-Basis: 208 Tests bestanden, drei übersprungen.
- GitHub: Backend-Tests/Format/Typen, UI-Tests/Lint/Typen und Apple-Clients bestanden.
  Eine neue Testdatei verletzte zunächst Prettier; gezielt korrigiert.

## Unabhängige Prüfung

Ein unabhängiger Reviewer prüfte den gesamten Branch bis `a28fd6ba` mit frischem
Kontext. Keine kritischen und acht wichtige Befunde. Die Korrekturen wurden
mit gezielten vorher fehlschlagenden Tests und erneuten vollständigen Suiten
geprüft; kein zweiter Reviewdurchlauf.

Die Korrekturen erfassen effektive beschreibbare Speicherpfade und App-Daten,
prüfen Sicherungsbytes vor dem Wechsel und vor der Datenwiederherstellung,
verlangen geprüfte Wiederherstellung statt Fortschritts-Heuristiken, benutzen
den tatsächlichen Lebenszyklus installierter Apps und halten den Statusdienst
bei beschädigten Jobdateien verfügbar. Veröffentlichungen sind an Herkunft,
master-Abstammung und genau getesteten Kompatibilitätsmodus gebunden.

GitHub-Environment `xps-stable` tatsächlich eingerichtet und per API nachgelesen:
erforderlicher Reviewer `PaulWeber-co`, erlaubter Branch ausschließlich `master`.
Nur `no-migration` kann derzeit veröffentlicht werden. Datenmigrationen benötigen
zuerst eigene vollständige Lifecycle-Nachweise.

## Lesende Prüfung am XPS

Ausgangscheckout sauber auf `886487bdd1b2db1d38a53c7bf0999982ae77b7ed`.
Die überarbeiteten Vorprüfungen liefen ohne Anhalten oder Aktualisieren auf dem
XPS durch. Sicherungsumfang rund **2,48 GB**, einschließlich beschreibbarer
Downloads, Appdaten und Konfiguration; unveränderte Fotos bleiben außerhalb.
USB-Laufwerk `Backup` erkannt: exFAT, UUID `EFF4-91B7`. Elf installierte Apps
und deren aktive/gestoppte Zustände erfasst. Intern weiterhin **null MP3-Dateien**
im früheren Downtify-Ziel; Speicherprüfung unmittelbar vor dem Wechsel rund 36 GiB frei.

## Vollständiger Registry-Lifecycle und Veröffentlichung

Der kanonische master-Lauf [41357291865](https://github.com/PaulWeber-co/umbrel2.0docker/actions/runs/41357291865)
bestand Build, 80 Host-Fälle (73 bestanden, sieben separat ausgeführte Imagefälle),
alle sieben echten Image-Prüfungen und den vollständigen verschachtelten
Docker-/systemd-Lifecycle. Er umfasst erfolgreichen Containerwechsel,
Appzustände, Doppelklick/Reconnect, Owner-Anmeldung, iCloud-Provider, MCP,
authentifizierten Update-Status, echte HEIC-Dekodierung, Ablehnung defekter
HEIC-Dateien, exFAT-Testmedium sowie fehlende App-/USB-Negativfälle. Ein absichtlich
ungesunder Kandidat wurde mit dem echten Worker auf altes Image und gesicherte
Daten zurückgeführt; unabhängige Medien blieben erhalten.

Frühere Testaufbaufehler (überlappendes Docker-Netz, unter dynamischem `/tmp`
versteckte `docker cp`-Datei, entfernte Healthcheck-Startfrist und falsch gesetzter
unverwalteter App-Ausgangszustand) wurden jeweils reproduziert und korrigiert.
Keiner dieser fehlgeschlagenen Läufe gab eine stabile Version frei.

Die geschützte Veröffentlichung
[41405661095](https://github.com/PaulWeber-co/umbrel2.0docker/actions/runs/41405661095)
war erfolgreich. Das tatsächliche [Release xps-2.0.1](https://github.com/PaulWeber-co/umbrel2.0docker/releases/tag/xps-2.0.1)
enthält das gegen Commit, Version und erfolgreiche Laufzeitevidenz geprüfte Manifest:

```text
image: ghcr.io/paulweber-co/xps-homeserver-umbrelos@sha256:21d8de0f13743c286bf071660d6c5dca9e0e3eaa90b31a26dc2428ec24ea8181
sourceCommit: 4faf23b8a2e9b08fd4ebf978bd31f278a7f36612
version: 2.0.1
dataCompatibility: no-migration
```

Nachweisartefakt `13103843855`, ZIP-SHA256
`da241eb53d0e7711ed6d1e9876b6d1d008f33c7185dbdfba340d108ef0c660fd`.
Das veröffentlichte Manifest und der XPS-CLI-Check liefern exakt denselben Digest.

## USB und Musik

3.495 MP3-Dateien auf dem USB-Stick; intern im früheren Downtify-Ziel null MP3.
Die Hauptplaylist enthält 3.495 gültige Verweise, von A$AP Rocky / Excuse Me bis
Distrion, Alex Skrindo / Entropy. Die zusätzliche 22-Titel-Playlist ist ebenfalls
gültig. Der Nutzer akzeptierte die bereits vorher fehlenden Lyrics und früheren
Downloadfehler und beauftragte keine erneute Vollkopie oder vollständige Hashrunde.
Die interne Löschung gab 29.058.697.852 Bytes frei.

Der USB-Stick war exFAT-formatiert, aber in beiden gültigen GPT-Tabellen fälschlich
als Linux-Partition gekennzeichnet. Nach ausdrücklicher Nutzerfreigabe wurden
Sicherung und Prüfsummen beider Tabellen/MBR angelegt, sauber ausgehängt, exFAT
lesend geprüft und ausschließlich der Typ auf Microsoft Basic Data geändert.
Beide GPT-CRCs, Geometrie, Identitäten und unveränderte übrige Tabellenbytes
wurden geprüft; exFAT blieb sauber, 3.495 MP3 und alle Playlistverweise erhalten.
Keine Neuformatierung. Die physische Lesbarkeit am Mac ist noch vom Nutzer zu prüfen.
Die zugrunde liegende Formatterfunktion setzt künftig für exFAT den korrekten Typ;
echte temporäre GPT-Abbilder prüfen zugleich, dass ext4 Linux bleibt.

## Produktivwechsel

Hostdienst gezielt installiert, ohne globales Setup oder Kiosk-Neustart.
Hostkonfiguration vorher gesichert unter
`/var/lib/xps-umbrel-updater/host-before-20261101T223313Z`.
Vorher: Version 2.0.0, 11 Apps (acht bereit, drei gestoppt), rund 36 GiB frei.
Kiosk war bereits vorher planmäßig inaktiv; keine Änderung am Dashboard/Kiosk.

Gestarteter geschützter Hostjob: `a313ab3d-7411-42c8-ae68-2c079e9c9e9a`.
Endstatus: `finished`, `progress=100`, `outcome=succeeded`, `error=false`.
Native MCP meldet Version **2.0.1**, Status **running**. Update-API meldet
`containerManaged=true`, `running=false`, `targetVersion=2.0.1`; `checkUpdate`
meldet `available=false`, `pendingUpstream=false`. Kein Downgrade oder erneuter
Installationsauftrag ist angeboten. Das installierte Image hat exakt den oben
freigegebenen Digest und die Quellrevision.

Alle elf Apps haben dieselben Zustände und Versionen wie vorher: acht bereit;
Cloudflare Tunnel, Obsidian und OpenCode weiterhin gestoppt. Der Worker hat alle
vorher aktiven Container, Mountidentitäten und veröffentlichten App-Ports
nachgeprüft. Paperclip benötigte längere Startzeit; sein Port antwortete
anschließend mit HTTP 200, ohne Eingriff in App oder Daten.

Zusätzlich bestanden **7/7 Sicherheitsprüfungen im tatsächlich laufenden
Produktivcontainer**: 2.0.1, libde265 `1.1.3-1`, System-CA-Verwendung,
Containerinitialisierung, echte Zertifikaterzeugung, GPT-Formatierer und Watchman.
Installiert: libheif `1.23.6-2~deb13u1`, CA-Paket `20250419+deb13u1`.
Hostkernel unverändert `6.12.113+deb13-amd64`.

Authentifizierte Cloud-API liefert den iCloud-Provider; bestehender MCP-Zugriff
funktioniert. Die Web-Anmeldung wurde vollständig im isolierten Lifecycle mit
echtem Testowner geprüft; produktiv wurde kein neues Passwort gesetzt oder
neuer Benutzer angelegt. `umbrel.local` und `xps.local` liefern vom Mac HTTP 200.
Tailscale am XPS: Running, online, keine Health-Meldungen. Eine direkte
Tailscale-Verbindung vom Mac war nicht nachweisbar: dessen lokaler Dienst läuft
nicht, die Route ging über das normale LAN-Gateway. Dafür wurden weder
VPN-Einstellungen noch Netzfreigaben verändert.

Sicherung unverändert aufbewahrt:
`/var/lib/xps-umbrel-updater/backups/snapshot-1793604699537575109.tar`,
2.476.117.558 ausgewählte Datenbytes, 2.511.861.760 Archivbytes,
SHA256 `e17c6bc7c30fd6b7780262d80c378f4cb87c17129c934e8aae3c55f993adface`.
Prüfsumme nach dem Wechsel erneut gültig; Metadaten nennen altes 2.0.0-Image,
Inventar und Wiederherstellungspfade. Alte Images und Sicherungen bleiben erhalten.
Nach Installation und Sicherung rund **29 GiB frei**. Kein Prune.

Nach dem Wechsel erneut ausschließlich lesend geprüft: 3.495 USB-MP3,
null interne MP3, 3.495 gültige Hauptplaylist-Verweise, beide Endtitel erhalten.
USB weiterhin exFAT/Microsoft Basic Data. `Paul iCloud` und `Jane iCloud`
vorhanden, `Diana iCloud` nicht vorhanden. Kiosk weiter im ursprünglichen
inaktiven Zustand.

Die [maschinenlesbare Produktionsevidenz](2026-11-02-xps-production-evidence.json)
enthält den tatsächlichen Abschlussstatus, Appvergleich und Sicherungsnachweis.

## Grenzen und getrennte nächste Schritte

Die Produktionsdaten werden nicht zu Testzwecken zurückgesetzt. Der tatsächliche
Rollback mit Daten wurde im isolierten System geprüft. Ein physischer Stromausfall
wurde nicht provoziert. Benutzerdefinierte Sicherungsziele außerhalb der
systemd-Schreibpfade sind nicht unterstützt; detailliertes Unterprozess-stderr
bleibt wegen möglicher Zugangsdaten aus dem Journal ausgeschlossen.

`Paul iCloud` und `Jane iCloud` sind vorbereitet; keine Apple-Anmeldung eingerichtet.
Die native iCloud-Anbindung ist eine Drive-Synchronisation, kein vollständiges
Fotos-/Gerätebackup. Eine getrennte Fotosicherung benötigt einen weiteren
Einrichtungsschritt. Während des OS-Wechsels werden keine Apps oder Apple-Konten
hinzugefügt.

Das vollständige [Entscheidungsprotokoll](2026-11-01-xps-container-updates-decisions.md)
hält Planabweichungen, Review-Rulings und zurückgestellte kleinere Punkte fest.
