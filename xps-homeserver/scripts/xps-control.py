#!/usr/bin/python3
"""Apply the dashboard's display settings on the XPS.

The dashboard runs without privileges. It decides what the wall display shows
(dashboard/server/control.js) and writes that wish to
/var/lib/xps-dashboard/host-state.json. This small root service is the only
part that acts on it:

  kiosk      start or stop the kiosk browser (xps-kiosk.service); while it is
             stopped the panel is switched off as well (framebuffer blank)
  airplay    start or stop the AirPlay receiver (xps-airplay.service)
  backlight  "auto" follows the room brightness that xps-ambient measures, a
             number is a fixed percentage, "off" switches the backlight off
  camera     read by xps-ambient itself: no measurement while it is false

Every value is validated, so the dashboard can never ask for more than these
switches. A missing or broken file means "everything on", the behaviour
before the control center existed. Units are started or stopped only when the
wish changes (and once at startup), so starting the kiosk by hand for a test
is not undone behind your back. What runs goes to /run/xps-control/status.json.

  xps-control.py               the service (checks the wish every second)
  xps-control.py --wants kiosk exit status 0 when the kiosk should run, 1 when
                               not (ExecCondition= of xps-kiosk.service and
                               xps-airplay.service, so a stopped screen stays
                               off across a reboot)
"""
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HOST_STATE = Path(os.environ.get("XPS_HOST_STATE", "/var/lib/xps-dashboard/host-state.json"))
AMBIENT_FILE = Path(os.environ.get("XPS_AMBIENT_FILE", "/run/xps-ambient/ambient.json"))
STATUS_DIR = Path(os.environ.get("XPS_CONTROL_DIR", "/run/xps-control"))
SYSTEMCTL = os.environ.get("XPS_SYSTEMCTL", "/usr/bin/systemctl")
FRAMEBUFFER_BLANK = Path(os.environ.get("XPS_FRAMEBUFFER_BLANK", "/sys/class/graphics/fb0/blank"))
UNITS = {
    "kiosk": os.environ.get("XPS_KIOSK_UNIT", "xps-kiosk.service"),
    "airplay": os.environ.get("XPS_AIRPLAY_UNIT", "xps-airplay.service"),
}


def env_int(name, default, low, high):
    try:
        value = int(os.environ.get(name, str(default)))
    except ValueError:
        value = default
    return max(low, min(high, value))


MIN_BACKLIGHT = env_int("XPS_BACKLIGHT_MIN_PERCENT", 8, 1, 100)
MAX_BACKLIGHT = env_int("XPS_BACKLIGHT_MAX_PERCENT", 85, MIN_BACKLIGHT, 100)
FALLBACK_BACKLIGHT = env_int("XPS_BACKLIGHT_FALLBACK_PERCENT", 50, MIN_BACKLIGHT, MAX_BACKLIGHT)
try:
    GAMMA = max(0.1, min(3.0, float(os.environ.get("XPS_BACKLIGHT_GAMMA", "0.65"))))
except ValueError:
    GAMMA = 0.65
UNIT_CHECK_SECONDS = 10
STATUS_REFRESH_SECONDS = 60

DEFAULT_WISH = {"display": "on", "kiosk": True, "airplay": True, "backlight": "auto", "camera": True}


def log(message):
    print(f"xps-control: {message}", file=sys.stderr, flush=True)


def normalize_wish(raw):
    """host-state.json → a wish with only known keys and valid values."""
    wish = dict(DEFAULT_WISH)
    if not isinstance(raw, dict):
        return wish
    if raw.get("display") in ("on", "night", "sleep", "off"):
        wish["display"] = raw["display"]
    for key in ("kiosk", "airplay", "camera"):
        if isinstance(raw.get(key), bool):
            wish[key] = raw[key]
    backlight = raw.get("backlight")
    if backlight in ("auto", "off"):
        wish["backlight"] = backlight
    elif isinstance(backlight, int) and not isinstance(backlight, bool) and 1 <= backlight <= 100:
        wish["backlight"] = backlight
    return wish


def read_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def read_wish(path=HOST_STATE):
    return normalize_wish(read_json(path))


def ambient_level(path=AMBIENT_FILE, now=None):
    """The room brightness (0 … 255) while the reading is fresh, else None."""
    state = read_json(path)
    if not isinstance(state, dict) or not state.get("available"):
        return None
    now = time.time() * 1000 if now is None else now
    try:
        captured = float(state["capturedAt"])
        interval = float(state.get("intervalSeconds") or 45)
        level = state.get("level")
        if level is None:
            level = round(float(state["ambientPercent"]) * 255 / 100)
        level = int(level)
    except (KeyError, TypeError, ValueError):
        return None
    if not 0 <= level <= 255 or now - captured > 2 * interval * 1000 or captured > now + 5000:
        return None
    return level


def curve_percent(level):
    """Room brightness 0 … 255 → backlight percent between min and max."""
    return round(MIN_BACKLIGHT + (MAX_BACKLIGHT - MIN_BACKLIGHT) * (level / 255) ** GAMMA)


def backlight_device():
    configured = os.environ.get("XPS_BACKLIGHT_PATH")
    candidates = [Path(configured)] if configured else sorted(Path("/sys/class/backlight").glob("*"))
    for candidate in candidates:
        if (candidate / "brightness").is_file() and (candidate / "max_brightness").is_file():
            return candidate
    return None


