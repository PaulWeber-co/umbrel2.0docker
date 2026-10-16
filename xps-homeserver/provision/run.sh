#!/usr/bin/env bash
# Sets up the XPS. Runs as root on the XPS itself; apply.sh calls it from the Mac.
#
#   sudo /opt/xps-homeserver/provision/run.sh            all steps in order
#   sudo /opt/xps-homeserver/provision/run.sh 40 60      only steps 40-* and 60-*
#   sudo /opt/xps-homeserver/provision/run.sh --list     show the steps
#
# Each step in steps/NN-name.sh is idempotent. The run stops at the first step
# that fails; the log is in /var/log/xps-provision.log.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
export XPS_DIR="${XPS_DIR:-$(dirname "$HERE")}"
LOG=/var/log/xps-provision.log

if [ "${1:-}" = --list ]; then
	for step in "$HERE"/steps/[0-9][0-9]-*.sh; do
		printf '%s  %s\n' "$(basename "$step" .sh)" "$(sed -n '2s/^# //p' "$step")"
	done
	exit 0
fi

[ "$(id -u)" = 0 ] || { echo "Bitte mit sudo starten." >&2; exit 1; }

selected=()
for step in "$HERE"/steps/[0-9][0-9]-*.sh; do
	name=$(basename "$step" .sh)
	if [ "$#" -eq 0 ]; then
		selected+=("$step")
		continue
	fi
	for wanted in "$@"; do
		case "$name" in "$wanted" | "$wanted"-*) selected+=("$step") ;; esac
	done
done
[ "${#selected[@]}" -gt 0 ] || { echo "Kein Schritt passt zu: $*" >&2; exit 1; }

exec > >(tee -a "$LOG") 2>&1
echo "=== $(date '+%F %T') Einrichtung: ${selected[*]##*/}"
for step in "${selected[@]}"; do
	name=$(basename "$step" .sh)
	echo "==> $name"
	# Each step in its own shell, with the helpers and settings loaded.
	if ! bash -c 'set -euo pipefail; source "$1"; load_env /etc/xps-homeserver/xps.env; source "$2"' _ "$HERE/lib.sh" "$step"; then
		echo "==> $name ist fehlgeschlagen. Die Meldungen darüber zeigen, warum; danach erneut starten mit: sudo $0 ${name%%-*}" >&2
		exit 1
	fi
done
echo "==> Fertig"
