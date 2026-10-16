# Helpers for the provisioning steps in steps/. Sourced by run.sh; every step
# runs as root on the XPS with this repository at $XPS_DIR (/opt/xps-homeserver).
#
# The steps are idempotent: running them again changes only what differs and
# restarts only services whose files changed. Settings come from
# /etc/xps-homeserver/xps.env, which apply.sh writes from the Mac's .env.
#
# Steps run with set -euo pipefail. install_file, render and write_file return
# 1 when nothing changed, so never call them bare: write
#   install_file a b && changed=1        or        install_file a b || true
# shellcheck shell=bash

XPS_DIR="${XPS_DIR:-/opt/xps-homeserver}"
# Used by the steps that source this file
# shellcheck disable=SC2034
XPS_ETC=/etc/xps-homeserver
# shellcheck disable=SC2034
FILES="$XPS_DIR/provision/files"
export DEBIAN_FRONTEND=noninteractive

log() { printf '    %s\n' "$*"; }
warn() { printf '    WARNUNG: %s\n' "$*" >&2; }
die() {
	printf '    FEHLER: %s\n' "$*" >&2
	exit 1
}

# Loads KEY=VALUE lines without shell evaluation (same rules as installer/build.sh).
# Variables already set in the environment win.
load_env() {
	local file=$1 line key value
	[ -f "$file" ] || return 0
	while IFS= read -r line || [ -n "$line" ]; do
		line="${line%$'\r'}"
		case "$line" in '' | '#'*) continue ;; esac
		key="${line%%=*}"
		value="${line#*=}"
		[ "$key" != "$line" ] || continue
		[[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || continue
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
	done <"$file"
}

# apt-get install for the packages that are not installed yet.
apt_install() {
	local missing=() pkg
	for pkg in "$@"; do
		dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null | grep -q 'install ok installed' || missing+=("$pkg")
	done
	[ "${#missing[@]}" -eq 0 ] && return 0
	log "Installiere ${missing[*]}"
	if [ -z "${APT_UPDATED:-}" ]; then
		apt-get update -qq
		APT_UPDATED=1
	fi
	apt-get install -y -qq --no-install-recommends "${missing[@]}" >/dev/null
}

# Prints the first package name that apt knows, for packages renamed between releases.
first_available_pkg() {
	local pkg
	for pkg in "$@"; do
		if apt-cache show "$pkg" >/dev/null 2>&1; then
			echo "$pkg"
			return 0
		fi
	done
	return 1
}

# install_file SRC DEST [MODE] [OWNER:GROUP]
# Copies SRC to DEST when the content, mode or owner differs. Returns 0 when
# something changed and 1 when DEST was already right, so callers can write:
#   install_file a b 644 && restart=1
install_file() {
	local src=$1 dest=$2 mode=${3:-644} owner=${4:-root:root}
	if [ -f "$dest" ] && cmp -s "$src" "$dest" &&
		[ "$(stat -c '%a %U:%G' "$dest")" = "$mode $owner" ]; then
		return 1
	fi
	install -D -m "$mode" -o "${owner%%:*}" -g "${owner##*:}" "$src" "$dest"
	log "aktualisiert: $dest"
	return 0
}

# render SRC DEST [MODE] [OWNER:GROUP]: like install_file, but replaces
# @@NAME@@ with the value of the environment variable NAME first. An unknown
# placeholder is an error, so a typo never ends up in a config file.
render() {
	local src=$1 dest=$2 tmp
	tmp=$(mktemp)
	if ! perl -pe 's/@@([A-Z][A-Z0-9_]*)@@/exists $ENV{$1} ? $ENV{$1} : die "unbekannter Platzhalter $1 in '"$src"'\n"/ge' "$src" >"$tmp"; then
		rm -f "$tmp"
		die "Vorlage $src konnte nicht gefüllt werden"
	fi
	local rc=0
	install_file "$tmp" "$dest" "${3:-644}" "${4:-root:root}" || rc=$?
	rm -f "$tmp"
	return "$rc"
}

# Writes a string to a file through install_file.
write_file() {
	local dest=$1 content=$2 tmp rc=0
	tmp=$(mktemp)
	printf '%s\n' "$content" >"$tmp"
	install_file "$tmp" "$dest" "${3:-644}" "${4:-root:root}" || rc=$?
	rm -f "$tmp"
	return "$rc"
}

# A system user without login for a service.
ensure_system_user() {
	local user=$1 home=${2:-/nonexistent}
	id "$user" >/dev/null 2>&1 && return 0
	useradd --system --home-dir "$home" --no-create-home --shell /usr/sbin/nologin "$user"
	log "Benutzer $user angelegt"
}

# Enables and starts a unit; restarts it when $2 is 1 (its files changed).
enable_unit() {
	local unit=$1 changed=${2:-0}
	systemctl daemon-reload
	if ! systemctl is-enabled --quiet "$unit" 2>/dev/null; then
		systemctl enable --quiet "$unit"
	fi
	if [ "$changed" = 1 ] && systemctl is-active --quiet "$unit"; then
		systemctl restart "$unit"
		log "neu gestartet: $unit"
	elif ! systemctl is-active --quiet "$unit"; then
		systemctl start "$unit" || warn "$unit startet nicht, siehe: journalctl -u $unit -n 50"
	fi
}
