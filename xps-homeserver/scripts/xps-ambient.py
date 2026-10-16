#!/usr/bin/python3
"""Read one low-resolution webcam frame, adjust backlight, discard the pixels."""
import json
import os
import statistics
import subprocess
import sys
import tempfile
import time
from pathlib import Path

CAMERA = os.environ.get("XPS_CAMERA_DEVICE", "/dev/video0")
OUTPUT_DIR = Path(os.environ.get("XPS_AMBIENT_DIR", "/run/xps-ambient"))
OUTPUT_FILE = OUTPUT_DIR / "ambient.json"
INTERVAL = max(2, int(os.environ.get("XPS_AMBIENT_INTERVAL", "10")))
DARK_ON = max(0, min(254, int(os.environ.get("XPS_AMBIENT_DARK_ON", "16"))))
DARK_OFF = max(DARK_ON + 1, min(255, int(os.environ.get("XPS_AMBIENT_DARK_OFF", "25"))))
MIN_BACKLIGHT = max(1, min(100, int(os.environ.get("XPS_BACKLIGHT_MIN_PERCENT", "8"))))
MAX_BACKLIGHT = max(MIN_BACKLIGHT, min(100, int(os.environ.get("XPS_BACKLIGHT_MAX_PERCENT", "85"))))
GAMMA = max(0.1, min(3.0, float(os.environ.get("XPS_BACKLIGHT_GAMMA", "0.65"))))
PIXEL_COUNT = 16 * 12
dark = False


def backlight_device():
    configured = os.environ.get("XPS_BACKLIGHT_PATH")
    candidates = [Path(configured)] if configured else sorted(Path("/sys/class/backlight").glob("*"))
    for candidate in candidates:
        brightness = candidate / "brightness"
        maximum = candidate / "max_brightness"
        if brightness.is_file() and maximum.is_file():
            return brightness, maximum
    return None, None


def measure_camera():
    result = subprocess.run(
        [
            "/usr/bin/ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
            "-f", "video4linux2", "-i", CAMERA, "-frames:v", "1",
            "-vf", "scale=16:12:flags=area,format=gray", "-pix_fmt", "gray",
            "-f", "rawvideo", "pipe:1",
        ],
        check=True,
        capture_output=True,
        timeout=10,
    )
    if len(result.stdout) != PIXEL_COUNT:
        raise RuntimeError("Die Webcam lieferte kein vollständiges Helligkeitsbild")
    return int(statistics.median(result.stdout))


def set_backlight(ambient):
    brightness, maximum = backlight_device()
    if brightness is None:
        return None
    try:
        max_value = int(maximum.read_text().strip())
        if max_value <= 0:
            return None
        target_percent = round(MIN_BACKLIGHT + (MAX_BACKLIGHT - MIN_BACKLIGHT) * (ambient / 255) ** GAMMA)
        target = max(1, round(max_value * target_percent / 100))
        current = int(brightness.read_text().strip())
        if abs(current - target) >= max(1, round(max_value * 0.01)):
            brightness.write_text(f"{target}\n")
            current = target
        return round(current * 100 / max_value)
    except OSError as error:
        print(f"xps-ambient: Backlight konnte nicht gesetzt werden: {error}", file=sys.stderr, flush=True)
        return None


def write_state(state):
    OUTPUT_DIR.mkdir(mode=0o750, parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix="ambient.", dir=OUTPUT_DIR, text=True)
    try:
        os.fchmod(fd, 0o640)
        os.fchown(fd, 0, -1)
        with os.fdopen(fd, "w", encoding="utf-8") as file:
            json.dump(state, file, separators=(",", ":"))
            file.write("\n")
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary, OUTPUT_FILE)
        os.chown(OUTPUT_FILE, 0, os.getegid())
        os.chmod(OUTPUT_FILE, 0o640)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def unavailable_state():
    return {
        "available": False,
        "ambientPercent": None,
        "backlightPercent": None,
        "dark": dark,
        "capturedAt": round(time.time() * 1000),
    }


def main():
    global dark
    while True:
        started = time.monotonic()
        try:
            level = measure_camera()
            if dark and level >= DARK_OFF:
                dark = False
            elif not dark and level <= DARK_ON:
                dark = True
            write_state({
                "available": True,
                "ambientPercent": round(level * 100 / 255),
                "backlightPercent": set_backlight(level),
                "dark": dark,
                "capturedAt": round(time.time() * 1000),
            })
        except (OSError, RuntimeError, subprocess.SubprocessError, ValueError) as error:
            print(f"xps-ambient: {error}", file=sys.stderr, flush=True)
            try:
                write_state(unavailable_state())
            except OSError as write_error:
                print(f"xps-ambient: {write_error}", file=sys.stderr, flush=True)
        time.sleep(max(0, INTERVAL - (time.monotonic() - started)))


if __name__ == "__main__":
    main()
