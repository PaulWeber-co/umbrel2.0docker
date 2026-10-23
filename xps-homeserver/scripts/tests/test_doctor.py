"""Tests for xps-doctor's checks of hand-typed settings.

    python3 -m unittest discover -s xps-homeserver/scripts/tests
"""
import importlib.util
import os
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("xps_doctor", SCRIPTS / "xps-doctor.py")
doctor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(doctor)


class SettingsTest(unittest.TestCase):
    def levels(self, env):
        return {text.split(" ")[0]: level for level, text in doctor.check_settings(env)}

    def test_knuddl_invites_in_every_form_the_app_shares(self):
        self.assertEqual(doctor.knuddl_secret("ABC123-K7F2M9QX4R8TWE7HJ2NP"), "K7F2M9QX4R8TWE7HJ2NP")
        self.assertEqual(doctor.knuddl_secret("Hier meine Einladung: abc123 - k7f2m9qx4r8twe7hj2np 💛"), "K7F2M9QX4R8TWE7HJ2NP")
        self.assertEqual(doctor.knuddl_secret("https://x.github.io/knuddl/?join=ABC123-K7F2M9QX4R8TWE7HJ2NP"), "K7F2M9QX4R8TWE7HJ2NP")
        self.assertIsNone(doctor.knuddl_secret("ABC123"))
        self.assertIsNone(doctor.knuddl_secret("irgendwas"))

    def test_typos_are_problems_missing_pin_only_a_hint(self):
        found = doctor.check_settings({
            "DASH_KNUDDL_INVITE": "ABC123",
            "DASH_CALENDAR_ICS": "webcal://p52-caldav.icloud.com/published/2/x, kalender",
            "DASH_HA_URL": "umbrel.local:8123",
            "DASH_HA_TODO_ENTITY": "einkauf",
        })
        problems = [text for level, text in found if level == doctor.PROBLEM]
        self.assertEqual(len(problems), 4)
        self.assertTrue(any(level == doctor.HINT and "PIN" in text for level, text in found))

    def test_good_settings_pass(self):
        found = doctor.check_settings({
            "DASH_KNUDDL_INVITE": "ABC123-K7F2M9QX4R8TWE7HJ2NP",
            "DASH_CALENDAR_ICS": "webcal://p52-caldav.icloud.com/published/2/x",
            "DASH_HA_URL": "http://umbrel.local:8123",
            "DASH_HA_CALENDAR_ENTITY": "calendar.familie",
            "DASH_PIN": "4711",
        })
        self.assertEqual([level for level, _ in found if level != doctor.OK], [])

    def test_env_file_reads_like_systemd(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "dashboard.env"
            path.write_text("# Kommentar\nDASH_NAME=Paul\nDASH_COMMUTE_LABEL=Ins Büro\nDASH_PIN=\"4711\"\nkaputt\n", encoding="utf-8")
            self.assertEqual(doctor.read_env(path), {"DASH_NAME": "Paul", "DASH_COMMUTE_LABEL": "Ins Büro", "DASH_PIN": "4711"})
            self.assertIsNone(doctor.read_env(Path(tmp) / "fehlt.env"))


class ReasonTest(unittest.TestCase):
    def test_network_errors_in_words(self):
        import urllib.error
        self.assertEqual(doctor.reason(urllib.error.URLError(ConnectionRefusedError(111, "Connection refused"))),
                         "Verbindung abgelehnt, der Dienst läuft nicht")
        self.assertEqual(doctor.reason(TimeoutError("timed out")), "keine Antwort")
        self.assertEqual(doctor.reason(urllib.error.HTTPError("http://x", 502, "Bad Gateway", {}, None)), "HTTP 502")
        self.assertEqual(doctor.reason(ValueError("Expecting value")), "Expecting value")


class ExecutableTest(unittest.TestCase):
    def test_everything_units_and_links_start_is_executable(self):
        # setup-xps.sh links xps-display and xps-doctor, the units start the rest
        for name in ("xps-doctor.py", "xps-display.py", "xps-control.py", "xps-kiosk.sh", "xps-services.py",
                     "xps-ambient.py", "setup-xps.sh", "update-xps.sh", "update-umbrel.sh", "rollback-umbrel.sh"):
            self.assertTrue(os.access(SCRIPTS / name, os.X_OK), f"{name} ist nicht ausführbar")


if __name__ == "__main__":
    unittest.main()
