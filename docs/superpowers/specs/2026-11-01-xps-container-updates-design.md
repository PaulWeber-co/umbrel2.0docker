# Umbrel 2.0.1 und Updates für den XPS-Container

Status: konkreter Entwurf zur Prüfung; noch keine Änderung am laufenden Umbrel.

## Ziel und Grenzen

Pauls Fork soll die offiziellen Sicherheitskorrekturen von 2.0.1 erhalten, seine bestehenden Docker-, USB-, Dashboard- und App-Funktionen behalten und zukünftige freigegebene Fork-Updates über den vorhandenen Aktualisieren-Button installieren können. Zuerst wird die laufende Musikbereinigung abgeschlossen. iCloud-Einrichtung und Änderungen an Apps gehören nicht zu diesem Update.

Fehlerfreiheit lässt sich nicht garantieren. Freigabekriterien, Sicherung der veränderlichen Daten und ein erprobter Rückweg sind deshalb Voraussetzungen für den Produktivwechsel.

## Geprüfter Ausgangszustand

- Fork: `PaulWeber-co/umbrel2.0docker`, Branch `master`, Ausgangscommit `886487bdd1b2db1d38a53c7bf0999982ae77b7ed`.
- Image: `ghcr.io/paulweber-co/xps-homeserver-umbrelos:branch-master`; veröffentlichtes und laufendes Image sind derzeit identisch. Umbrel meldet 2.0.0.
- XPS: Debian 13, laufender Kernel `6.12.113+deb13-amd64`, Paketversion `6.12.113-1`. Diese Version ist laut Debian für CVE-2026-98432 korrigiert. Der Container nutzt den Host-Kernel.
- Container: libde265 `1.1.1-1`, libheif `1.23.4-1`, CA-Paket `20250419`; der Umbrel-Dienst verwendet noch nicht ausdrücklich den System-CA-Speicher.
- Der normale Updater lädt das offizielle Update-Skript. Dessen Geräte-Updatepfad passt nicht zur Container-Installation und endet mit `No supported update mechanism found`.
- `update-umbrel.sh` kann bereits einen Image-Digest installieren und bei fehlgeschlagener Zustandsprüfung auf das vorherige Image zurückwechseln. Das allein stellt geänderte Datenbanken nicht wieder her.

## Schritt 1: Sicherheitsstand 2.0.1

Die neun offiziellen Commits zwischen 2.0.0 und 2.0.1 werden mit dem Fork verglichen und integriert. Die vorhandenen Container-Buildstufen, USB-Erkennung und Hostdienste dürfen nicht durch die ursprünglichen Gerätevarianten ersetzt werden.

Zu übernehmen sind insbesondere die aktualisierten Debian-/APT-Stände, libde265 1.1.3, die passende libheif-Paketversorgung, der System-CA-Speicher für Node sowie die zutreffenden Update-Härtungen. Rugix-/Mender-Änderungen betreffen die entsprechenden Gerätevarianten; sie ersetzen nicht den Container-Updater. Die zusätzliche IPv4-Filterregel wird hinsichtlich ihrer Netzwerk-Namensräume geprüft; sie darf mDNS, Tailscale oder veröffentlichte App-Ports nicht beeinträchtigen. Der bereits korrigierte Host-Kernel wird nicht durch einen Container-Kernel ersetzt.

Der CI-Build erzeugt zunächst ein unveränderliches amd64-Kandidatenimage mit Commit- und Versionskennzeichnung. Eine reine Änderung der angezeigten Versionsnummer genügt nicht.

## Schritt 2: Containerfähiger Aktualisieren-Button

### Zuständigkeiten

Ein kleiner systemd-Dienst auf dem XPS ist allein für den Austausch des äußeren Umbrel-Containers zuständig. Umbreld spricht ihn über einen dedizierten Unix-Socket an. Dafür wird ausschließlich dessen Verzeichnis eingebunden; der Host-Docker-Socket wird Umbreld nicht zusätzlich zugänglich gemacht. Es entsteht kein öffentlich erreichbarer Update-Port.

Der Dienst bietet einen begrenzten Vertrag: freigegebene Version abfragen, Update ohne benutzerdefinierte Parameter starten, dauerhaften Status lesen. Die Anfrage darf weder Shellbefehle noch beliebige Image-URLs, Repository-Namen, Dateipfade oder Digests enthalten. Gleichzeitige Starts werden durch eine Sperre zusammengeführt oder abgewiesen.

Ein Updatejob läuft unabhängig vom anfragenden Umbrel-Prozess. Sein Status wird atomar auf dem Host gespeichert: Job-ID, Zielversion/-Digest, Phase, Fortschritt, Fehler und Ergebnis. Nach dem Containerwechsel kann die Oberfläche denselben Auftrag weiter anzeigen. Ein Neustart oder Verbindungsabbruch darf nicht fälschlich als Erfolg gelten.

