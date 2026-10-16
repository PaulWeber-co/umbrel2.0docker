#!/bin/bash
# Switch Umbrel to the image saved by the last successful update.
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "$SCRIPT_DIR/../.." && pwd)
COMPOSE_FILE="$REPO_ROOT/xps-homeserver/deploy/compose.yaml"
ENV_FILE=${XPS_UMBREL_ENV_FILE:-/etc/xps-homeserver/umbrel.env}
PREVIOUS_ENV_FILE=${XPS_UMBREL_PREVIOUS_ENV_FILE:-/etc/xps-homeserver/umbrel-previous.env}
HEALTH_TIMEOUT_SECONDS=${XPS_UMBREL_HEALTH_TIMEOUT_SECONDS:-900}
git_repo() { git -C "$REPO_ROOT" -c safe.directory="$REPO_ROOT" "$@"; }
compose() { docker compose --project-name xps-homeserver --env-file "$1" -f "$COMPOSE_FILE" "${@:2}"; }
read_image() { awk -F= '$1 == "XPS_UMBREL_IMAGE" { value = substr($0, index($0, "=") + 1) } END { print value }' "$1"; }
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
			unhealthy|exited|dead) return 1 ;;
		esac
		sleep 10
	done
	return 1
}

if [ "$(id -u)" -ne 0 ]; then
	echo "Bitte mit sudo starten: sudo $0" >&2
	exit 1
fi
if [ ! -r "$ENV_FILE" ] || [ ! -r "$PREVIOUS_ENV_FILE" ]; then
	echo "Kein Rückfall-Image gespeichert. Erst nach einem erfolgreichen Umbrel-Update steht eines bereit." >&2
	exit 1
fi

branch=$(git_repo branch --show-current)
if [ -z "$branch" ] || [ -n "$(git_repo status --porcelain)" ]; then
	echo "Das Checkout unter $REPO_ROOT muss auf einem sauberen Branch stehen." >&2
	exit 1
fi

current_image=$(read_image "$ENV_FILE")
previous_image=$(read_image "$PREVIOUS_ENV_FILE")
if [ -z "$current_image" ] || [ -z "$previous_image" ] || [ "$current_image" = "$previous_image" ]; then
	echo "Das gespeicherte Rückfall-Image ist ungültig oder bereits aktiv." >&2
	exit 1
fi

candidate_env=$(mktemp "$(dirname -- "$ENV_FILE")/.umbrel-rollback.XXXXXX")
reverse_env=$(mktemp "$(dirname -- "$PREVIOUS_ENV_FILE")/.umbrel-reverse.XXXXXX")
trap 'rm -f "$candidate_env" "$reverse_env"' EXIT
replace_image "$ENV_FILE" "$candidate_env" "$previous_image"
replace_image "$ENV_FILE" "$reverse_env" "$current_image"
chmod 600 "$candidate_env" "$reverse_env"

echo "Lade Rückfall-Image $previous_image."
if ! docker image inspect "$previous_image" >/dev/null 2>&1; then
	if ! compose "$candidate_env" pull umbrel port-publisher; then
		echo "Rückfall-Image konnte nicht geladen werden; der laufende Container bleibt unverändert." >&2
		exit 1
	fi
fi
if compose "$candidate_env" up --detach --remove-orphans && wait_healthy; then
	install -m 600 "$candidate_env" "$ENV_FILE"
	install -m 600 "$reverse_env" "$PREVIOUS_ENV_FILE"
	echo "Umbrel läuft wieder mit $previous_image."
	exit 0
fi

echo "Rückfall-Image ist nicht gesund; stelle $current_image wieder her." >&2
if compose "$ENV_FILE" up --detach --remove-orphans && wait_healthy; then
	echo "Das bisherige Image läuft wieder. Bitte Logs prüfen." >&2
	exit 1
fi
echo "Auch das bisherige Image konnte nicht bestätigt werden. Bitte 'docker logs umbrel' und 'journalctl -u docker' prüfen." >&2
exit 2
