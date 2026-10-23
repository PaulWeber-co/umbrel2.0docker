#!/bin/sh
# The wall dashboard on the XPS display: Cage (a Wayland compositor for
# exactly one program) with Chromium in kiosk mode, as the unprivileged user
# xps-kiosk. Started by xps-kiosk.service; xps-control starts and stops that
# service when the control center switches the screen on or off.
set -eu

# systemd's %h and %U name root, not the service user: set both here.
export HOME=/var/lib/xps-kiosk
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
cd "$HOME"

# Chromium decodes the background videos on the GPU (VA-API,
# intel-media-va-driver); no keyring, no update or crash bubbles, no swipe-back
# on the touchpad, no translation offer. ?kiosk=1 tells the page it is the
# wall display: only here a dark screen goes black and a tap wakes it.
exec /usr/bin/cage -s -- /usr/bin/chromium --kiosk --ozone-platform=wayland \
	--enable-features=AcceleratedVideoDecodeLinuxGL,AcceleratedVideoDecodeLinuxZeroCopyGL,VaapiVideoDecoder \
	--disable-features=TranslateUI --autoplay-policy=no-user-gesture-required \
	--no-first-run --no-default-browser-check --disable-infobars --disable-session-crashed-bubble --noerrdialogs \
	--password-store=basic --overscroll-history-navigation=0 --check-for-update-interval=31536000 \
	--user-data-dir="$HOME/chromium" 'http://127.0.0.1:7777/?kiosk=1'
