"""Fixed host operations; no operation is selected by an HTTP request."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import time

from xps_update_backup import create_snapshot, restore_snapshot, source_size, verify_snapshot, digest, fsync_directory

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


def execute(args, timeout=120):
    return subprocess.check_output(args, text=True, stderr=subprocess.PIPE, timeout=timeout).strip()


class Runtime:
    def __init__(self, config):
        self.config = dict(config); self.running = []; self.stopped = []; self.old_env = None
        self.apps = []; self.storage = []; self.identity = {}; self.managed_running = []

    def current_version(self):
        return execute(['docker', 'exec', 'umbrel', 'node', '-p',
                        'JSON.parse(require("fs").readFileSync("/opt/umbreld/package.json")).version'])

    def client(self, operation, app_id=None):
        args=['docker','exec','umbrel','umbreld','client',operation]
        if app_id is not None: args += ['--appId',app_id]
        return json.loads(execute(args, timeout=900))

    def app_inventory(self):
        rows=self.client('apps.list.query')
        if not isinstance(rows,list): raise ValueError('Invalid installed app inventory')
        # Full API rows include credentials. Retain only lifecycle/storage fields.
        return [{k:row.get(k) for k in ('id','state','port','path','storage')} for row in rows]

    def installed_ids(self):
        script="const fs=require('fs'),yaml=require('js-yaml');console.log(JSON.stringify(yaml.load(fs.readFileSync('/home/umbrel/umbrel/umbrel.yaml','utf8')).apps ?? []))"
        ids=json.loads(execute(['docker','exec','-w','/opt/umbreld','umbrel','node','-e',script]))
        if not isinstance(ids,list) or any(not isinstance(i,str) for i in ids) or len(set(ids))!=len(ids):
            raise ValueError('Invalid persisted installed-app inventory')
        return ids

    def container_inventory(self):
        ids=execute(['docker','exec','umbrel','docker','ps','-aq']).split()
        return json.loads(execute(['docker','exec','umbrel','docker','inspect',*ids])) if ids else []

    def storage_inventory(self):
        raw=json.loads(execute(['docker','exec','umbrel','findmnt','--json','-o','TARGET,SOURCE,FSTYPE,UUID']))
        extra=getattr(self,'outer_storage_targets',[])
        def flatten(rows):
            for row in rows:
                if row['target'] in ('/data','/home','/var/lib/docker') or row['target'] in extra or row['target'].startswith(('/home/','/var/lib/docker/volumes/')):
                    yield {k:row.get(k) for k in ('target','source','fstype','uuid')}
                yield from flatten(row.get('children',[]))
        return list(flatten(raw['filesystems']))

    def persistent_path(self, path):
        # Resolve in the container namespace: a host-side resolve would interpret
        # absolute symlinks against the host's /home instead of persistent /home.
        path=str(path)
        if path.startswith('/Home/'):
            path='/home/umbrel/umbrel/home/'+path[len('/Home/'):]
        parts=Path(path).parts
        if '..' in parts: raise ValueError('Invalid storage path')
        if path.startswith('/home/umbrel/umbrel/external/'):
            raise ValueError('External writable app data requires a dedicated backup policy')
        if path.startswith('/home/'):
            rel=Path('umbrel-os')/path.lstrip('/')
        elif path.startswith('/var/lib/docker/volumes/'):
            rel=Path('umbrel-os')/path.lstrip('/')
        else: raise ValueError('Unconfigured writable app storage')
        source=Path(self.config['dataDirectory'])
        target=source/rel
        if not target.exists() or target.is_symlink() or not target.resolve().is_relative_to(source):
            raise ValueError('Missing or redirected app data')
        # A filesystem nested below /home is not contained in a volume archive.
        for mount in self.storage:
            if (path == mount['target'] or path.startswith(mount['target']+'/')) and mount['target'] not in ('/home','/var/lib/docker','/data'):
                raise ValueError('Nested writable mount requires a dedicated backup policy')
        return str(rel)

    def preflight(self, release):
        self.release=release
        info=json.loads(execute(['docker','inspect','umbrel']))[0]
        mounts=[m for m in info['Mounts'] if m['Destination']=='/data' and m['Type']=='volume']
        if len(mounts)!=1: raise ValueError('Unknown persistent data layout')
        for m in info['Mounts']:
            if m['Destination']!='/data' and m.get('RW') and m['Type'] in ('volume','bind'):
                raise ValueError('Additional writable outer storage requires backup configuration')
        self.outer_storage_targets=[m['Destination'] for m in info['Mounts'] if m['Destination']!='/data' and m['Type']=='bind' and not m['Destination'].startswith('/run/xps-umbrel-updater')]
        source=Path(mounts[0]['Source']).resolve(strict=True)
        self.config['dataDirectory']=str(source)
        self.old_env=ENV_FILE.read_text(); self.old_image=info['Config']['Image']
        self.old_version=self.current_version()
        if '@sha256:' not in self.old_image: raise ValueError('Previous image is not digest pinned')
        self.storage=self.storage_inventory()
        apps=self.app_inventory()
        if {a['id'] for a in apps} != set(self.installed_ids()):
            raise ValueError('Installed apps have not finished registering')
        if any(a.get('state') not in ('ready','stopped') for a in apps): raise ValueError('Wait for stable installed app states')
        home=Path('umbrel-os/home/umbrel/umbrel')
        if not (source/home/'app-data').is_dir(): raise ValueError('Unknown app data layout')
        excluded={'home','external','network','thumbnails','file-index'}
        if any(p.is_symlink() for p in (source/home).iterdir() if p.name not in excluded):
            raise ValueError('Redirected top-level state requires a dedicated backup policy')
        paths=[str(home/p.name) for p in (source/home).iterdir() if p.name not in excluded and not p.is_symlink()]
        paths += [p for p in ('ssh','umbrel-os/var/lib/docker/volumes') if (source/p).exists()]
        # Include configured storage even for stopped apps with no containers.
        for app in apps:
            storage=app.get('storage') or {}
            location=(storage.get('dataRoot') or {}).get('location')
            if location: paths.append(self.persistent_path(location))
            if storage.get('missingSourcePaths'): raise ValueError('An app storage source is unavailable')
            for folder in storage.get('folderAccess',[]):
                location=folder.get('sourcePath') or folder.get('defaultSourcePath')
                if location and any(not m.get('readOnly',False) for m in folder.get('mounts',[])):
                    paths.append(self.persistent_path(location))
            for mount in storage.get('customMounts',[]):
                if not mount.get('readOnly',False): paths.append(self.persistent_path(mount['sourcePath']))
        self.containers=self.container_inventory()
        # The effective Docker mounts catch legacy/custom Compose bindings too.
        for container in self.containers:
            for mount in container.get('Mounts',[]):
                if mount.get('RW') and mount['Type'] in ('bind','volume'):
                    paths.append(self.persistent_path(mount['Source']))
        # Never archive only a symlink while silently omitting its mutable target.
        for root,dirs,files in os.walk(source/home/'app-data',followlinks=False):
            for name in dirs+files:
                link=Path(root)/name
                if link.is_symlink():
                    target=os.readlink(link)
                    # App images contain binary links and browser lock/socket
                    # links. They have no persistent target bytes to archive.
                    if Path(target).is_absolute() and Path(target).parts[1] in ('usr','bin','sbin','lib','lib64','tmp','run','proc','dev'):
                        continue
                    if not Path(target).is_absolute():
                        resolved=(link.parent/target).resolve()
                        if not resolved.exists(): continue
                        if not resolved.is_relative_to(source/'umbrel-os'):
                            raise ValueError('App data link escapes persistent volume')
                        paths.append(self.persistent_path('/'+str(resolved.relative_to(source/'umbrel-os'))))
                        continue
                    container_path='/'+str(link.relative_to(source/'umbrel-os'))
                    resolved=execute(['docker','exec','umbrel','readlink','-f','--',container_path])
                    paths.append(self.persistent_path(resolved))
        paths=sorted(set(paths),key=lambda p:(len(Path(p).parts),p))
        selected=[]
        for path in paths:
            if not any(Path(p)==Path(path) or Path(p) in Path(path).parents for p in selected): selected.append(path)
        self.config['snapshotPaths']=selected if release['dataCompatibility']=='no-migration' else ['.']
        self.apps=[{k:a.get(k) for k in ('id','state','port','path')} for a in apps]
        self.identity={str(p):digest(p) for p in [source/home/'db/umbrel-seed/seed'] if p.is_file()}
        size=sum(source_size(source/p) for p in self.config['snapshotPaths'])
        backup=Path(self.config['backupRoot']).resolve();backup.mkdir(parents=True,exist_ok=True,mode=0o700)
        reserve=(size*11+9)//10
        same_disk=backup.stat().st_dev==source.stat().st_dev
        if shutil.disk_usage(backup).free<reserve or shutil.disk_usage(source).free<reserve*(2 if same_disk else 1):
            raise OSError('Insufficient space for snapshot and non-destructive restore')
        for app in self.apps:
            if app['state']=='ready': self.probe_app(app)

    def pull(self, release):
        execute(['docker', 'pull', release['image']], timeout=1800)
        image = json.loads(execute(['docker', 'image', 'inspect', release['image']]))[0]
        labels = image['Config'].get('Labels') or {}
        if image['Architecture'] != 'amd64' or labels.get('org.opencontainers.image.revision') != release['sourceCommit'] or labels.get('org.opencontainers.image.version') != release['version']:
            raise ValueError('Image identity does not match approved release')

    def pause(self):
        # Pulling may take minutes; refresh inventory before the first stop.
        self.preflight(self.release)
        installed={a['id'] for a in self.apps}
        self.running=[];self.stopped=[];self.managed_running=[]
        for c in self.containers:
            name=c['Name'].lstrip('/')
            project=(c.get('Config',{}).get('Labels') or {}).get('com.docker.compose.project')
            if project in installed:
                if c['State']['Running']:self.managed_running.append(name)
            elif project!='umbrel':
                (self.running if c['State']['Running'] else self.stopped).append(name)
        execute(['docker','stop','--time','300','umbrel'],timeout=330)
        source=Path(self.config['dataDirectory'])
        paths=self.config['snapshotPaths']
        absent=[]
        for p in list(paths):
            if p.endswith(('.db','.sqlite','.sqlite3')) and (source/p).is_file():
                for suffix in ('-wal','-shm'):
                    if p+suffix not in paths:
                        if (source/(p+suffix)).exists(): paths.append(p+suffix)
                        else: absent.append(p+suffix)
        for p in paths:
            if p.endswith(('-wal','-shm')) and p[:-4] in paths and not (source/p).exists(): absent.append(p)
        # SQLite normally removes WAL/SHM on clean shutdown. Preserve absence
        # too, so a candidate's stale sidecar cannot attach to a restored DB.
        self.config['snapshotPaths']=[p for p in paths if p not in absent]
        self.config['absentPaths']=sorted(set(absent))

    def snapshot(self):
        snapshot = create_snapshot(self.config)
        snapshot.update(oldEnv=self.old_env, oldImage=self.old_image, oldVersion=self.old_version, apps=self.apps, storage=self.storage, identity=self.identity, running=self.running, stopped=self.stopped, managedRunning=self.managed_running)
        from xps_update_worker import write_status
        write_status(Path(self.config['backupRoot'])/(Path(snapshot['archive']).stem+'.json'), snapshot)
        return snapshot

    def verify_snapshot(self, snapshot):
        verify_snapshot(snapshot)

    def compose(self, image):
        candidate = ENV_FILE.with_name('umbrel-update-candidate.env')
        lines = [l for l in self.old_env.splitlines() if not l.startswith('XPS_UMBREL_IMAGE=')]
        # Serialize env as text, never source it in a shell.
        fd = os.open(candidate, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, 'w') as f:
            f.write('\n'.join(lines)+'\nXPS_UMBREL_IMAGE='+image+'\n'); f.flush(); os.fsync(f.fileno())
        execute(['docker', 'compose', '--project-name', 'xps-homeserver', '--env-file', str(candidate),
                 '-f', str(PROJECT_ROOT/'deploy/compose.yaml'), 'up', '--detach', '--remove-orphans'],timeout=900)
        self.wait_healthy()
        os.replace(candidate, ENV_FILE); fsync_directory(ENV_FILE.parent)

    def switch(self, release): self.compose(release['image'])

    def wait_healthy(self):
        deadline = time.monotonic()+900
        while time.monotonic() < deadline:
            status = execute(['docker', 'inspect', '--format', '{{.State.Health.Status}}', 'umbrel'])
            if status == 'healthy': return
            if status == 'unhealthy': raise RuntimeError('Container is unhealthy')
            time.sleep(5)
        raise TimeoutError('Container readiness timeout')

    def wait_for(self, check, description, timeout=600):
        deadline=time.monotonic()+timeout
        while time.monotonic()<deadline:
            try:
                if check(): return
            except (subprocess.SubprocessError, OSError, ValueError, KeyError, RuntimeError): pass
            time.sleep(3)
        raise TimeoutError(description)

    def resume(self):
        execute(['docker','start','umbrel']); self.wait_healthy()
        expected={a['id'] for a in self.apps}
        self.wait_for(lambda: expected.issubset({a['id'] for a in self.app_inventory()}),'Installed apps did not register')
        for app in self.apps:
            def state(): return self.client('apps.state.query',app['id'])['state']
            self.wait_for(lambda: state() in ('ready','stopped','unknown'),'App startup did not settle')
            wanted=app['state']
            if state()!=wanted:
                self.client('apps.start.mutate' if wanted=='ready' else 'apps.stop.mutate',app['id'])
            self.wait_for(lambda: state()==wanted,'App state did not recover')
        # Installed app containers are recreated by Umbrel, never docker-started
        # by their old names. Only unmanaged containers use Docker lifecycle here.
        if self.running: execute(['docker','exec','umbrel','docker','start',*self.running])
        if self.stopped: execute(['docker','exec','umbrel','docker','stop',*self.stopped])

    def probe_app(self, app):
        port=app.get('port')
        if port is None: return
        if type(port) is not int or not 1<=port<=65535: raise ValueError('Invalid app endpoint')
        path=app.get('path') or '/'
        if not path.startswith('/'): path='/'+path
        url=f'http://127.0.0.1:{port}{path}'
        # Check through the published host port, including authentication/redirect
        # responses, while rejecting connection failures and server errors.
        code=execute(['curl','--silent','--output','/dev/null','--write-out','%{http_code}','--max-time','10',url])
        if not code.isdigit() or not 200<=int(code)<500: raise RuntimeError('Published app endpoint unavailable')

    def verify_storage_and_identity(self):
        current={m['target']:m for m in self.storage_inventory()}
        if any(current.get(m['target'])!=m for m in self.storage): raise RuntimeError('Persistent or USB mount identity changed')
        if any(not Path(p).is_file() or digest(p)!=checksum for p,checksum in self.identity.items()):
            raise RuntimeError('Installation data identity changed')
        source=self.config.get('dataDirectory')
        if source and any(not (Path(source)/p).exists() for p in self.config['snapshotPaths'] if not p.endswith(('-wal','-shm'))):
            raise RuntimeError('A selected persistent data root is missing')

    def verify_services(self):
        self.resume(); self.verify_storage_and_identity()
        for name in self.running+self.managed_running:
            def healthy():
                c=json.loads(execute(['docker','exec','umbrel','docker','inspect',name]))[0]
                return c['State']['Running'] and c['State'].get('Health',{}).get('Status','healthy')=='healthy'
            self.wait_for(healthy,'Previously active container did not recover')
        for app in self.apps:
            if app['state']=='ready': self.wait_for(lambda: (self.probe_app(app) is None),'Published app endpoint did not recover')
        execute(['docker','exec','umbrel','curl','--fail','--silent','--output','/dev/null','http://localhost'])

    def verify(self, release):
        self.verify_services()
        if self.current_version()!=release['version']: raise ValueError('Version mismatch')

    def verify_previous(self):
        self.verify_services()
        if hasattr(self,'old_version') and self.current_version()!=self.old_version: raise ValueError('Previous version mismatch')

    def rollback(self, snapshot):
        execute(['docker','stop','--time','300','umbrel'],timeout=330)
        if snapshot['source']!=self.config['dataDirectory']: raise ValueError('Unexpected snapshot source')
        restore_snapshot(snapshot)
        self.old_env=snapshot['oldEnv'];self.compose(snapshot['oldImage'])
