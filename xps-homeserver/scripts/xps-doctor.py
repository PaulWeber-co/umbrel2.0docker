#!/usr/bin/python3
"""Check the whole XPS homeserver and say in plain German what is wrong.

  sudo xps-doctor           everything: system, services, containers,
                            dashboard tiles, settings
  sudo xps-doctor --kurz    only what needs attention (setup-xps.sh ends with it)

Read-only: it changes nothing. Every check has a timeout, so a hanging
Docker or network never hangs the doctor. For a service that does not run it
prints the last lines of its journal, which usually name the cause.
Exit status: 0 all good or only hints, 1 at least one problem.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

CONFIG_DIR = Path(os.environ.get("XPS_CONFIG_DIR", "/etc/xps-homeserver"))
DASHBOARD = os.environ.get("XPS_DASHBOARD_URL", "http://127.0.0.1:7777")
OK, HINT, PROBLEM = "ok", "hint", "problem"
MARK = {OK: "✓", HINT: "!", PROBLEM: "✗"}

# Units of the homeserver: name → what it is
UNITS = {
    "xps-dashboard.service": "Dashboard",
    "xps-control.service": "Steuerung (Bildschirm, Lautsprecher, Helligkeit)",
    "xps-kiosk.service": "Bildschirm-Browser (Kiosk)",
    "xps-airplay.service": "Lautsprecher (AirPlay und Spotify)",
    "xps-services.service": "Dienste-Statistik",
    "xps-ambient.service": "Raumhelligkeit über die Webcam",
    "docker.service": "Docker",
    "avahi-daemon.service": "Namen im Netz (xps.local, umbrel.local)",
    "NetworkManager.service": "Netzwerk",
    "xps-wifi-watchdog.service": "WLAN-Wächter",
    "xps-mdns-alias.service": "umbrel.local",
}
# Units the control center may switch off on purpose
SWITCHABLE = {"xps-kiosk.service": "kiosk", "xps-airplay.service": "airplay"}
CONTAINERS = {
    "umbrel": "Umbrel",
    "umbrel-port-publisher": "Umbrel-Ports",
    "xps-airplay": "AirPlay (shairport-sync)",
    "xps-spotify": "Spotify Connect (go-librespot)",
}
SPEAKER_CONTAINERS = ("xps-airplay", "xps-spotify")

# Tile id → name and the settings it needs (for "Beispieldaten")
TILES = {
    "wetter": ("Wetter", "DASH_LAT und DASH_LON"),
    "weg": ("Arbeitsweg", "DASH_TOMTOM_KEY, DASH_HOME_ADDRESS und DASH_WORK_ADDRESS"),
    "fotos": ("Fotos", "DASH_IMMICH_KEY (Immich → Kontoeinstellungen → API-Schlüssel)"),
    "kal": ("Kalender", "DASH_CALENDAR_ICS (Apple) oder DASH_HA_TOKEN und DASH_HA_CALENDAR_ENTITY"),
    "todo": ("To-dos", "DASH_REMINDERS_LIST (Apple) oder DASH_HA_TOKEN und DASH_HA_TODO_ENTITY"),
    "home": ("Zuhause", "DASH_HA_TOKEN und DASH_HA_ENTITIES"),
    "dienste": ("Dienste", "läuft xps-services? (systemctl status xps-services)"),
    "server": ("XPS", ""),
}


class Report:
    def __init__(self, short=False):
        self.short = short
        self.counts = {OK: 0, HINT: 0, PROBLEM: 0}
        self.section_name = None
        self.section_printed = False

    def section(self, name):
        self.section_name = name
        self.section_printed = False

    def add(self, level, text, detail=None):
        self.counts[level] += 1
        if self.short and level == OK:
            return
        if not self.section_printed:
            print(f"\n{self.section_name}")
            self.section_printed = True
        print(f"  {MARK[level]} {text}")
        for line in (detail or "").splitlines():
            if line.strip():
                print(f"      {line.rstrip()}")

    def summary(self):
        problems, hints = self.counts[PROBLEM], self.counts[HINT]
        print()
        if not problems and not hints:
            print("Alles in Ordnung.")
        elif not problems:
            print(f"Keine Probleme, {hints} Hinweis{'e' if hints != 1 else ''}.")
        else:
            print(f"{problems} Problem{'e' if problems != 1 else ''}, {hints} Hinweis{'e' if hints != 1 else ''}. "
                  "Mehr dazu: docs/betrieb.md, Abschnitt „Dienste prüfen“.")
        return 1 if problems else 0


def run(*args, timeout=10):
    """(exit code, stdout) of a command; (None, error) when it cannot run."""
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL, check=False)
        return result.returncode, (result.stdout or result.stderr).strip()
    except (OSError, subprocess.SubprocessError) as error:
        return None, str(error)


def journal(unit, lines=6):
    code, out = run("journalctl", "-u", unit, "-n", str(lines), "--no-pager", "-o", "cat", timeout=10)
    return out if code == 0 else ""


def read_env(path):
    """KEY=VALUE lines like systemd's EnvironmentFile (no shell expansion)."""
    values = {}
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return None
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key.strip()] = value
    return values


