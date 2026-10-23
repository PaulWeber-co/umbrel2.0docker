#!/usr/bin/python3
"""The control center from the command line, e.g. over SSH:

  xps-display                     what the wall display shows and why
  xps-display aus [Minuten]       screen off (kiosk stopped), default 60 min
  xps-display schwarz [Minuten]   screen black, a tap wakes it
  xps-display nacht [Minuten]     only the night clock
  xps-display an [Minuten]        dashboard on
  xps-display morgen              screen off until the schedule starts again
  xps-display auto                end a temporary state
  xps-display modus auto|an|aus   automatic, always on, or only a server

It talks to the dashboard on this machine (http://127.0.0.1:7777), which
needs no PIN, so any user logged in on the XPS can use it.
"""
import json
import sys
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:7777"
STATES = {"an": "on", "on": "on", "aus": "off", "off": "off", "schwarz": "sleep", "sleep": "sleep", "nacht": "night", "night": "night"}
MODES = {"auto": "auto", "an": "on", "on": "on", "aus": "off", "off": "off"}
NAMES = {"on": "an", "night": "Nachtuhr", "sleep": "schwarz", "off": "aus"}


def call(method, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(BASE + path, data=data, method=method, headers={"content-type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        message = json.load(error).get("error", error.reason)
        sys.exit(f"xps-display: {message}")
    except OSError as error:
        sys.exit(f"xps-display: Dashboard nicht erreichbar ({error}); systemctl status xps-dashboard")


def clock(ms):
    return time.strftime("%a %H:%M", time.localtime(ms / 1000)) if ms else ""


def show(snapshot):
    effective = snapshot["effective"]
    line = f"Bildschirm: {NAMES[effective['display']]} – {effective['reason']}"
    if effective.get("until"):
        line += f" (bis {clock(effective['until'])})"
    print(line)
    if effective.get("next") and effective["source"] in ("schedule", "dark"):
        print(f"Danach:     {NAMES[effective['next']['display']]} ab {clock(effective['next']['at'])}")
    mode = {"auto": "Automatisch", "on": "Immer an", "off": "Aus – nur Server"}[snapshot["settings"]["mode"]]
    print(f"Modus:      {mode}")
    status = snapshot.get("status") or {}
    if status:
        print(f"Kiosk:      {status.get('kiosk', '?')}   AirPlay: {status.get('airplay', '?')}   Helligkeit: {status.get('backlightPercent', '?')} %")


def main(args):
    if not args:
        return show(call("GET", "/api/control"))
    word = args[0].lower()
    if word in ("-h", "--help", "hilfe"):
        print(__doc__)
        return None
    if word == "auto":
        return show(call("POST", "/api/control/override", {"clear": True}))
    if word == "morgen":
        return show(call("POST", "/api/control/override", {"state": "off", "until": "morning"}))
    if word in ("modus", "mode") and len(args) == 2 and args[1].lower() in MODES:
        return show(call("PUT", "/api/control", {"mode": MODES[args[1].lower()]}))
    if word in STATES:
        minutes = int(args[1]) if len(args) > 1 and args[1].isdigit() else 60
        return show(call("POST", "/api/control/override", {"state": STATES[word], "minutes": minutes}))
    sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
