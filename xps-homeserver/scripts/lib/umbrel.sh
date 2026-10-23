# shellcheck shell=bash
# Shared by update-umbrel.sh and rollback-umbrel.sh. The Umbrel container's
# image lives in /etc/xps-homeserver/umbrel.env as XPS_UMBREL_IMAGE, always
# pinned by digest (repo@sha256:…), so a rollback gets exactly the old image;
# umbrel-previous.env keeps the one before the last successful update.

LIB_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
XPS_ROOT=$(cd -- "$LIB_DIR/../.." && pwd)
COMPOSE_FILE="$XPS_ROOT/deploy/compose.yaml"
# shellcheck disable=SC2034 # both are used by the scripts that source this file
ENV_FILE=${XPS_UMBREL_ENV_FILE:-/etc/xps-homeserver/umbrel.env}
# shellcheck disable=SC2034
PREVIOUS_ENV_FILE=${XPS_UMBREL_PREVIOUS_ENV_FILE:-/etc/xps-homeserver/umbrel-previous.env}
HEALTH_TIMEOUT_SECONDS=${XPS_UMBREL_HEALTH_TIMEOUT_SECONDS:-900}

log() { printf '[umbrel] %s\n' "$*"; }

need_root() {
	if [ "$(id -u)" -ne 0 ]; then
		echo "Bitte mit sudo starten: sudo $0" >&2
		exit 1
	fi
}

compose() {
	docker compose --project-name xps-homeserver --env-file "$1" -f "$COMPOSE_FILE" "${@:2}"
}

read_image() {
	awk -F= '$1 == "XPS_UMBREL_IMAGE" { value = substr($0, index($0, "=") + 1) } END { print value }' "$1"
}

# A copy of env file $1 at $2 with XPS_UMBREL_IMAGE=$3, mode 600
write_env() {
	awk -F= -v image="$3" '
		$1 == "XPS_UMBREL_IMAGE" { print "XPS_UMBREL_IMAGE=" image; found = 1; next }
		{ print }
		END { if (!found) print "XPS_UMBREL_IMAGE=" image }
	' "$1" >"$2"
	chmod 600 "$2"
}

# Waits for Umbrel's healthcheck (docker, umbreld and the web UI)
wait_healthy() {
	local deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS)) status="" said=$SECONDS
	log "Warte, bis Umbrel bereit ist (der erste Start dauert einige Minuten) …"
	while ((SECONDS < deadline)); do
		status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' umbrel 2>/dev/null || true)
		case "$status" in
		healthy) return 0 ;;
		unhealthy | exited | dead)
			log "Umbrel meldet '$status'. Die letzten Zeilen aus 'docker logs umbrel':"
			docker logs --tail 15 umbrel 2>&1 | sed 's/^/    /' || true
			return 1
			;;
		esac
		# A sign of life every minute, so a long first start does not look stuck
		if ((SECONDS - said >= 60)); then
			log "… noch nicht bereit (${status:-startet}), $(((SECONDS - deadline + HEALTH_TIMEOUT_SECONDS) / 60)) min"
			said=$SECONDS
		fi
		sleep 10
	done
	log "Nach ${HEALTH_TIMEOUT_SECONDS} s noch nicht gesund (zuletzt: ${status:-unbekannt})."
	return 1
}
