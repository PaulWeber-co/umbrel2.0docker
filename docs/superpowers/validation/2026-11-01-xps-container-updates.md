# XPS-Container-Updates: Verifikation

Arbeitsbranch: `codex-umbrel-container-updates`. Noch keine Produktivinstallation.

## Bestandene Prüfungen

- Offizieller 2.0.1-Merge: `e1fcb5d8`. Alter XPS reproduzierte die erwarteten
  Abweichungen bei Version, libde265 und System-CA-Option. Der neue lokale
  amd64-Kandidat besteht alle sechs tatsächlichen Image-Prüfungen, einschließlich
  OpenSSL-Zertifikaterzeugung und Watchman.
- Backend nach Review-Korrekturen: 136 Testdateien, **1.618 Tests bestanden**,
  Linux/Node 22 im Kandidaten mit seinen nativen Produktions-Bindings.
- UI nach Review-Korrekturen: 117 Testdateien, **890 Tests bestanden**, Linux/Node 22.13.
- Gezielte Python-Update-Suite: **53 Tests bestanden**. Reale temporäre Archive,
  Integritätsfehler, Wiederherstellung einzelner Zustandsordner, SQLite-WAL/SHM,
  Erhalt fremder Medien, begrenzte Socketanfragen, parallele Statusabfragen,
  sichere Wiederherstellung, widersprüchliche Statusdaten, abgestürzte Worker,
  vertrauenswürdige Kandidatenherkunft und Kompatibilitätsbindung werden geprüft.
- Vollständige abschließende Linux-Host-Suite: **73 bestanden**, sechs explizite
  Image-Prüfungen separat ausgeführt (79 Fälle insgesamt).
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

Checkout sauber auf `886487bdd1b2db1d38a53c7bf0999982ae77b7ed`.
Die überarbeiteten Vorprüfungen liefen ohne Anhalten oder Aktualisieren auf dem
XPS durch. Sicherungsumfang rund **2,48 GB**, einschließlich beschreibbarer
Downloads, Appdaten und Konfiguration; unveränderte Fotos bleiben außerhalb.
USB-Laufwerk `Backup` erkannt: exFAT, UUID `EFF4-91B7`. Elf installierte Apps
und deren aktive/gestoppte Zustände erfasst. Intern weiterhin **null MP3-Dateien**
im früheren Downtify-Ziel; letzte Speicherprüfung rund 40 GiB frei.

## Noch offen

Der erste CI-Kandidat (`41345864378`) bestand Build, Host- und sechs tatsächliche
Image-Prüfungen. Der Lifecycle scheiterte bereits am Image-Pull im verschachtelten
Testhost, ohne Freigabeartefakt. Das ursprüngliche Standardnetz überlappte mit
dessen eigenem Docker-Subnetz; der korrigierte Testaufbau nutzt ein separates
Netz und Datenvolume sowie verwertbare Pull-Fehlerausgaben. Ein erneuter Lauf
muss diese Diagnose bestätigen.

Zweiter CI-Lauf `41348029091`/Kandidat `65cdfe4f`: Build, Host- und sechs
Image-Prüfungen bestanden. Der tatsächliche Wechsel auf 2.0.1 samt
Installations-App-Wiederanlauf, doppeltem Start, Statusdienst-Neustart,
Owner-Anmeldung und MCP bestand. Danach scheiterte der HEIC-Test an einer
unter dem dynamischen systemd-/tmp-Mount versteckten `docker cp`-Testdatei.
Dies wurde in einem eigenen Container reproduziert (Datei unsichtbar), durch
Schreiben über `docker exec` korrigiert und mit SHA-256 plus echtem
128×128-JPEG nachgewiesen. Kein Decoder-Fehler. Noch keine stabile Freigabe.

Der erweiterte Lifecycle nutzt eine echte installierte App mit verzögertem
Start, eine gestoppte App, persistente Daten, ein eigenes exFAT-Testlaufwerk,
fehlende App-/USB-Negativprüfungen und einen absichtlich ungesunden Kandidaten
mit tatsächlicher Datenwiederherstellung. Dieser Lauf ist noch kein Erfolg.

Noch erforderlich: erfolgreicher Registry-Lifecycle, stabile Freigabe,
konsistenter Produktivsnapshot, getesteter Wechsel und Nachprüfung auf dem XPS.
Kein Produktivwechsel allein auf Basis bestandener Unit-Tests.
