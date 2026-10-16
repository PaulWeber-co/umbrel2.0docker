#!/bin/bash
# Updates the XPS to the newest state of the fork: git pull, then setup-xps.sh
# (configuration, services, Umbrel image). Installed as "sudo update-xps".
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")" && pwd)
REPO_ROOT=$(cd -- "$SCRIPT_DIR/../.." && pwd)
git_repo() { git -C "$REPO_ROOT" -c safe.directory="$REPO_ROOT" "$@"; }

if [ "$(id -u)" -ne 0 ]; then
	echo "Bitte mit sudo starten: sudo update-xps" >&2
	exit 1
fi
if [ -n "$(git_repo status --porcelain --untracked-files=no)" ]; then
	echo "In $REPO_ROOT gibt es lokale Änderungen; bitte erst verwerfen (git -C $REPO_ROOT checkout .)." >&2
	exit 1
fi
branch=$(git_repo branch --show-current)
echo "==> Neuester Stand von origin/$branch"
git_repo pull --ff-only origin "$branch"
# The new version of the setup script, not the one already running
exec "$SCRIPT_DIR/setup-xps.sh"
