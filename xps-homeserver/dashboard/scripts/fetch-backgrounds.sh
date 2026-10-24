#!/usr/bin/env bash
# Downloads the dashboard's aerial clips (dashboard/scripts/backgrounds.txt)
# from Mixkit and turns each into a seamless H.264 loop with a poster frame,
# named <scene>-<id>.mp4 / .jpg (server/backgrounds.js reads the pool from
# those names). The encode is made for cheap playback on the XPS's Skylake
# graphics: the display's exact size (no scaling in the browser), 24 frames a
# second, Main profile, capped bitrate, so the hardware decoder does the work.
#
#   dashboard/scripts/fetch-backgrounds.sh <output dir> [height]
#
# height: 720 (default, also what the mockup uses) or 1080 (the XPS display).
# Clips already there are kept, clips no longer listed are removed, so running
# it again (setup-xps.sh does on every update) only fetches what is new.
# Needs curl and ffmpeg.
set -euo pipefail
# awk prints decimals with the locale's separator; under de_DE that is "12,71",
# which ffmpeg's filter graph reads as a second filter
export LC_ALL=C

OUT="${1:?Ausgabeordner fehlt, z. B. dashboard/mockup/media}"
HEIGHT="${2:-720}"
LIST="$(dirname "$0")/backgrounds.txt"
case "$HEIGHT" in 720) WIDTH=1280 ;; 1080) WIDTH=1920 ;; *) echo "height muss 720 oder 1080 sein" >&2; exit 1 ;; esac
command -v ffmpeg >/dev/null || { echo "ffmpeg fehlt (Mac: brew install ffmpeg)" >&2; exit 1; }

FADE=2    # seconds of the clip's start crossfaded onto its end
LONGEST=22
SHORTEST=12

mkdir -p "$OUT"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

failed=0
wanted=" "
while read -r scene id _; do
	case "$scene" in morgen | tag | abend | spaet) ;; *) echo "Unbekannte Szene: $scene" >&2; failed=1; continue ;; esac
	name="$scene-$id"
	wanted+="$name "
	[ -s "$OUT/$name.mp4" ] && [ -s "$OUT/$name.jpg" ] && continue

	echo "==> $name"
	# Mixkit has most clips at 1080 p, some only at 720 p
	if ! curl -fsSL "https://assets.mixkit.co/videos/$id/$id-$HEIGHT.mp4" -o "$tmp/src.mp4" &&
		! curl -fsSL "https://assets.mixkit.co/videos/$id/$id-720.mp4" -o "$tmp/src.mp4"; then
		echo "    nicht ladbar, übersprungen" >&2
		failed=1
		continue
	fi
	duration=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$tmp/src.mp4" </dev/null)
	# Up to $LONGEST s of the clip; its first $FADE s fade in over the end, so the
	# loop has no visible jump
	take=$(awk -v d="$duration" -v max="$LONGEST" 'BEGIN { t = d - 0.3; if (t > max) t = max; printf "%.2f", t }')
	if awk -v t="$take" -v min="$SHORTEST" 'BEGIN { exit !(t < min) }'; then
		echo "    zu kurz (${duration} s), übersprungen" >&2
		failed=1
		continue
	fi
	offset=$(awk -v t="$take" -v f="$FADE" 'BEGIN { printf "%.2f", t - 2 * f }')
	# fps again after each trim: since ffmpeg 7 (Debian 13) trim leaves the frame
	# rate unknown, and xfade refuses inputs without a constant one
	if ! ffmpeg -nostdin -v error -y -i "$tmp/src.mp4" -filter_complex \
		"[0:v]trim=0:$take,setpts=PTS-STARTPTS,fps=24,scale=$WIDTH:$HEIGHT:force_original_aspect_ratio=increase:flags=lanczos,crop=$WIDTH:$HEIGHT,setsar=1,split[a][b];[a]trim=$FADE:$take,setpts=PTS-STARTPTS,fps=24[main];[b]trim=0:$FADE,setpts=PTS-STARTPTS,fps=24[head];[main][head]xfade=transition=fade:duration=$FADE:offset=$offset,format=yuv420p[v]" \
		-map "[v]" -an -c:v libx264 -profile:v main -preset medium -crf 24 -maxrate 6M -bufsize 12M -g 48 \
		-movflags +faststart "$tmp/out.mp4" ||
		! ffmpeg -nostdin -v error -y -i "$tmp/out.mp4" -vframes 1 -q:v 3 "$tmp/out.jpg"; then
		echo "    Umwandlung fehlgeschlagen, übersprungen" >&2
		failed=1
		continue
	fi
	mv "$tmp/out.jpg" "$OUT/$name.jpg"
	mv "$tmp/out.mp4" "$OUT/$name.mp4"
	echo "    $(du -h "$OUT/$name.mp4" | cut -f1)"
done < <(grep -vE '^[[:space:]]*(#|$)' "$LIST")

# Clips taken off the list go, so the pool is exactly the list
for file in "$OUT"/*.mp4 "$OUT"/*.jpg; do
	[ -e "$file" ] || continue
	base=$(basename "$file")
	name="${base%.*}"
	[[ "$name" =~ ^(morgen|tag|abend|spaet)-[0-9]+$ ]] || continue
	[[ "$wanted" == *" $name "* ]] || { rm -f "$file"; echo "entfernt: $base"; }
done
exit "$failed"
