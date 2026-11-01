"""Real nested Docker/systemd lifecycle in the disposable host from smoke.sh.

The release fetch is a fixed candidate fixture; all installation operations use
the production socket handler, systemd worker, snapshot and Docker runtime.
"""
import json
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import threading
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from xps_update_cli import send_request
from xps_update_release import validate_release
from xps_update_runtime import Runtime, execute, ENV_FILE, PROJECT_ROOT
from xps_update_service import create_server

BASELINE = 'ghcr.io/paulweber-co/xps-homeserver-umbrelos@sha256:da71b430226e3e2fb4cba5b19d86c66a52ea5ad6990bb179f353225885dabe82'
SOCKET = '/run/xps-umbrel-updater/control.sock'
STATE = Path('/var/lib/xps-umbrel-updater')


def wait_for(check, description, timeout=900):
    deadline = time.monotonic()+timeout
    while time.monotonic() < deadline:
        try:
            result = check()
            if result: return result
        except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError): pass
        time.sleep(2)
    raise TimeoutError(description)


def compose(image):
    ENV_FILE.parent.mkdir(parents=True, exist_ok=True)
    ENV_FILE.write_text('XPS_UMBREL_IMAGE='+image+'\n'); ENV_FILE.chmod(0o600)
    execute(['docker','compose','--project-name','xps-homeserver','--env-file',str(ENV_FILE),
             '-f',str(PROJECT_ROOT/'deploy/compose.yaml'),'up','--detach','--remove-orphans'])
    Runtime({}).wait_healthy()


def fixture_api(release):
    def fetch():
        return dict(available=True, version=release['version'], name='Candidate', releaseNotes='Test fixture',
                    digest=release['image'], upstreamVersion=release['version'], pendingUpstream=False, manifest=release)
    def launch(identifier):
        subprocess.run(['systemctl','start','--no-block',f'xps-umbrel-update@{identifier}.service'],check=True)
    server = create_server(SOCKET, STATE, fetch, launch)
    thread = threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    return server, thread


def await_job(identifier):
    def done():
        status = send_request(SOCKET,'GET','/v1/status')
        assert status['jobId'] == identifier
        return status if status['phase']=='finished' else None
    return wait_for(done,'Update job did not finish',1800)


def assert_apps_and_data(volume):
    assert (volume/'umbrel-os/home/umbrel/umbrel/.xps-update-validation/state.json').read_text() == 'original-state'
    assert execute(['docker','exec','umbrel','docker','inspect','--format','{{.State.Running}}','xps-update-active']) == 'true'
    assert execute(['docker','exec','umbrel','docker','inspect','--format','{{.State.Running}}','xps-update-stopped']) == 'false'
    assert execute(['docker','exec','umbrel','curl','--fail','--silent','http://127.0.0.1:18080'])=='xps-app-healthy'
    wait_for(lambda: execute(['curl','--fail','--silent','http://127.0.0.1:18080'])=='xps-app-healthy',
             'Published app port did not recover',120)


def probe_api(expected_version):
    source = (PROJECT_ROOT/'scripts/tests/container_api_probe.mjs').read_text()
    result = subprocess.run(['docker','exec','-i','-w','/opt/umbreld','-e','EXPECTED_VERSION='+expected_version,
                             'umbrel','node','--input-type=module'],input=source,text=True,capture_output=True)
    if result.returncode:
        # Test credentials are synthetic; never use this helper on a real owner account.
        raise RuntimeError('Disposable API validation failed: '+result.stderr[-2000:])
    print(result.stdout,flush=True)


def probe_heic():
    image='/source/packages/umbreld/source/modules/files/fixtures/thumbnails/apple-encoded-image.heic'
    execute(['docker','cp',image,'umbrel:/tmp/xps-test.heic'])
    execute(['docker','exec','umbrel','convert','/tmp/xps-test.heic','-thumbnail','128x128','/tmp/xps-test.jpg'])
    execute(['docker','exec','umbrel','sh','-c','printf invalid > /tmp/xps-invalid.heic'])
    result=subprocess.run(['docker','exec','umbrel','convert','/tmp/xps-invalid.heic','/tmp/xps-invalid.jpg'],capture_output=True)
    assert result.returncode==1,'Malformed HEIC did not fail cleanly'


def create_usb_fixture():
    image=Path('/var/tmp/xps-validation-usb.img')
    with image.open('xb') as stream: stream.truncate(64*1024*1024)
    device=execute(['losetup','--find','--show',str(image)])
    # Never format an arbitrary discovered drive: prove this exact file backs it.
    backing=execute(['losetup','--noheadings','--output','BACK-FILE',device])
    assert Path(backing).resolve()==image.resolve()
    execute(['mkfs.exfat','-L','XPS_TEST',device])
    root=Path('/mnt/xps-validation-usb');root.mkdir()
    execute(['mount','-t','exfat',device,str(root)])
    execute(['losetup','--detach',device])  # autoclear when the last test mount disappears
    (root/'Musik').mkdir()
    files={'Musik/Excuse Me.mp3':b'first-track-fixture','Musik/Entropy.mp3':b'last-track-fixture',
           'Musik/lyrics.lrc':b'[00:01.00] Test', 'Musik/Playlist.m3u':b'#EXTM3U\nExcuse Me.mp3\nEntropy.mp3\n'}
    for name,data in files.items(): (root/name).write_bytes(data)
    return {name:hashlib.sha256(data).hexdigest() for name,data in files.items()}


