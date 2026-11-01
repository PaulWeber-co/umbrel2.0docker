# XPS-Container-Updates: Verifikation

Arbeitsbranch: `codex-umbrel-container-updates`. Noch keine Produktivinstallation.

- Offizieller 2.0.1-Merge: `e1fcb5d8`; vier Laufzeitprüfungen im ersten lokal
  gebauten amd64-Kandidaten bestanden. Davor drei erwartete Fehler am alten XPS:
  Versionsnummer, libde265 und System-CA-Option.
- Dashboard-Basis: 208 Tests bestanden, drei übersprungen.
- Linux-Hosttests vor den letzten Ergänzungen: 41 bestanden, vier explizit nur
  mit Imageziel ausführbare Prüfungen übersprungen.
- Vollständige Umbreld-Linux-Unittests im ersten Kandidaten: 1.602 bestanden,
  16 übersprungen; zwei Testsuites scheiterten an Homebrew-OpenSSLs veraltetem
  Konfigurationspfad. System-OpenSSL plus Watchman wurden als funktionierende
  Kombination separat nachgewiesen. Der gezielte zusätzliche Regressionstest
  reproduzierte den Fehler im Image; erneuter vollständiger Lauf steht aus.
- Gezielte Client-/Update-API-Tests: elf bestanden; Backend-Typecheck bestanden.
- UI-Regressionsprüfung: vorher zwei Fehler (fehlende Anzeige ohne Releaseabruf),
  danach drei Tests bestanden; UI-Typecheck bestanden.
- Host-Update-Prüfungen zuletzt: 34 bestanden. Dazu gehören reale temporäre
  Archive, Integritätsfehler, Wiederherstellung einzelner Zustandsordner,
  Erhalt fremder Medien, begrenzte Socketanfragen, langsame Releaseabfragen,
  Wiederanlaufsperre und Erkennung abgestürzter Worker.

Noch nachzuweisen: endgültiges Image mit OpenSSL-Korrektur und neuer UI,
vollständige abschließende Tests, tatsächlicher isolierter Lifecycle-Lauf über
einen Registry-Digest, unabhängiges Branchreview, konsistenter Produktivsnapshot
und Nachprüfung auf dem XPS. Eine CI-Artefaktdatei wird erst nach erfolgreichen
Laufzeittests erzeugt; diese Notiz ist kein Freigabeartefakt.
