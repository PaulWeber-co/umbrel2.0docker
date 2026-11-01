import http.client
import json
from pathlib import Path
import socket
import sys
import tempfile
import threading
import time
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
        payload=(body or '').encode()
        sock=socket.socket(socket.AF_UNIX);sock.settimeout(5);sock.connect(str(self.sock))
        try:
            packet=(f'{method} {path} HTTP/1.0\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: {len(payload)}\r\n\r\n').encode()+payload
            sock.sendall(packet)
            response=http.client.HTTPResponse(sock);response.begin()
            return response.status,json.loads(response.read())
        finally:sock.close()

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

    def test_host_cli_uses_the_same_constrained_socket_api(self):
        from xps_update_cli import send_request
        result = send_request(str(self.sock), 'GET', '/v1/status')
        self.assertEqual(result['phase'], 'idle')

    def test_interrupted_or_failed_rollback_requires_operator_review(self):
        from xps_update_worker import write_status
        from xps_update_service import IDLE
        for outcome in ['interrupted', 'failed']:
            write_status(self.root/'state/status.json', dict(IDLE, phase='finished', progress=85, outcome=outcome,error='Manual recovery required'))
            self.assertEqual(self.request('POST','/v1/update','{}')[0],409)
        self.launch.assert_not_called()

    def test_only_safe_terminal_failure_can_be_acknowledged(self):
        from xps_update_worker import write_status
        from xps_update_service import IDLE
        write_status(self.root/'state/status.json', dict(IDLE, jobId='45cdf188-ea3e-4e6d-a857-a473a271ca76',version='2.0.1',digest=manifest()['image'],phase='finished', outcome='rolled-back', error='Previous version restored', progress=85, safeToContinue=True))
        self.assertEqual(self.request('POST','/v1/acknowledge','{}')[0],200)
        self.assertTrue(self.request('GET','/v1/status')[1]['acknowledged'])
        write_status(self.root/'state/status.json', dict(IDLE, phase='finished', outcome='interrupted', error='Manual review required', progress=85))
        self.assertEqual(self.request('POST','/v1/acknowledge','{}')[0],409)

    def test_progress_never_grants_permission_to_retry_or_acknowledge(self):
        from xps_update_worker import write_status
        from xps_update_service import IDLE
        write_status(self.root/'state/status.json',dict(IDLE,phase='finished',outcome='failed',progress=30,safeToContinue=False,error='Previous app state unavailable'))
        for path in ['/v1/update','/v1/acknowledge']:
            self.assertEqual(self.request('POST',path,'{}')[0],409)

    def test_missing_job_and_malformed_terminal_status_require_recovery(self):
        from xps_update_worker import write_status
        from xps_update_service import recover_status, IDLE
        root=self.root/'state'
        for saved in [dict(IDLE,jobId='45cdf188-ea3e-4e6d-a857-a473a271ca76',phase='backup'),
                      {'phase':'finished','outcome':'succeeded'}, dict(IDLE,phase='finished',progress='bad'),
                      dict(IDLE,phase='finished',outcome='succeeded',progress=17)]:
            write_status(root/'status.json',saved)
            status=recover_status(root,lambda _:False)
            self.assertEqual(status['outcome'],'interrupted')
            self.assertFalse(status['safeToContinue'])
            self.assertEqual(json.loads((root/'status.json').read_text()),status)

    def test_slow_release_lookup_does_not_block_progress_reads(self):
        entered=threading.Event(); proceed=threading.Event()
        def lookup():
            entered.set();proceed.wait(3)
            return dict(available=False, version='2.0.1')
        self.fetch.side_effect=lookup
        errors=[]
        def lookup_request():
            try:self.request('GET','/v1/release')
            except Exception as error:errors.append(error)
        thread=threading.Thread(target=lookup_request);thread.start();entered.wait(2)
        try:
            start=time.monotonic();self.assertEqual(self.request('GET','/v1/status')[0],200)
            self.assertLess(time.monotonic()-start,1)
        finally:
            proceed.set();thread.join()

    def test_dead_worker_is_reported_as_interrupted(self):
        from xps_update_service import recover_status, IDLE
        from xps_update_worker import write_status
        identifier='45cdf188-ea3e-4e6d-a857-a473a271ca76'
        root=self.root/'state';write_status(root/'status.json',dict(IDLE,jobId=identifier,phase='switch',progress=60))
        write_status(root/'jobs'/f'{identifier}.json',dict(started=True))
        status=recover_status(root, lambda _:False)
        self.assertEqual(status['outcome'],'interrupted')
        self.assertEqual(status['phase'],'finished')

    def test_active_oneshot_and_finished_result_are_not_overwritten(self):
        from xps_update_service import recover_status, IDLE
        from xps_update_worker import write_status
        identifier='45cdf188-ea3e-4e6d-a857-a473a271ca76'
        root=self.root/'state';write_status(root/'status.json',dict(IDLE,jobId=identifier,phase='verify'))
        write_status(root/'jobs'/f'{identifier}.json',dict(started=True))
        self.assertEqual(recover_status(root,lambda _:True)['phase'],'verify')
        write_status(root/'status.json',dict(IDLE,jobId=identifier,version='2.0.1',digest=manifest()['image'],phase='finished',outcome='succeeded',progress=100))
        self.assertEqual(recover_status(root,lambda _:False)['outcome'],'succeeded')
