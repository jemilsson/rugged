#!/usr/bin/env bash
# Open N chromium windows tiled at fixed geometry on the active Hyprland
# workspace, all pointed at the same URL, for multi-player demo recording.
#
# Usage: tabs.sh <url> [count]
#   url    page to load in every window (required)
#   count  number of windows to tile, 1-4 (default: 2)
#
# Requires hyprctl (Hyprland IPC) and chromium on PATH.
set -euo pipefail

URL="${1:?usage: tabs.sh <url> [count]}"
COUNT="${2:-2}"

if ! command -v hyprctl >/dev/null 2>&1; then
  echo "tabs.sh: hyprctl not found; this script targets Hyprland" >&2
  exit 1
fi
if ! command -v chromium >/dev/null 2>&1; then
  echo "tabs.sh: chromium not found on PATH" >&2
  exit 1
fi
if [ "$COUNT" -lt 1 ] || [ "$COUNT" -gt 4 ]; then
  echo "tabs.sh: count must be between 1 and 4, got $COUNT" >&2
  exit 1
fi

SCREEN_W=1920
SCREEN_H=1080

# Fixed 2x2 grid geometry, cell size scales with window count so a single
# window fills the screen and larger counts tile evenly.
case "$COUNT" in
  1) CELLS=("0,0,${SCREEN_W}x${SCREEN_H}") ;;
  2) CELLS=("0,0,$((SCREEN_W/2))x${SCREEN_H}" "$((SCREEN_W/2)),0,$((SCREEN_W/2))x${SCREEN_H}") ;;
  3) CELLS=("0,0,$((SCREEN_W/2))x${SCREEN_H}" "$((SCREEN_W/2)),0,$((SCREEN_W/2))x$((SCREEN_H/2))" "$((SCREEN_W/2)),$((SCREEN_H/2)),$((SCREEN_W/2))x$((SCREEN_H/2))") ;;
  4) CELLS=("0,0,$((SCREEN_W/2))x$((SCREEN_H/2))" "$((SCREEN_W/2)),0,$((SCREEN_W/2))x$((SCREEN_H/2))" "0,$((SCREEN_H/2)),$((SCREEN_W/2))x$((SCREEN_H/2))" "$((SCREEN_W/2)),$((SCREEN_H/2)),$((SCREEN_W/2))x$((SCREEN_H/2))") ;;
esac

for i in $(seq 0 $((COUNT - 1))); do
  PROFILE_DIR="$(mktemp -d)"
  chromium \
    --user-data-dir="$PROFILE_DIR" \
    --new-window \
    --no-first-run \
    --no-default-browser-check \
    --window-position=0,0 \
    --window-size="${SCREEN_W},${SCREEN_H}" \
    "$URL" >/dev/null 2>&1 &
  disown
  sleep 1

  CELL="${CELLS[$i]}"
  POS="${CELL%,*}"
  SIZE="${CELL##*,}"
  X="${POS%,*}"
  Y="${POS#*,}"

  WIN_ADDR="$(hyprctl clients -j | jq -r '[.[] | select(.class | test("[Cc]hromium"))][-1].address' 2>/dev/null || true)"
  if [ -n "$WIN_ADDR" ] && [ "$WIN_ADDR" != "null" ]; then
    hyprctl dispatch setfloating "address:$WIN_ADDR" >/dev/null
    hyprctl dispatch resizewindowpixel "exact ${SIZE} ,address:$WIN_ADDR" >/dev/null
    hyprctl dispatch movewindowpixel "exact ${X} ${Y},address:$WIN_ADDR" >/dev/null
  else
    echo "tabs.sh: could not locate window $i via hyprctl; leaving default placement" >&2
  fi
done

echo "tabs.sh: opened $COUNT chromium window(s) at $URL" >&2
