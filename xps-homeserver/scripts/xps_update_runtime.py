"""Fixed host operations; no operation is selected by an HTTP request."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import time

from xps_update_backup import create_snapshot, restore_snapshot, source_size

CONFIG_PATH = Path('/etc/xps-homeserver/updater.json')
PROJECT_ROOT = Path('/opt/xps-homeserver/xps-homeserver')
ENV_FILE = Path('/etc/xps-homeserver/umbrel.env')


def load_config():
    st = CONFIG_PATH.lstat()
    if CONFIG_PATH.is_symlink() or st.st_uid != 0 or st.st_mode & 0o077:
        raise ValueError('Updater configuration must be root-owned and private')
    config = json.loads(CONFIG_PATH.read_text())
    if set(config) != {'backupRoot'} or not Path(config['backupRoot']).is_absolute():
        raise ValueError('Invalid updater configuration')
    return config


def execute(args):
    return subprocess.check_output(args, text=True, stderr=subprocess.PIPE).strip()


class Runtime:
    def __init__(self, config):
        self.config = dict(config); self.running = []; self.stopped = []; self.old_env = None

    def current_version(self):
        return execute(['docker', 'exec', 'umbrel', 'node', '-p',
                        'JSON.parse(require("fs").readFileSync("/opt/umbreld/package.json")).version'])

    def preflight(self, release):
        info = json.loads(execute(['docker', 'inspect', 'umbrel']))[0]
        mounts = [m for m in info['Mounts'] if m['Destination'] == '/data' and m['Type'] == 'volume']
        if len(mounts) != 1: raise ValueError('Unknown persistent data layout')
        source = Path(mounts[0]['Source']).resolve(strict=True)
        self.config['dataDirectory'] = str(source)
        if release['dataCompatibility'] == 'no-migration':
            home = Path('umbrel-os/home/umbrel/umbrel')
            if not (source/home/'app-data').is_dir(): raise ValueError('Unknown app data layout')
            excluded = {'home', 'external', 'thumbnails', 'file-index'}
            paths = [str(home/p.name) for p in (source/home).iterdir() if p.name not in excluded and not p.is_symlink()]
            paths += [p for p in ['ssh', 'umbrel-os/var/lib/docker/volumes'] if (source/p).exists()]
            self.config['snapshotPaths'] = paths
        else:
            self.config['snapshotPaths'] = ['.']
        size = sum(source_size(source/p) for p in self.config['snapshotPaths'])
        backup = Path(self.config['backupRoot']).resolve(); backup.mkdir(parents=True, exist_ok=True, mode=0o700)
        reserve = (size*11+9)//10
        same_disk = backup.stat().st_dev == source.stat().st_dev
        if shutil.disk_usage(backup).free < reserve or shutil.disk_usage(source).free < reserve*(2 if same_disk else 1):
            raise OSError('Insufficient space for snapshot and non-destructive restore')
        self.old_env = ENV_FILE.read_text()
        self.old_image = info['Config']['Image']
        if '@sha256:' not in self.old_image: raise ValueError('Previous image is not digest pinned')
        # Unexpected separate persistent volumes must be handled explicitly, not silently omitted.
        for m in info['Mounts']:
            if m['Destination'] != '/data' and m.get('RW') and m['Type'] == 'volume':
                raise ValueError('Additional persistent volume requires backup configuration')

    def pull(self, release):
        execute(['docker', 'pull', release['image']])
        image = json.loads(execute(['docker', 'image', 'inspect', release['image']]))[0]
        labels = image['Config'].get('Labels') or {}
        if image['Architecture'] != 'amd64' or labels.get('org.opencontainers.image.revision') != release['sourceCommit'] or labels.get('org.opencontainers.image.version') != release['version']:
            raise ValueError('Image identity does not match approved release')

    def pause(self):
        raw = execute(['docker', 'exec', 'umbrel', 'docker', 'ps', '-a', '--format', 'json'])
        containers = [json.loads(line) for line in raw.splitlines() if line]
        self.running = [c['Names'] for c in containers if c['State'] == 'running']
        self.stopped = [c['Names'] for c in containers if c['State'] != 'running']
        execute(['docker', 'stop', '--time', '300', 'umbrel'])

    def snapshot(self):
        snapshot = create_snapshot(self.config)
        snapshot.update(oldEnv=self.old_env, oldImage=self.old_image)
        from xps_update_worker import write_status
        write_status(Path(self.config['backupRoot'])/(Path(snapshot['archive']).stem+'.json'), snapshot)
        return snapshot

    def compose(self, image):
        candidate = ENV_FILE.with_name('umbrel-update-candidate.env')
        lines = [l for l in self.old_env.splitlines() if not l.startswith('XPS_UMBREL_IMAGE=')]
        # Serialize env as text, never source it in a shell.
        fd = os.open(candidate, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, 'w') as f:
            f.write('\n'.join(lines)+'\nXPS_UMBREL_IMAGE='+image+'\n'); f.flush(); os.fsync(f.fileno())
        execute(['docker', 'compose', '--project-name', 'xps-homeserver', '--env-file', str(candidate),
                 '-f', str(PROJECT_ROOT/'deploy/compose.yaml'), 'up', '--detach', '--remove-orphans'])
        self.wait_healthy()
        os.replace(candidate, ENV_FILE)

    def switch(self, release): self.compose(release['image'])

    def wait_healthy(self):
        deadline = time.monotonic()+900
        while time.monotonic() < deadline:
            status = execute(['docker', 'inspect', '--format', '{{.State.Health.Status}}', 'umbrel'])
            if status == 'healthy': return
            if status == 'unhealthy': raise RuntimeError('Container is unhealthy')
            time.sleep(5)
        raise TimeoutError('Container readiness timeout')

    def resume(self):
        execute(['docker', 'start', 'umbrel']); self.wait_healthy()
        if self.running: execute(['docker', 'exec', 'umbrel', 'docker', 'start', *self.running])
        if self.stopped: execute(['docker', 'exec', 'umbrel', 'docker', 'stop', *self.stopped])

    def verify(self, release):
        self.resume()
        if self.current_version() != release['version']: raise ValueError('Version mismatch')
        for name in self.running:
            if execute(['docker', 'exec', 'umbrel', 'docker', 'inspect', '--format', '{{.State.Running}}', name]) != 'true':
                raise RuntimeError('Previously active app did not restart')
        execute(['docker', 'exec', 'umbrel', 'curl', '--fail', '--silent', '--output', '/dev/null', 'http://localhost'])

    def rollback(self, snapshot):
        execute(['docker', 'stop', '--time', '300', 'umbrel'])
        if snapshot['source'] != self.config['dataDirectory']: raise ValueError('Unexpected snapshot source')
        restore_snapshot(snapshot)
        self.old_env = snapshot['oldEnv']; self.compose(snapshot['oldImage'])
