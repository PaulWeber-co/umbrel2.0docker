"""Local HTTP API over a private Unix socket. POST accepts no install parameters."""
import fcntl
from http.server import BaseHTTPRequestHandler
import json
import os
from pathlib import Path
import socketserver
import subprocess
import uuid
import time

from xps_update_release import decode_json, fetch_release, validate_release
from xps_update_worker import write_status, STATE_ROOT

IDLE = dict(jobId=None, version=None, digest=None, phase='idle', progress=0, error=False, outcome=None, acknowledged=False)


def recover_status(state_root, active):
    root=Path(state_root);status_file=root/'status.json';status=json.loads(status_file.read_text())
    if status['phase'] in ('idle','finished'):return status
    identifier=str(uuid.UUID(status['jobId']))
    if active(identifier):return status
    # Read again after querying systemd: the worker may just have written its final result.
    status=json.loads(status_file.read_text())
    if status['phase'] in ('idle','finished'):return status
    job=json.loads((root/'jobs'/f'{identifier}.json').read_text())
    if not job.get('started') and time.time()-job.get('createdAt',0)<30:return status
    status.update(phase='finished',outcome='interrupted',error='Update interrupted; manual host review required')
    write_status(status_file,status)
    return status


def create_server(socket_path, state_root, fetch, launch, active=None):
    state_root = Path(state_root); state_root.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(state_root, 0o700)
    jobs = state_root/'jobs'; jobs.mkdir(mode=0o700, exist_ok=True)
    status_file = state_root/'status.json'
    if not status_file.exists(): write_status(status_file, IDLE)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_): pass

        def reply(self, status, data):
            body = json.dumps(data).encode()
            self.send_response(status); self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body))); self.send_header('Cache-Control', 'no-store'); self.end_headers(); self.wfile.write(body)

        def do_GET(self):
            try:
                if self.path == '/v1/status': return self.reply(200, recover_status(state_root,active) if active else json.loads(status_file.read_text()))
                if self.path == '/v1/release': return self.reply(200, {k:v for k,v in fetch().items() if k != 'manifest'})
                self.reply(404, {'error':'Unknown endpoint'})
            except Exception: self.reply(503, {'error':'Updater information unavailable'})

        def do_POST(self):
            if self.path not in ('/v1/update', '/v1/acknowledge'): return self.reply(404, {'error':'Unknown endpoint'})
            try:
                if self.headers.get('Transfer-Encoding'): raise ValueError()
                length = int(self.headers.get('Content-Length', '-1'))
                if not 0 <= length <= 64: raise ValueError()
                if decode_json(self.rfile.read(length)) != {}: raise ValueError()
            except Exception: return self.reply(400, {'error':'Expected empty JSON object'})
            try:
                with (state_root/'start.lock').open('a') as lock:
                    fcntl.flock(lock, fcntl.LOCK_EX)
                    status = recover_status(state_root,active) if active else json.loads(status_file.read_text())
                    if self.path == '/v1/acknowledge':
                        safe = status['outcome'] == 'rolled-back' or (status['outcome'] == 'failed' and status['progress'] < 60)
                        if status['phase'] != 'finished' or not safe:
                            return self.reply(409, {'error':'Host recovery review is still required'})
                        write_status(status_file, dict(status, acknowledged=True))
                        return self.reply(200, {'acknowledged':True})
                    if status['phase'] not in ('idle', 'finished'):
                        return self.reply(202, {'jobId':status['jobId']})
                    if status['outcome'] == 'interrupted' or (status['outcome'] == 'failed' and status['progress'] >= 60):
                        return self.reply(409, {'error':'Previous update requires manual host recovery review'})
                    release = fetch()
                    if not release['available']: return self.reply(409, {'error':'No approved newer release'})
                    manifest = validate_release(release['manifest']); identifier = str(uuid.uuid4())
                    write_status(jobs/f'{identifier}.json', dict(jobId=identifier, release=manifest, started=False, createdAt=time.time()))
                    write_status(status_file, dict(IDLE, jobId=identifier, version=manifest['version'], digest=manifest['image'], phase='preflight'))
                    try: launch(identifier)
                    except Exception:
                        write_status(status_file, dict(IDLE, jobId=identifier, phase='finished', error='Could not start update worker', outcome='failed'))
                        raise
                    self.reply(202, {'jobId':identifier})
            except Exception: self.reply(503, {'error':'Could not start approved update'})

    class Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
        daemon_threads = True
        def get_request(self):
            sock, address = super().get_request(); sock.settimeout(10); return sock, address

    socket_path = Path(socket_path); socket_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(socket_path.parent, 0o700)
    if socket_path.exists(): socket_path.unlink()
    server = Server(str(socket_path), Handler); os.chmod(socket_path, 0o600)
    return server


def main():
    from xps_update_runtime import Runtime, load_config
    config = load_config(); runtime = Runtime(config)
    STATE_ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    def active(identifier):
        state=subprocess.check_output(['systemctl','show','--property=ActiveState','--value',
            f'xps-umbrel-update@{identifier}.service'],text=True,stderr=subprocess.DEVNULL).strip()
        return state in ('active','activating','reloading','deactivating')
    # A service restart must not invent success or relaunch an interrupted job.
    status_path = STATE_ROOT/'status.json'
    if status_path.exists():
        try:
            recover_status(STATE_ROOT,active)
        except (ValueError, KeyError, TypeError):
            write_status(status_path, dict(IDLE, phase='finished', outcome='interrupted', error='Invalid saved updater status; manual review required'))
    def fetch(): return fetch_release(config, runtime.current_version())
    def launch(identifier):
        subprocess.run(['systemctl', 'start', '--no-block', f'xps-umbrel-update@{identifier}.service'], check=True)
    with create_server('/run/xps-umbrel-updater/control.sock', STATE_ROOT, fetch, launch, active) as server:
        server.serve_forever()


if __name__ == '__main__': main()
