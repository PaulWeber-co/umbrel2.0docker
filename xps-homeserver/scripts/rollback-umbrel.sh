#!/bin/bash
# Switches Umbrel back to the image before the last successful update (and
# a second call switches forward again). Umbrel's data stays as it is.
set -euo pipefail
# shellcheck source=SCRIPTDIR/lib/umbrel.sh
. "$(dirname -- "${BASH_SOURCE[0]}")/lib/umbrel.sh"
need_root

if [ ! -r "$ENV_FILE" ] || [ ! -r "$PREVIOUS_ENV_FILE" ]; then
	echo "Kein vorheriges Image gespeichert; das gibt es erst nach einem erfolgreichen Update." >&2
	exit 1
fi
current=$(read_image "$ENV_FILE")
previous=$(read_image "$PREVIOUS_ENV_FILE")
if [ -z "$previous" ] || [ "$current" = "$previous" ]; then
	echo "Das gespeicherte vorherige Image ist ungültig oder läuft schon." >&2
	exit 1
fi

candidate=$(mktemp "$(dirname -- "$ENV_FILE")/.umbrel-rollback.XXXXXX")
reverse=$(mktemp "$(dirname -- "$PREVIOUS_ENV_FILE")/.umbrel-reverse.XXXXXX")
trap 'rm -f "$candidate" "$reverse"' EXIT
write_env "$ENV_FILE" "$candidate" "$previous"
write_env "$ENV_FILE" "$reverse" "$current"

log "Starte Umbrel mit ${previous##*@}."
if compose "$candidate" up --detach --remove-orphans && wait_healthy; then
	mv "$candidate" "$ENV_FILE"
	mv "$reverse" "$PREVIOUS_ENV_FILE"
	log "Umbrel läuft wieder mit dem vorherigen Image."
	exit 0
fi
log "Das vorherige Image wird nicht gesund; zurück zu ${current##*@}."
if compose "$ENV_FILE" up --detach --remove-orphans && wait_healthy; then
	exit 1
fi
log "Auch das aktuelle Image wird nicht gesund. Bitte 'docker logs umbrel' prüfen."
exit 2
