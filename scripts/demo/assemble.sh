#!/usr/bin/env bash
# Assemble recorded takes into the final demo video: title card + takes,
# concatenated, with background music mixed in and an optional subtitle
# burn-in.
#
# Usage: assemble.sh [-m music.mp3] [-t title.png] [-s subs.srt] [-o out.mp4] take1.mkv [take2.mkv ...]
#   -m music.mp3   background track, mixed at low volume under take audio
#                  (default: assets/music/lobby.mp3)
#   -t title.png   title card image, shown for 3s before the first take
#                  (default: assets/images/title.png)
#   -s subs.srt    subtitles to burn into the final video (optional)
#   -o out.mp4     output path (default: scripts/demo/out/final.mp4)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUT_DIR="$SCRIPT_DIR/out"
mkdir -p "$OUT_DIR"

MUSIC="$REPO_ROOT/assets/music/lobby.mp3"
TITLE_IMG="$REPO_ROOT/assets/images/title.png"
SRT=""
OUTPUT="$OUT_DIR/final.mp4"
MUSIC_VOLUME=0.15
TITLE_DURATION=3
FPS=30
RESOLUTION=1920x1080
RES_W="${RESOLUTION%x*}"
RES_H="${RESOLUTION#*x}"

while getopts "m:t:s:o:h" opt; do
  case "$opt" in
    m) MUSIC="$OPTARG" ;;
    t) TITLE_IMG="$OPTARG" ;;
    s) SRT="$OPTARG" ;;
    o) OUTPUT="$OPTARG" ;;
    h) grep '^#' "$0" | sed 's/^# \?//'; exit 0 ;;
    *) exit 1 ;;
  esac
done
shift $((OPTIND - 1))

TAKES=("$@")
if [ "${#TAKES[@]}" -eq 0 ]; then
  echo "assemble.sh: at least one take video is required" >&2
  exit 1
fi
for f in "$MUSIC" "$TITLE_IMG" "${TAKES[@]}"; do
  [ -f "$f" ] || { echo "assemble.sh: missing input file: $f" >&2; exit 1; }
done

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Title card: still image held for TITLE_DURATION seconds, silent audio track
# so the concat filter has a matching audio stream to work with.
TITLE_CLIP="$WORK/title.mp4"
ffmpeg -y -loglevel error \
  -loop 1 -t "$TITLE_DURATION" -i "$TITLE_IMG" \
  -f lavfi -t "$TITLE_DURATION" -i anullsrc=r=48000:cl=stereo \
  -vf "scale=${RES_W}:${RES_H}:force_original_aspect_ratio=decrease,pad=${RES_W}:${RES_H}:(ow-iw)/2:(oh-ih)/2,fps=${FPS},format=yuv420p" \
  -c:v libx264 -preset veryfast -c:a aac -shortest \
  "$TITLE_CLIP"

# Normalize every take to the same codec/resolution/fps so concat is safe.
NORM_CLIPS=("$TITLE_CLIP")
i=0
for take in "${TAKES[@]}"; do
  norm="$WORK/take_${i}.mp4"
  ffmpeg -y -loglevel error -i "$take" \
    -vf "scale=${RES_W}:${RES_H}:force_original_aspect_ratio=decrease,pad=${RES_W}:${RES_H}:(ow-iw)/2:(oh-ih)/2,fps=${FPS},format=yuv420p" \
    -c:v libx264 -preset veryfast -c:a aac -ar 48000 -ac 2 \
    "$norm"
  NORM_CLIPS+=("$norm")
  i=$((i + 1))
done

CONCAT_LIST="$WORK/concat.txt"
: > "$CONCAT_LIST"
for c in "${NORM_CLIPS[@]}"; do
  echo "file '$c'" >> "$CONCAT_LIST"
done

CONCAT_OUT="$WORK/concat.mp4"
ffmpeg -y -loglevel error -f concat -safe 0 -i "$CONCAT_LIST" -c copy "$CONCAT_OUT"

# Mix background music (looped, low volume) under the concatenated audio,
# then optionally burn in subtitles.
FILTER="[1:a]volume=${MUSIC_VOLUME},aloop=loop=-1:size=2e9[music];[0:a][music]amix=inputs=2:duration=first:dropout_transition=2[aout]"
VIDEO_ARGS=(-map 0:v)
if [ -n "$SRT" ]; then
  [ -f "$SRT" ] || { echo "assemble.sh: missing subtitle file: $SRT" >&2; exit 1; }
  ffmpeg -y -loglevel error \
    -i "$CONCAT_OUT" -stream_loop -1 -i "$MUSIC" \
    -filter_complex "${FILTER};[0:v]subtitles='${SRT}'[vout]" \
    -map "[vout]" -map "[aout]" \
    -c:v libx264 -preset veryfast -c:a aac -shortest \
    "$OUTPUT"
else
  ffmpeg -y -loglevel error \
    -i "$CONCAT_OUT" -stream_loop -1 -i "$MUSIC" \
    -filter_complex "$FILTER" \
    -map 0:v -map "[aout]" \
    -c:v libx264 -preset veryfast -c:a aac -shortest \
    "$OUTPUT"
fi

echo "assemble.sh: wrote $OUTPUT" >&2
