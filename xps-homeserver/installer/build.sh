#!/usr/bin/env bash
# Builds the XPS installer ISO: the official Debian 13 netinst ISO plus an
# offline package repository with the Broadcom wl Wi-Fi driver and a boot
# entry that installs the XPS without any questions. Runs on macOS and Linux
# and only needs Docker.
#
#   ./installer/build.sh
#
# Result: installer/out/xps-installer.iso (write it to a USB stick, see
# installer/README.md). An end-to-end test in QEMU: installer/test/qemu-test.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${XPS_ENV_FILE:-$ROOT/.env}"
BUILD_IMAGE="${XPS_BUILD_IMAGE:-debian:trixie}"
OUT_NAME="${XPS_OUT_NAME:-xps-installer.iso}"

die() {
	echo "Fehler: $*" >&2
	exit 1
}

# Reads KEY=VALUE lines without shell evaluation, so Wi-Fi passwords with $, `
# or quotes arrive unchanged. Variables already set in the environment win.
load_env() {
	[ -f "$1" ] || die "$1 fehlt. Kopiere .env.example nach .env und trag deine Werte ein."
	local line key value
	while IFS= read -r line || [ -n "$line" ]; do
		line="${line%$'\r'}"
		case "$line" in '' | '#'*) continue ;; esac
		key="${line%%=*}"
		value="${line#*=}"
		[ "$key" != "$line" ] || continue
		case "$key" in XPS_[A-Z_]*) ;; *) continue ;; esac
		[ -z "${!key+x}" ] || continue
		case "$value" in
		\"*\")
			value="${value#\"}"
			value="${value%\"}"
			;;
		\'*\')
			value="${value#\'}"
			value="${value%\'}"
			;;
		esac
		export "$key=$value"
	done <"$1"
}

require() {
	[ -n "${!1:-}" ] || die "$1 ist in $ENV_FILE nicht gesetzt."
}

load_env "$ENV_FILE"

for var in XPS_HOSTNAME XPS_USER XPS_FULLNAME XPS_WIFI_SSID XPS_WIFI_PSK XPS_SSH_PUBKEY_FILE XPS_TIMEZONE XPS_LOCALE XPS_KEYMAP; do
	require "$var"
done

[[ "$XPS_HOSTNAME" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]] || die "XPS_HOSTNAME: nur Kleinbuchstaben, Ziffern und Bindestriche."
[[ "$XPS_USER" =~ ^[a-z][a-z0-9_-]*$ ]] || die "XPS_USER: Kleinbuchstaben am Anfang, dann Kleinbuchstaben, Ziffern, _ oder -."
[ "${#XPS_WIFI_SSID}" -le 32 ] || die "XPS_WIFI_SSID ist länger als 32 Zeichen."
if [ "${#XPS_WIFI_PSK}" -lt 8 ] || [ "${#XPS_WIFI_PSK}" -gt 64 ]; then
	die "XPS_WIFI_PSK muss 8 bis 64 Zeichen lang sein."
fi

pubkey_file="${XPS_SSH_PUBKEY_FILE/#\~/$HOME}"
[ -f "$pubkey_file" ] || die "SSH-Schlüssel $pubkey_file nicht gefunden. Auf dem Mac anlegen mit: ssh-keygen -t ed25519"
XPS_SSH_PUBKEY="$(head -n1 "$pubkey_file")"
case "$XPS_SSH_PUBKEY" in ssh-* | ecdsa-* | sk-*) ;; *) die "$pubkey_file sieht nicht wie ein öffentlicher SSH-Schlüssel aus." ;; esac
export XPS_SSH_PUBKEY

if [ -z "${XPS_PASSWORD:-}" ]; then
	read -rsp "Passwort für $XPS_USER auf dem XPS (Login am Gerät): " XPS_PASSWORD
	echo
	read -rsp "Nochmal: " password_repeat
	echo
	[ "$XPS_PASSWORD" = "$password_repeat" ] || die "Die Passwörter stimmen nicht überein."
	[ -n "$XPS_PASSWORD" ] || die "Leeres Passwort."
fi
export XPS_PASSWORD

command -v docker >/dev/null || die "Docker fehlt. Installiere Docker Desktop und starte es."
docker info >/dev/null 2>&1 || die "Docker läuft nicht. Starte Docker Desktop."

mkdir -p "$ROOT/installer/out" "$ROOT/installer/cache"

# Behind a TLS-intercepting proxy, XPS_CA_BUNDLE points at its CA certificates.
ca_args=()
if [ -n "${XPS_CA_BUNDLE:-}" ]; then
	ca_args=(-v "$XPS_CA_BUNDLE:/etc/xps-ca-bundle.crt:ro" -e CURL_CA_BUNDLE=/etc/xps-ca-bundle.crt)
fi

# ${a[@]+...} keeps an empty array working under set -u in macOS's bash 3.2
docker run --rm --platform linux/amd64 ${ca_args[@]+"${ca_args[@]}"} \
	-e XPS_HOSTNAME -e XPS_USER -e XPS_FULLNAME -e XPS_PASSWORD -e XPS_SSH_PUBKEY \
	-e XPS_WIFI_SSID -e XPS_WIFI_PSK -e XPS_TIMEZONE -e XPS_LOCALE -e XPS_KEYMAP \
	-e XPS_ISO_BASE_URL -e XPS_TEST_AUTOBOOT \
	-e XPS_OUT_NAME="$OUT_NAME" -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
	-v "$ROOT/installer:/installer" \
	"$BUILD_IMAGE" bash /installer/container/build-iso.sh

echo
echo "Fertig: installer/out/$OUT_NAME"
echo "Weiter geht's in installer/README.md (USB-Stick schreiben, BIOS, Installation)."
