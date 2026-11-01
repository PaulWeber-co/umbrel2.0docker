"""Durable host-side update lifecycle, independent of the requesting container."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import subprocess
import tempfile
import uuid
import logging

from xps_update_release import validate_release

STATE_ROOT = Path('/var/lib/xps-umbrel-updater')


def write_status(path, status):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix='.status-')
    try:
        with os.fdopen(fd, 'w') as stream:
            os.fchmod(stream.fileno(), 0o600); json.dump(status, stream)
            stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try: os.fsync(directory)
        finally: os.close(directory)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)


def run_job(job, config, runner):
    release = validate_release(job['release'])
    status = dict(jobId=job.get('jobId'), version=release['version'], digest=release['image'],
                  phase='preflight', progress=0, error=False, outcome=None, safeToContinue=False, acknowledged=False)
    snapshot = None; switched = False; paused = False
    def publish(phase, progress):
        status.update(phase=phase, progress=progress)
        if config.get('statusFile'): write_status(config['statusFile'], status)
    try:
        publish('preflight', 0); runner.preflight(release)
        publish('pull', 10); runner.pull(release)
        paused = True; runner.pause()
        publish('backup', 30); snapshot = runner.snapshot()
        runner.verify_snapshot(snapshot)
        publish('switch', 60); switched = True; runner.switch(release)
        publish('verify', 80); runner.verify(release)
        paused = False
        status.update(outcome='succeeded')
    except Exception as error:
        logging.error('Update failed in stage %s (%s)', status['phase'], type(error).__name__)
        # Error strings deliberately omit subprocess output, environment and credentials.
        status.update(error='Update failed; check the root-only host journal', outcome='failed')
        if switched and snapshot is not None:
            status.update(error=False, outcome=None)
            publish('rollback', 85)
            try:
                runner.rollback(snapshot); runner.verify_previous()
                status.update(outcome='rolled-back', safeToContinue=True, error='Update failed; previous version and app state restored'); paused = False
            except Exception as recovery_error:
                logging.error('Recovery failed (%s)', type(recovery_error).__name__)
                status.update(outcome='failed', error='Rollback failed; manual recovery required; snapshot retained')
                paused = False  # Do not restart an image against a failed/unknown data restore.
        if not switched:
            try:
                if paused: runner.resume()
                runner.verify_previous(); status['safeToContinue'] = True
            except Exception as recovery_error:
                logging.error('Previous state verification failed (%s)', type(recovery_error).__name__)
                status.update(error='Could not verify previous app state; manual recovery required', outcome='failed')
    publish('finished', 100 if status['outcome'] == 'succeeded' else status['progress'])
    return status


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--job', required=True)
    args = parser.parse_args(); identifier = str(uuid.UUID(args.job))
    if args.job != identifier: raise ValueError('Invalid job identifier')
    from xps_update_runtime import Runtime, load_config
    config = load_config(); config['statusFile'] = str(STATE_ROOT/'status.json')
    with (STATE_ROOT/'worker.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        job = json.loads((STATE_ROOT/'jobs'/f'{identifier}.json').read_text())
        if job['jobId'] != identifier or job.get('started'):
            raise ValueError('Unknown or already started job')
        job['started'] = True; write_status(STATE_ROOT/'jobs'/f'{identifier}.json', job)
        result = run_job(job, config, Runtime(config))
        raise SystemExit(0 if result['outcome'] == 'succeeded' else 1)


if __name__ == '__main__': main()
