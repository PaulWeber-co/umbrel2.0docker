import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import xps_update_release as release


def manifest(version='2.0.1'):
    return dict(schemaVersion=1, version=version, platform='linux/amd64',
                image=release.IMAGE_REPOSITORY + '@sha256:' + 'a'*64,
                sourceCommit='b'*40, releaseNotes='Security fixes', dataCompatibility='no-migration')


class ReleaseTests(unittest.TestCase):
    def test_valid_manifest(self):
        self.assertEqual(release.validate_release(manifest())['version'], '2.0.1')

    def test_invalid_manifests_fail_closed(self):
        for field, value in [('schemaVersion', True), ('platform', 'linux/arm64'),
                             ('version', '02.0.1'), ('version', '2.0.2-beta'),
                             ('image', 'ghcr.io/attacker/image@sha256:'+'a'*64),
                             ('image', release.IMAGE_REPOSITORY+':latest'),
                             ('sourceCommit', '../bad'), ('dataCompatibility', 'skip')]:
            with self.subTest(field=field, value=value):
                d = manifest(); d[field] = value
                with self.assertRaises(ValueError): release.validate_release(d)
        d = manifest(); d['command'] = 'touch /etc/test'
        with self.assertRaises(ValueError): release.validate_release(d)

    def test_stable_newer_matching_tag_only(self):
        entries = [dict(tag_name='xps-2.0.1', draft=False, prerelease=False, manifest=manifest())]
        self.assertIsNotNone(release.select_release(entries, '2.0.0'))
        self.assertIsNone(release.select_release(entries, '2.0.1'))
        self.assertIsNone(release.select_release(entries, '2.1.0'))
        for key in ['draft', 'prerelease']:
            changed = copy.deepcopy(entries); changed[0][key] = True
            self.assertIsNone(release.select_release(changed, '2.0.0'))
        entries[0]['tag_name'] = 'xps-9.0.0'
        with self.assertRaises(ValueError): release.select_release(entries, '2.0.0')

    def test_outstanding_official_release_is_not_installable(self):
        def get(url):
            return {'tag_name':'2.0.2'} if url.endswith('/latest') else []
        result = release.fetch_release({}, '2.0.1', get_json=get)
        self.assertFalse(result['available']); self.assertTrue(result['pendingUpstream'])
        self.assertIsNone(result['digest'])

    def test_untrusted_url_rejected_before_request(self):
        for url in ['http://github.com/file', 'https://evil.example/file',
                    'https://github.com@evil.example/file', 'https://github.com:444/file']:
            with self.subTest(url=url), self.assertRaises(ValueError): release.validate_download_url(url)

    def test_duplicate_json_keys_rejected(self):
        with self.assertRaises(ValueError): release.decode_json(b'{"version":"2.0.1","version":"9.0.0"}')


if __name__ == '__main__': unittest.main()