def probe_usb(expected):
    for name,checksum in expected.items():
        actual=execute(['docker','exec','umbrel','sha256sum','/mnt/xps-validation-usb/'+name]).split()[0]
        assert actual==checksum, name


def install_lifecycle_apps(volume):
    # Genuine installed apps: Umbrel Compose-down removes their containers on
    # shutdown, and a delayed pre-start recreates them after web health is ready.
    execute(['docker','exec','umbrel','systemctl','stop','umbrel'],timeout=330)
    root=volume/'umbrel-os/home/umbrel/umbrel'
    for suffix,port,active in [('active',18081,True),('stopped',18082,False)]:
        app_id='xps-validation-'+suffix
        app=root/'app-data'/app_id; (app/'data').mkdir(parents=True)
        manifest=dict(manifestVersion=1,id=app_id,name='Lifecycle '+suffix,tagline='Disposable validation',
            category='Development',version='1.0.0',port=port,path='',description='Disposable validation app',
            developer='XPS validation',website='https://example.org',submitter='XPS validation',
            submission='https://example.org',repo='https://example.org',support='https://example.org',
            gallery=[],releaseNotes='Fixture',dependencies=[])
        (app/'umbrel-app.yml').write_text(json.dumps(manifest))
        compose=dict(services={'server':dict(image='busybox:1.37',container_name=app_id+'_server_1',
            ports=[f'{port}:8080'],volumes=['${APP_DATA_DIR}/data:/fixture'],
            command=['sh','-c','mkdir -p /tmp/www; echo installed-app-healthy > /tmp/www/index.html; exec httpd -f -p 8080 -h /tmp/www'])})
        (app/'docker-compose.yml').write_text(json.dumps(compose))
        (app/'settings.yml').write_text(json.dumps(dict(autoStart=active)))
        (app/'data/marker').write_text('persistent-installed-app-data')
        (app/'hooks').mkdir(); hook=app/'hooks/pre-start'
        hook.write_text('#!/bin/sh\nsleep 20\n');hook.chmod(0o755)
    script="const fs=require('fs'),y=require('js-yaml');const p='/home/umbrel/umbrel/umbrel.yaml';const s=y.load(fs.readFileSync(p,'utf8'));s.apps=['xps-validation-active','xps-validation-stopped'];fs.writeFileSync(p,y.dump(s));"
    execute(['docker','exec','-w','/opt/umbreld','umbrel','node','-e',script])
    execute(['docker','exec','umbrel','systemctl','start','umbrel'],timeout=330)
    Runtime({}).wait_healthy()
    wait_for(lambda: {a['id']:a['state'] for a in Runtime({}).app_inventory()}=={'xps-validation-active':'ready','xps-validation-stopped':'stopped'},'Installed fixture apps did not start')
    wait_for(lambda: execute(['curl','--fail','--silent','http://127.0.0.1:18081'])=='installed-app-healthy','Installed fixture port not published')


def assert_installed_apps(volume):
    states={a['id']:a['state'] for a in Runtime({}).app_inventory()}
    assert states=={'xps-validation-active':'ready','xps-validation-stopped':'stopped'},states
    assert execute(['curl','--fail','--silent','http://127.0.0.1:18081'])=='installed-app-healthy'
    for suffix in ('active','stopped'):
        assert (volume/f'umbrel-os/home/umbrel/umbrel/app-data/xps-validation-{suffix}/data/marker').read_text()=='persistent-installed-app-data'


def assert_negative_checks(release):
    runtime=Runtime({'backupRoot':'/var/lib/xps-umbrel-updater/backups'});runtime.preflight(release)
    execute(['docker','exec','umbrel','docker','stop','xps-validation-active_server_1'])
    runtime.managed_running=['xps-validation-active_server_1']
    wait=runtime.wait_for
    runtime.wait_for=lambda check,description,timeout=600: wait(check,description,timeout=3)
    try:
        runtime.verify(release)
    except TimeoutError: pass
    else: raise AssertionError('Lost installed app container was accepted')
    runtime.client('apps.restart.mutate','xps-validation-active')
    execute(['docker','exec','umbrel','umount','/mnt/xps-validation-usb'])
    try: runtime.verify_storage_and_identity()
    except RuntimeError: pass
    else: raise AssertionError('Lost USB mount was accepted')


