#!/usr/bin/env python3
"""Generate circular face-crop PNGs for the layered sprite system.

Reads assets/tokens/raw/<T>.png, applies the same per-ticker crop boxes as
CROP_BOX_OVERRIDES in composite_tokens.py, and writes a 512x512 RGBA
circular crop with a 2px feathered edge to assets/tokens/faces/<T>.png.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parent
RAW_DIR = ROOT / "tokens" / "raw"
FACES_DIR = ROOT / "tokens" / "faces"

DIAMETER = 512
FEATHER = 2

# Kept in sync with composite_tokens.py CROP_BOX_OVERRIDES.
CROP_BOX_OVERRIDES = {
    "GIGA": (20, 0, 920, 900),
    "MOODENG": (10, 0, 470, 460),
}


def circular_face(raw_path: Path, diameter: int, feather: int) -> Image.Image:
    img = Image.open(raw_path).convert("RGBA")
    override = CROP_BOX_OVERRIDES.get(raw_path.stem)
    if override:
        img = img.crop(override)
    else:
        w, h = img.size
        side = min(w, h)
        left = (w - side) // 2
        top = (h - side) // 2
        img = img.crop((left, top, left + side, top + side))
    img = img.resize((diameter, diameter), Image.LANCZOS)

    # Supersample the mask so the feathered edge is smooth at full res.
    scale = 4
    big = diameter * scale
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, big - 1, big - 1), fill=255)
    mask = mask.resize((diameter, diameter), Image.LANCZOS)
    mask = mask.filter(ImageFilter.GaussianBlur(feather))

    img.putalpha(mask)
    return img


def main() -> None:
    FACES_DIR.mkdir(parents=True, exist_ok=True)
    raw_files = sorted(RAW_DIR.glob("*.png"))
    if not raw_files:
        raise SystemExit(f"no raw token PNGs found in {RAW_DIR}")
    for raw_path in raw_files:
        face = circular_face(raw_path, DIAMETER, FEATHER)
        out_path = FACES_DIR / raw_path.name
        face.save(out_path)
        print(f"wrote {out_path} ({face.size[0]}x{face.size[1]})")


if __name__ == "__main__":
    main()