def write_if_different(path, value):
    try:
        if path.read_text().strip() == str(value):
            return False
        path.write_text(f"{value}\n")
        return True
    except OSError as error:
        log(f"{path}: {error}")
        return False


class Controller:
    def __init__(self, systemctl=SYSTEMCTL, host_state=HOST_STATE, ambient_file=AMBIENT_FILE, status_dir=STATUS_DIR):
        self.systemctl = systemctl
        self.host_state = host_state
        self.ambient_file = ambient_file
        self.status_dir = status_dir
        self.applied = None
        self.last_level = None  # the last good room reading, a guess after a wake-up
        self.units = {}
        self.units_checked = 0.0
        self.backlight_percent = None
        self.last_status = None
        self.status_written = 0.0

    def run_systemctl(self, *args, timeout=60):
        try:
            result = subprocess.run(
                [self.systemctl, *args], stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=timeout, check=False
            )
        except (OSError, subprocess.SubprocessError) as error:
            log(f"systemctl {' '.join(args)}: {error}")
            return None
        if result.returncode and args[0] not in ("is-active",):
            log(f"systemctl {' '.join(args)}: {result.stderr.strip() or result.returncode}")
        return result

    def unit_state(self, unit):
        result = self.run_systemctl("is-active", unit, timeout=10)
        return result.stdout.strip() if result and result.stdout.strip() else "unknown"

    def apply_units(self, wish):
        previous = self.applied
        if previous is None or previous["kiosk"] != wish["kiosk"]:
            if wish["kiosk"]:
                write_if_different(FRAMEBUFFER_BLANK, 0)
                self.run_systemctl("start", "--no-block", UNITS["kiosk"])
            else:
                # Wait for the browser to let go of the display, then power it down
                self.run_systemctl("stop", UNITS["kiosk"], timeout=60)
                write_if_different(FRAMEBUFFER_BLANK, 4)
            log(f"Kiosk {'an' if wish['kiosk'] else 'aus'}")
        if previous is None or previous["airplay"] != wish["airplay"]:
            self.run_systemctl("start" if wish["airplay"] else "stop", "--no-block", UNITS["airplay"])
            log(f"AirPlay {'an' if wish['airplay'] else 'aus'}")
        self.units_checked = 0.0

    def apply_backlight(self, wish):
        level = ambient_level(self.ambient_file)
        if level is not None:
            self.last_level = level
        setting = wish["backlight"]
        device = backlight_device()
        if device is None:
            self.backlight_percent = None
            return
        try:
            maximum = int((device / "max_brightness").read_text().strip())
            current = int((device / "brightness").read_text().strip())
        except (OSError, ValueError) as error:
            log(f"Backlight: {error}")
            return
        if maximum <= 0:
            return
        power = device / "bl_power"
        if setting == "off":
            target = 0
        else:
            if setting == "auto":
                percent = curve_percent(self.last_level) if self.last_level is not None else FALLBACK_BACKLIGHT
            else:
                percent = setting
            target = max(1, round(maximum * percent / 100))
        if power.is_file():
            write_if_different(power, 4 if setting == "off" else 0)
        # Small changes are skipped, so the panel does not flicker between readings
        if target == 0 or current == 0 or abs(current - target) >= max(1, round(maximum * 0.01)):
            if write_if_different(device / "brightness", target):
                current = target
        self.backlight_percent = round(current * 100 / maximum)

    def check_units(self, now):
        if now - self.units_checked < UNIT_CHECK_SECONDS:
            return
        self.units_checked = now
        self.units = {name: self.unit_state(unit) for name, unit in UNITS.items()}

    def write_status(self, now):
        status = {
            "wish": self.applied,
            "kiosk": self.units.get("kiosk", "unknown"),
            "airplay": self.units.get("airplay", "unknown"),
            "backlightPercent": self.backlight_percent,
            "ambientLevel": self.last_level,
        }
        if status == self.last_status and now - self.status_written < STATUS_REFRESH_SECONDS:
            return
        self.last_status = status
        self.status_written = now
        try:
            self.status_dir.mkdir(mode=0o750, parents=True, exist_ok=True)
            fd, temporary = tempfile.mkstemp(prefix="status.", dir=self.status_dir, text=True)
            try:
                os.fchmod(fd, 0o640)
                with os.fdopen(fd, "w", encoding="utf-8") as file:
                    json.dump({**status, "checkedAt": round(time.time() * 1000)}, file, separators=(",", ":"))
                    file.write("\n")
                os.replace(temporary, self.status_dir / "status.json")
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
        except OSError as error:
            log(f"Status: {error}")

    def step(self, now=None):
        now = time.monotonic() if now is None else now
        wish = read_wish(self.host_state)
        if wish != self.applied:
            self.apply_units(wish)
            self.applied = wish
        self.apply_backlight(wish)
        self.check_units(now)
        self.write_status(now)


def main(argv):
    if len(argv) == 3 and argv[1] == "--wants" and argv[2] in ("kiosk", "airplay"):
        return 0 if read_wish()[argv[2]] else 1
    if len(argv) > 1:
        print(__doc__, file=sys.stderr)
        return 2
    controller = Controller()
    while True:
        try:
            controller.step()
        except Exception as error:  # never die on one bad round, systemd would restart us anyway
            log(f"Fehler: {error}")
        time.sleep(1)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
