"""Strict release metadata for the XPS container. No remote executable scripts."""
import json
import re
import urllib.request
from urllib.parse import urlsplit

REPOSITORY = 'PaulWeber-co/umbrel2.0docker'
IMAGE_REPOSITORY = 'ghcr.io/paulweber-co/xps-homeserver-umbrelos'
MAX_JSON = 1024 * 1024
VERSION = re.compile(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\Z')
FIELDS = {'schemaVersion', 'version', 'platform', 'image', 'sourceCommit', 'releaseNotes', 'dataCompatibility'}


def version_tuple(version):
    if not isinstance(version, str) or not VERSION.fullmatch(version):
        raise ValueError('Invalid stable release version')
    return tuple(map(int, version.split('.')))


def validate_release(document):
    if not isinstance(document, dict) or set(document) != FIELDS:
        raise ValueError('Invalid release fields')
    if type(document['schemaVersion']) is not int or document['schemaVersion'] != 1:
        raise ValueError('Unsupported release schema')
    version_tuple(document['version'])
    if document['platform'] != 'linux/amd64':
        raise ValueError('Unsupported release architecture')
    if not isinstance(document['image'], str) or not re.fullmatch(re.escape(IMAGE_REPOSITORY)+r'@sha256:[a-f0-9]{64}', document['image']):
        raise ValueError('Release is not pinned to the approved registry')
    if not isinstance(document['sourceCommit'], str) or not re.fullmatch(r'[a-f0-9]{40}', document['sourceCommit']):
        raise ValueError('Invalid source commit')
    if not isinstance(document['releaseNotes'], str) or len(document['releaseNotes']) > 32768:
        raise ValueError('Invalid release notes')
    if document['dataCompatibility'] not in ('no-migration', 'snapshot-required'):
        raise ValueError('Unknown data compatibility')
    return dict(document)


def validate_download_url(url):
    p = urlsplit(url)
    hosts = {'api.github.com', 'github.com', 'release-assets.githubusercontent.com',
             'objects.githubusercontent.com', 'github-releases.githubusercontent.com'}
    if p.scheme != 'https' or p.hostname not in hosts or p.username or p.password or p.fragment or p.port not in (None, 443):
        raise ValueError('Untrusted release download URL')
    return url


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        validate_download_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def decode_json(data):
    if len(data) > MAX_JSON:
        raise ValueError('Release response too large')
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('Duplicate JSON field')
            result[key] = value
        return result
    return json.loads(data, object_pairs_hook=unique)


def get_json(url):
    validate_download_url(url)
    request = urllib.request.Request(url, headers={'User-Agent': 'XPS-Umbrel-Updater/1', 'Accept': 'application/json'})
    with urllib.request.build_opener(SafeRedirect()).open(request, timeout=10) as response:
        return decode_json(response.read(MAX_JSON + 1))


def select_release(releases, current_version):
    current = version_tuple(current_version)
    candidates = []
    for item in releases:
        if item.get('draft') or item.get('prerelease') or 'manifest' not in item:
            continue
        manifest = validate_release(item['manifest'])
        if item.get('tag_name') != 'xps-' + manifest['version']:
            raise ValueError('Release tag does not match manifest')
        if version_tuple(manifest['version']) > current:
            candidates.append(manifest)
    return max(candidates, key=lambda d: version_tuple(d['version']), default=None)


def fetch_release(config, current_version, get_json=get_json):
    if config.get('repository', REPOSITORY) != REPOSITORY:
        raise ValueError('Unapproved source repository')
    entries = get_json(f'https://api.github.com/repos/{REPOSITORY}/releases?per_page=100')
    if not isinstance(entries, list):
        raise ValueError('Invalid release listing')
    parsed = []
    for item in entries:
        if item.get('draft') or item.get('prerelease') or not item.get('tag_name', '').startswith('xps-'):
            continue
        tag = item['tag_name']; version_tuple(tag[4:])
        if version_tuple(tag[4:]) <= version_tuple(current_version):
            continue
        if not any(a.get('name') == 'container-update.json' for a in item.get('assets', [])):
            continue
        url = f'https://github.com/{REPOSITORY}/releases/download/{tag}/container-update.json'
        parsed.append({**item, 'manifest': get_json(url)})
    selected = select_release(parsed, current_version)
    upstream = get_json('https://api.github.com/repos/getumbrel/umbrel/releases/latest')['tag_name'].removeprefix('v')
    version_tuple(upstream)
    newest = selected['version'] if selected else current_version
    return dict(available=selected is not None, version=newest, name='umbrelOS '+newest,
                releaseNotes=selected['releaseNotes'] if selected else '',
                digest=selected['image'] if selected else None, upstreamVersion=upstream,
                pendingUpstream=version_tuple(upstream) > version_tuple(newest), manifest=selected)
