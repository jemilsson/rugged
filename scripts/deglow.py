#!/usr/bin/env python3
"""Strip the outer neon-green halo from coin sprites, leaving the character
silhouette plus a thin dark outline. Keeps the original as *-glow.png
(used for meeting portraits) and overwrites the source with the de-glowed
version (used for in-world sprites).

Approach: the glow is a bright, low-saturation-of-hue-but-high-green ring
around the character with partial alpha. We erode the alpha channel using a
green-glow color test (green channel dominant and bright) combined with an
alpha threshold, then re-composite a solid dark outline just inside the
eroded edge.
"""
import sys
from pathlib import Path
from PIL import Image, ImageFilter

GLOW_G_MIN = 170      # glow pixels are strongly green
GLOW_RB_MAX = 140      # ...and comparatively low in red/blue
ALPHA_KEEP = 40        # below this alpha, pixel is background already
OUTLINE_PX = 2


def is_glow(px):
    r, g, b, a = px
    if a < ALPHA_KEEP:
        return False
    return g >= GLOW_G_MIN and r <= GLOW_RB_MAX and b <= GLOW_RB_MAX


def deglow(im: Image.Image) -> Image.Image:
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()

    # Build a silhouette mask: 255 where pixel is opaque AND not glow-colored.
    mask = Image.new("L", (w, h), 0)
    mpx = mask.load()
    for y in range(h):
        for x in range(w):
            p = px[x, y]
            mpx[x, y] = 0 if is_glow(p) else (255 if p[3] >= ALPHA_KEEP else 0)

    # Erode a couple px to eat any anti-aliased glow fringe left behind.
    mask = mask.filter(ImageFilter.MinFilter(3))
    mask = mask.filter(ImageFilter.MinFilter(3))

    # Dark outline: dilate the eroded mask, subtract the mask itself -> ring.
    dilated = mask
    for _ in range(OUTLINE_PX):
        dilated = dilated.filter(ImageFilter.MaxFilter(3))

    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    opx = out.load()
    dpx = dilated.load()
    mpx2 = mask.load()
    for y in range(h):
        for x in range(w):
            if mpx2[x, y] >= 128:
                opx[x, y] = px[x, y]
            elif dpx[x, y] >= 128:
                opx[x, y] = (20, 22, 28, 255)  # thin dark outline
    return out


def process(path: Path) -> None:
    im = Image.open(path)
    glow_path = path.with_name(f"{path.stem}-glow{path.suffix}")
    if not glow_path.exists():
        im.convert("RGBA").save(glow_path)
    deglow(im).save(path)
    print(f"deglowed {path}")


def main() -> None:
    roots = [Path("app/public/tokens"), Path("app/public/img")]
    targets: list[Path] = []
    for root in roots:
        targets.extend(sorted(root.glob("coin-*.png")))
    targets = [t for t in targets if "-glow" not in t.stem]
    for t in targets:
        process(t)


if __name__ == "__main__":
    main()
