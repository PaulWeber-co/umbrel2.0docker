import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from make_update_manifest import make_manifest
from test_update_release import manifest


class ManifestTests(unittest.TestCase):
    def test_requires_matching_successful_candidate_evidence(self):
        m = manifest(); evidence = dict(image=m['image'], sourceCommit=m['sourceCommit'],
                                        version=m['version'], securityPassed=True, lifecyclePassed=True)
        self.assertEqual(make_manifest(m, evidence), m)
        for key in ['image', 'sourceCommit', 'version', 'securityPassed', 'lifecyclePassed']:
            bad = {**evidence, key:False}
            with self.subTest(key=key), self.assertRaises(ValueError): make_manifest(m, bad)

    def test_missing_evidence_cannot_publish(self):
        with self.assertRaises(ValueError): make_manifest(manifest(), {})
