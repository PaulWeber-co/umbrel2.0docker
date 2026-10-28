#!/usr/bin/python3
"""Collect every Docker container on the XPS for the dashboard's "Dienste" tile.

Two Docker daemons run on the XPS: the host's (Umbrel container, AirPlay and
anything you deploy yourself with docker compose) and the one inside the
Umbrel container (every Umbrel app). Both are asked every XPS_SERVICES_INTERVAL
seconds; the result goes to /run/xps-services/services.json, which the
dashboard (server/widgets/services.js) groups and shows.

This runs as root because the Docker socket is root-equivalent; the dashboard
itself never gets access to Docker. Only names, states and resource figures are
written, never environment variables, logs or other container details.

Every XPS_PHOTOS_INTERVAL seconds it also counts what the Umbrel app's photo
backup holds for each Umbrel account (photos, videos, bytes), and for each
folder in an account's Photos (the app gives every phone its own, "iPhone",
"iPhone (2)" ...), and writes it to /run/xps-services/photos.json for the
"Fotos-Backup" tile (server/widgets/backup.js). Only account and folder names
and these three figures leave, never file names. Live Photos count as one photo and one video: the files are
named by their content, so the halves cannot be paired.
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

DOCKER = os.environ.get("XPS_DOCKER", "/usr/bin/docker")
UMBREL_CONTAINER = os.environ.get("XPS_UMBREL_CONTAINER", "umbrel")
OUTPUT_DIR = Path(os.environ.get("XPS_SERVICES_DIR", "/run/xps-services"))
OUTPUT_FILE = OUTPUT_DIR / "services.json"
INTERVAL = max(10, int(os.environ.get("XPS_SERVICES_INTERVAL", "30")))
# Umbrel's data in its Docker volume, as seen from the host
UMBREL_DATA = Path(os.environ.get(
    "XPS_UMBREL_DATA", "/var/lib/docker/volumes/xps-homeserver_umbrel-data/_data/umbrel-os/home/umbrel/umbrel"))
PHOTOS_FILE = OUTPUT_DIR / "photos.json"
PHOTOS_INTERVAL = max(60, int(os.environ.get("XPS_PHOTOS_INTERVAL", "120")))
PHOTO_TYPES = {"jpg", "jpeg", "heic", "heif", "png", "gif", "webp", "tif", "tiff", "dng", "raw", "avif"}
VIDEO_TYPES = {"mov", "mp4", "m4v", "hevc", "avi", "3gp"}
TIMEOUT = 25
CPUS = os.cpu_count() or 1

UNITS = {
    "b": 1, "kb": 1000, "mb": 1000 ** 2, "gb": 1000 ** 3, "tb": 1000 ** 4,
    "kib": 1024, "mib": 1024 ** 2, "gib": 1024 ** 3, "tib": 1024 ** 4,
}
SIZE = re.compile(r"^\s*([\d.]+)\s*([a-zA-Z]*)")


def parse_size(text):
    """'21.5MiB / 15.4GiB' -> bytes of the first part, or None."""
    match = SIZE.match(str(text).split("/")[0])
    if not match:
        return None
    factor = UNITS.get(match.group(2).lower() or "b")
    return round(float(match.group(1)) * factor) if factor else None


def parse_percent(text):
    """'153.20%' (Docker: 100 % per core) -> share of the whole machine."""
    try:
        return round(float(str(text).strip().rstrip("%")) / CPUS, 1)
    except ValueError:
        return None


def docker(prefix, *args):
    result = subprocess.run(
        [*prefix, *args], check=True, capture_output=True, text=True, timeout=TIMEOUT, stdin=subprocess.DEVNULL
    )
    return result.stdout


def inspect(prefix, ids):
    """docker inspect for many ids. A container that went away since "ps"
    (an app restarting) makes docker fail with "No such object", but it still
    prints the others: those count, the missing one is simply not there."""
    result = subprocess.run(
        [*prefix, "inspect", *ids], capture_output=True, text=True, timeout=TIMEOUT, stdin=subprocess.DEVNULL
    )
    try:
        found = json.loads(result.stdout or "null")
    except ValueError:
        found = None
    if isinstance(found, list) and (result.returncode == 0 or "No such object" in result.stderr):
        return found
    raise subprocess.CalledProcessError(result.returncode, result.args, result.stdout, result.stderr)


def collect(scope, prefix):
    """All containers of one Docker daemon as plain dictionaries."""
    ids = docker(prefix, "ps", "--all", "--quiet", "--no-trunc").split()
    if not ids:
        return []
    stats = {}
    for line in docker(prefix, "stats", "--no-stream", "--no-trunc", "--format", "{{json .}}").splitlines():
        try:
            row = json.loads(line)
        except ValueError:
            continue
        stats[row.get("ID", "")] = row
    containers = []
    for info in inspect(prefix, ids):
        state = info.get("State") or {}
        labels = (info.get("Config") or {}).get("Labels") or {}
        name = str(info.get("Name", "")).lstrip("/")
        row = stats.get(info.get("Id", ""), {})
        running = state.get("Status") == "running"
        containers.append({
            "scope": scope,
            "name": name,
            "project": labels.get("com.docker.compose.project") or name,
            "service": labels.get("com.docker.compose.service") or name,
            "state": state.get("Status", "unknown"),
            "health": (state.get("Health") or {}).get("Status"),
            "exitCode": state.get("ExitCode"),
            "restartPolicy": ((info.get("HostConfig") or {}).get("RestartPolicy") or {}).get("Name") or "no",
            "restartCount": info.get("RestartCount", 0),
            "startedAt": state.get("StartedAt") if running else None,
            "cpuPercent": parse_percent(row.get("CPUPerc", "")) if running and row else None,
            "memBytes": parse_size(row.get("MemUsage", "")) if running and row else None,
        })
    return containers


def write_state(state, target=OUTPUT_FILE):
    OUTPUT_DIR.mkdir(mode=0o750, parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f"{target.stem}.", dir=OUTPUT_DIR, text=True)
    try:
        os.fchmod(fd, 0o640)
        with os.fdopen(fd, "w", encoding="utf-8") as file:
            json.dump(state, file, separators=(",", ":"))
            file.write("\n")
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def yaml_value(line):
    value = line.split(":", 1)[1].strip()
    return value[1:-1] if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"" else value


def photo_accounts(root):
    """[(name, Photos folder)]: the owner first, then each member, from umbrel.yaml."""
    owner, members, section, member = "Umbrel", [], None, None
    try:
        lines = (root / "umbrel.yaml").read_text(encoding="utf-8").splitlines()
    except OSError:
        lines = []
    for line in lines:
        if line and not line.startswith(" "):
            section = line.split(":", 1)[0]
            continue
        if section == "user" and line.startswith("  name:"):
            owner = yaml_value(line) or owner
        elif section == "members" and line.startswith("  - "):
            # A new member: its first key sits on the dash line
            member = {"id": None, "name": None, "deleted": False}
            members.append(member)
            line = "    " + line[4:]
        if section == "members" and member and line.startswith("    ") and not line.startswith("     "):
            # Only the member's own keys, not those of its nested settings
            key = line.strip().split(":", 1)[0]
            if key == "id":
                member["id"] = yaml_value(line)
            elif key == "name":
                member["name"] = yaml_value(line)
            elif key == "deleted":
                # A deleted account stays as {id, deleted: true}: its folder is gone
                member["deleted"] = yaml_value(line) == "true"
    accounts = [(owner, root / "home" / "Photos")]
    for member in (m for m in members if not m["deleted"]):
        # Account ids name folders: never let one point elsewhere
        if member["id"] and "/" not in member["id"] and member["id"] not in (".", ".."):
            accounts.append((member["name"] or member["id"], root / "members" / member["id"] / "home" / "Photos"))
    return accounts


def count_photos(folder):
    photos = videos = size = 0
    for directory, subdirectories, files in os.walk(folder):
        subdirectories[:] = [name for name in subdirectories if not name.startswith(".")]
        for name in files:
            if name.startswith("."):
                continue
            kind = name.rsplit(".", 1)[-1].lower() if "." in name else ""
            if kind not in PHOTO_TYPES and kind not in VIDEO_TYPES:
                continue
            try:
                info = os.lstat(os.path.join(directory, name))
            except OSError:
                continue
            photos += kind in PHOTO_TYPES
            videos += kind in VIDEO_TYPES
            size += info.st_size
    return {"photos": photos, "videos": videos, "bytes": size}


def count_folders(photos):
    """{folder: figures} for each folder in an account's Photos; "" holds the
    files lying directly in Photos."""
    folders = {}
    loose = {"photos": 0, "videos": 0, "bytes": 0}
    try:
        entries = sorted(os.scandir(photos), key=lambda entry: entry.name)
    except OSError:
        return folders
    for entry in entries:
        if entry.name.startswith("."):
            continue
        if entry.is_dir(follow_symlinks=False):
            folders[entry.name] = count_photos(entry.path)
        elif entry.is_file(follow_symlinks=False):
            kind = entry.name.rsplit(".", 1)[-1].lower() if "." in entry.name else ""
            if kind in PHOTO_TYPES or kind in VIDEO_TYPES:
                loose["photos"] += kind in PHOTO_TYPES
                loose["videos"] += kind in VIDEO_TYPES
                loose["bytes"] += entry.stat(follow_symlinks=False).st_size
    if any(loose.values()):
        folders[""] = loose
    return folders


def photos_sample(root=UMBREL_DATA):
    if not (root / "umbrel.yaml").is_file():
        return {"capturedAt": round(time.time() * 1000), "people": [], "devices": [], "error": f"Umbrel-Daten nicht gefunden ({root})"}
    people, devices = [], []
    for name, photos in photo_accounts(root):
        folders = count_folders(photos)
        people.append({"name": name, **{key: sum(f[key] for f in folders.values()) for key in ("photos", "videos", "bytes")}})
        devices += [{"account": name, "folder": folder, **figures} for folder, figures in folders.items()]
    return {"capturedAt": round(time.time() * 1000), "people": people, "devices": devices, "error": None}


def sample():
    sources = {}
    containers = []
    for scope, prefix in (("host", [DOCKER]), ("umbrel", [DOCKER, "exec", UMBREL_CONTAINER, "docker"])):
        try:
            found = collect(scope, prefix)
            # The Umbrel container shows up on the host with all apps' load;
            # its apps are listed one by one from the inner daemon instead.
            if scope == "host":
                found = [c for c in found if c["name"] != UMBREL_CONTAINER]
            containers += found
            sources[scope] = {"ok": True, "error": None}
        except (OSError, subprocess.SubprocessError, ValueError) as error:
            message = getattr(error, "stderr", None) or str(error)
            sources[scope] = {"ok": False, "error": str(message).strip().splitlines()[-1][:200] if message else "Fehler"}
    return {
        "capturedAt": round(time.time() * 1000),
        "intervalSeconds": INTERVAL,
        "sources": sources,
        "containers": containers,
    }


def main():
    once = "--once" in sys.argv
    if "--photos" in sys.argv:
        json.dump(photos_sample(), sys.stdout, indent=2, ensure_ascii=False)
        print()
        return
    reported = {}
    photos_due = 0
    while True:
        started = time.monotonic()
        state = sample()
        if once:
            json.dump(state, sys.stdout, indent=2)
            print()
            return
        try:
            write_state(state)
        except OSError as error:
            print(f"xps-services: {error}", file=sys.stderr, flush=True)
        if started >= photos_due:
            photos_due = started + PHOTOS_INTERVAL
            photos = photos_sample()
            if photos["error"] != reported.get("photos"):
                print(f"xps-services: Fotos: {photos['error'] or 'gezählt'}", file=sys.stderr, flush=True)
                reported["photos"] = photos["error"]
            try:
                write_state(photos, PHOTOS_FILE)
            except OSError as error:
                print(f"xps-services: {error}", file=sys.stderr, flush=True)
        # Each problem is logged once, not every interval
        for scope, source in state["sources"].items():
            if source["error"] != reported.get(scope):
                print(f"xps-services: {scope}: {source['error'] or 'wieder erreichbar'}", file=sys.stderr, flush=True)
                reported[scope] = source["error"]
        time.sleep(max(1, INTERVAL - (time.monotonic() - started)))


if __name__ == "__main__":
    main()