INVITE = re.compile(r"\b[A-Z0-9]{6}-([A-Z2-9]{16,32})\b")


def knuddl_secret(text):
    """Like secretFromInvite() in dashboard/server/knuddl.js."""
    raw = re.sub(r"\s*-\s*", "-", re.sub("[‐-―−]", "-", str(text or ""))).strip()
    link = re.search(r"[?&]join=([A-Za-z0-9-]+)", raw)
    candidate = (link.group(1) if link else raw).upper()
    full = INVITE.search(candidate)
    if full:
        return full.group(1)
    return candidate if re.fullmatch(r"[A-Z2-9]{16,32}", candidate) else None


def feed_url(text):
    value = re.sub(r"^webcals?://", "https://", str(text).strip(), flags=re.I)
    return value if re.match(r"^https?://[^\s/]+", value) else None


def check_settings(env):
    """→ [(level, text)] for the dashboard settings people type in by hand."""
    found = []
    invite = env.get("DASH_KNUDDL_INVITE", "")
    if invite and not knuddl_secret(invite):
        found.append((PROBLEM, "DASH_KNUDDL_INVITE ist keine Knuddl-Einladung (Knuddl → Mehr → Verbindung → Kopieren, sieht aus wie ABC123-K7F2…)"))
    elif invite:
        found.append((OK, "Minifunk: Knuddl-Einladung eingetragen"))
    links = [part for part in re.split(r"[\s,]+", env.get("DASH_CALENDAR_ICS", "")) if part]
    bad = [link for link in links if not feed_url(link)]
    if bad:
        found.append((PROBLEM, f"DASH_CALENDAR_ICS: {len(bad)} Eintrag/Einträge sind keine Links (webcal://… oder https://…)"))
    elif links:
        found.append((OK, f"Apple-Kalender: {len(links)} Link{'s' if len(links) != 1 else ''}"))
    ha_url = env.get("DASH_HA_URL", "")
    if ha_url and not re.match(r"^https?://", ha_url):
        found.append((PROBLEM, "DASH_HA_URL muss mit http:// oder https:// beginnen"))
    for key in ("DASH_HA_CALENDAR_ENTITY", "DASH_HA_TODO_ENTITY"):
        value = env.get(key, "")
        prefix = "calendar." if "CALENDAR" in key else "todo."
        if value and not re.fullmatch(re.escape(prefix) + r"[a-z0-9_]+", value):
            found.append((PROBLEM, f"{key}={value} sieht nicht wie eine Entität aus ({prefix}…)"))
    pin = env.get("DASH_PIN", "")
    if not pin:
        found.append((HINT, "Keine PIN: Jedes Gerät im WLAN kann Licht, Bildschirm und Kacheln ändern (DASH_PIN setzen)"))
    elif len(pin) < 4:
        found.append((HINT, "DASH_PIN ist kürzer als 4 Zeichen"))
    return found


