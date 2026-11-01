import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from xps_update_runtime import Runtime
from test_update_release import manifest


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp()); self.data = self.root/'volume'; self.data.mkdir()
        home = self.data/'umbrel-os/home/umbrel/umbrel'; (home/'app-data').mkdir(parents=True)
        (home/'app-data/database').write_bytes(b'important')
        (home/'home').mkdir(); (home/'home/photo').write_bytes(b'media')
        self.env = self.root/'umbrel.env'; self.env.write_text('XPS_UMBREL_IMAGE='+manifest()['image']+'\n')
        self.info = dict(Config={'Image':manifest()['image']}, Mounts=[dict(Source=str(self.data),Destination='/data',Type='volume', RW=True)])

    def test_no_migration_snapshot_preserves_app_state_without_selecting_media(self):
        with patch('xps_update_runtime.ENV_FILE', self.env), patch('xps_update_runtime.execute', return_value=json.dumps([self.info])):
            runtime = Runtime({'backupRoot':str(self.root/'backup')}); runtime.preflight(manifest())
        self.assertIn('umbrel-os/home/umbrel/umbrel/app-data', runtime.config['snapshotPaths'])
        self.assertNotIn('umbrel-os/home/umbrel/umbrel/home', runtime.config['snapshotPaths'])

    def test_migration_requires_complete_snapshot(self):
        m = manifest(); m['dataCompatibility'] = 'snapshot-required'
        with patch('xps_update_runtime.ENV_FILE', self.env), patch('xps_update_runtime.execute', return_value=json.dumps([self.info])):
            runtime = Runtime({'backupRoot':str(self.root/'backup')}); runtime.preflight(m)
        self.assertEqual(runtime.config['snapshotPaths'], ['.'])

    def test_unknown_volume_layout_is_rejected(self):
        self.info['Mounts'].append(dict(Source='/other', Destination='/persistent',Type='volume',RW=True))
        with patch('xps_update_runtime.ENV_FILE', self.env), patch('xps_update_runtime.execute', return_value=json.dumps([self.info])):
            with self.assertRaises(ValueError): Runtime({'backupRoot':str(self.root/'backup')}).preflight(manifest())

    def test_image_identity_must_match_release(self):
        result = json.dumps([dict(Architecture='arm64',Config={'Labels':{}})])
        with patch('xps_update_runtime.execute', return_value=result):
            with self.assertRaises(ValueError): Runtime({}).pull(manifest())

    def test_prior_app_names_and_stopped_state_are_preserved(self):
        rows = '\n'.join(json.dumps(dict(Names=name,State=state)) for name,state in [('music','running'),('old','exited')])
        with patch('xps_update_runtime.execute', side_effect=[rows,'']) as command:
            runtime = Runtime({}); runtime.pause()
        self.assertEqual(runtime.running,['music']); self.assertEqual(runtime.stopped,['old'])
        self.assertEqual(command.call_args.args[0], ['docker','stop','--time','300','umbrel'])
