"""Tests for the host services that touch hardware, against fake files.

    python3 -m unittest discover -s xps-homeserver/scripts/tests

A temporary directory stands in for /sys (backlight, framebuffer), /run and
the dashboard's data directory; a small script stands in for systemctl and
records every call.
"""
import importlib.util
import json
import os
import stat
import tempfile
import time
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class HostTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="xps-host-"))
        self.backlight = self.tmp / "backlight" / "intel_backlight"
        self.backlight.mkdir(parents=True)
        (self.backlight / "max_brightness").write_text("1000\n")
        (self.backlight / "brightness").write_text("500\n")
        (self.backlight / "bl_power").write_text("0\n")
        self.blank = self.tmp / "fb0-blank"
        self.blank.write_text("")
        self.host_state = self.tmp / "host-state.json"
        self.ambient = self.tmp / "ambient.json"
        self.calls = self.tmp / "systemctl.log"
        self.systemctl = self.tmp / "systemctl"
        self.systemctl.write_text(
            "#!/bin/sh\n"
            f'echo "$*" >> "{self.calls}"\n'
            'if [ "$1" = is-active ]; then echo active; fi\n'
        )
        self.systemctl.chmod(self.systemctl.stat().st_mode | stat.S_IEXEC)
        self.saved_env = dict(os.environ)
        os.environ.update({
            "XPS_HOST_STATE": str(self.host_state),
            "XPS_AMBIENT_FILE": str(self.ambient),
            "XPS_CONTROL_DIR": str(self.tmp / "run-control"),
            "XPS_SYSTEMCTL": str(self.systemctl),
            "XPS_FRAMEBUFFER_BLANK": str(self.blank),
            "XPS_BACKLIGHT_PATH": str(self.backlight),
            "XPS_BACKLIGHT_MIN_PERCENT": "8",
            "XPS_BACKLIGHT_MAX_PERCENT": "85",
            "XPS_AMBIENT_DIR": str(self.tmp / "run-ambient"),
        })

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self.saved_env)

    def wish(self, **values):
        self.host_state.write_text(json.dumps(values))

    def calls_made(self):
        return self.calls.read_text().splitlines() if self.calls.exists() else []

    def brightness(self):
        return int((self.backlight / "brightness").read_text())


