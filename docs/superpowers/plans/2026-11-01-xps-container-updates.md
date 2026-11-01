# XPS Container Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Den bestehenden Fork mit den Sicherheitskorrekturen von Umbrel 2.0.1 aktualisieren und zukünftige getestete Fork-Images über den vorhandenen Aktualisieren-Button installieren.

**Architecture:** Umbreld verwendet in der ausdrücklich konfigurierten XPS-Container-Installation einen begrenzten HTTP-Vertrag über einen Unix-Socket. Ein Hostdienst startet einen unabhängigen systemd-Worker für den Austausch, hält den Status dauerhaft vor und akzeptiert ausschließlich freigegebene Digests des Forks. Originale Geräteinstallationen behalten den vorhandenen Updatepfad.

**Tech Stack:** Bestehendes TypeScript/Node 22, Vitest und tRPC; Python-3-Standardbibliothek/unittest auf dem Host; systemd, Docker Compose, GitHub Actions/GHCR. Keine zusätzliche Laufzeitbibliothek für den Hostdienst.

**Spec:** `docs/superpowers/specs/2026-11-01-xps-container-updates-design.md`

## Global Constraints

- Repository `PaulWeber-co/umbrel2.0docker`; Registry `ghcr.io/paulweber-co/xps-homeserver-umbrelos`; Plattform `linux/amd64`.
- Bestehende Docker-, USB-, Dashboard-, Cloud- und App-Funktionen erhalten. Keine Installation des offiziellen Geräteimages auf dem XPS.
- Laufender Host-Kernel `6.12.113+deb13-amd64` ist bereits für CVE-2026-98432 korrigiert. Das Container-Image ersetzt ihn nicht.
- 2.0.1 muss tatsächliche Paket-/CA-Korrekturen enthalten, nicht nur eine geänderte Versionsanzeige.
- Nur freigegebene SHA-256-Digests installieren; `branch-master` allein ist keine stabile Freigabe. Keine beliebigen Shellbefehle, Repositories, Dateipfade oder Images als Request-Parameter.
- Kein öffentlicher Update-Port und keine zusätzliche Host-Docker-Socket-Freigabe an Umbreld. Der bestehende privilegierte Container ist damit nicht plötzlich eine harte Sicherheitsgrenze.
- Vor Produktivwechsel konsistente Datensicherung, Platzprüfung und getesteter Rückweg; Image-Rollback allein stellt migrierte Daten nicht wieder her. Kein ungeprüftes Produktivvolume in einer zweiten Instanz öffnen.
- Musikbereinigung abgeschlossen: 3.495 interne MP3s entfernt, USB-Playlist unverändert von „Excuse Me“ bis „Entropy“. Musik nicht automatisch neu herunterladen. iCloud-Anmeldungen gehören nicht zu diesem Plan.

## Review Focus

- Client verschwindet nach Annahme des Auftrags: Worker läuft weiter, neuer Client sieht denselben Job (Tasks 3–5, 7).
- Neue Upstream-Version ohne getestetes Fork-Image: kein installierbares Geräteupdate vortäuschen und kein Downgrade anbieten (Tasks 2, 5–6).
- Gesunde Weboberfläche trotz fehlender App-Daten/USB-Anbindung: nicht allein aufgrund des Docker-Healthchecks freigeben (Tasks 3, 7–8).
- Snapshot unvollständig oder nachträglich verändert: vor dem Wechsel abbrechen; bestehende Musikdateien auf USB nicht als Update-Sicherungsziel überschreiben (Tasks 3, 7–8).
- Doppelklick, Host-Neustart und beschädigter Status: keine parallelen Worker, kein falsches Erfolgsergebnis und kein endloser automatischer Wiederholungsversuch (Tasks 3–5, 7).

## Gemeinsamer Vertrag

Hostkonfiguration: `/etc/xps-homeserver/updater.json` (root, 0600); Socketverzeichnis `/run/xps-umbrel-updater` (root, 0700); Socket darin `control.sock` (0600); dauerhafter Zustand `/var/lib/xps-umbrel-updater` (root, 0700). Das Socketverzeichnis wird auf `/run/xps-umbrel-updater` in Umbrel eingebunden. Umbreld erkennt ausschließlich `XPS_UMBREL_UPDATER_SOCKET=/run/xps-umbrel-updater/control.sock` als Aktivierung, nicht das bloße Vorhandensein einer Datei.

