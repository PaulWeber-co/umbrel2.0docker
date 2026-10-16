#!/bin/bash
# Clone the selected fork branch into /opt, configure the dashboard service,
# and start Design A on tty1 in Cage + Chromium kiosk mode.
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
SOURCE_ROOT=$(cd -- "$SCRIPT_DIR/../.." && pwd)
DEPLOY_ROOT=/opt/xps-homeserver
CONFIG_DIR=/etc/xps-homeserver
KIOSK_USER=${1:-${SUDO_USER:-}}
git_source() { git -C "$SOURCE_ROOT" -c safe.directory="$SOURCE_ROOT" "$@"; }

if [ "$(id -u)" -ne 0 ]; then
	echo "Bitte mit sudo starten: sudo $0 <Linux-Benutzer>" >&2
	exit 1
fi
if [ -z "$KIOSK_USER" ] || ! id "$KIOSK_USER" >/dev/null 2>&1; then
	echo "Bitte einen vorhandenen Linux-Benutzer angeben: sudo $0 <Linux-Benutzer>" >&2
	exit 1
fi

branch=$(git_source branch --show-current)
remote=$(git_source remote get-url origin)
if [ -z "$branch" ]; then
	echo "Das Quell-Repository muss auf einem Branch ausgecheckt sein." >&2
	exit 1
fi

if [ -e "$DEPLOY_ROOT" ]; then
	if [ ! -d "$DEPLOY_ROOT/.git" ]; then
		echo "$DEPLOY_ROOT existiert und ist kein Git-Checkout; bitte erst prüfen." >&2
		exit 1
	fi
	if [ "$(git -C "$DEPLOY_ROOT" -c safe.directory="$DEPLOY_ROOT" remote get-url origin)" != "$remote" ]; then
		echo "Das Checkout unter $DEPLOY_ROOT stammt aus einem anderen origin." >&2
		exit 1
	fi
	if [ -n "$(git -C "$DEPLOY_ROOT" -c safe.directory="$DEPLOY_ROOT" status --porcelain)" ]; then
		echo "Das Checkout unter $DEPLOY_ROOT hat lokale Änderungen; bitte erst prüfen." >&2
		exit 1
	fi
	if [ "$(git -C "$DEPLOY_ROOT" -c safe.directory="$DEPLOY_ROOT" branch --show-current)" != "$branch" ]; then
		echo "Unter $DEPLOY_ROOT ist ein anderer Branch ausgecheckt; bitte erst prüfen." >&2
		exit 1
	fi
	git -C "$DEPLOY_ROOT" -c safe.directory="$DEPLOY_ROOT" pull --ff-only origin "$branch"
else
	git clone --branch "$branch" --single-branch "$remote" "$DEPLOY_ROOT"
fi

if ! id xps-dashboard >/dev/null 2>&1; then
	useradd --system --user-group --home-dir /var/lib/xps-dashboard --create-home --shell /usr/sbin/nologin xps-dashboard
fi
install -d -o xps-dashboard -g xps-dashboard -m 755 /var/lib/xps-dashboard
install -d -m 755 "$CONFIG_DIR"
if [ ! -e "$CONFIG_DIR/dashboard.env" ]; then
	install -m 600 "$DEPLOY_ROOT/xps-homeserver/dashboard.env.example" "$CONFIG_DIR/dashboard.env"
fi

for group in video input; do
	getent group "$group" >/dev/null || groupadd --system "$group"
	usermod -aG "$group" "$KIOSK_USER"
done
install -d -o "$KIOSK_USER" -g "$(id -gn "$KIOSK_USER")" -m 700 /var/lib/xps-kiosk
install -m 644 "$DEPLOY_ROOT/xps-homeserver/deploy/systemd/xps-dashboard.service" /etc/systemd/system/xps-dashboard.service
install -m 644 "$DEPLOY_ROOT/xps-homeserver/deploy/systemd/xps-kiosk@.service" /etc/systemd/system/xps-kiosk@.service
install -m 644 "$DEPLOY_ROOT/xps-homeserver/deploy/systemd/xps-airplay.service" /etc/systemd/system/xps-airplay.service
systemctl enable --now docker.service
systemctl daemon-reload
systemctl enable --now xps-dashboard.service "xps-kiosk@$KIOSK_USER.service" xps-airplay.service

cat <<EOF
Dashboard ist eingerichtet.
  Browser: http://xps.local:8080
  Konfiguration: $CONFIG_DIR/dashboard.env
  Dienststatus: systemctl status xps-dashboard xps-kiosk@$KIOSK_USER
  AirPlay: systemctl status xps-airplay

Änderungen am Konfigurationsfile werden nach einem Dashboard-Neustart geladen:
  sudo systemctl restart xps-dashboard
EOF
