# Hand-off für Opus 5.5

## Arbeitsstand

- Erstellt mit **Codex (GPT-6)** auf `codex/xps-dashboard-system-widget`.
- Ausgangspunkt ist der aktuelle Stand von `origin/master`; den tatsächlichen
  Merge-Base und alle Commits mit Git prüfen.
- Die jüngste Dashboard-Änderung liegt im Commit
  `d0df58061f735f3b1b194aa97e4765d3ce19252a`.
- Die Phasen 0–6 des XPS-Home-Server-Plans sind in diesem Branch ausgearbeitet:
  Basissystem und Umbrel-Container, Design-A-Dashboard mit Widgets und Kiosk,
  AirPlay-Musikmodus, Webcam-Helligkeitsregelung und Nachtmodus sowie Betrieb
  und Wiederherstellung.
- Die jüngste Dashboard-Politur bündelt die Zuhause-Geräte im Musikmodus in
  einer Spalte, versieht die Musikdetails mit einer Glasfläche und richtet den
  Player wieder unten an der Server-Kachel aus. Der „Klar–Milchig“-Regler ist
  über ein Reglersymbol in einem Einstellungsfenster erreichbar und steuert
  gemeinsam die Glasflächen aller Browser und des Kiosks. Der Server speichert
  den Wert in `DASH_DATA_DIR/settings.json`; `DASH_GLASS` setzt den Startwert.
  Das „Beispieldaten“-Badge ist aus der Oberfläche entfernt; die Demo-
  Datenquellen bleiben für nicht konfigurierte Integrationen verfügbar.
- Der XPS selbst wurde nicht mit echter Hardware geprüft. Die Musikvorschau
  verwendete simulierte Shairport-Metadaten; die UI wurde lokal im Browser
  angesehen.

## Opus-Review

Bitte zuerst den folgenden Prompt vollständig verwenden. Er fordert eine
Prüfung ohne direkte Änderungen an Dateien oder Git-Status an.

```text
Du bist Opus 5.5 und übernimmst eine unabhängige technische Prüfung des XPS-
Home-Server-Branches `codex/xps-dashboard-system-widget`.

Lies zuerst `xps-homeserver/README.md`, `xps-homeserver/docs/architektur.md`,
`xps-homeserver/docs/betrieb.md`, `xps-homeserver/dashboard/README.md` und
`xps-homeserver/dashboard/WIDGETS.md`. Ermittle danach den echten Merge-Base zu
`origin/master`, prüfe den vollständigen Branch-Diff und lies die relevanten
Tests. Nutze diese Dokumente als Plan und Architekturvorgabe; prüfe, ob die
Implementierung dazu passt.

Führe im ersten Durchgang ausschließlich ein Review durch. Ändere keine
Dateien, erstelle keine Commits oder Pushes und öffne keine PR. Prüfe besonders:

1. Fehler, Datenverlust- oder Sicherheitsrisiken in Installer, Umbrel-Update
   und Rollback, Services und API.
2. Dashboard-Architektur und Widgets, einschließlich Serverdaten, Home
   Assistant, AirPlay-Metadaten und Musikmodus.
3. Webcam-Dienst, Nachtmodus, Privatsphäre und Verhalten bei fehlender Hardware.
4. Die jüngste UI-Änderung: Player-Ausrichtung, Glass-Regler mit Speicherung,
   Demo-Badge-Entfernung sowie Darstellung in Design A.
5. Fehlende Tests und Verbesserungen, die den Code einfacher oder robuster
   machen würden.

Führe nach Möglichkeit `npm test`, `npm run check` und `npm run smoke` in
`xps-homeserver/dashboard` aus. Beachte, dass die HTTP-Tests und der Smoke-Test
einen lokalen Listener auf `127.0.0.1` benötigen. Hardwareverhalten am XPS kann
ohne das Gerät nicht belegt werden.

Berichte zuerst nur Befunde, nach Wichtigkeit sortiert. Für jeden Befund nenne
Priorität, Datei und Zeile, konkrete Auswirkung sowie Beleg oder Reproduktions-
schritt. Trenne bestätigte Fehler klar von optionalen Architektur- oder
Designverbesserungen. Wenn du keine kritischen Befunde findest, sage das
explizit und nenne verbleibende Verifikationslücken. Warte danach auf meine
Entscheidung, bevor du etwas änderst.
```
