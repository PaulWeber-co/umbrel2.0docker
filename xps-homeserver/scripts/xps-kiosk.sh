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
URL='http://127.0.0.1:7777/?kiosk=1'

# The dashboard starts at the same time. Until it answers, Chromium would show
# its own "site can't be reached" page and stay there. So wait a little; if it
# takes longer, start with a waiting page that switches over by itself as
# soon as the dashboard answers.
start=$URL
tries=0
until curl -fsS -o /dev/null --max-time 2 "$URL"; do
	tries=$((tries + 1))
	[ "$tries" -eq 1 ] && echo "xps-kiosk: warte auf das Dashboard auf Port 7777 …" >&2
	if [ "$tries" -ge 10 ]; then
		echo "xps-kiosk: Das Dashboard antwortet noch nicht (journalctl -u xps-dashboard); zeige die Warteseite." >&2
		start="file://$HOME/warten.html"
		cat >"$HOME/warten.html" <<-EOF
			<!doctype html><meta charset="utf-8"><title>XPS</title>
			<body style="margin:0;height:100vh;display:grid;place-items:center;background:#0d1f2c;color:#fff;font-family:system-ui,sans-serif;text-align:center">
			<div><div style="font-size:44px;font-weight:300">Das Dashboard startet …</div>
			<div style="margin-top:18px;font-size:22px;opacity:.7">Bleibt das länger als ein paar Minuten: per SSH <b>xps-doctor</b> aufrufen.</div></div>
			<script>setInterval(() => fetch('$URL', { mode: 'no-cors', cache: 'no-store' }).then(() => location.replace('$URL'), () => {}), 3000)</script>
		EOF
		break
	fi
	sleep 2
done

# A restart (every night, or a power cut) is no crash: no "restore pages?"
prefs="$HOME/chromium/Default/Preferences"
if [ -f "$prefs" ]; then
	sed -i 's/"exited_cleanly":false/"exited_cleanly":true/; s/"exit_type":"[A-Za-z]*"/"exit_type":"Normal"/' "$prefs" || true
fi

# Chromium decodes the background videos on the GPU (VA-API,
# intel-media-va-driver); no keyring, no update or crash bubbles, no swipe-back
# on the touchpad, no translation offer. ?kiosk=1 tells the page it is the
# wall display: only here a dark screen goes black and a tap wakes it.
exec /usr/bin/cage -s -- /usr/bin/chromium --kiosk --ozone-platform=wayland \
	--enable-features=AcceleratedVideoDecodeLinuxGL,AcceleratedVideoDecodeLinuxZeroCopyGL,VaapiVideoDecoder \
	--disable-features=TranslateUI --lang=de --autoplay-policy=no-user-gesture-required \
	--no-first-run --no-default-browser-check --disable-infobars --disable-session-crashed-bubble --noerrdialogs \
	--password-store=basic --overscroll-history-navigation=0 --check-for-update-interval=31536000 \
	--user-data-dir="$HOME/chromium" "$start"
