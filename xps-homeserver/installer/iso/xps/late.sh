#!/bin/sh
# preseed/late_command, runs inside the installer (busybox) once the base
# system is on the disk. Copies /xps from the stick into the new system and
# finishes the setup there. A failure stops the installation with an error
# message, so a missing Wi-Fi driver is noticed before the first boot.
set -e

mkdir -p /target/opt/xps-install
cp -a /cdrom/xps/. /target/opt/xps-install/
in-target bash /opt/xps-install/target-setup.sh
