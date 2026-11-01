import http.client
import json
from pathlib import Path
import socket
import sys
import tempfile
import threading
import unittest
from unittest.mock import Mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from xps_update_service import create_server
from test_update_release import manifest


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp()); self.sock = self.root/'control.sock'
        self.fetch = Mock(return_value=dict(available=True, manifest=manifest(), version='2.0.1'))
        self.launch = Mock()
        self.server = create_server(self.sock, self.root/'state', self.fetch, self.launch)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True); self.thread.start()

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join()

    def request(self, method, path, body=None):
        conn = http.client.HTTPConnection('localhost', timeout=2)
        conn.sock = socket.socket(socket.AF_UNIX); conn.sock.connect(str(self.sock))
        conn.request(method, path, body=body, headers={'Content-Type':'application/json'})
        response = conn.getresponse(); data = json.loads(response.read()); status = response.status; conn.close()
        return status, data

    def test_one_durable_job_for_duplicate_click(self):
        first = self.request('POST', '/v1/update', '{}')
        second = self.request('POST', '/v1/update', '{}')
        self.assertEqual(first[0], 202); self.assertEqual(first, second)
        self.launch.assert_called_once()
        self.assertEqual(self.request('GET', '/v1/status')[1]['jobId'], first[1]['jobId'])

    def test_unknown_fields_and_paths_rejected(self):
        for body in ['{"image":"attacker"}', '[]', 'null', '{"command":"whoami"}', 'x'*65]:
            self.assertEqual(self.request('POST', '/v1/update', body)[0], 400)
        self.assertEqual(self.request('GET', '/v1/status/../../etc/passwd')[0], 404)
        self.launch.assert_not_called()

    def test_release_does_not_expose_internal_manifest(self):
        status, data = self.request('GET', '/v1/release')
        self.assertEqual(status, 200); self.assertNotIn('manifest', data)
        self.assertEqual(self.sock.stat().st_mode & 0o777, 0o600)

    def test_fetch_failure_never_launches(self):
        self.fetch.side_effect = RuntimeError('secret-token-value')
        status, data = self.request('POST', '/v1/update', '{}')
        self.assertEqual(status, 503); self.assertNotIn('secret-token', str(data))
        self.launch.assert_not_called()
