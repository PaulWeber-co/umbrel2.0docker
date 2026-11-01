#!/bin/bash
# Targeted bootstrap; does not restart the kiosk, apps or Umbrel container.
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then echo 'Run as root' >&2; exit 1; fi
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
if [ "$root" != /opt/xps-homeserver/xps-homeserver ]; then
    echo 'Install the reviewed checkout at /opt/xps-homeserver first' >&2
    exit 1
fi
if [ ! -d /etc/xps-homeserver ]; then install -d -m 755 /etc/xps-homeserver; fi
install -d -m 700 /var/lib/xps-umbrel-updater /run/xps-umbrel-updater
if [ ! -e /etc/xps-homeserver/updater.json ]; then
    (umask 077; printf '%s\n' '{"backupRoot":"/var/lib/xps-umbrel-updater/backups"}' > /etc/xps-homeserver/updater.json)
fi
install -m 644 "$root/deploy/systemd/xps-umbrel-updater.service" /etc/systemd/system/
install -m 644 "$root/deploy/systemd/xps-umbrel-update@.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now xps-umbrel-updater.service