`GET /v1/release` liefert `{available, version, name, releaseNotes, digest, upstreamVersion, pendingUpstream}`. `POST /v1/update` akzeptiert nur das leere JSON-Objekt `{}` und antwortet mit HTTP 202 und `{jobId}`; ein bereits laufender Job liefert dieselbe ID. `GET /v1/status` liefert `{jobId, version, digest, phase, progress, error, outcome}`; `jobId`, Version und Digest sind vor dem ersten Job `null`. `phase`: `idle|preflight|backup|pull|switch|verify|rollback|finished`; `outcome`: `null|succeeded|rolled-back|failed|interrupted`. Fehler sind bereinigte Meldungen, keine Tokens oder vollständigen Umgebungen. Clienttimeout 10 s, maximal 1 MiB Antwort, Startbody maximal 64 Bytes; unerwartete Felder, Methoden und Pfade ablehnen.

Freigabemanifest `container-update.json` im stabilen GitHub-Release `xps-<version>`: `{schemaVersion:1, version, platform:"linux/amd64", image:"ghcr.io/paulweber-co/xps-homeserver-umbrelos@sha256:<64 lowercase hex>", sourceCommit:<40 lowercase hex>, releaseNotes, dataCompatibility:"no-migration"|"snapshot-required"}`. Version ist stabile SemVer ohne Präfix. Auswahl über `https://api.github.com/repos/PaulWeber-co/umbrel2.0docker/releases`; nur nicht zurückgezogene, nicht als Vorabversion markierte Releases mit passendem Manifest. HTTPS-Ziele/Weiterleitungen nur an GitHub-/GitHub-Asset-Hosts erlauben, 1 MiB JSON-Limit, keine aus Requests übernommenen URLs. Fehler beim Abruf dürfen keine Installation starten. Der Start prüft den gewählten Digest erneut und bindet den Job daran.

---

### Task 1: Sicherheitskorrekturen von 2.0.1 integrieren

**Files:** Modify `packages/os/umbrelos.Dockerfile`, `packages/umbreld/package.json`, relevante Lockdateien und die von Upstream 2.0.1 geänderten OS-Overlays/Rugix-Dateien; Create `xps-homeserver/scripts/tests/test_container_security.py`; Modify `.github/workflows/xps-umbrel-image.yml` für OCI-Version-/Commitlabels.

**Interfaces:** Consumes offizielle Commits `9298257b0e904ca8d8270b1702672666343f0b86..a72dac249974d1603be9423d3cf6ac1a2d8f65f9`; produces Containerbasis 2.0.1 mit unverändertem `BASE_VARIANT=-container`.

- [ ] Ausgangstests dokumentieren: `python3 -m unittest discover -s xps-homeserver/scripts/tests` und `node --test xps-homeserver/dashboard/test/*.test.js`; Abhängigkeiten nur für tatsächlich benötigte Node-Tests installieren.
- [ ] Laufzeitprobe `test_container_security.py` schreiben: Image aus `XPS_TEST_IMAGE` über `docker run --rm --entrypoint sh` prüfen; `/opt/umbreld/package.json` meldet `2.0.1`, `dpkg-query` meldet libde265 `1.1.3-1`, installierte Umbrel-Unit enthält `--use-openssl-ca`, Container-Initialisierung ist vorhanden. Mit dem bisherigen Image muss `python3 -m unittest discover -s xps-homeserver/scripts/tests -p test_container_security.py` fehlschlagen. Keine Tests, die nur Dockerfile-Zeilen mit ihrer Implementierung vergleichen.
- [ ] Die neun Upstream-Commits im isolierten Branch integrieren; Konflikte anhand beider Varianten lösen, insbesondere keine Fork-Containerstufe entfernen. libheif aus dem neuen APT-Stand übernehmen; Netzwerkfilter in den tatsächlich betroffenen Namensräumen bewerten und die Begründung dokumentieren.
- [ ] Kandidat mit `docker build --platform linux/amd64 --build-arg BASE_VARIANT=-container -f packages/os/umbrelos.Dockerfile -t xps-umbrel:2.0.1-candidate .` bauen; dieselbe Probe mit `XPS_TEST_IMAGE=xps-umbrel:2.0.1-candidate` muss bestehen. `npm --prefix packages/umbreld run typecheck` und gezielte betroffene Tests ausführen. Vollständigen Funktionstest in Task 7 ergänzen; diese Probe allein gibt das Image nicht produktiv frei.
- [ ] Commit: `fix: integrate umbrelOS 2.0.1 security fixes for XPS containers`.

