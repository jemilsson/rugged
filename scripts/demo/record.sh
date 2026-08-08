#!/usr/bin/env bash
# Record the demo desktop to scripts/demo/out/raw.mkv.
#
# Prefers wf-recorder (Hyprland/wlroots). Falls back to ffmpeg x11grab when
# wf-recorder or a Wayland compositor socket is unavailable (e.g. under Xorg
# or Xwayland-only sessions).
#
# Usage: record.sh [duration_seconds] [output_path]
#   duration_seconds  stop automatically after N seconds (default: manual, Ctrl-C to stop)
#   output_path       default: <repo>/scripts/demo/out/raw.mkv
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="$SCRIPT_DIR/out"
mkdir -p "$OUT_DIR"

DURATION="${1:-}"
OUTPUT="${2:-$OUT_DIR/raw.mkv}"
GEOMETRY="1920x1080"
FPS=30

run_wf_recorder() {
  local args=(-f "$OUTPUT" -r "$FPS")
  if [ -n "$DURATION" ]; then
    exec timeout "$DURATION" wf-recorder "${args[@]}"
  else
    exec wf-recorder "${args[@]}"
  fi
}

run_ffmpeg_x11() {
  local display="${DISPLAY:-:0}"
  local args=(-y -f x11grab -video_size "$GEOMETRY" -framerate "$FPS" -i "$display"
              -f pulse -i default
              -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac)
  if [ -n "$DURATION" ]; then
    args=(-t "$DURATION" "${args[@]}")
  fi
  exec ffmpeg "${args[@]}" "$OUTPUT"
}

if command -v wf-recorder >/dev/null 2>&1 && [ -n "${WAYLAND_DISPLAY:-}" ]; then
  echo "record.sh: using wf-recorder -> $OUTPUT" >&2
  run_wf_recorder
elif command -v ffmpeg >/dev/null 2>&1; then
  echo "record.sh: wf-recorder unavailable, falling back to ffmpeg x11grab -> $OUTPUT" >&2
  run_ffmpeg_x11
else
  echo "record.sh: neither wf-recorder nor ffmpeg found on PATH" >&2
  echo "run via: nix shell nixpkgs#wf-recorder nixpkgs#ffmpeg -c scripts/demo/record.sh" >&2
  exit 1
fi
