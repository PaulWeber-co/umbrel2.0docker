"""Publish metadata only for a candidate with matching runtime evidence."""
import argparse
import json
import re
from pathlib import Path
from xps_update_release import validate_release


def candidate_commit(run, repository):
    if (run.get('status') != 'completed' or run.get('conclusion') != 'success'
        or run.get('head_branch') != 'master' or run.get('event') not in ('push','workflow_dispatch')
        or run.get('repository',{}).get('full_name') != repository
        or run.get('head_repository',{}).get('full_name') != repository
        or run.get('pull_requests') != [] or run.get('path') != '.github/workflows/xps-umbrel-image.yml'
        or not re.fullmatch('[a-f0-9]{40}', run.get('head_sha',''))):
        raise ValueError('Untrusted candidate origin')
    return run['head_sha']


def make_manifest(document, evidence):
    release = validate_release(document)
    if release['dataCompatibility'] != 'no-migration' or evidence.get('dataCompatibility') != release['dataCompatibility']:
        raise ValueError('Compatibility mode has not passed a matching lifecycle test')
    if any(evidence.get(key) != release[key] for key in ('image', 'sourceCommit', 'version')):
        raise ValueError('Candidate evidence does not match release')
    if evidence.get('securityPassed') is not True or evidence.get('lifecyclePassed') is not True:
        raise ValueError('Candidate has not passed security and lifecycle validation')
    return release


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--manifest', required=True); parser.add_argument('--validation', required=True)
    parser.add_argument('--output', required=True); args = parser.parse_args()
    release = make_manifest(json.loads(Path(args.manifest).read_text()), json.loads(Path(args.validation).read_text()))
    Path(args.output).write_text(json.dumps(release, indent=2)+'\n')


if __name__ == '__main__': main()