### Task 2: Freigabemanifest strikt auswählen und validieren

**Files:** Create `xps-homeserver/scripts/xps_update_release.py`, `xps-homeserver/scripts/tests/test_update_release.py`, `xps-homeserver/scripts/tests/fixtures/container-update.json`.

**Interfaces:** Produces `validate_release(document: dict) -> dict`, `select_release(releases: list, current_version: str) -> dict | None`, `fetch_release(config: dict, current_version: str) -> dict`. Fixture verwendet Version `2.0.1`, Plattform `linux/amd64`, den festen Registry-Pfad, einen 64-stelligen Testdigest und 40-stelligen Testcommit.

- [ ] Tests schreiben: fremde Registry, Tags statt Digest, falsche Architektur, Zusatzfelder, ungültige SemVer, größere Antwort, fremde Weiterleitung und Vorabversion werden abgelehnt; gleiche/ältere Version ergibt `available=False`; ausstehendes Upstream-Release ergibt `pendingUpstream=True` ohne Installation.
- [ ] `python3 -m unittest discover -s xps-homeserver/scripts/tests -p test_update_release.py` ausführen: zunächst Import-/Funktionsfehler erwarten.
- [ ] Die drei Funktionen mit Standardbibliothek implementieren. HTTP-Client, Uhr und Releaseantworten für Tests injizierbar halten; kein Netzwerkzugriff in Unittests.
- [ ] Tests müssen bestehen; Digest und Quellcommit vor/nach dem Abruf identisch zurückgeben. Commit: `feat: validate stable XPS container release manifests`.

### Task 3: Wiederherstellbaren Installationsworker implementieren

**Files:** Create `xps-homeserver/scripts/xps_update_worker.py`, `xps-homeserver/scripts/xps_update_backup.py`, `xps-homeserver/scripts/tests/test_update_worker.py`, `xps-homeserver/scripts/tests/test_update_backup.py`; Modify `scripts/update-umbrel.sh`, `scripts/lib/umbrel.sh`, `scripts/rollback-umbrel.sh` unter `xps-homeserver/`.

**Interfaces:** Produces `run_job(job: dict, config: dict, runner) -> dict`, `write_status(path: Path, status: dict) -> None`, `create_snapshot(config: dict, runner) -> dict`, `restore_snapshot(snapshot: dict, runner) -> None`. Worker-CLI `python3 xps_update_worker.py --job <host-created-job-id>`; ID nur UUID, Jobdatei ausschließlich im festen Zustandsverzeichnis. Shellupdater erhält expliziten geprüften Zieldigest statt immer den neuesten Branch-Tag zu installieren.

- [ ] Tests für Platzmangel, unvollständige Sicherung, fehlerhaftes Image, geänderte Daten, bereits vorhandenen Job, abgebrochenen Zustand und Erfolg schreiben. Erwartung bei Platz-/Sicherungsfehler: kein Compose-Wechsel; bei Fehler nach Wechsel: ursprüngliches Image plus nötige Datensicherung wiederhergestellt, `outcome='rolled-back'` statt Erfolg.
- [ ] Beide Testdateien über unittest discovery ausführen; vor Implementierung müssen sie fehlschlagen.
- [ ] Atomare Statusdateien über temporäre Datei, `fsync` und `os.replace`; `flock` verhindert Parallelität. subprocess nur mit Argumentlisten, ohne `shell=True`. Zustandsübergänge gemäß gemeinsamem Vertrag; Erfolg erst nach Versions-, Daten- und App-Prüfung.
- [ ] Sicherungsumfang anhand tatsächlicher Mounts bestimmen: Umbrel-Konfiguration, Appdefinitionen/-daten, Cloud-Konfiguration und betroffene Home-Daten erfassen; Mounts außerhalb des Volumes separat aufnehmen. Keine laufenden SQLite-/Postgres-Dateien kopieren: vorherige Appzustände erfassen und notwendige Schreiber stoppen. Besitzrechte, ACLs/xattrs und Wiederherstellbarkeit erhalten. Vorhandene Musik auf USB ausschließen, nicht verändern. Sicherungsinventar, Umfang und Prüfsummen protokollieren; Platzbedarf plus 10 % Reserve vorab prüfen. Bei unbekannter Wiederherstellbarkeit stoppen.
- [ ] `snapshot-required` erzwingt getestete Datensicherung und Wiederherstellung. Auch `no-migration` benötigt die vereinbarte Sicherung; es ist kein Freibrief zum Überspringen. Bereits aktive Apps nach Erfolg/Rückkehr wieder starten, vorher gestoppte Apps gestoppt lassen.
- [ ] Tests müssen bestehen; Shellskripte mit `bash -n` prüfen. Commit: `feat: add recoverable digest-pinned XPS update worker`.