class ControlTest(HostTestCase):
    def setUp(self):
        super().setUp()
        self.control = load("xps_control", "xps-control.py")

    def test_invalid_or_missing_wishes_mean_everything_on(self):
        normalize = self.control.normalize_wish
        self.assertEqual(normalize(None), self.control.DEFAULT_WISH)
        self.assertEqual(normalize({"kiosk": "no", "backlight": 0, "display": "dim", "rm": "-rf"}), self.control.DEFAULT_WISH)
        self.assertEqual(normalize({"backlight": True})["backlight"], "auto")
        self.assertEqual(normalize({"backlight": 40, "kiosk": False})["backlight"], 40)
        self.assertEqual(self.control.read_wish(self.tmp / "missing.json"), self.control.DEFAULT_WISH)

    def test_wants_answers_for_exec_condition(self):
        self.assertEqual(self.control.main(["xps-control", "--wants", "kiosk"]), 0)
        self.wish(kiosk=False, airplay=True)
        self.assertEqual(self.control.main(["xps-control", "--wants", "kiosk"]), 1)
        self.assertEqual(self.control.main(["xps-control", "--wants", "airplay"]), 0)
        self.assertEqual(self.control.main(["xps-control", "--wants", "rm"]), 2)

    def test_units_follow_changes_of_the_wish_only(self):
        controller = self.control.Controller()
        self.wish(display="on", kiosk=True, airplay=True, backlight="auto", camera=True)
        controller.step(now=100)
        self.assertIn("start --no-block xps-kiosk.service", self.calls_made())
        self.assertIn("start --no-block xps-airplay.service", self.calls_made())

        self.calls.unlink()
        controller.step(now=101)
        self.assertNotIn("start --no-block xps-kiosk.service", self.calls_made(), "same wish, no new start")

        self.wish(display="off", kiosk=False, airplay=False, backlight="off", camera=False)
        controller.step(now=102)
        self.assertIn("stop xps-kiosk.service", self.calls_made())
        self.assertIn("stop --no-block xps-airplay.service", self.calls_made())
        self.assertEqual(self.blank.read_text().strip(), "4", "panel powered down once the kiosk is gone")
        self.assertEqual(self.brightness(), 0)
        self.assertEqual((self.backlight / "bl_power").read_text().strip(), "4")

        self.wish(display="on", kiosk=True, airplay=False, backlight=60, camera=False)
        controller.step(now=103)
        self.assertEqual(self.blank.read_text().strip(), "0")
        self.assertEqual(self.brightness(), 600)
        self.assertEqual((self.backlight / "bl_power").read_text().strip(), "0")

        status = json.loads((self.tmp / "run-control" / "status.json").read_text())
        self.assertEqual(status["kiosk"], "active")
        self.assertEqual(status["backlightPercent"], 60)
        self.assertEqual(status["wish"]["backlight"], 60)

    def test_auto_backlight_follows_the_room_and_remembers_it(self):
        controller = self.control.Controller()
        self.wish(display="on", kiosk=True, airplay=True, backlight="auto", camera=True)
        now_ms = time.time() * 1000
        self.ambient.write_text(json.dumps({"available": True, "level": 0, "capturedAt": now_ms, "intervalSeconds": 45}))
        controller.step(now=1)
        self.assertEqual(self.brightness(), 80, "a dark room: the minimum, 8 %")
        self.ambient.write_text(json.dumps({"available": True, "level": 255, "capturedAt": now_ms, "intervalSeconds": 45}))
        controller.step(now=2)
        self.assertEqual(self.brightness(), 850, "a bright room: the maximum, 85 %")

        # Asleep and awake again before the camera has a new reading: the last
        # level is the guess, not a flash at full brightness
        self.ambient.write_text(json.dumps({"available": True, "level": 0, "capturedAt": now_ms, "intervalSeconds": 45}))
        controller.step(now=3)
        self.wish(display="sleep", kiosk=True, airplay=True, backlight="off", camera=False)
        self.ambient.write_text(json.dumps({"available": False, "paused": True, "capturedAt": now_ms}))
        controller.step(now=4)
        self.assertEqual(self.brightness(), 0)
        self.wish(display="on", kiosk=True, airplay=True, backlight="auto", camera=True)
        controller.step(now=5)
        self.assertEqual(self.brightness(), 80)

    def test_stale_ambient_readings_are_ignored(self):
        old = (time.time() - 600) * 1000
        self.ambient.write_text(json.dumps({"available": True, "level": 200, "capturedAt": old, "intervalSeconds": 45}))
        self.assertIsNone(self.control.ambient_level(self.ambient))
        self.ambient.write_text(json.dumps({"available": True, "ambientPercent": 50, "capturedAt": time.time() * 1000}))
        self.assertEqual(self.control.ambient_level(self.ambient), 128, "older files without level still work")


class AmbientTest(HostTestCase):
    def setUp(self):
        super().setUp()
        self.ambient_module = load("xps_ambient", "xps-ambient.py")

    def test_camera_runs_unless_the_dashboard_switched_it_off(self):
        self.assertTrue(self.ambient_module.camera_wanted(), "no file: measure as before")
        self.host_state.write_text("not json")
        self.assertTrue(self.ambient_module.camera_wanted())
        self.wish(camera=False)
        self.assertFalse(self.ambient_module.camera_wanted())
        self.wish(camera=True)
        self.assertTrue(self.ambient_module.camera_wanted())

    def test_a_measurement_writes_only_numbers(self):
        self.ambient_module.measure_camera = lambda: 12
        self.ambient_module.measure_once()
        state = json.loads((self.tmp / "run-ambient" / "ambient.json").read_text())
        self.assertEqual(state["level"], 12)
        self.assertEqual(state["ambientPercent"], 5)
        self.assertTrue(state["dark"])
        self.assertEqual(set(state), {"available", "paused", "level", "ambientPercent", "dark", "capturedAt", "intervalSeconds"})


if __name__ == "__main__":
    unittest.main()


