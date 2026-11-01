"""Opt-in runtime checks; never infer security from a displayed version alone."""
import os
from pathlib import Path
import shlex
import subprocess
import unittest


@unittest.skipUnless(os.getenv('XPS_TEST_IMAGE') or os.getenv('XPS_TEST_CONTAINER'), 'requires container runtime target')
class ContainerSecurityTest(unittest.TestCase):
    def run_in_container(self, command):
        target = os.getenv('XPS_TEST_CONTAINER')
        args = ['docker', 'exec', target] if target else ['docker', 'run', '--rm', '--entrypoint', 'sh', os.environ['XPS_TEST_IMAGE']]
        if target:
            args += ['sh']
        return subprocess.check_output(args + ['-c', command], text=True).strip()

    def test_security_release_version(self):
        self.assertEqual(self.run_in_container("node -p 'JSON.parse(require(\"fs\").readFileSync(\"/opt/umbreld/package.json\")).version'"), '2.0.1')

    def test_decoder_security_floor(self):
        self.assertEqual(self.run_in_container("dpkg-query -W -f='${Version}' libde265-0"), '1.1.3-1')

    def test_system_certificate_store_is_used(self):
        unit = self.run_in_container('cat /etc/systemd/system/umbrel.service')
        self.assertIn('NODE_OPTIONS=--use-openssl-ca', unit)

    def test_container_data_initialization_is_retained(self):
        self.assertEqual(self.run_in_container('test -f /etc/systemd/system/umbrel-container-data.service && echo present'), 'present')

    def test_tls_certificate_generation_uses_a_valid_system_configuration(self):
        self.assertEqual(self.run_in_container('d=$(mktemp -d); openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=localhost -keyout "$d/key" -out "$d/cert" >/dev/null 2>&1 && test -s "$d/cert" && echo valid'), 'valid')

    def test_exfat_and_ext4_have_the_correct_gpt_partition_types(self):
        probe = Path(__file__).with_name('partition_format_probe.mjs').read_text()
        result = self.run_in_container('cd /opt/umbreld && node --import tsx --input-type=module -e '+shlex.quote(probe))
        self.assertIn('PASS: real formatter creates Microsoft Basic Data', result)

    def test_watchman_remains_available(self):
        self.assertRegex(self.run_in_container('watchman -v'), r'\d+\.\d+')


if __name__ == '__main__':
    unittest.main()
