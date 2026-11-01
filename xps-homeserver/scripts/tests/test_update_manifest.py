import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from make_update_manifest import make_manifest
from test_update_release import manifest


class ManifestTests(unittest.TestCase):
    def test_requires_matching_successful_candidate_evidence(self):
        m = manifest(); evidence = dict(image=m['image'], sourceCommit=m['sourceCommit'],
                                        version=m['version'], securityPassed=True, lifecyclePassed=True, dataCompatibility='no-migration')
        self.assertEqual(make_manifest(m, evidence), m)
        for key in ['image', 'sourceCommit', 'version', 'securityPassed', 'lifecyclePassed']:
            bad = {**evidence, key:False}
            with self.subTest(key=key), self.assertRaises(ValueError): make_manifest(m, bad)

    def test_missing_evidence_cannot_publish(self):
        with self.assertRaises(ValueError): make_manifest(manifest(), {})

    def test_unexercised_migration_mode_cannot_publish(self):
        m=manifest(); m['dataCompatibility']='snapshot-required'
        evidence=dict(m,securityPassed=True,lifecyclePassed=True,dataCompatibility='no-migration')
        with self.assertRaises(ValueError): make_manifest(m,evidence)

    def test_untrusted_candidate_origins_are_rejected(self):
        from make_update_manifest import candidate_commit
        run=dict(status='completed',conclusion='success',head_branch='master',event='push',
                 repository={'full_name':'PaulWeber-co/umbrel2.0docker'},
                 head_repository={'full_name':'PaulWeber-co/umbrel2.0docker'},
                 path='.github/workflows/xps-umbrel-image.yml',head_sha='b'*40,pull_requests=[])
        self.assertEqual(candidate_commit(run,'PaulWeber-co/umbrel2.0docker'),'b'*40)
        for bad in [dict(run,event='pull_request'),dict(run,head_repository={'full_name':'attacker/fork'}),
                    dict(run,pull_requests=[{'number':1}]),dict(run,head_sha='--evil'),dict(run,event='workflow_run')]:
            with self.subTest(bad=bad), self.assertRaises(ValueError): candidate_commit(bad,'PaulWeber-co/umbrel2.0docker')
