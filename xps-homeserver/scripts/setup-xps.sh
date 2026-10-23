#!/bin/bash
# Sets up everything on the XPS beyond the installer stick, or brings it up to
# date: host configuration, packages, dashboard, kiosk, AirPlay, webcam sensor,
# services statistics and Umbrel. Safe to run again at any time; update-xps
# runs it after every git pull.
#
#   sudo /opt/xps-homeserver/xps-homeserver/scripts/setup-xps.sh <Benutzer>
#
# <Benutzer> logs in on the display for the kiosk (once; it is remembered).
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
XPS_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)
REPO_ROOT=$(cd -- "$XPS_ROOT/.." && pwd)
DEPLOY_ROOT=/opt/xps-homeserver
CONFIG_DIR=/etc/xps-homeserver
export DEBIAN_FRONTEND=noninteractive

step() { printf '\n==> %s\n' "$*"; }
warn() { printf 'Warnung: %s\n' "$*" >&2; }
git_repo() { git -C "$REPO_ROOT" -c safe.directory="$REPO_ROOT" "$@"; }

if [ "$(id -u)" -ne 0 ]; then
	echo "Bitte mit sudo starten: sudo $0 <Benutzer>" >&2
	exit 1
fi
if [ "$REPO_ROOT" != "$DEPLOY_ROOT" ]; then
	cat >&2 <<-EOF
		Die Dienste erwarten das Repository unter $DEPLOY_ROOT. So holst du es
		(nur der Ordner xps-homeserver wird ausgecheckt):
		  sudo git clone --filter=blob:none --sparse <Fork-URL> $DEPLOY_ROOT
		  sudo git -C $DEPLOY_ROOT sparse-checkout set xps-homeserver
		  sudo $DEPLOY_ROOT/xps-homeserver/scripts/setup-xps.sh <Benutzer>
	EOF
	exit 1
fi
kiosk_user=${1:-$(cat "$CONFIG_DIR/kiosk-user" 2>/dev/null || echo "${SUDO_USER:-}")}
if [ -z "$kiosk_user" ] || ! id "$kiosk_user" >/dev/null 2>&1; then
	echo "Bitte den Linux-Benutzer für das Display angeben: sudo $0 <Benutzer>" >&2
	exit 1
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
/usr/local/sbin/xps-wl-guard >/dev/null

step "Benutzer und Einstellungen"
if ! id xps-dashboard >/dev/null 2>&1; then
	useradd --system --user-group --home-dir /var/lib/xps-dashboard --shell /usr/sbin/nologin xps-dashboard
fi
install -d -o xps-dashboard -g xps-dashboard -m 750 /var/lib/xps-dashboard
for group in video input render; do
	getent group "$group" >/dev/null && usermod -aG "$group" "$kiosk_user"
done
install -d -o "$kiosk_user" -g "$(id -gn "$kiosk_user")" -m 700 /var/lib/xps-kiosk
install -d -m 755 "$CONFIG_DIR"
echo "$kiosk_user" >"$CONFIG_DIR/kiosk-user"
[ -e "$CONFIG_DIR/dashboard.env" ] || install -m 600 "$XPS_ROOT/dashboard.env.example" "$CONFIG_DIR/dashboard.env"
[ -e "$CONFIG_DIR/host.env" ] || install -m 600 "$XPS_ROOT/host.env.example" "$CONFIG_DIR/host.env"
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

step "Dienste: Dashboard, Kiosk, AirPlay, Webcam, Dienste-Statistik"
for unit in "$XPS_ROOT"/deploy/systemd/*.service "$XPS_ROOT"/deploy/systemd/*.timer; do
	install -m 644 "$unit" /etc/systemd/system/
done
install -m 644 "$XPS_ROOT/deploy/tmpfiles/xps-homeserver.conf" /etc/tmpfiles.d/xps-homeserver.conf
systemd-tmpfiles --create /etc/tmpfiles.d/xps-homeserver.conf
ln -sfn "$XPS_ROOT/scripts/update-xps.sh" /usr/local/sbin/update-xps
systemctl daemon-reload
systemctl enable --now docker.service
systemctl enable xps-dashboard.service xps-services.service xps-ambient.service xps-airplay.service \
	"xps-kiosk@$kiosk_user.service" xps-kiosk-restart.timer
# Restart, so a new version of the code takes effect
systemctl restart xps-dashboard.service xps-services.service xps-ambient.service
systemctl restart xps-airplay.service || warn "AirPlay startet nicht: journalctl -u xps-airplay"
systemctl start "xps-kiosk@$kiosk_user.service" xps-kiosk-restart.timer

media=$XPS_ROOT/dashboard/web/media
if [ -z "$(ls -A "$media" 2>/dev/null)" ]; then
	step "Hintergrundvideos laden (Mixkit, einmalig)"
	"$XPS_ROOT/dashboard/scripts/fetch-backgrounds.sh" "$media" 1080 || warn "Videos fehlen; das Dashboard zeigt Farbverläufe"
fi

step "Umbrel"
"$XPS_ROOT/scripts/update-umbrel.sh" || warn "Umbrel ist noch nicht auf dem neuesten Stand (siehe oben)"

cat <<EOF

Fertig.
  Dashboard:  http://xps.local:7777 (und auf dem Display)
  Umbrel:     http://umbrel.local
  Einstellen: sudoedit $CONFIG_DIR/dashboard.env, dann sudo systemctl restart xps-dashboard
  Updates:    sudo update-xps
EOF
