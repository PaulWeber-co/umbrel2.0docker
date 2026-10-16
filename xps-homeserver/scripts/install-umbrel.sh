#!/bin/bash
# Initialize the persistent image reference and deploy the current branch's
# published image. Run from a clean clone of the fork.
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "$SCRIPT_DIR/../.." && pwd)
ENV_FILE=${XPS_UMBREL_ENV_FILE:-/etc/xps-homeserver/umbrel.env}
git_repo() { git -C "$REPO_ROOT" -c safe.directory="$REPO_ROOT" "$@"; }

if [ "$(id -u)" -ne 0 ]; then
	echo "Bitte mit sudo starten: sudo $0" >&2
	exit 1
fi

command -v docker >/dev/null 2>&1 || {
	echo "Docker fehlt. Installiere den XPS mit dem aktuellen Installer neu oder installiere docker.io." >&2
	exit 1
}
docker compose version >/dev/null
systemctl enable --now docker

branch=$(git_repo branch --show-current)
if [ -z "$branch" ]; then
	echo "Das Repository muss auf einem Branch ausgecheckt sein." >&2
	exit 1
fi
remote=$(git_repo remote get-url origin)
owner=$(printf '%s\n' "$remote" | sed -E 's#^(https://github\.com/|git@github\.com:)##; s#\.git$##; s#/.*$##' | tr '[:upper:]' '[:lower:]')
if [ -z "$owner" ] || [ "$owner" = "$remote" ]; then
	echo "GitHub-Owner konnte aus origin nicht gelesen werden: $remote" >&2
	exit 1
fi
IMAGE_REPOSITORY=${XPS_UMBREL_IMAGE_REPOSITORY:-ghcr.io/$owner/xps-homeserver-umbrelos}

install -d -m 755 "$(dirname -- "$ENV_FILE")"
if [ ! -e "$ENV_FILE" ]; then
	image_tag=$(git_repo rev-parse HEAD)
	printf 'XPS_UMBREL_IMAGE=%s:sha-%s\n' "$IMAGE_REPOSITORY" "$image_tag" >"$ENV_FILE"
	chmod 600 "$ENV_FILE"
fi

exec "$SCRIPT_DIR/update-umbrel.sh"
