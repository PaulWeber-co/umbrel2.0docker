import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from contextlib import ExitStack
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from xps_update_runtime import Runtime
from test_update_release import manifest


class StorageInventoryTests(unittest.TestCase):
    def test_nested_network_storage_is_never_hidden(self):
        row=dict(target='/home/umbrel/umbrel/network/NAS',source='nas:/share',fstype='nfs4',uuid=None)
        with patch('xps_update_runtime.execute',return_value=json.dumps({'filesystems':[row]})):
            self.assertEqual(Runtime({}).storage_inventory(),[row])


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp()); self.data = self.root/'volume'; self.data.mkdir()
        home = self.data/'umbrel-os/home/umbrel/umbrel'; (home/'app-data').mkdir(parents=True)
        (home/'app-data/database').write_bytes(b'important')
        (home/'home').mkdir(); (home/'home/photo').write_bytes(b'media')
        self.env = self.root/'umbrel.env'; self.env.write_text('XPS_UMBREL_IMAGE='+manifest()['image']+'\n')
        self.stack = ExitStack(); self.addCleanup(self.stack.close)
        for method, value in [('app_inventory',[]),('container_inventory',[]),('storage_inventory',[]),('installed_ids',[])]:
            self.stack.enter_context(patch.object(Runtime, method, return_value=value, create=True))
        self.info = dict(Config={'Image':manifest()['image']}, Mounts=[dict(Source=str(self.data),Destination='/data',Type='volume', RW=True)])

    def test_no_migration_snapshot_preserves_app_state_without_selecting_media(self):
        with patch('xps_update_runtime.ENV_FILE', self.env), patch('xps_update_runtime.execute', return_value=json.dumps([self.info])):
            runtime = Runtime({'backupRoot':str(self.root/'backup')}); runtime.preflight(manifest())
        self.assertIn('umbrel-os/home/umbrel/umbrel/app-data', runtime.config['snapshotPaths'])
        self.assertNotIn('umbrel-os/home/umbrel/umbrel/home', runtime.config['snapshotPaths'])

    def test_migration_requires_complete_snapshot(self):
        m = manifest(); m['dataCompatibility'] = 'snapshot-required'
        with patch('xps_update_runtime.ENV_FILE', self.env), patch('xps_update_runtime.execute', return_value=json.dumps([self.info])):
            runtime = Runtime({'backupRoot':str(self.root/'backup')}); runtime.preflight(m)
        self.assertEqual(runtime.config['snapshotPaths'], ['.'])

    def test_unknown_volume_layout_is_rejected(self):
        self.info['Mounts'].append(dict(Source='/other', Destination='/persistent',Type='volume',RW=True))
        with patch('xps_update_runtime.ENV_FILE', self.env), patch('xps_update_runtime.execute', return_value=json.dumps([self.info])):
            with self.assertRaises(ValueError): Runtime({'backupRoot':str(self.root/'backup')}).preflight(manifest())

    def test_image_identity_must_match_release(self):
        result = json.dumps([dict(Architecture='arm64',Config={'Labels':{}})])
        with patch('xps_update_runtime.execute', return_value=result):
            with self.assertRaises(ValueError): Runtime({}).pull(manifest())

    def test_prior_app_names_and_stopped_state_are_preserved(self):
        rows = [dict(Name=name,State={'Running':state},Config={'Labels':{}}) for name,state in [('music',True),('old',False)]]
        runtime = Runtime({'dataDirectory':str(self.data),'snapshotPaths':['umbrel-os/home/umbrel/umbrel/app-data']}); runtime.release=manifest();runtime.containers=rows
        with patch.object(runtime,'preflight'), patch('xps_update_runtime.execute',return_value='') as command:
            runtime.pause()
        self.assertEqual(runtime.running,['music']); self.assertEqual(runtime.stopped,['old'])
        self.assertEqual(command.call_args.args[0], ['docker','stop','--time','300','umbrel'])

    def test_writable_home_mount_is_included(self):
        downloads=self.data/'umbrel-os/home/umbrel/umbrel/home/Downloads'; downloads.mkdir()
        rows=[{'Name':'/music','Config':{'Labels':{}},'State':{'Running':True},'Mounts':[{'RW':True,'Type':'bind','Source':'/home/umbrel/umbrel/home/Downloads'}]}]
        with patch.object(Runtime,'container_inventory',return_value=rows), patch('xps_update_runtime.ENV_FILE',self.env), patch('xps_update_runtime.execute',return_value=json.dumps([self.info])):
            runtime=Runtime({'backupRoot':str(self.root/'backup')}); runtime.preflight(manifest())
        self.assertIn('umbrel-os/home/umbrel/umbrel/home/Downloads',runtime.config['snapshotPaths'])

    def test_external_writable_mount_or_managed_root_is_rejected(self):
        variants=[([{'Name':'/db','State':{'Running':True},'Config':{'Labels':{}},'Mounts':[{'RW':True,'Type':'bind','Source':'/home/umbrel/umbrel/external/USB/database'}]}],[]),
                  ([],[{'id':'db','state':'stopped','storage':{'dataRoot':{'location':'/External/USB/database'}}}])]
        for containers,apps in variants:
            with self.subTest(apps=apps), patch.object(Runtime,'installed_ids',return_value=[a['id'] for a in apps]), patch.object(Runtime,'container_inventory',return_value=containers), patch.object(Runtime,'app_inventory',return_value=apps), patch('xps_update_runtime.ENV_FILE',self.env), patch('xps_update_runtime.execute',return_value=json.dumps([self.info])):
                with self.assertRaises(ValueError): Runtime({'backupRoot':str(self.root/'backup')}).preflight(manifest())

    def test_symlink_to_uncovered_app_state_is_rejected(self):
        home=self.data/'umbrel-os/home/umbrel/umbrel'
        (home/'app-data/link').symlink_to('/mnt/external-database',target_is_directory=True)
        with patch('xps_update_runtime.ENV_FILE',self.env),patch('xps_update_runtime.execute',return_value=json.dumps([self.info])):
            with self.assertRaises(ValueError): Runtime({'backupRoot':str(self.root/'backup')}).preflight(manifest())

    def test_initial_empty_api_list_is_not_mistaken_for_no_installed_apps(self):
        with patch.object(Runtime,'installed_ids',return_value=['music']),patch('xps_update_runtime.ENV_FILE',self.env),patch('xps_update_runtime.execute',return_value=json.dumps([self.info])):
            with self.assertRaises(ValueError): Runtime({'backupRoot':str(self.root/'backup')}).preflight(manifest())

    def test_missing_storage_or_changed_identity_fails_verification(self):
        runtime=Runtime({});runtime.storage=[{'target':'/usb','source':'/dev/test','fstype':'exfat','uuid':'test'}]
        with self.assertRaises(RuntimeError):runtime.verify_storage_and_identity()
        identity=self.root/'seed'; identity.write_text('new')
        runtime.storage=[]; runtime.identity={str(identity):'old-hash'}
        with self.assertRaises(RuntimeError):runtime.verify_storage_and_identity()

    def test_installed_apps_wait_for_registration_and_use_app_api(self):
        runtime=Runtime({});runtime.apps=[{'id':'music','state':'ready','port':None,'path':''}]
        runtime.app_inventory=lambda: [] if not getattr(runtime,'polled',False) else [{'id':'music','state':'stopped'}]
        calls=[]
        runtime.app_state='stopped'
        def client(operation, app_id=None):
            calls.append(operation)
            if operation=='apps.state.query':return {'state':runtime.app_state}
            if operation=='apps.start.mutate':runtime.app_state='ready'
            runtime.polled=True
        runtime.client=client
        with patch('xps_update_runtime.time.sleep',side_effect=lambda _:setattr(runtime,'polled',True)),patch('xps_update_runtime.execute',return_value=''),patch.object(runtime,'wait_healthy'):
            runtime.resume()
        self.assertIn('apps.start.mutate',calls)
