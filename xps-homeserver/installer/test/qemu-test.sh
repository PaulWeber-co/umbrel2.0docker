#!/usr/bin/env bash
# End-to-end test of the installer: builds a test ISO, installs it into a
# QEMU VM exactly like on the XPS (UEFI, NVMe SSD, ISO on a USB stick, no
# network), boots the installed system and checks it over SSH.
#
#   installer/test/qemu-test.sh
#
# Linux only. Needs docker, qemu-system-x86_64, OVMF, ssh and python3. Uses KVM when
# /dev/kvm exists (about 15 minutes), otherwise software emulation (1-2 hours).
# The VM has no Broadcom card, so the test checks that wl is built and
# installed for the kernel, not that it connects.
# The checks run their commands on the VM: single quotes on purpose.
# shellcheck disable=SC2016
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
T="$ROOT/installer/out/test"
ISO="$ROOT/installer/out/xps-installer-test.iso"
SSH_PORT="${XPS_TEST_SSH_PORT:-2222}"
TEST_USER=xpstest
TEST_HOST=xps-test
TEST_SSID='Test WLAN; "mit" Sonderzeichen'
# Deliberately full of characters a shell would expand
# shellcheck disable=SC2016
TEST_PSK='p@ss w0rd $HOME `x` \n'

mkdir -p "$T"
# Unix socket paths are limited to 108 bytes, so the QEMU monitor lives in /tmp
MON_DIR=$(mktemp -d /tmp/xps-qemu.XXXXXX)
trap 'rm -rf "$MON_DIR"' EXIT

find_ovmf() {
	local dir
	for dir in /usr/share/OVMF /usr/share/ovmf /usr/share/edk2/x64; do
		if [ -f "$dir/OVMF_CODE_4M.fd" ]; then
			OVMF_CODE="$dir/OVMF_CODE_4M.fd" OVMF_VARS="$dir/OVMF_VARS_4M.fd"
			return
		fi
	done
	echo "OVMF (UEFI-Firmware für QEMU) nicht gefunden" >&2
	exit 1
}

build_test_iso() {
	[ -f "$T/id_test" ] || ssh-keygen -q -t ed25519 -N '' -C xps-test -f "$T/id_test"
	cat >"$T/test.env" <<-EOF
		XPS_HOSTNAME=$TEST_HOST
		XPS_USER=$TEST_USER
		XPS_FULLNAME=XPS Test
		XPS_PASSWORD=test
		XPS_SSH_PUBKEY_FILE=$T/id_test.pub
		XPS_WIFI_SSID=$TEST_SSID
		XPS_WIFI_PSK=$TEST_PSK
		XPS_TIMEZONE=Europe/Berlin
		XPS_LOCALE=de_DE.UTF-8
		XPS_KEYMAP=de
	EOF
	XPS_ENV_FILE="$T/test.env" XPS_TEST_AUTOBOOT=1 XPS_OUT_NAME="$(basename "$ISO")" "$ROOT/installer/build.sh"
}

# Common VM settings: UEFI, 2 GB RAM, the "internal" NVMe SSD.
vm_args() {
	VM_ARGS=(-accel tcg -cpu max)
	[ -w /dev/kvm ] && VM_ARGS=(-accel kvm -cpu host)
	VM_ARGS+=(-machine q35 -m 2048 -smp "$(nproc)"
		-drive "if=pflash,format=raw,readonly=on,file=$OVMF_CODE"
		-drive "if=pflash,format=raw,file=$T/vars.fd"
		-drive "if=none,id=ssd,format=qcow2,file=$T/ssd.qcow2"
		-device "nvme,serial=xps-ssd,drive=ssd,bootindex=2"
		-display none)
}

# Saves what the VM shows on its screen as a PNG, through the QEMU monitor.
screenshot() {
	python3 - "$MON_DIR/monitor.sock" "screendump $1 -f png" <<-'PY' >/dev/null 2>&1 || true
		import socket, sys, time
		s = socket.socket(socket.AF_UNIX)
		s.connect(sys.argv[1])
		s.sendall((sys.argv[2] + "\n").encode())
		time.sleep(1)
	PY
}

install() {
	echo "==> Installation in der VM (offline, wie auf dem XPS)"
	cp "$OVMF_VARS" "$T/vars.fd"
	rm -f "$T/ssd.qcow2" "$T/install-screen.png"
	qemu-img create -q -f qcow2 "$T/ssd.qcow2" 32G
	# The installer reboots when it's done; -no-reboot turns that into an exit.
	qemu-system-x86_64 "${VM_ARGS[@]}" \
		-device qemu-xhci \
		-drive "if=none,id=stick,format=raw,readonly=on,file=$ISO" \
		-device usb-storage,drive=stick,bootindex=1 \
		-nic none -serial "file:$T/install-serial.log" -no-reboot \
		-monitor "unix:$MON_DIR/monitor.sock,server,nowait" &
	local vm=$! waited=0 limit="${XPS_TEST_INSTALL_TIMEOUT:-10800}"
	# A question the preseed doesn't answer stops the installer silently, so
	# keep a current screenshot to see where it stands.
	while kill -0 "$vm" 2>/dev/null; do
		if [ "$waited" -ge "$limit" ]; then
			kill "$vm"
			wait "$vm" 2>/dev/null || true
			echo "Installation hängt nach $((limit / 60)) Minuten. Letztes Bild: $T/install-screen.png" >&2
			exit 1
		fi
		screenshot "$T/install-screen.png"
		sleep 30
		waited=$((waited + 30))
	done
	wait "$vm" || {
		echo "QEMU ist mit einem Fehler beendet worden. Letztes Bild: $T/install-screen.png" >&2
		exit 1
	}
	echo "Installation nach $((waited / 60)) Minuten abgeschlossen"
}