def main():
    if Path('/source').is_dir() or PROJECT_ROOT.is_dir():
        # Caller is the disposable host; the source mount is required proof of context.
        assert Path('/source/xps-homeserver').is_dir()
    else: raise RuntimeError('Disposable host context missing')
    candidate = os.environ['CANDIDATE']
    try: execute(['docker','pull',candidate],timeout=1800)
    except subprocess.CalledProcessError as error:
        # This disposable fixture contains no real user/registry credentials.
        raise RuntimeError('Disposable candidate pull failed: '+error.stderr[-2000:]) from error
    labels = json.loads(execute(['docker','image','inspect',candidate]))[0]['Config']['Labels']
    release = validate_release(dict(schemaVersion=1, version=labels['org.opencontainers.image.version'],
        platform='linux/amd64', image=candidate, sourceCommit=labels['org.opencontainers.image.revision'],
        releaseNotes='Isolated CI candidate', dataCompatibility='no-migration'))
    subprocess.run(['bash',str(PROJECT_ROOT/'scripts/install-updater.sh')],check=True)
    subprocess.run(['systemctl','stop','xps-umbrel-updater.service'],check=True)
    usb=create_usb_fixture()
    compose_file=PROJECT_ROOT/'deploy/compose.yaml'
    compose_file.write_text(compose_file.read_text().replace('- umbrel-data:/data',
        '- umbrel-data:/data\n      - /mnt/xps-validation-usb:/mnt/xps-validation-usb:ro'))
    execute(['docker','pull',BASELINE],timeout=1800); compose(BASELINE)
    probe_api('2.0.0');probe_usb(usb)
    execute(['docker','exec','umbrel','docker','run','-d','--name','xps-update-active','-p','18080:8080','busybox:1.37',
             'sh','-c','mkdir -p /tmp/www; echo xps-app-healthy > /tmp/www/index.html; exec httpd -f -p 8080 -h /tmp/www'])
    execute(['docker','exec','umbrel','docker','run','--name','xps-update-stopped','busybox:1.37','true'])
    # Locate /data by destination, never rely on Docker's mount order.
    volume = Path(next(m['Source'] for m in json.loads(execute(['docker','inspect','umbrel']))[0]['Mounts'] if m['Destination']=='/data'))
    fixture = volume/'umbrel-os/home/umbrel/umbrel/.xps-update-validation';fixture.mkdir(parents=True)
    (fixture/'state.json').write_text('original-state')
    home = volume/'umbrel-os/home/umbrel/umbrel/home';home.mkdir(parents=True,exist_ok=True)
    (home/'unrelated-media').write_text('media-original')
    install_lifecycle_apps(volume)
    server, thread = fixture_api(release)
    job = send_request(SOCKET,'POST','/v1/update')['jobId']
    assert send_request(SOCKET,'POST','/v1/update')['jobId'] == job
    # Disconnect/restart the HTTP service while the separate systemd worker continues.
    server.shutdown();server.server_close();thread.join()
    server,thread = fixture_api(release)
    result = await_job(job);assert result['outcome']=='succeeded',result
    assert Runtime({}).current_version() == release['version']
    probe_api(release['version']);probe_heic();probe_usb(usb)
    assert_apps_and_data(volume);assert_installed_apps(volume)
    assert (home/'unrelated-media').read_text() == 'media-original'
    execute(['docker','exec','umbrel','sh','-c','test -n "$XPS_UMBREL_UPDATER_SOCKET" || systemctl show umbrel -p Environment | grep XPS_UMBREL_UPDATER_SOCKET'])
    server.shutdown();server.server_close();thread.join()
    assert_negative_checks(release)
    # Reset the disposable installation to the old image for a real failed switch.
    compose(BASELINE)
    wait_for(lambda: all(a['state'] in ('ready','stopped') for a in Runtime({}).app_inventory()),'Baseline apps not ready')
    config_file = PROJECT_ROOT/'deploy/compose.yaml'; normal = config_file.read_text()
    # Only the candidate version is unhealthy; rollback's baseline retains its real healthcheck.
    old = 'systemctl is-active --quiet docker umbrel && curl --silent --fail --output /dev/null http://localhost'
    bad = "test $$(node -p 'require(\"/opt/umbreld/package.json\").version') != "+release['version']+' && '+old
    health = 'test: ["CMD-SHELL", '+json.dumps(old)+']'
    assert health in normal
    config_file.write_text(normal.replace(health,'test: ["CMD-SHELL", '+json.dumps(bad)+']').replace('interval: 30s','interval: 2s').replace('start_period: 5m','start_period: 0s'))
    server,thread = fixture_api(release)
    try:
        job = send_request(SOCKET,'POST','/v1/update')['jobId']
        def changed_image():
            actual=json.loads(execute(['docker','inspect','umbrel']))[0]['Config']['Image']
            return actual==candidate
        wait_for(changed_image,'Candidate never started')
        (fixture/'state.json').write_text('migration-during-failed-update')
        (home/'unrelated-media').write_text('media-new')
        result=await_job(job);assert result['outcome']=='rolled-back',result
        assert Runtime({}).current_version()=='2.0.0'
        probe_api('2.0.0')
        probe_usb(usb)
        assert_apps_and_data(volume);assert_installed_apps(volume)
        assert (home/'unrelated-media').read_text()=='media-new'
    finally:
        config_file.write_text(normal);server.shutdown();server.server_close();thread.join()
    print('PASS: real successful switch, durable reconnect, app states, snapshot restore, failed candidate rollback and unchanged media',flush=True)


if __name__ == '__main__': main()
