#!/bin/bash
# Sets up everything on the XPS beyond the installer stick, or brings it up to
# date: host configuration, packages, dashboard, kiosk, control center,
# AirPlay, webcam sensor, services statistics and Umbrel. Safe to run again at
# any time; update-xps runs it after every git pull.
#
#   sudo /opt/xps-homeserver/xps-homeserver/scripts/setup-xps.sh
#
# The kiosk browser runs as the user xps-kiosk (no password, no sudo), which
# this script creates; older versions took a login user as argument.
set -Eeuo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
XPS_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)
REPO_ROOT=$(cd -- "$XPS_ROOT/.." && pwd)
DEPLOY_ROOT=/opt/xps-homeserver
CONFIG_DIR=/etc/xps-homeserver
export DEBIAN_FRONTEND=noninteractive

LOG=/var/log/xps-setup.log
CURRENT_STEP="Start"
WARNINGS=()
step() {
	CURRENT_STEP=$*
	printf '\n==> %s (%s)\n' "$*" "$(date +%H:%M:%S)"
}
warn() {
	WARNINGS+=("$*")
	printf 'Warnung: %s\n' "$*" >&2
}
git_repo() { git -C "$REPO_ROOT" -c safe.directory="$REPO_ROOT" "$@"; }

if [ "$(id -u)" -ne 0 ]; then
	echo "Bitte mit sudo starten: sudo $0" >&2
	exit 1
fi

# Everything also goes to the log, so a failed run can be read afterwards
exec > >(tee -a "$LOG") 2>&1
printf '\n===== setup-xps.sh %s, Stand %s =====\n' "$(date '+%Y-%m-%d %H:%M')" \
	"$(git_repo log -1 --format='%h %s' 2>/dev/null || echo unbekannt)"
trap 'echo; echo "FEHLER im Schritt \"$CURRENT_STEP\" (Zeile $LINENO). Das ganze Protokoll: $LOG" >&2; echo "Danach einfach erneut starten: sudo $0" >&2' ERR
if [ "$REPO_ROOT" != "$DEPLOY_ROOT" ]; then
	cat >&2 <<-EOF
		Die Dienste erwarten das Repository unter $DEPLOY_ROOT. So holst du es
		(nur der Ordner xps-homeserver wird ausgecheckt):
		  sudo git clone --filter=blob:none --sparse <Fork-URL> $DEPLOY_ROOT
		  sudo git -C $DEPLOY_ROOT sparse-checkout set xps-homeserver
		  sudo $DEPLOY_ROOT/xps-homeserver/scripts/setup-xps.sh
	EOF
	exit 1
