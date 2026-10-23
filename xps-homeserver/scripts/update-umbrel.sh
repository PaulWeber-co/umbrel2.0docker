#!/bin/bash
# Brings the Umbrel container to the newest image GitHub built for this
# branch (.github/workflows/xps-umbrel-image.yml): pulls the branch tag, pins
# its digest, restarts Umbrel only when the image changed, waits until it is
# healthy and goes back to the previous image if it is not. Umbrel's data
# (volume umbrel-data) is never touched. Called by update-xps and setup-xps.sh.
set -euo pipefail
# shellcheck source=SCRIPTDIR/lib/umbrel.sh
. "$(dirname -- "${BASH_SOURCE[0]}")/lib/umbrel.sh"
need_root

if [ ! -r "$ENV_FILE" ]; then
	echo "$ENV_FILE fehlt. Zuerst setup-xps.sh ausführen." >&2
	exit 1
fi
repository=$(awk -F= '$1 == "XPS_UMBREL_IMAGE_REPOSITORY" { print substr($0, index($0, "=") + 1) }' "$ENV_FILE")
tag=$(awk -F= '$1 == "XPS_UMBREL_IMAGE_TAG" { print substr($0, index($0, "=") + 1) }' "$ENV_FILE")
if [ -z "$repository" ] || [ -z "$tag" ]; then
	echo "XPS_UMBREL_IMAGE_REPOSITORY oder XPS_UMBREL_IMAGE_TAG fehlt in $ENV_FILE." >&2
	exit 1
fi

old_image=$(read_image "$ENV_FILE")

log "Lade $repository:$tag."
if ! docker pull --quiet "$repository:$tag" >/dev/null; then
	if [ -n "$old_image" ]; then
		log "Das Image ließ sich nicht laden; Umbrel läuft unverändert weiter."
	else
		log "Das Image ließ sich nicht laden; Umbrel ist noch nicht installiert."
	fi
	log "Ist der GitHub-Build durchgelaufen und das Paket öffentlich? (docs/betrieb.md, Abschnitt Umbrel-Image)"
	log "Oder fehlt das Internet? Dann später erneut: sudo update-xps"
	exit 1
fi
new_image=$(docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$repository:$tag" | grep -m1 "^$repository@" || true)
if [ -z "$new_image" ]; then
	log "Kein Digest für $repository:$tag gefunden."
	exit 1
fi
candidate=$(mktemp "$(dirname -- "$ENV_FILE")/.umbrel.env.XXXXXX")
trap 'rm -f "$candidate"' EXIT
write_env "$ENV_FILE" "$candidate" "$new_image"

if [ "$new_image" = "$old_image" ] && [ "$(docker inspect --format '{{.State.Health.Status}}' umbrel 2>/dev/null || true)" = healthy ]; then
	log "Umbrel ist aktuell (${new_image##*@})."
	exit 0
fi

log "Starte Umbrel mit ${new_image##*@}."
if compose "$candidate" up --detach --remove-orphans && wait_healthy; then
	if [ -n "$old_image" ] && [ "$old_image" != "$new_image" ]; then
		write_env "$ENV_FILE" "$candidate.previous" "$old_image"
		mv "$candidate.previous" "$PREVIOUS_ENV_FILE"
	fi
	mv "$candidate" "$ENV_FILE"
	log "Umbrel ist gesund. Zurück zum vorherigen Image: sudo $XPS_ROOT/scripts/rollback-umbrel.sh"
	exit 0
fi

if [ -z "$old_image" ]; then
	log "Erster Start fehlgeschlagen; die Daten im Volume umbrel-data sind unberührt. Logs: docker logs umbrel"
	exit 1
fi
log "Das neue Image ist nicht gesund; zurück zu ${old_image##*@}."
if compose "$ENV_FILE" up --detach --remove-orphans && wait_healthy; then
	log "Das bisherige Image läuft wieder."
	exit 1
fi
log "Auch das bisherige Image wird nicht gesund. Bitte 'docker logs umbrel' prüfen."
exit 2
