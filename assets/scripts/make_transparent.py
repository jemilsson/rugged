#!/usr/bin/env python3
"""Strip the baked navy circuit-board background from coin sprites, making
it transparent so sprites composite cleanly onto any room background.

Method: flood fill from the four image corners over pixels within a
color-distance threshold of the sampled corner color (the navy background,
including its faint circuit traces). Filled pixels get alpha=0. A second,
tighter-threshold pass mops up navy halo pixels adjacent to the already-
transparent region (antialiased edge remnants) without eating into the
character's neon glow or the coin outline. A 1px alpha blur feathers the
cut edge.

Usage: make_transparent.py <in.png> <out.png> [--threshold N] [--tight N]
"""

import argparse
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


def flood_fill_mask(arr: np.ndarray, threshold: float) -> np.ndarray:
    """BFS flood fill from the four corners over pixels close in RGB
    distance to their seed corner's color. Returns a bool mask of pixels
    to make transparent."""
    h, w, _ = arr.shape
    visited = np.zeros((h, w), dtype=bool)
    rgb = arr[:, :, :3].astype(np.int32)

    corners = [(0, 0), (0, w - 1), (h - 1, 0), (h - 1, w - 1)]
    q = deque()
    for cy, cx in corners:
        if not visited[cy, cx]:
            visited[cy, cx] = True
            q.append((cy, cx, rgb[cy, cx]))

    thr2 = threshold * threshold
    while q:
        y, x, seed = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx]:
                d = rgb[ny, nx] - seed
                if int(d @ d) <= thr2:
                    visited[ny, nx] = True
                    q.append((ny, nx, seed))
    return visited


def process(src: Path, dst: Path, threshold: float, tight: float) -> None:
    im = Image.open(src).convert("RGBA")
    arr = np.array(im)

    mask = flood_fill_mask(arr, threshold)

    # Second pass: tighter threshold, seeded from pixels bordering the
    # already-removed region, to mop up faint navy fringe the first pass's
    # threshold left opaque (without touching the character/glow interior).
    h, w, _ = arr.shape
    rgb = arr[:, :, :3].astype(np.int32)
    border_seed = np.array([5, 10, 43])
    thr2 = tight * tight
    close_to_navy = ((rgb - border_seed) ** 2).sum(axis=2) <= thr2
    # Dilate mask by 1px to find fringe candidates adjacent to removed area.
    grown = mask.copy()
    grown[1:, :] |= mask[:-1, :]
    grown[:-1, :] |= mask[1:, :]
    grown[:, 1:] |= mask[:, :-1]
    grown[:, :-1] |= mask[:, 1:]
    fringe = grown & ~mask & close_to_navy
    mask |= fringe

    alpha = arr[:, :, 3].copy()
    alpha[mask] = 0
    alpha_img = Image.fromarray(alpha, mode="L").filter(ImageFilter.GaussianBlur(1))
    alpha_final = np.minimum(alpha, np.array(alpha_img))

    out = arr.copy()
    out[:, :, 3] = alpha_final
    Image.fromarray(out, mode="RGBA").save(dst)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("src", type=Path)
    p.add_argument("dst", type=Path)
    p.add_argument("--threshold", type=float, default=40)
    p.add_argument("--tight", type=float, default=70)
    args = p.parse_args()
    process(args.src, args.dst, args.threshold, args.tight)


if __name__ == "__main__":
    main()
