# shellcheck shell=bash
# Installs the host configuration in host/ (a copy of the target paths below /)
# and enables its services. Used by target-setup.sh during the installation
# and by scripts/setup-xps.sh afterwards, so changes reach a running XPS too.

HOST_UNITS=(
	xps-wl-guard.service
	xps-wl-guard.timer
	xps-wifi-watchdog.service
	xps-mdns-alias.service
	xps-battery-care.service
	xps-quiet.service
)

install_host_files() {
	local source=$1 file target mode
	while IFS= read -r -d '' file; do
		target=/${file#"$source"/}
		mode=644
		case $target in
		/usr/local/sbin/* | /etc/kernel/*) mode=755 ;;
		esac
		install -D -m "$mode" "$file" "$target"
	done < <(find "$source" -type f -print0)
	# The hook of the previous version stopped dpkg when wl was missing
	rm -f /etc/kernel/postinst.d/xps-wl-check
	systemctl daemon-reload 2>/dev/null || true
	systemctl enable "${HOST_UNITS[@]}"
	# Never sleep, whatever asks for it
	systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
}
