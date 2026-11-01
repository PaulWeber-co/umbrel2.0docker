import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from xps_update_worker import run_job, write_status
from test_update_release import manifest


class WorkerTests(unittest.TestCase):
    def test_atomic_status(self):
        p = Path(tempfile.mkdtemp())/'status.json'
        write_status(p, {'phase':'backup'})
        self.assertEqual(json.loads(p.read_text()), {'phase':'backup'})
        self.assertEqual(p.stat().st_mode & 0o777, 0o600)

    def runner(self, fail=None):
        r = Mock(); r.preflight.return_value = None; r.snapshot.return_value = {'id':'snapshot'}
        if fail: getattr(r, fail).side_effect = RuntimeError('failure')
        return r

    def test_no_switch_without_backup(self):
        r = self.runner('snapshot'); result = run_job({'release':manifest()}, {}, r)
        self.assertEqual(result['outcome'], 'failed'); r.switch.assert_not_called()
        r.resume.assert_called_once()

    def test_failed_verification_restores_data_and_image(self):
        r = self.runner('verify'); result = run_job({'release':manifest()}, {}, r)
        self.assertEqual(result['outcome'], 'rolled-back')
        r.rollback.assert_called_once_with({'id':'snapshot'})

    def test_failed_rollback_is_never_success(self):
        r = self.runner('verify'); r.rollback.side_effect = RuntimeError('rollback failed')
        self.assertEqual(run_job({'release':manifest()}, {}, r)['outcome'], 'failed')
        r.resume.assert_not_called()

    def test_only_verified_state_is_success(self):
        r = self.runner(); result = run_job({'release':manifest()}, {}, r)
        self.assertEqual(result['outcome'], 'succeeded'); r.verify.assert_called_once(); r.rollback.assert_not_called()

    def test_invalid_image_never_calls_runner(self):
        r = self.runner(); d = manifest(); d['image'] = 'attacker:latest'
        with self.assertRaises(ValueError): run_job({'release':d}, {}, r)
        r.preflight.assert_not_called()