ssh_vm() {
	ssh -q -i "$T/id_test" -p "$SSH_PORT" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
		-o ConnectTimeout=5 -o BatchMode=yes "$TEST_USER@127.0.0.1" "$@"
}

boot_and_check() {
	echo "==> Installiertes System starten"
	qemu-system-x86_64 "${VM_ARGS[@]}" -nic "user,model=virtio-net-pci,hostfwd=tcp:127.0.0.1:$SSH_PORT-:22" \
		-serial "file:$T/boot-serial.log" &
	local vm=$! tries=0
	trap 'kill $vm 2>/dev/null || true; rm -rf "$MON_DIR"' EXIT
	until ssh_vm true 2>/dev/null; do
		tries=$((tries + 1))
		[ "$tries" -lt 180 ] || {
			echo "SSH kommt nicht hoch" >&2
			exit 1
		}
		sleep 10
	done

	echo "==> Prüfen"
	local failed=0
	check() {
		local name=$1
		shift
		if "$@" >/dev/null 2>&1; then echo "  ok    $name"; else
			echo "  FEHLER $name"
			failed=1
		fi
	}
	check "SSH-Login mit Schlüssel, sudo ohne Passwort" ssh_vm sudo -n true
	check "Hostname" test "$(ssh_vm hostname)" = "$TEST_HOST"
	# modinfo and dkms live in /usr/sbin, which is not on a normal user's PATH
	check "Neuester Kernel läuft" ssh_vm 'test "$(uname -r)" = "$(linux-version list | linux-version sort | tail -n1)"'
	check "wl für den laufenden Kernel gebaut" ssh_vm 'sudo modinfo -n wl | grep -q updates/dkms'
	check "DKMS meldet broadcom-sta installiert" ssh_vm 'sudo dkms status broadcom-sta | grep -q installed'
	check "Broadcom-Konfliktmodule gesperrt" ssh_vm 'grep -rqs "blacklist b43" /etc/modprobe.d/'
	check "WLAN-Profil: SSID" test "$(ssh_vm sudo nmcli --escape no -g 802-11-wireless.ssid connection show heim-wlan)" = "$TEST_SSID"
	check "WLAN-Profil: Passwort" test "$(ssh_vm sudo nmcli --escape no -s -g 802-11-wireless-security.psk connection show heim-wlan)" = "$TEST_PSK"
	check "WLAN-Stromsparen aus" ssh_vm 'nmcli -g 802-11-wireless.powersave connection show heim-wlan | grep -q "2\|disable"'
	local unit
	for unit in ssh NetworkManager avahi-daemon systemd-timesyncd; do
		check "Dienst $unit läuft" ssh_vm systemctl is-active --quiet "$unit"
	done
	for unit in xps-wl-guard.timer xps-wifi-watchdog xps-mdns-alias docker; do
		check "Dienst $unit aktiv" ssh_vm systemctl is-active --quiet "$unit"
	done
	check "Kernel-Wächter: neuester Kernel hat wl" ssh_vm 'grep -q "^ok " /var/lib/xps-homeserver/wl-status'
	check "Kernel-Hook blockiert dpkg nie" ssh_vm 'test -x /etc/kernel/postinst.d/zz-xps-wl-guard && test ! -e /etc/kernel/postinst.d/xps-wl-check'
	check "GRUB startet den gespeicherten Kernel" ssh_vm 'grep -q "set default=\"\${saved_entry}\"" /boot/grub/grub.cfg'
	check "Kein Standby" ssh_vm 'test "$(systemctl is-enabled suspend.target)" = masked'
	check "Hardware-Watchdog eingestellt" ssh_vm 'test "$(systemctl show -p RuntimeWatchdogUSec --value)" = 30s'
	check "zram-Swap aktiv" ssh_vm 'grep -q zram /proc/swaps'
	check "Sicherheitsupdates automatisch" ssh_vm 'apt-config dump | grep -q "APT::Periodic::Unattended-Upgrade \"1\""'
	check "Passwort-Login per SSH aus" ssh_vm 'sudo sshd -T | grep -qx "passwordauthentication no"'
	check "root-Login per SSH aus" ssh_vm 'sudo sshd -T | grep -qx "permitrootlogin no"'
	check "Debian-Paketquellen inkl. non-free" ssh_vm 'grep -q "non-free " /etc/apt/sources.list.d/debian.sources'
	check "WLAN-Passwort nicht mehr auf der Platte verstreut" ssh_vm 'test ! -e /opt/xps-install/config.env'
	check "Installationsprotokoll endet mit Fertig" ssh_vm 'sudo tail -n1 /var/log/xps-install.log | grep -q Fertig'

	ssh_vm sudo poweroff || true
	wait "$vm" || true
	trap 'rm -rf "$MON_DIR"' EXIT
	if [ "$failed" != 0 ]; then
		echo "==> Mindestens eine Prüfung ist fehlgeschlagen" >&2
		exit 1
	fi
	echo "==> Alles in Ordnung"
}

find_ovmf
vm_args
[ "${XPS_TEST_SKIP_BUILD:-}" = 1 ] || build_test_iso
[ "${XPS_TEST_SKIP_INSTALL:-}" = 1 ] || install
boot_and_check
