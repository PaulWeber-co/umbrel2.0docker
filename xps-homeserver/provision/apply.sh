#!/usr/bin/env bash
# Runs on the Mac: copies this project to the XPS (/opt/xps-homeserver),
# writes the settings from .env to /etc/xps-homeserver/ and starts the setup.
#
#   ./provision/apply.sh                  everything, to <XPS_USER>@<XPS_HOSTNAME>.local
#   ./provision/apply.sh 50 60            only steps 50-* and 60-*
#   XPS_SSH=paul@192.168.2.40 ./provision/apply.sh   another address
#
# Needs only ssh and rsync; the XPS user has sudo without a password (installer).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${XPS_ENV_FILE:-$ROOT/.env}"
[ -f "$ENV_FILE" ] || { echo "Fehler: $ENV_FILE fehlt (cp .env.example .env)." >&2; exit 1; }

value() { grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- || true; }
TARGET="${XPS_SSH:-$(value XPS_USER)@$(value XPS_HOSTNAME).local}"
SSH=(ssh -o ConnectTimeout=10 "$TARGET")

echo "==> Verbindung zu $TARGET"
"${SSH[@]}" true || { echo "Fehler: $TARGET nicht per SSH erreichbar." >&2; exit 1; }
"${SSH[@]}" 'command -v rsync >/dev/null || sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq rsync >/dev/null'

echo "==> Projekt nach /opt/xps-homeserver kopieren"
rsync -az --delete --rsync-path="sudo rsync" \
	--exclude .git --exclude .env --exclude 'installer/out/' --exclude 'installer/cache/' \
	--exclude '*/media/' --exclude 'dashboard/data/' --exclude node_modules \
	"$ROOT/" "$TARGET:/opt/xps-homeserver/"

echo "==> Einstellungen nach /etc/xps-homeserver"
# Each service gets only its own keys; the Wi-Fi password and the installer
# password stay on the Mac. "|| true": a group without keys is fine.
"${SSH[@]}" 'sudo install -d -m 755 /etc/xps-homeserver'
{ grep -E '^(XPS_(USER|HOSTNAME|TIMEZONE|LOCALE|AIRPLAY_[A-Z_]+|UMBREL_[A-Z_]+|BATTERY_[A-Z_]+)|UMBREL_[A-Z_]+)=' "$ENV_FILE" || true; } |
	"${SSH[@]}" 'sudo tee /etc/xps-homeserver/xps.env >/dev/null && sudo chmod 600 /etc/xps-homeserver/xps.env'
{ grep -E '^DASH_[A-Z0-9_]+=' "$ENV_FILE" || true; } |
	"${SSH[@]}" 'sudo tee /etc/xps-homeserver/dashboard.env >/dev/null && sudo chmod 640 /etc/xps-homeserver/dashboard.env'
{ grep -E '^AMBIENT_[A-Z0-9_]+=' "$ENV_FILE" || true; } |
	"${SSH[@]}" 'sudo tee /etc/xps-homeserver/ambient.env >/dev/null && sudo chmod 640 /etc/xps-homeserver/ambient.env'

echo "==> Einrichtung auf dem XPS"
ssh -t -o ConnectTimeout=10 "$TARGET" sudo /opt/xps-homeserver/provision/run.sh "$@"
