"""Publish metadata only for a candidate with matching runtime evidence."""
import argparse
import json
from pathlib import Path
from xps_update_release import validate_release


def make_manifest(document, evidence):
    release = validate_release(document)
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