### Task 4: Begrenzten Unix-Socket-Hostdienst installieren

**Files:** Create `xps-homeserver/scripts/xps_update_service.py`, `xps-homeserver/scripts/tests/test_update_service.py`, `xps-homeserver/deploy/systemd/xps-umbrel-updater.service`, `xps-homeserver/deploy/systemd/xps-umbrel-update@.service`; Modify `xps-homeserver/scripts/setup-xps.sh`, `xps-homeserver/deploy/compose.yaml`, `xps-homeserver/deploy/tmpfiles/xps-homeserver.conf`.

**Interfaces:** Produces die drei HTTP-Endpunkte des gemeinsamen Vertrags; `start_job(config: dict) -> str` reserviert eine UUID und startet `xps-umbrel-update@<uuid>.service` über systemctl. Der Worker läuft nicht als Thread des HTTP-Requests. Hostservice-CLI `python3 xps_update_service.py --config /etc/xps-homeserver/updater.json`.

- [ ] Tests schreiben: nur definierte Endpunkte, POST `{}` maximal 64 Bytes, ungültige Zusatzfelder abweisen, Doppelklick liefert dieselbe ID, unbekannte Jobdatei wird nicht geöffnet; Socket-/Statusrechte wie festgelegt; Service-Neustart startet keinen zweiten Worker.
- [ ] `python3 -m unittest discover -s xps-homeserver/scripts/tests -p test_update_service.py` muss zunächst fehlschlagen.
- [ ] Hostdienst mit UnixStreamServer/HTTP-Handler implementieren. Runtime-/StateDirectory in systemd setzen; Root benötigt Docker/Compose und systemctl. Keine unnötigen Netzports; Hostkonfiguration und Zustand nur root-schreibbar. Socketverzeichnis bind-mounten, keinen Docker-Socket hinzufügen. Beim Bootstrap Hostdienst zuerst installieren, erst danach das bridgefähige Image wechseln.
- [ ] Tests bestehen lassen; `docker compose --env-file <test-env> -f xps-homeserver/deploy/compose.yaml config` und systemd-Unitvalidierung auf Linux ausführen. Commit: `feat: expose constrained XPS updater over Unix socket`.

### Task 5: Vorhandene Update-API an Hostauftrag anbinden

**Files:** Create `packages/umbreld/source/modules/system/container-update.ts`, `container-update.unit.test.ts`, `update.unit.test.ts` im selben Verzeichnis; Modify `packages/umbreld/source/modules/system/update.ts`, `routes.ts`; bei tatsächlichem UI-Bedarf gezielt bestehende Update-Komponenten und Übersetzungen anpassen.

**Interfaces:** Produces `isContainerUpdateConfigured(): boolean`, `getContainerRelease(): Promise<ContainerRelease>`, `getContainerStatus(): Promise<ProgressStatus>`, `startContainerUpdate(): Promise<{jobId:string}>` und `getUpdateStatus(): Promise<ProgressStatus>`. Geräteseitigen In-Memory-Status über denselben Promise-Vertrag erhalten. `performUpdate(umbreld): Promise<boolean>` bedeutet im Container nur Auftrag angenommen, nicht Installation abgeschlossen.