### Freigabe zukünftiger Updates

Der Button verwendet ausschließlich ein Freigabemanifest des konfigurierten Fork-Repositories. Es enthält die SemVer-Version, amd64-Image-Referenz mit SHA-256-Digest, Quellcommit und Hinweise zur Datenkompatibilität. Repository, Registry und Architektur sind fest konfiguriert; Eingaben werden strikt geprüft. Zugangsdaten werden nicht in Protokolle geschrieben.

Das Manifest wird erst nach erfolgreichem CI-Build und den unten genannten Tests als stabile Fork-Version veröffentlicht. `branch-master` allein gilt nicht als stabile Freigabe. Erscheint eine neue offizielle Umbrel-Version, wird eine automatische Vergleichs-/Buildprüfung ausgelöst; ein unverändert ungeprüftes Originalimage wird nicht installiert. Unverarbeitete Upstream-Versionen werden als noch nicht für diesen Fork freigegeben gekennzeichnet.

Außerhalb einer explizit konfigurierten XPS-Container-Installation bleibt der vorhandene Geräte-Updater zuständig. Ein fehlender oder unzugänglicher Hostdienst führt im Container zu einer verständlichen Fehlermeldung, nicht zum Ausführen des offiziellen Geräte-Installers.

## Installation, Datensicherung und Rückweg

Vor dem Wechsel: USB-Arbeit abgeschlossen, verfügbare Kapazität prüfen, laufende Apps und ihre Zustände erfassen, Konfiguration und benötigte veränderliche App-/Umbrel-Daten konsistent sichern. Live-Kopien offener SQLite-Datenbanken reichen nicht. Sicherungsziel und Datenumfang werden anhand der tatsächlichen Größen festgelegt; bei fehlender Kapazität wird der Wechsel abgebrochen. Ein vorübergehender Gesundheitsfehler darf keine Datenlöschung auslösen.

Das Kandidatenimage wird zunächst auf einem getrennten Testsystem mit separatem Datenvolume geprüft. Das Produktivvolume wird nie gleichzeitig von zwei Umbrel-Instanzen benutzt. Auf dem XPS werden Image-Digest, Versionsanzeige, API, persistente Daten und bisher laufende Apps kontrolliert. Der Installationsauftrag stoppt und startet nur die für den Austausch notwendigen Dienste.

Bei fehlgeschlagener Zustandsprüfung wird das bisherige Image wieder eingesetzt. Hat der Kandidat Datenformate verändert, ist zusätzlich die vorherige konsistente Datensicherung wiederherzustellen; ein Image-Rollback allein wird nicht als vollständige Wiederherstellung bezeichnet. Nachgewiesene Dateninkompatibilität verhindert eine automatische Freigabe ohne getesteten Wiederherstellungsweg.

## Verifikation und Abnahme

1. Bestehende zielgerichtete Tests für Hostdienste, Dashboard und Umbreld ausführen; neue Fehler gegenüber der Ausgangsbasis klären.
2. Container-Updater testen: nur freigegebene Digests, keine fremden Images/Befehle, fehlender Socket, ungültiges Manifest, voller Datenträger und gleichzeitige Starts.
3. Unterbrochene Verbindung, Neustart während des Updates, fehlerhaftes Image und Rückkehr mit konsistenten Daten testen.
4. Im Kandidaten 2.0.1 und tatsächliche Decoder-/CA-Konfiguration nachweisen; HEIC-Vorschaubilder prüfen.
5. Web-Anmeldung, MCP, bisher aktive Apps, Portfreigaben, USB-Erkennung/Lesen/Schreiben/Auswerfen und vorhandene Cloud-Funktion prüfen.
6. Downtify muss nach der beauftragten Musiklöschung starten; die ausgelagerte Musik wird nicht automatisch erneut heruntergeladen. Die USB-Playlist behält die Reihenfolge von „Excuse Me“ bis „Entropy“.
7. Erst nach bestandenem Kandidatentest und geprüfter Sicherung auf dem XPS installieren; danach die Prüfungen aus 4–6 wiederholen und den Status dokumentieren.

## Nachweise

- Offizielle Änderungen: https://github.com/getumbrel/umbrel/compare/2.0.0...2.0.1
- Veröffentlichung: https://github.com/getumbrel/umbrel/releases/tag/2.0.1
- Kernelstatus: https://security-tracker.debian.org/tracker/CVE-2026-98432
- Fork: https://github.com/PaulWeber-co/umbrel2.0docker