fi
if [ $# -gt 0 ]; then
	echo "Hinweis: '$*' wird nicht mehr gebraucht; der Kiosk läuft als eigener Benutzer xps-kiosk."
fi

step "Pakete (installer/iso/xps/packages.txt)"
mapfile -t packages < <(grep -vE '^[[:space:]]*(#|$)' "$XPS_ROOT/installer/iso/xps/packages.txt")
apt-get update -qq
apt-get install -y -qq --no-install-recommends "${packages[@]}" >/dev/null

step "Grundsystem: Kernel-Wächter, Watchdogs, umbrel.local, Akku, Updates"
# shellcheck source=SCRIPTDIR/../installer/iso/xps/host-files.sh
. "$XPS_ROOT/installer/iso/xps/host-files.sh"
install_host_files "$XPS_ROOT/installer/iso/xps/host"
update-grub 2>/dev/null || warn "update-grub fehlgeschlagen"
systemctl restart systemd-journald
systemctl daemon-reexec # picks up the hardware watchdog setting
systemctl restart xps-wifi-watchdog.service xps-mdns-alias.service
systemctl start xps-battery-care.service xps-wl-guard.timer
systemctl restart xps-quiet.service
/usr/local/sbin/xps-wl-guard >/dev/null

step "Benutzer und Einstellungen"
if ! id xps-dashboard >/dev/null 2>&1; then
	useradd --system --user-group --home-dir /var/lib/xps-dashboard --shell /usr/sbin/nologin xps-dashboard
fi
install -d -o xps-dashboard -g xps-dashboard -m 750 /var/lib/xps-dashboard
# The kiosk browser's own user: a regular account for logind's seat on the
# display, but without password (locked), sudo or login shell.
if ! id xps-kiosk >/dev/null 2>&1; then
	useradd --user-group --home-dir /var/lib/xps-kiosk --no-create-home --shell /usr/sbin/nologin \
		--comment "XPS Wand-Dashboard" xps-kiosk
fi
for group in video input render; do
	getent group "$group" >/dev/null && usermod -aG "$group" xps-kiosk
done
install -d -o xps-kiosk -g xps-kiosk -m 700 /var/lib/xps-kiosk
# Spotify Connect's container runs as this user instead of root
if ! id xps-spotify >/dev/null 2>&1; then
	useradd --system --user-group --home-dir /var/lib/xps-spotify --no-create-home --shell /usr/sbin/nologin xps-spotify
fi
# Older versions ran the kiosk as the login user (xps-kiosk@<user>.service)
mapfile -t old_kiosks < <(systemctl list-units --all --plain --no-legend 'xps-kiosk@*.service' | awk '{ print $1 }')
for unit in "${old_kiosks[@]}"; do
	systemctl disable --now "$unit" 2>/dev/null || true
done
rm -f /etc/systemd/system/xps-kiosk@.service /etc/systemd/system/multi-user.target.wants/xps-kiosk@*.service "$CONFIG_DIR/kiosk-user"
install -d -m 755 "$CONFIG_DIR"
[ -e "$CONFIG_DIR/dashboard.env" ] || install -m 600 "$XPS_ROOT/dashboard.env.example" "$CONFIG_DIR/dashboard.env"
[ -e "$CONFIG_DIR/host.env" ] || install -m 600 "$XPS_ROOT/host.env.example" "$CONFIG_DIR/host.env"
{
	echo "# Von setup-xps.sh geschrieben: unter welchem Benutzer und welcher Gruppe Spotify Connect läuft"
	echo "XPS_SPOTIFY_USER=$(id -u xps-spotify):$(getent group audio | cut -d: -f3)"
} >"$CONFIG_DIR/spotify.env"
if [ ! -e "$CONFIG_DIR/umbrel.env" ]; then
	# ghcr.io/<owner>/…: image names are lowercase, GitHub owners need not be
	owner=$(git_repo remote get-url origin | sed -E 's#^(https://github\.com/|git@github\.com:)##; s#/.*$##' | tr '[:upper:]' '[:lower:]')
	branch=$(git_repo branch --show-current)
	{
		echo "# Welches Umbrel-Image läuft; update-umbrel.sh pflegt XPS_UMBREL_IMAGE."
		echo "XPS_UMBREL_IMAGE_REPOSITORY=ghcr.io/$owner/xps-homeserver-umbrelos"
		echo "XPS_UMBREL_IMAGE_TAG=branch-${branch//\//-}"
	} >"$CONFIG_DIR/umbrel.env"
	chmod 600 "$CONFIG_DIR/umbrel.env"
fi

step "Dienste: Dashboard, Steuerung, Kiosk, AirPlay, Webcam, Dienste-Statistik"
for unit in "$XPS_ROOT"/deploy/systemd/*.service "$XPS_ROOT"/deploy/systemd/*.timer; do
	install -m 644 "$unit" /etc/systemd/system/
done
install -m 644 "$XPS_ROOT/deploy/tmpfiles/xps-homeserver.conf" /etc/tmpfiles.d/xps-homeserver.conf
# Chromium ignores --disable-features=TranslateUI since about version 120;
# only the policy keeps the translation bubble off the German dashboard
install -D -m 644 "$XPS_ROOT/deploy/chromium/xps-kiosk.json" /etc/chromium/policies/managed/xps-kiosk.json
systemd-tmpfiles --create /etc/tmpfiles.d/xps-homeserver.conf
ln -sfn "$XPS_ROOT/scripts/update-xps.sh" /usr/local/sbin/update-xps
ln -sfn "$XPS_ROOT/scripts/xps-display.py" /usr/local/bin/xps-display
ln -sfn "$XPS_ROOT/scripts/xps-doctor.py" /usr/local/sbin/xps-doctor
systemctl daemon-reload
systemctl enable --now docker.service
systemctl enable xps-dashboard.service xps-control.service xps-services.service xps-ambient.service \
	xps-airplay.service xps-kiosk.service xps-kiosk-restart.timer
# Restart, so a new version of the code takes effect. AirPlay and the kiosk
# skip their start when the control center has switched them off.
systemctl restart xps-dashboard.service xps-control.service xps-services.service xps-ambient.service
systemctl restart xps-airplay.service || warn "AirPlay startet nicht: journalctl -u xps-airplay"
systemctl restart xps-kiosk.service || warn "Der Kiosk startet nicht: journalctl -u xps-kiosk"
systemctl start xps-kiosk-restart.timer

# The first run downloads about 1 GB and takes a while; later runs only fetch
# clips new to backgrounds.txt (and remove the ones taken off it).
step "Hintergrundvideos (Mixkit-Luftaufnahmen, nur was neu ist)"
"$XPS_ROOT/dashboard/scripts/fetch-backgrounds.sh" "$XPS_ROOT/dashboard/web/media" 1080 ||
	warn "Nicht alle Videos sind da; das Dashboard nimmt die vorhandenen, sonst Farbverläufe. Später nochmal: sudo update-xps"

step "Umbrel"
if ! "$XPS_ROOT/scripts/update-umbrel.sh"; then
	if docker inspect umbrel >/dev/null 2>&1; then
		warn "Umbrel ist noch nicht auf dem neuesten Stand (siehe oben)"
	else
		warn "Umbrel läuft noch nicht (siehe oben); danach erneut: sudo update-xps"
	fi
fi

step "Prüfung"
"$XPS_ROOT/scripts/xps-doctor.py" --kurz || true

if [ "${#WARNINGS[@]}" -gt 0 ]; then
	printf '\nFertig, mit %d Warnung(en):\n' "${#WARNINGS[@]}"
	printf '  - %s\n' "${WARNINGS[@]}"
else
	printf '\nFertig.\n'
fi
cat <<EOF
  Dashboard:  http://xps.local:7777 (und auf dem Display)
  Steuerung:  http://xps.local:7777/steuerung (Bildschirm, Zeitplan, Funktionen)
  Umbrel:     http://umbrel.local
  Einstellen: sudoedit $CONFIG_DIR/dashboard.env, dann sudo systemctl restart xps-dashboard
  Prüfen:     sudo xps-doctor
  Updates:    sudo update-xps
  Protokoll:  $LOG
EOF