- [ ] Tests schreiben: explizite Konfiguration nutzt Hostclient; fehlender Socket fällt nicht auf Geräteinstaller zurück; keine Konfiguration behält Gerätepfad; HTTP 202 wird nicht als abgeschlossene Installation angezeigt; reconnect liest Hoststatus; `rolled-back` und `interrupted` bleiben sichtbare Fehler.
- [ ] `npm --prefix packages/umbreld test -- container-update.unit.test.ts update.unit.test.ts` muss vor Implementierung fehlschlagen.
- [ ] Unix-HTTP-Client über `node:http` mit den Vertragslimits implementieren. `checkUpdate` benutzt im Container ausschließlich freigegebene neuere Versionen; vorhandene Antwortfelder erhalten. `updateStatus` fragt asynchron den Hoststatus ab. Der `system.update`-Handler ruft im Container weder `umbreld.stop()` noch `reboot()` auf; nur der Hostworker tauscht den Container aus. Gerätepfad bleibt unverändert.
- [ ] Tests, `npm --prefix packages/umbreld run typecheck` und gegebenenfalls UI-Typecheck/gezielte UI-Tests müssen bestehen. Commit: `feat: route container updates through persistent host jobs`.

### Task 6: Kandidaten bauen und zukünftige Freigaben vorbereiten

**Files:** Modify `.github/workflows/xps-umbrel-image.yml`; Create `.github/workflows/xps-umbrel-upstream.yml`, `.github/workflows/xps-umbrel-release.yml`, `xps-homeserver/scripts/make_update_manifest.py`, `xps-homeserver/scripts/tests/test_update_manifest.py`; Modify `xps-homeserver/docs/betrieb.md`.

**Interfaces:** Manifestgenerator konsumiert getesteten Digest/Commit und `dataCompatibility`, produziert Task-2-Schema. Zeitgesteuerte Upstreamprüfung wöchentlich und per `workflow_dispatch`; Kandidatenbuild bei relevanten Commits; stabile Veröffentlichung über geschütztes GitHub-Environment `xps-stable` nach erfolgreichen Prüfungen und manuellem Funktionstest.

- [ ] Tests schreiben: kein Manifest bei fehlendem Testergebnis, Digest-/Versions-/Commitabweichung oder Plattformfehler; gültiger Kandidat erzeugt genau das vereinbarte Manifest. unittest ausführen und fehlende Implementierung nachweisen.
- [ ] Generator implementieren. Workflows trennen Kandidaten-Tag `sha-<commit>` und stabile Release `xps-<version>`. Nur geprüfte Workflows erhalten Schreibrechte; keine Ausführung fremder PR-Inhalte mit Veröffentlichungsrechten. Aktiven Host nie allein über Änderung von `branch-master` aktualisieren.
- [ ] Upstreamprüfung meldet neue Versionen und startet einen Vergleichs-/Kandidatenworkflow für den vorhandenen Fork-Stand; neue Upstream-Commits werden nicht ungeprüft automatisch gemergt oder als enthalten ausgegeben. Erst nach Integration, Build und Abnahme stabile Version freigeben. Betriebsdokument beschreibt diesen Wartungsschritt ausdrücklich.
- [ ] Generatortests und Workflowvalidierung bestehen lassen. Commit: `ci: gate XPS container releases on verified candidates`.

### Task 7: Echten Containerwechsel und Rückkehr testen

**Files:** Create `xps-homeserver/scripts/tests/container-update-smoke.sh`, `xps-homeserver/scripts/tests/fixtures/usb-playlist.m3u`; Dokumentation der tatsächlichen Befehle/Resultate unter `docs/superpowers/validation/2026-11-01-xps-container-updates.md`.

**Interfaces:** Smoke-CLI `container-update-smoke.sh <candidate-image@digest>` nutzt ausschließlich eigene Testvolumes und eigene Compose-Projektnamen in einer wegwerfbaren Linux-VM, keine Produktionspfade/-Volumes. Runner muss privilegierte Container mit systemd, USB-Testgerät und Host-Docker unterstützen; andernfalls ist der Test blockiert, nicht bestanden.

