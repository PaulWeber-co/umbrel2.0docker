#!/bin/sh
# partman/early_command, runs inside the installer (busybox) before
# partitioning. Picks the internal disk for the installation and never the USB
# stick the installer runs from: the first NVMe disk, otherwise the first other
# disk that is neither on USB nor the install medium.

media=$(awk '$2 == "/cdrom" { print $1 }' /proc/mounts)

is_usb() {
	case "$(readlink -f "/sys/block/${1#/dev/}")" in */usb*) return 0 ;; esac
	return 1
}

pick() {
	for disk in $(list-devices disk); do
		case "$media" in "$disk"*) continue ;; esac
		is_usb "$disk" && continue
		# shellcheck disable=SC2254
		case "$disk" in $1) echo "$disk"; return 0 ;; esac
	done
	return 1
}

disk=$(pick '/dev/nvme*') || disk=$(pick '*') || {
	logger -t xps-installer "Keine interne SSD gefunden (BIOS: SATA Operation auf AHCI?)"
	exit 1
}

logger -t xps-installer "Installiere auf $disk (Installationsmedium: ${media:-?})"
debconf-set partman-auto/disk "$disk"
debconf-set grub-installer/bootdev "$disk"
