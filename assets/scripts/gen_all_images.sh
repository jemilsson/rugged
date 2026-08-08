#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

STYLE="dark retro-terminal crypto video game aesthetic, deep navy/black background, neon accents in Solana brand colors electric purple #9945FF and neon green #14F195, playful pixel-art-adjacent 2D game illustration style, NOT photorealistic, NOT a photo, digital game art, clean vector-ish shading, no text, no watermark"

gen() {
  local out="$1" w="$2" h="$3" prompt="$4"
  LOCAL_OK=1 python3 scripts/gen_image.py "images/$out" "$w" "$h" "$prompt"
}

gen coin-base.png 1024 1024 \
"A single round golden-and-purple memecoin character with tiny cartoon arms and legs and worried nervous eyes, front view, centered on a plain dark background, cute game character mascot, no text on the coin. $STYLE"

gen coin-rugger-hint.png 1024 1024 \
"A single round golden-and-purple memecoin character with tiny cartoon arms and legs, subtly sinister expression with glowing red eyes, faint evil smirk, front view, centered on a plain dark background, same proportions as a cute game mascot but ominous, no text on the coin. $STYLE"

gen coin-rugged.png 1024 1024 \
"A single round golden-and-purple memecoin character knocked over on its side, defeated, with X-shaped eyes, a tiny flatlining red price chart floating above it, front-ish view, centered on a plain dark background, no text on the coin. $STYLE"

gen room-turbine.png 1024 1024 \
"Top-down view of a sci-fi spaceship room called Turbine, large glowing mechanical turbine engine in the center, pipes and vents, dark sci-fi data-center ship interior, game level background. $STYLE"

gen room-poh.png 1024 1024 \
"Top-down view of a sci-fi spaceship room called Proof of History, a giant glowing clock-like reactor core in the center radiating light, dark sci-fi data-center ship interior, game level background. $STYLE"

gen room-gossip.png 1024 1024 \
"Top-down view of a sci-fi spaceship communications room called Gossip, walls lined with glowing monitor screens and antenna equipment, dark sci-fi data-center ship interior, game level background. $STYLE"

gen room-gulfstream.png 1024 1024 \
"Top-down view of a sci-fi spaceship navigation room called Gulfstream, a central holographic star-map navigation console, dark sci-fi data-center ship interior, game level background. $STYLE"

gen title.png 1280 720 \
"Video game title screen, bold distressed glowing neon letters spelling the word RUGGED filling the composition, set over a dark spaceship corridor with a rug being yanked out from underfoot, dramatic lighting, purple and green neon accents. $STYLE"

echo "ALL DONE"
