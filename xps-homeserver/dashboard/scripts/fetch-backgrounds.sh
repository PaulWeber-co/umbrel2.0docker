#!/usr/bin/env bash
# Downloads the dashboard's background videos (dashboard/scripts/backgrounds.txt)
# from Mixkit and turns each into a short, seamless H.264 loop with a poster
# frame. Small files with a low bitrate keep video decoding cheap on the XPS's
# Skylake graphics.
#
#   dashboard/scripts/fetch-backgrounds.sh <output dir> [height]
#
# height: 720 (default, also what the mockup uses) or 1080 (the XPS display).
# Needs curl and ffmpeg.
set -euo pipefail

OUT="${1:?Ausgabeordner fehlt, z. B. dashboard/mockup/media}"
HEIGHT="${2:-720}"
LIST="$(dirname "$0")/backgrounds.txt"
case "$HEIGHT" in 720 | 1080) ;; *) echo "height muss 720 oder 1080 sein" >&2; exit 1 ;; esac
command -v ffmpeg >/dev/null || { echo "ffmpeg fehlt (Mac: brew install ffmpeg)" >&2; exit 1; }

mkdir -p "$OUT"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

grep -vE '^[[:space:]]*(#|$)' "$LIST" | while read -r name id _; do
	echo "==> $name (Mixkit $id)"
	curl -fsSL "https://assets.mixkit.co/videos/$id/$id-$HEIGHT.mp4" -o "$tmp/$name.mp4" ||
		curl -fsSL "https://assets.mixkit.co/videos/$id/$id-1080.mp4" -o "$tmp/$name.mp4"
	# 13.5 s of the clip; the first 2 s are crossfaded onto the end, so the
	# 11.5 s loop has no visible jump.
	ffmpeg -nostdin -v error -y -i "$tmp/$name.mp4" -filter_complex \
		"[0:v]trim=0:13.5,setpts=PTS-STARTPTS,fps=24,scale=-2:$HEIGHT,split[a][b];[a]trim=2:13.5,setpts=PTS-STARTPTS[main];[b]trim=0:2,setpts=PTS-STARTPTS[head];[main][head]xfade=transition=fade:duration=2:offset=9.5,format=yuv420p[v]" \
		-map "[v]" -an -c:v libx264 -profile:v main -preset slow -crf 27 -movflags +faststart "$OUT/$name.mp4"
	ffmpeg -nostdin -v error -y -i "$OUT/$name.mp4" -vframes 1 -q:v 6 "$OUT/$name.jpg"
	echo "    $(du -h "$OUT/$name.mp4" | cut -f1)"
done
