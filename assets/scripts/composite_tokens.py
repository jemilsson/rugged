#!/usr/bin/env python3
"""Composite real token logos onto the coin-base mascot sprite, tinting the
coin body to match each logo's dominant color.

For each raw logo in tokens/raw/<TICKER>.png: circular-crop it, scale to fit
the coin's inner face disc, extract the logo's dominant color, recolor the
coin's gold body pixels toward that hue (preserving per-pixel luminance so
shading survives), paste the logo centered onto the recolored coin, and save
as tokens/coins/coin-<TICKER>.png.

Inner-disc geometry was measured directly on coin-base.png (1024x1024) by
scanning horizontal/vertical rows for the yellow face color and averaging the
resulting bounds: center (535, 481), face radius ~245px at widest. RADIUS is
set a bit smaller than the measured face edge so the logo disc sits cleanly
inside the coin face without touching the purple/outline ring.

Body hue range (measured on coin-base.png): the gold face pixels sit at
hue ~40-57 deg, S>=0.3, V>=0.5. The neon green ring (~120-190 deg) and neon
purple ring (~260-290 deg) plus the navy background (V<0.3) fall well
outside that band, so a simple HSV threshold isolates the body cleanly.
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ASSETS = Path(__file__).resolve().parent.parent
BASE_SPRITE = ASSETS / "images" / "coin-base.png"
RAW_DIR = ASSETS / "tokens" / "raw"
OUT_DIR = ASSETS / "tokens" / "coins"

# Measured on coin-base.png (1024x1024).
CENTER = (535, 481)
RADIUS = 225

# Gold body mask thresholds in HSV (H in [0,1], S/V in [0,1]).
BODY_HUE_MIN, BODY_HUE_MAX = 30 / 360, 65 / 360
BODY_SAT_MIN = 0.30
BODY_VAL_MIN = 0.50


# Per-ticker overrides for the naive centered-square crop, as an explicit
# (left, top, right, bottom) box in raw source-image pixel coords. Needed
# when the subject isn't centered in its source photo, so a blind center
# crop cuts hair/chin or leaves the subject off to one side.
CROP_BOX_OVERRIDES = {
    "GIGA": (20, 0, 920, 900),
    "MOODENG": (10, 0, 470, 460),
}


def circular_crop_and_scale(logo_path: Path, diameter: int) -> Image.Image:
    logo = Image.open(logo_path).convert("RGBA")
    override = CROP_BOX_OVERRIDES.get(logo_path.stem)
    if override:
        logo = logo.crop(override)
    else:
        # Crop to a centered square first so the circle mask uses the logo's
        # shortest dimension without squashing the image.
        w, h = logo.size
        side = min(w, h)
        left = (w - side) // 2
        top = (h - side) // 2
        logo = logo.crop((left, top, left + side, top + side))
    logo = logo.resize((diameter, diameter), Image.LANCZOS)

    mask = Image.new("L", (diameter, diameter), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, diameter, diameter), fill=255)
    logo.putalpha(mask)
    return logo


def dominant_hue(logo: Image.Image) -> float:
    """Pick the logo's dominant non-background, non-near-black/white hue.

    Quantizes to a small palette, walks the palette by pixel frequency, and
    returns the first swatch with real saturation and mid-range brightness
    (skipping backgrounds and near-black/white). If a swatch is muddy (low
    S or V) it's boosted rather than skipped, so a washed-out but genuinely
    dominant color still wins over a background color's palette entry.
    Returns hue in [0, 1); falls back to gold (matching the base body) if
    nothing usable is found.
    """
    rgb = logo.convert("RGB")
    quant = rgb.quantize(colors=24, method=Image.MEDIANCUT)
    palette = quant.getpalette()
    counts = sorted(quant.getcolors(), reverse=True)  # (count, index)

    import colorsys

    for count, idx in counts:
        r, g, b = palette[idx * 3 : idx * 3 + 3]
        h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        if v < 0.12 or v > 0.97 and s < 0.08:
            continue  # near-black or near-white/background
        if s < 0.15:
            continue  # too gray to carry a hue
        return h
    return 46 / 360  # fallback: base gold hue


def recolor_body(coin: Image.Image, target_hue: float) -> Image.Image:
    """Hue-shift the coin's gold body pixels to target_hue, keeping the
    neon outline rings and navy background untouched. Luminance (V) is
    preserved per pixel so shading/highlights survive the shift; saturation
    is bumped slightly for a punchier tint.
    """
    arr = np.asarray(coin.convert("RGBA")).astype(np.float32) / 255.0
    r, g, b, a = arr[..., 0], arr[..., 1], arr[..., 2], arr[..., 3]

    maxc = np.maximum(np.maximum(r, g), b)
    minc = np.minimum(np.minimum(r, g), b)
    v = maxc
    delta = maxc - minc
    s = np.where(maxc > 0, delta / np.where(maxc > 0, maxc, 1), 0)

    rc = np.zeros_like(r)
    gc = np.zeros_like(g)
    bc = np.zeros_like(b)
    safe_delta = np.where(delta == 0, 1, delta)
    rc = (maxc - r) / safe_delta
    gc = (maxc - g) / safe_delta
    bc = (maxc - b) / safe_delta

    h = np.zeros_like(r)
    is_r = (maxc == r) & (delta != 0)
    is_g = (maxc == g) & (delta != 0) & ~is_r
    is_b = (maxc == b) & (delta != 0) & ~is_r & ~is_g
    h = np.where(is_r, bc - gc, h)
    h = np.where(is_g, 2.0 + rc - bc, h)
    h = np.where(is_b, 4.0 + gc - rc, h)
    h = (h / 6.0) % 1.0

    body_mask = (
        (h >= BODY_HUE_MIN) & (h <= BODY_HUE_MAX) & (s >= BODY_SAT_MIN) & (v >= BODY_VAL_MIN)
    )

    new_h = np.where(body_mask, target_hue, h)
    new_s = np.where(body_mask, np.clip(s * 1.05, 0, 1), s)
    new_v = v

    # HSV -> RGB, vectorized.
    i = np.floor(new_h * 6.0)
    f = new_h * 6.0 - i
    p = new_v * (1.0 - new_s)
    q = new_v * (1.0 - f * new_s)
    t = new_v * (1.0 - (1.0 - f) * new_s)
    i_mod = i.astype(np.int32) % 6

    conditions = [i_mod == k for k in range(6)]
    new_r = np.select(conditions, [new_v, q, p, p, t, new_v])
    new_g = np.select(conditions, [t, new_v, new_v, q, p, p])
    new_b = np.select(conditions, [p, p, t, new_v, new_v, q])

    out = np.stack([new_r, new_g, new_b, a], axis=-1)
    out = np.clip(out * 255, 0, 255).astype(np.uint8)
    return Image.fromarray(out, mode="RGBA")


def composite_one(ticker: str) -> tuple[Path, float]:
    raw_path = RAW_DIR / f"{ticker}.png"
    diameter = RADIUS * 2
    logo = circular_crop_and_scale(raw_path, diameter)
    hue = dominant_hue(logo)

    coin = Image.open(BASE_SPRITE).convert("RGBA")
    coin = recolor_body(coin, hue)
    paste_xy = (CENTER[0] - RADIUS, CENTER[1] - RADIUS)
    coin.alpha_composite(logo, dest=paste_xy)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / f"coin-{ticker}.png"
    coin.save(out_path)
    return out_path, hue


def main() -> None:
    tickers = sorted(p.stem for p in RAW_DIR.glob("*.png"))
    for ticker in tickers:
        out_path, hue = composite_one(ticker)
        import colorsys

        r, g, b = colorsys.hsv_to_rgb(hue, 0.85, 0.95)
        hexcolor = "#%02x%02x%02x" % (int(r * 255), int(g * 255), int(b * 255))
        print(f"{ticker}: {out_path} dominant_hue={hue * 360:.0f} ~{hexcolor}")


if __name__ == "__main__":
    main()
