#!/bin/bash
# Runs inside debian:trixie, started by installer/build.sh. Downloads the
# current Debian 13 netinst ISO, builds an offline package repository with the
# Broadcom wl driver and everything around it, and repacks the ISO with a
# preseeded "install the XPS automatically" boot entry.
set -euo pipefail

IN=/installer
CACHE=$IN/cache
OUT=$IN/out
WORK=$(mktemp -d)
ISO_BASE_URL=${XPS_ISO_BASE_URL:-https://cdimage.debian.org/debian-cd/current/amd64/iso-cd}

step() { printf '\n==> %s\n' "$*"; }
die() {
	echo "Fehler: $*" >&2
	exit 1
}

setup_apt() {
	step "Debian-Paketquellen einrichten"
	rm -f /etc/apt/sources.list.d/debian.sources
	cp "$IN/iso/xps/debian.sources" /etc/apt/sources.list.d/debian.sources
	apt-get update -qq
	DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
		xorriso apt-utils openssl curl ca-certificates >/dev/null
}

fetch_iso() {
	step "Debian-Installer-ISO holen"
	curl -fsSL "$ISO_BASE_URL/SHA256SUMS" -o "$WORK/SHA256SUMS"
	ISO_NAME=$(grep -oE 'debian-13\.[0-9]+\.[0-9]+-amd64-netinst\.iso' "$WORK/SHA256SUMS" | head -n1)
	[ -n "$ISO_NAME" ] || die "Kein Debian-13-netinst-ISO unter $ISO_BASE_URL. Setz XPS_ISO_BASE_URL auf das Archiv von Debian 13."
	grep " $ISO_NAME\$" "$WORK/SHA256SUMS" >"$WORK/iso.sha256"
	if ! (cd "$CACHE" && sha256sum --check --quiet "$WORK/iso.sha256" 2>/dev/null); then
		curl -fL --progress-bar "$ISO_BASE_URL/$ISO_NAME" -o "$CACHE/$ISO_NAME.part"
		mv "$CACHE/$ISO_NAME.part" "$CACHE/$ISO_NAME"
		(cd "$CACHE" && sha256sum --check --quiet "$WORK/iso.sha256") || die "Prüfsumme von $ISO_NAME stimmt nicht."
	fi
	ISO="$CACHE/$ISO_NAME"
	echo "$ISO_NAME"
}

# The installer puts the kernel from the ISO on the disk. Its headers let DKMS
# build wl for it as well, so it stays a working fallback next to the newest
# kernel from the offline repository.
iso_kernel_version() {
	xorriso -indev "$ISO" -find /pool/main/l/linux-signed-amd64 -name 'linux-image-*-amd64_*.deb' 2>/dev/null |
		sed -nE "s|.*/linux-image-([0-9][^_]*-amd64)_.*|\1|p" | head -n1
}

build_repo() {
	step "Offline-Paketquelle bauen (WLAN-Treiber, SSH, NetworkManager, ...)"
	local packages iso_kver
	packages=$(grep -vE '^[[:space:]]*(#|$)' "$IN/iso/xps/packages.txt" | tr '\n' ' ')
	iso_kver=$(iso_kernel_version)
	if [ -n "$iso_kver" ] && apt-cache show "linux-headers-$iso_kver" >/dev/null 2>&1; then
		packages="$packages linux-headers-$iso_kver"
	else
		echo "Hinweis: keine Header für den ISO-Kernel ${iso_kver:-?}, wl wird nur für den neuesten Kernel gebaut."
	fi

	# An empty dpkg status makes apt download the complete dependency closure,
	# whatever the freshly installed base system already has or lacks.
	mkdir -p "$WORK/xps/repo/partial"
	: >"$WORK/empty-status"
	# shellcheck disable=SC2086
	apt-get -q -y --download-only \
		-o Dir::State::status="$WORK/empty-status" \
		-o Dir::Cache::archives="$WORK/xps/repo" \
		-o APT::Sandbox::User=root \
		install $packages >"$WORK/apt-download.log" || {
		cat "$WORK/apt-download.log"
		die "Pakete konnten nicht geladen werden."
	}
	rmdir "$WORK/xps/repo/partial"
	rm -f "$WORK/xps/repo/lock"
	(cd "$WORK/xps/repo" && apt-ftparchive packages . >Packages)
	echo "$(find "$WORK/xps/repo" -name '*.deb' | wc -l) Pakete, $(du -sh "$WORK/xps/repo" | cut -f1)"
}

write_config() {
	step "Einstellungen für die Installation schreiben"
	cp "$IN/iso/xps/"*.sh "$IN/iso/xps/packages.txt" "$IN/iso/xps/debian.sources" "$WORK/xps/"
	cp -a "$IN/iso/xps/host" "$WORK/xps/host"

	# Read by target-setup.sh inside the new system and deleted there afterwards.
	{
		printf 'XPS_HOSTNAME=%q\n' "$XPS_HOSTNAME"
		printf 'XPS_USER=%q\n' "$XPS_USER"
		printf 'XPS_SSH_PUBKEY=%q\n' "$XPS_SSH_PUBKEY"
		printf 'XPS_WIFI_SSID=%q\n' "$XPS_WIFI_SSID"
		printf 'XPS_WIFI_PSK=%q\n' "$XPS_WIFI_PSK"
		printf 'XPS_ISO_NAME=%q\n' "$ISO_NAME"
	} >"$WORK/xps/config.env"

	XPS_PASSWORD_HASH=$(printf '%s\n' "$XPS_PASSWORD" | openssl passwd -6 -stdin)
	export XPS_PASSWORD_HASH
	unset XPS_PASSWORD
	render "$IN/iso/preseed.cfg" >"$WORK/preseed.cfg"
}

# Replaces @@NAME@@ with the value of $XPS_NAME and fails on unknown names.
render() {
	perl -pe 's/@@([A-Z_]+)@@/exists $ENV{"XPS_$1"} ? $ENV{"XPS_$1"} : die "unbekannter Platzhalter $1\n"/ge' "$1"
}

write_grub_menu() {
	step "Boot-Menü ergänzen"
	xorriso -osirrox on -indev "$ISO" -extract /boot/grub/grub.cfg "$WORK/grub.orig.cfg" 2>/dev/null
	chmod u+w "$WORK/grub.orig.cfg"

	XPS_KERNEL_EXTRA=""
	if [ "${XPS_TEST_AUTOBOOT:-}" = 1 ]; then
		# QEMU test: pick the entry on its own. No serial console: the installer
		# would move there and, unable to show German, stop to ask for a language.
		XPS_KERNEL_EXTRA=""
		printf 'set default=0\nset timeout=3\n' >"$WORK/grub.entry"
	else
		: >"$WORK/grub.entry"
	fi
	export XPS_KERNEL_EXTRA
	render "$IN/iso/grub-entry.cfg" >>"$WORK/grub.entry"

	# Our entry goes first; the stock Debian entries stay available below it.
	awk -v entry="$WORK/grub.entry" '
		!done && /^menuentry/ { while ((getline line < entry) > 0) print line; print ""; done = 1 }
		{ print }
	' "$WORK/grub.orig.cfg" >"$WORK/grub.cfg"
	grep -q "XPS automatisch installieren" "$WORK/grub.cfg" || die "Boot-Menü konnte nicht ergänzt werden."
}

repack_iso() {
	step "ISO neu packen"
	xorriso -indev "$ISO" -outdev "$WORK/$XPS_OUT_NAME" \
		-map "$WORK/preseed.cfg" /preseed.cfg \
		-map "$WORK/xps" /xps \
		-map "$WORK/grub.cfg" /boot/grub/grub.cfg \
		-boot_image any replay 2>&1 | grep -E '^(xorriso : (UPDATE|FAILURE|SORRY)|libisofs: (FAILURE|SORRY))' || true
	[ -s "$WORK/$XPS_OUT_NAME" ] || die "ISO wurde nicht geschrieben."
	mv "$WORK/$XPS_OUT_NAME" "$OUT/$XPS_OUT_NAME"
	(cd "$OUT" && sha256sum "$XPS_OUT_NAME" >"$XPS_OUT_NAME.sha256")
	chown "${HOST_UID:-0}:${HOST_GID:-0}" "$OUT/$XPS_OUT_NAME" "$OUT/$XPS_OUT_NAME.sha256" "$CACHE" "$CACHE/$ISO_NAME" 2>/dev/null || true
	ls -lh "$OUT/$XPS_OUT_NAME"
}

setup_apt
fetch_iso
build_repo
write_config
write_grub_menu
repack_iso
rm -rf "$WORK"
