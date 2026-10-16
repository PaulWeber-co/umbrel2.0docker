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
    for info in json.loads(docker(prefix, "inspect", *ids)):
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


def write_state(state):
    OUTPUT_DIR.mkdir(mode=0o750, parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix="services.", dir=OUTPUT_DIR, text=True)
    try:
        os.fchmod(fd, 0o640)
        with os.fdopen(fd, "w", encoding="utf-8") as file:
            json.dump(state, file, separators=(",", ":"))
            file.write("\n")
        os.replace(temporary, OUTPUT_FILE)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


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
    reported = {}
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
        # Each problem is logged once, not every interval
        for scope, source in state["sources"].items():
            if source["error"] != reported.get(scope):
                print(f"xps-services: {scope}: {source['error'] or 'wieder erreichbar'}", file=sys.stderr, flush=True)
                reported[scope] = source["error"]
        time.sleep(max(1, INTERVAL - (time.monotonic() - started)))


if __name__ == "__main__":
    main()