class PhotosTest(unittest.TestCase):
    """The photo backup figures per Umbrel account (xps-services.py)."""

    def setUp(self):
        self.services = load("xps_services", "xps-services.py")
        self.root = Path(tempfile.mkdtemp(prefix="xps-umbrel-"))
        (self.root / "umbrel.yaml").write_text(
            "version: 1\nuser:\n  name: Paul\n  language: de\nphotos:\n  backupSources:\n    - id: x\n      name: iPhone\n"
            "members:\n  - id: Jane\n    name: 'Jane'\n    language: de\n  - id: ../etc\n    name: Böse\n"
        )

    def put(self, path, size):
        file = self.root / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(b"x" * size)

    def test_counts_photos_videos_and_bytes_per_account(self):
        self.put("home/Photos/iPhone/b1/aaa.jpg", 100)
        self.put("home/Photos/iPhone/b1/bbb.HEIC", 50)
        self.put("home/Photos/iPhone (2)/c2/ccc.mov", 300)
        self.put("home/Photos/iPhone/b1/notes.txt", 999)
        self.put("home/Photos/iPhone/.thumbs/ddd.jpg", 999)
        self.put("members/Jane/home/Photos/iPhone/e5/eee.dng", 70)
        sample = self.services.photos_sample(self.root)
        self.assertIsNone(sample["error"])
        self.assertEqual(sample["people"], [
            {"name": "Paul", "photos": 2, "videos": 1, "bytes": 450},
            {"name": "Jane", "photos": 1, "videos": 0, "bytes": 70},
        ], "names from umbrel.yaml, other files, hidden folders and odd member ids left out")

    def test_deleted_accounts_and_nested_names_do_not_count(self):
        # Jane deleted and created again: the old record stays as a tombstone,
        # the new account gets the id Jane-2 and keeps its name
        (self.root / "umbrel.yaml").write_text(
            "user:\n  name: Paul\nmembers:\n  - id: Jane\n    deleted: true\n"
            "  - id: Jane-2\n    name: Jane\n    widgets:\n      - name: Wetter\n        app: x\n    language: de\n"
        )
        self.put("members/Jane-2/home/Photos/iPhone/a1/neu.jpg", 40)
        sample = self.services.photos_sample(self.root)
        self.assertEqual(sample["people"], [
            {"name": "Paul", "photos": 0, "videos": 0, "bytes": 0},
            {"name": "Jane", "photos": 1, "videos": 0, "bytes": 40},
        ])

    def test_each_phone_folder_is_counted_on_its_own(self):
        self.put("home/Photos/iPhone/b1/aaa.jpg", 100)
        self.put("home/Photos/iPhone/b2/bbb.mov", 300)
        self.put("home/Photos/iPhone (2)/c2/ccc.heic", 40)
        self.put("home/Photos/lose.png", 5)
        self.put("home/Photos/.versteckt/ddd.jpg", 999)
        self.put("members/Jane/home/Photos/iPhone/e5/eee.jpg", 70)
        sample = self.services.photos_sample(self.root)
        self.assertEqual(sample["devices"], [
            {"account": "Paul", "folder": "iPhone", "photos": 1, "videos": 1, "bytes": 400},
            {"account": "Paul", "folder": "iPhone (2)", "photos": 1, "videos": 0, "bytes": 40},
            {"account": "Paul", "folder": "", "photos": 1, "videos": 0, "bytes": 5},
            {"account": "Jane", "folder": "iPhone", "photos": 1, "videos": 0, "bytes": 70},
        ], "files directly in Photos count under the folder \"\"")
        self.assertEqual(sample["people"][0], {"name": "Paul", "photos": 3, "videos": 1, "bytes": 445}, "accounts sum their folders")

    def test_an_account_without_backups_counts_zero(self):
        sample = self.services.photos_sample(self.root)
        self.assertEqual([p["photos"] for p in sample["people"]], [0, 0])

    def test_missing_umbrel_data_is_reported(self):
        sample = self.services.photos_sample(self.root / "nothing")
        self.assertEqual(sample["people"], [])
        self.assertIn("nicht gefunden", sample["error"])
