import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from xps_update_backup import create_snapshot, restore_snapshot


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp()); self.data = self.root/'data'; self.data.mkdir()
        (self.data/'state').write_bytes(b'original')
        self.config = dict(dataDirectory=str(self.data), backupRoot=str(self.root/'backup'))

    def test_real_archive_round_trip(self):
        snapshot = create_snapshot(self.config)
        (self.data/'state').write_bytes(b'changed')
        restore_snapshot(snapshot)
        self.assertEqual((self.data/'state').read_bytes(), b'original')

    def test_modified_snapshot_is_not_restored(self):
        snapshot = create_snapshot(self.config)
        Path(snapshot['archive']).write_bytes(b'damaged')
        with self.assertRaises(ValueError): restore_snapshot(snapshot)
        self.assertEqual((self.data/'state').read_bytes(), b'original')

    def test_backup_inside_source_rejected(self):
        self.config['backupRoot'] = str(self.data/'backup')
        with self.assertRaises(ValueError): create_snapshot(self.config)

    def test_low_space_never_starts_tar(self):
        runner = Mock()
        with self.assertRaises(OSError): create_snapshot(self.config, runner=runner, available_bytes=0)
        runner.assert_not_called()

    def test_selected_state_restore_preserves_unrelated_media(self):
        (self.data/'media').mkdir(); (self.data/'media/photo').write_bytes(b'photo')
        self.config['snapshotPaths'] = ['state']
        snapshot = create_snapshot(self.config)
        (self.data/'state').write_bytes(b'changed')
        (self.data/'media/photo').write_bytes(b'unrelated-new-photo')
        restore_snapshot(snapshot)
        self.assertEqual((self.data/'state').read_bytes(), b'original')
        self.assertEqual((self.data/'media/photo').read_bytes(), b'unrelated-new-photo')