- [ ] Szenarien definieren: erfolgreiches Update; absichtlich ungesundes Kandidatenimage; Datenänderung plus Wiederherstellung; Clientabbruch; doppelter Start; Neustart mit offenem Job; voller Sicherungsdatenträger; fehlendes USB-Gerät; Fehler beim Wiederstart einer vorher laufenden App.
- [ ] Smoke-Skript gegen die bisherige fehlende Bridge ausführen, erwarteten Fehler dokumentieren; danach Kandidatenimage bauen und dieselben Szenarien ausführen. Neuer Testbenutzer nur im Testvolume, keine echten Apple-/App-Zugangsdaten kopieren.
- [ ] Tatsächlich nachweisen: API-Version 2.0.1, libde265 `1.1.3-1`, libheif aus neuem Snapshot, aktualisierter CA-Bestand und `NODE_OPTIONS=--use-openssl-ca`; HEIC-Vorschau erzeugen. Web-Anmeldung, MCP, App-Port, Cloud-API, USB-Erkennung/Lesen/Schreiben/Auswerfen und Testplaylist prüfen. Auch fehlerhafte HEIC-Datei kontrolliert ablehnen lassen.
- [ ] Alle erwarteten Status-/Daten-/Appzustände dokumentieren; Tests dürfen nicht bloß den Healthcheck oder eine Versionsdatei nachlesen. Nach erfolgreichem Durchlauf Commit: `test: verify XPS update and recovery lifecycle`.

### Task 8: Gesicherten Produktivwechsel vorbereiten und durchführen

**Files:** Modify nur die tatsächlich freizugebende Betriebsdokumentation; Deployment auf dem XPS über die in Tasks 3–4 eingeführten festen Werkzeuge. Keine zusätzlichen Hardware-/Dashboard-Umbauten.

**Interfaces:** Consumes bestandene Task-7-Nachweise, Kandidatendigest und Sicherungsinventar; produces überprüften Produktivstatus 2.0.1 mit funktionierendem Update-Button und dokumentiertem Rückweg.

- [ ] Vorher erfassen: Appzustände, Mounts, freier Platz, Hostkernel, aktuelle Digests und Datenumfang. Bestätigen, dass keine Musik- oder andere Speicheroperation mehr läuft. Sicherungsziel mit ausreichendem Platz ermitteln; wenn es fehlt, Deployment blockieren und den konkreten Bedarf nennen.
- [ ] Konsistente Sicherung erstellen und Wiederherstellbarkeit prüfen. Alten Digest und nötige Hostkonfiguration aufbewahren. Keine automatische Löschung alter Images/Sicherungen und kein `docker system prune`.
- [ ] Hostdienst zuerst gezielt installieren; nicht ungeprüft das gesamte `setup-xps.sh` auf dem laufenden Host ausführen. Anschließend ausschließlich den getesteten Digest installieren. Keine neuen Apps oder iCloud-Anmeldungen dabei vornehmen.
- [ ] Nachprüfung: Version/Pakete/CA, vorher aktive Apps, Web-Anmeldung, MCP, Cloud-API und existierende Ports; USB-Daten nur lesen, Schreib-/Auswurftest ausschließlich mit dafür angelegter Testdatei und ohne laufende Nutzung. Interne MP3-Zahl bleibt null; USB-Playlist bleibt gültig. Update-Button meldet stabilen Stand und startet keinen Downgrade.
- [ ] Erfolg erst nach bestandenem Nachweis melden. Bei Fehlern den in Task 7 getesteten Rückweg ausführen und den tatsächlichen Endzustand dokumentieren. Einen fehlgeschlagenen Rollback niemals als repariert melden.

## Selbstprüfung und Ausführung

Die Tasks decken beide Teile des bestätigten Entwurfs ab; Task 1–2 legen Sicherheitsbasis und Freigabevertrag fest, 3–5 hängen daran, 6–8 liefern Freigabe, Funktionsnachweis und Installation. Vertragsnamen, Pfade und Statuswerte sind zwischen Python, Umbreld und CI identisch zu verwenden. Das Produktivsystem wurde für diesen Plan nicht verändert; Builds und Softwaretests stehen erst in der Ausführung an.

Empfohlene Ausführung: **Native** — ein Implementierer in diesem isolierten Branch, anschließend unabhängige Prüfung des gesamten Branches. Die Aufgaben hängen stark an demselben Status-/Freigabevertrag; einheitliche Umsetzung vermeidet unnötige Übergaben. Vor Implementation Plan vom Nutzer prüfen lassen und Ausführungsart auswählen.