def get_json(path, timeout=5):
    request = urllib.request.Request(DASHBOARD + path, headers={"accept": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def check_system(report):
    report.section("System")
    code, out = run("nmcli", "-t", "-f", "TYPE,STATE,CONNECTION", "device")
    if code == 0:
        wifi = [line.split(":") for line in out.splitlines() if line.startswith("wifi:")]
        connected = [parts for parts in wifi if len(parts) >= 3 and parts[1] == "connected"]
        if connected:
            _, signal = run("nmcli", "-t", "-f", "IN-USE,SIGNAL,SSID", "device", "wifi")
            strength = next((line.split(":")[1] for line in signal.splitlines() if line.startswith("*:")), "?")
            level = OK if strength.isdigit() and int(strength) >= 40 else HINT
            report.add(level, f"WLAN verbunden mit {connected[0][2]} (Signal {strength} %)",
                       None if level == OK else "Schwaches Signal: den XPS näher an den Speedport stellen")
        elif wifi:
            report.add(PROBLEM, "WLAN nicht verbunden", "nmcli device wifi list; journalctl -u xps-wifi-watchdog -n 20")
        else:
            code_wl, _ = run("modinfo", "-n", "wl")
            report.add(PROBLEM, "Kein WLAN-Gerät", "Der Broadcom-Treiber wl fehlt für diesen Kernel: sudo /usr/local/sbin/xps-wl-guard"
                       if code_wl != 0 else "lsmod | grep wl; journalctl -k | grep -i wl")
    else:
        report.add(PROBLEM, "NetworkManager antwortet nicht", "sudo systemctl status NetworkManager")
    code, out = run("timedatectl", "show", "-p", "NTPSynchronized", "--value")
    if code == 0:
        report.add(OK if out == "yes" else HINT, "Uhrzeit synchron" if out == "yes" else "Uhrzeit noch nicht synchron (braucht Internet)")
    usage = shutil.disk_usage("/")
    free_gb = usage.free / 1e9
    level = OK if free_gb >= 10 else HINT if free_gb >= 3 else PROBLEM
    report.add(level, f"SSD: {free_gb:.0f} GB frei von {usage.total / 1e9:.0f} GB",
               None if level == OK else "Platz schaffen: sudo docker system prune; alte Fotos/Backups prüfen")
    code, out = run("systemctl", "--failed", "--plain", "--no-legend", "--no-pager")
    failed = [line.split()[0] for line in out.splitlines() if line.strip()] if code == 0 else []
    if failed:
        report.add(PROBLEM, f"Fehlgeschlagene Dienste: {', '.join(failed)}", "\n".join(f"journalctl -u {unit} -n 30" for unit in failed[:3]))
    elif code == 0:
        report.add(OK, "Keine fehlgeschlagenen Dienste")


def check_units(report, wish):
    report.section("Dienste")
    for unit, name in UNITS.items():
        code, state = run("systemctl", "is-active", unit, timeout=5)
        if code is None or "booted with systemd" in state or "Failed to connect" in state:
            report.add(PROBLEM, "systemd antwortet nicht – läuft das hier auf dem XPS?", state.splitlines()[0] if state else None)
            return
        state = state.splitlines()[0] if state else ""
        if state == "active":
            report.add(OK, f"{name} läuft")
        elif unit in SWITCHABLE and wish.get(SWITCHABLE[unit]) is False:
            report.add(OK, f"{name} ist in der Steuerung ausgeschaltet")
        elif state == "activating":
            report.add(HINT, f"{name} startet gerade", journal(unit, 3))
        else:
            report.add(PROBLEM, f"{name} läuft nicht ({state or 'unbekannt'}) – sudo systemctl status {unit}", journal(unit))


def check_containers(report, wish):
    report.section("Container")
    code, out = run("docker", "ps", "-a", "--format", "{{.Names}}\t{{.State}}\t{{.Status}}", timeout=20)
    if code is None or code != 0:
        report.add(PROBLEM, "Docker antwortet nicht", out[-300:] + "\nsudo systemctl status docker")
        return
    rows = {}
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) == 3:
            rows[parts[0]] = (parts[1], parts[2])
    for name, label in CONTAINERS.items():
        if name not in rows:
            if name in SPEAKER_CONTAINERS and wish.get("airplay") is False:
                report.add(OK, f"{label}: in der Steuerung ausgeschaltet")
            elif name in SPEAKER_CONTAINERS:
                report.add(PROBLEM, f"{label}: kein Container", "sudo systemctl restart xps-airplay; journalctl -u xps-airplay -n 30")
            else:
                report.add(PROBLEM, f"{label}: kein Container", "sudo /opt/xps-homeserver/xps-homeserver/scripts/update-umbrel.sh")
            continue
        state, status = rows[name]
        if state == "running" and "unhealthy" not in status:
            level = HINT if "starting" in status else OK
            report.add(level, f"{label}: {status}")
        else:
            _, logs = run("docker", "logs", "--tail", "6", name, timeout=15)
            report.add(PROBLEM, f"{label}: {state} ({status})", logs[-600:])


def check_dashboard(report, env):
    report.section("Dashboard")
    state, last = None, None
    for _ in range(10):
        try:
            state = get_json("/api/state")
            break
        except (OSError, ValueError) as error:
            last = error
            time.sleep(1)
    if state is None:
        report.add(PROBLEM, f"Dashboard antwortet nicht auf Port 7777 ({last})", journal("xps-dashboard.service"))
        return {}
    report.add(OK, "Dashboard antwortet (http://xps.local:7777)")
    control = state.get("control") or {}
    effective = control.get("effective") or {}
    names = {"on": "an", "night": "Nachtuhr", "sleep": "schwarz", "off": "aus"}
    if effective:
        report.add(OK, f"Bildschirm: {names.get(effective.get('display'), '?')} – {effective.get('reason', '')}")
    widgets = state.get("widgets") or {}
    examples = []
    for tile, (name, needs) in TILES.items():
        entry = widgets.get(tile)
        if not entry:
            continue
        if entry.get("error"):
            report.add(PROBLEM, f"Kachel {name}: {entry['error']}")
        elif entry.get("demo"):
            examples.append(f"{name}: {needs}" if needs else name)
    if examples:
        report.add(HINT, "Kacheln mit Beispieldaten (Einstellung fehlt in /etc/xps-homeserver/dashboard.env):", "\n".join(examples))
    minifunk = (widgets.get("minifunk") or {}).get("data") or {}
    if env.get("DASH_KNUDDL_INVITE") and minifunk.get("enabled") is False:
        report.add(PROBLEM, "Minifunk ist aus, obwohl eine Einladung eingetragen ist", "journalctl -u xps-dashboard | grep minifunk")
    backgrounds = state.get("backgrounds") or {}
    clips = sum(len(v) for v in backgrounds.values() if isinstance(v, list))
    if clips:
        report.add(OK, f"Hintergrundvideos: {clips} Clips")
    else:
        report.add(HINT, "Keine Hintergrundvideos (Farbverläufe statt Luftaufnahmen)", "sudo update-xps lädt sie (etwa 1 GB)")
    return control


def check_network(report):
    report.section("Erreichbarkeit")
    for name in ("xps.local", "umbrel.local"):
        code, out = run("getent", "hosts", name, timeout=5)
        report.add(OK if code == 0 else PROBLEM, f"{name} → {out.split()[0]}" if code == 0 else f"{name} lässt sich nicht auflösen",
                   None if code == 0 else "sudo systemctl restart avahi-daemon xps-mdns-alias")
    try:
        urllib.request.urlopen("http://127.0.0.1:80/", timeout=5).close()
        report.add(OK, "Umbrel antwortet (http://umbrel.local)")
    except urllib.error.HTTPError:
        report.add(OK, "Umbrel antwortet (http://umbrel.local)")
    except OSError:
        report.add(PROBLEM, "Umbrel antwortet nicht auf Port 80", "sudo docker logs --tail 30 umbrel")
    code, _ = run("curl", "-fsS", "-o", "/dev/null", "--max-time", "8", "https://deb.debian.org/debian/dists/trixie/Release", timeout=12)
    report.add(OK if code == 0 else PROBLEM, "Internet erreichbar" if code == 0 else "Kein Internet (Updates, Wetter, Images gehen nicht)")


def check_settings_file(report):
    report.section("Einstellungen")
    path = CONFIG_DIR / "dashboard.env"
    env = read_env(path)
    if env is None:
        report.add(PROBLEM, f"{path} fehlt oder ist nicht lesbar", "sudo setup-xps.sh legt sie an")
        return {}
    mode = path.stat().st_mode & 0o777
    if mode & 0o077:
        report.add(PROBLEM, f"{path} ist für andere lesbar ({oct(mode)}): sudo chmod 600 {path}")
    for level, text in check_settings(env):
        report.add(level, text)
    return env


def main(argv):
    short = "--kurz" in argv
    if any(arg in ("-h", "--help", "hilfe") for arg in argv):
        print("sudo xps-doctor [--kurz]   prüft System, Dienste, Container, Dashboard und Einstellungen")
        return 0
    if os.geteuid() != 0:
        print("Bitte mit sudo starten: sudo xps-doctor", file=sys.stderr)
        return 2
    report = Report(short)
    print("XPS-Homeserver: Prüfung" + (" (nur Auffälliges)" if short else ""))
    env = check_settings_file(report)
    check_system(report)
    control = check_dashboard(report, env)
    wish = control.get("host") or {}
    if not wish:
        # The control center's current wish, as xps-control reads it
        try:
            wish = json.loads(Path("/var/lib/xps-dashboard/host-state.json").read_text())
        except (OSError, ValueError):
            wish = {}
    check_units(report, wish)
    check_containers(report, wish)
    check_network(report)
    return report.summary()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
