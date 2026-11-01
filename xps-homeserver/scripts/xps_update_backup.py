"""Consistent full-volume archives. Caller must stop all writers first."""
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(4*1024*1024), b''):
            h.update(chunk)
    return h.hexdigest()


def source_size(source):
    if source.is_file(): return source.stat().st_size
    seen = set(); size = 0
    for root, dirs, files in os.walk(source, followlinks=False):
        for name in files:
            p = Path(root)/name; st = p.lstat(); key = (st.st_dev, st.st_ino)
            if p.is_file() and not p.is_symlink() and key not in seen:
                seen.add(key); size += st.st_size
    return size


def create_snapshot(config, runner=subprocess.run, available_bytes=None):
    source = Path(config['dataDirectory']).resolve(strict=True)
    backup = Path(config['backupRoot']).resolve()
    if source == Path('/') or len(source.parts) < 3 or backup == source or source in backup.parents:
        raise ValueError('Unsafe snapshot paths')
    backup.mkdir(parents=True, exist_ok=True, mode=0o700)
    paths = config.get('snapshotPaths', ['.'])
    if not paths or any(Path(p).is_absolute() or '..' in Path(p).parts or p.startswith('-') for p in paths):
        raise ValueError('Invalid snapshot selection')
    if len(paths) != len(set(paths)) or any(a != b and Path(a) in Path(b).parents for a in paths for b in paths):
        raise ValueError('Overlapping snapshot paths')
    for p in paths:
        target = source/p
        if not target.exists() or target.is_symlink() or source not in [target.resolve(), *target.resolve().parents]:
            raise ValueError('Snapshot path missing or outside source')
    size = sum(source_size(source/p) for p in paths)
    available = shutil.disk_usage(backup).free if available_bytes is None else available_bytes
    if available < max(1024*1024, (size*11+9)//10):
        raise OSError('Insufficient space for complete data snapshot with 10% reserve')
    archive = backup/('snapshot-'+str(time.time_ns())+'.tar')
    flags = ['--acls', '--xattrs', '--numeric-owner'] if sys.platform == 'linux' else []
    runner(['tar', *flags, '-cpf', str(archive), '-C', str(source), '--', *paths], check=True)
    runner(['tar', '-tf', str(archive)], check=True, stdout=subprocess.DEVNULL)
    with archive.open('rb') as stream: os.fsync(stream.fileno())
    os.chmod(archive, 0o600)
    return dict(archive=str(archive), source=str(source), paths=paths, bytes=size, sha256=digest(archive))


def restore_snapshot(snapshot, runner=subprocess.run):
    source = Path(snapshot['source']); archive = Path(snapshot['archive'])
    if source.is_symlink() or source.resolve() == Path('/') or len(source.resolve().parts) < 3:
        raise ValueError('Unsafe restore path')
    if archive.is_symlink() or digest(archive) != snapshot['sha256']:
        raise ValueError('Snapshot checksum mismatch')
    # Extract to a sibling first: a failed restore never destroys the current tree.
    needed = (int(snapshot['bytes'])*11+9)//10
    if shutil.disk_usage(source.parent).free < needed:
        raise OSError('Insufficient space for non-destructive data restore; manual recovery required')
    staging = source.with_name(source.name+'.restore-'+str(time.time_ns()))
    staging.mkdir(mode=0o700)
    flags = ['--acls', '--xattrs', '--numeric-owner'] if sys.platform == 'linux' else []
    try:
        runner(['tar', *flags, '-xpf', str(archive), '-C', str(staging)], check=True)
        paths = snapshot.get('paths', ['.'])
        moved = []
        try:
            for rel in paths:
                current = source/rel; restored = staging/rel
                if rel == '.': current, restored = source, staging
                old = current.with_name(current.name+'.before-restore-'+str(time.time_ns()))
                if current.exists(): current.rename(old)
                else: old = None
                moved.append((current, old, restored))
                restored.rename(current)
        except BaseException:
            for current, old, restored in reversed(moved):
                if current.exists(): current.rename(restored)
                if old is not None: old.rename(current)
            raise
        if staging.exists(): shutil.rmtree(staging)
    except BaseException:
        if staging.exists(): shutil.rmtree(staging)
        raise
