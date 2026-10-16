#!/bin/bash
# Pull the latest code for the checked-out branch, deploy its immutable GHCR
# image, wait for Umbrel's healthcheck, and restore the previous image on error.
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "$SCRIPT_DIR/../.." && pwd)
COMPOSE_FILE="$REPO_ROOT/xps-homeserver/deploy/compose.yaml"
ENV_FILE=${XPS_UMBREL_ENV_FILE:-/etc/xps-homeserver/umbrel.env}
IMAGE_REPOSITORY=${XPS_UMBREL_IMAGE_REPOSITORY:-ghcr.io/paulweber-co/xps-homeserver-umbrelos}
HEALTH_TIMEOUT_SECONDS=${XPS_UMBREL_HEALTH_TIMEOUT_SECONDS:-900}
git_repo() { git -C "$REPO_ROOT" -c safe.directory="$REPO_ROOT" "$@"; }

log() { printf '[xps-update] %s\n' "$*"; }
compose() {
	docker compose --project-name xps-homeserver --env-file "$1" -f "$COMPOSE_FILE" "${@:2}"
}
read_image() {
	awk -F= '$1 == "XPS_UMBREL_IMAGE" { value = substr($0, index($0, "=") + 1) } END { print value }' "$1"
}
replace_image() {
	local source=$1 destination=$2 image=$3
	awk -F= -v image="$image" '
		$1 == "XPS_UMBREL_IMAGE" { print "XPS_UMBREL_IMAGE=" image; found = 1; next }
		{ print }
		END { if (!found) print "XPS_UMBREL_IMAGE=" image }
	' "$source" >"$destination"
}
wait_healthy() {
	local deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS)) status
	while (( SECONDS < deadline )); do
		status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' umbrel 2>/dev/null || true)
		case "$status" in
			healthy) return 0 ;;
			unhealthy|exited|dead)
				log "Umbrel meldet Zustand '$status'."
				return 1
				;;
		esac
		sleep 10
	done
	log "Healthcheck nach ${HEALTH_TIMEOUT_SECONDS}s noch nicht erfolgreich (letzter Zustand: ${status:-unbekannt})."
	return 1
}

if [ "$(id -u)" -ne 0 ]; then
	echo "Bitte mit sudo starten: sudo $0" >&2
	exit 1
fi
if [ ! -r "$ENV_FILE" ]; then
	echo "Konfiguration $ENV_FILE fehlt. Zuerst install-umbrel.sh ausführen." >&2
	exit 1
fi

branch=$(git_repo branch --show-current)
if [ -z "$branch" ]; then
	echo "Das Repository muss auf einem Branch ausgecheckt sein." >&2
	exit 1
fi
if [ -n "$(git_repo status --porcelain)" ]; then
	echo "Das Repository hat lokale Änderungen. Bitte erst committen oder verwerfen." >&2
	exit 1
fi

log "Hole den aktuellen Stand von origin/$branch."
git_repo pull --ff-only origin "$branch"
commit=$(git_repo rev-parse HEAD)
old_image=$(read_image "$ENV_FILE")
if [ -z "${XPS_UMBREL_IMAGE_REPOSITORY:-}" ] && [ -n "$old_image" ]; then
	IMAGE_REPOSITORY=${old_image%:*}
fi
new_image="$IMAGE_REPOSITORY:sha-$commit"
candidate_env=$(mktemp "$(dirname -- "$ENV_FILE")/.umbrel.env.XXXXXX")
trap 'rm -f "$candidate_env"' EXIT
replace_image "$ENV_FILE" "$candidate_env" "$new_image"

log "Lade $new_image."
if ! compose "$candidate_env" pull umbrel port-publisher; then
	log "Image konnte nicht geladen werden; der laufende Container bleibt unverändert."
	exit 1
fi

if compose "$candidate_env" up --detach --remove-orphans && wait_healthy; then
	install -m 600 "$candidate_env" "$ENV_FILE"
	log "Umbrel ist gesund auf Commit $commit. Das vorherige Image bleibt als Rückfall erhalten."
	exit 0
fi

log "Neues Image ist nicht gesund; rolle zurück."
if [ -n "$old_image" ]; then
	rollback_env=$(mktemp "$(dirname -- "$ENV_FILE")/.umbrel-rollback.XXXXXX")
	trap 'rm -f "$candidate_env" "$rollback_env"' EXIT
	replace_image "$ENV_FILE" "$rollback_env" "$old_image"
	if compose "$rollback_env" up --detach --remove-orphans && wait_healthy; then
		log "Vorheriges Image $old_image ist wieder gesund."
		exit 1
	fi
	log "Rückfall-Image konnte nicht als gesund bestätigt werden; bitte journalctl und docker logs umbrel prüfen."
	exit 2
fi

compose "$candidate_env" down
log "Erstinstallation fehlgeschlagen. Es gab noch kein vorheriges Image; Datenvolume blieb erhalten."
exit 1
