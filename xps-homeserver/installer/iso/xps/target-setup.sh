#!/bin/bash
# Runs inside the freshly installed system (chroot, started by late.sh via
# in-target) at the end of the automatic installation. Installs the Broadcom wl
# driver and the base tools from the offline repository on the stick, sets up
# Wi-Fi, SSH and mDNS, and fails the installation if wl didn't build.
set -euo pipefail

SRC=/opt/xps-install
LOG=/var/log/xps-install.log
export DEBIAN_FRONTEND=noninteractive

step() { printf '\n==> %s\n' "$*"; }

main() {
	# shellcheck source=/dev/null
	. "$SRC/config.env"
	# shellcheck source=SCRIPTDIR/host-files.sh
	. "$SRC/host-files.sh"
	install_packages
	build_wifi_driver
	install_host_configuration
	systemctl enable docker
	configure_apt_sources
	configure_wifi
	configure_ssh
	configure_sudo
	configure_console
	write_install_info
	cleanup
	step "Fertig"
}

install_host_configuration() {
	step "Server-Betrieb: Updates, Kernel-Wächter, Watchdogs, zram, kein Standby"
	install_host_files "$SRC/host"
	systemctl enable apt-daily.timer apt-daily-upgrade.timer
	update-grub
}

install_packages() {
	step "Pakete aus der Offline-Paketquelle installieren"
	# Only the offline repository: the cdrom entries the installer wrote can't
	# be read from inside the chroot.
	echo "deb [trusted=yes] file:$SRC/repo ./" >"$SRC/offline.list"
	mkdir -p "$SRC/no-sources.d"
	local apt_offline=(-o "Dir::Etc::SourceList=$SRC/offline.list" -o "Dir::Etc::SourceParts=$SRC/no-sources.d")
	apt-get "${apt_offline[@]}" update
	# shellcheck disable=SC2046
	apt-get "${apt_offline[@]}" install -y $(grep -vE '^[[:space:]]*(#|$)' "$SRC/packages.txt")
}

build_wifi_driver() {
	step "WLAN-Treiber wl für jeden Kernel bauen"
	local kver newest
	for kver in $(linux-version list); do
		if [ -e "/lib/modules/$kver/build" ]; then
			dkms autoinstall -k "$kver" || echo "Warnung: wl für $kver nicht gebaut"
		fi
	done
	dkms status

	# GRUB boots the newest kernel, so that one must have wl.
	newest=$(linux-version list | linux-version sort | tail -n1)
	if ! modinfo -k "$newest" -n wl >/dev/null 2>&1; then
		echo "FEHLER: Der WLAN-Treiber wl wurde für Kernel $newest nicht gebaut."
		return 1
	fi
	echo "wl für $newest: $(modinfo -k "$newest" -n wl)"
}

configure_apt_sources() {
	step "Debian-Paketquellen fürs WLAN eintragen"
	install -m 644 "$SRC/debian.sources" /etc/apt/sources.list.d/debian.sources
	echo "# Paketquellen stehen in /etc/apt/sources.list.d/debian.sources" >/etc/apt/sources.list
}

configure_wifi() {
	step "WLAN einrichten"
	cat >/etc/NetworkManager/conf.d/10-xps-wifi.conf <<-'EOF'
		# XPS homeserver: Wi-Fi power saving off for stable latency and fewer
		# dropouts with the wl driver; keep the real MAC so the Speedport's DHCP
		# reservation always matches.
		[connection]
		wifi.powersave=2

		[device]
		wifi.scan-rand-mac-address=no
	EOF

	# nmcli --offline writes a correctly escaped keyfile without a running daemon.
	local profile=/etc/NetworkManager/system-connections/heim-wlan.nmconnection
	nmcli --offline connection add type wifi con-name heim-wlan \
		ssid "$XPS_WIFI_SSID" \
		wifi-sec.key-mgmt wpa-psk wifi-sec.psk "$XPS_WIFI_PSK" \
		wifi.powersave disable \
		connection.autoconnect yes connection.autoconnect-retries 0 \
		>"$profile"
	chmod 600 "$profile"
}

configure_ssh() {
	step "SSH: nur Schlüssel, kein Passwort, kein root"
	local home
	home=$(getent passwd "$XPS_USER" | cut -d: -f6)
	install -d -m 700 -o "$XPS_USER" -g "$XPS_USER" "$home/.ssh"
	printf '%s\n' "$XPS_SSH_PUBKEY" >"$home/.ssh/authorized_keys"
	chown "$XPS_USER:$XPS_USER" "$home/.ssh/authorized_keys"
	chmod 600 "$home/.ssh/authorized_keys"

	cat >/etc/ssh/sshd_config.d/10-xps.conf <<-'EOF'
		# XPS homeserver: key login only
		PasswordAuthentication no
		KbdInteractiveAuthentication no
		PermitRootLogin no
	EOF
}

configure_sudo() {
	step "sudo ohne Passwort für $XPS_USER (Login geht nur per SSH-Schlüssel oder am Gerät)"
	local file="/etc/sudoers.d/90-xps-$XPS_USER"
	echo "$XPS_USER ALL=(ALL) NOPASSWD:ALL" >"$file"
	chmod 440 "$file"
	visudo -cf "$file"
}

configure_console() {
	step "Anmeldebildschirm zeigt IP-Adresse und SSH-Befehl"
	cat >/etc/issue <<-EOF
		Debian GNU/Linux 13 \n \l

		XPS-Homeserver  |  IP: \4  |  ssh $XPS_USER@$XPS_HOSTNAME.local

	EOF
}

write_install_info() {
	mkdir -p /etc/xps-homeserver
	cat >/etc/xps-homeserver/install-info <<-EOF
		installed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
		iso=$XPS_ISO_NAME
		kernels=$(linux-version list | linux-version sort | tr '\n' ' ')
		wl=$(dkms status broadcom-sta | tr '\n' ';')
	EOF
}

cleanup() {
	step "Aufräumen"
	# config.env holds the Wi-Fi password; it now lives only in the
	# root-only NetworkManager profile.
	rm -rf "$SRC/repo" "$SRC/config.env" "$SRC/offline.list" "$SRC/no-sources.d"
	rm -f /var/lib/apt/lists/*opt_xps-install*
	apt-get clean
}

main 2>&1 | tee -a "$LOG"
exit "${PIPESTATUS[0]}"
