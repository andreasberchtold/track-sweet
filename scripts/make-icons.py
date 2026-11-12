#!/usr/bin/env python3
"""Draw the home-screen icons for an app: a dark board with a row of bulbs.

Usage:  python3 scripts/make-icons.py apps/movies [board-colour] [bulb-colour]
Needs:  Pillow (pip install pillow). Only needed when you want new icons;
        the generated PNG files are committed to the repository.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


def draw(size: int, board: str, bulb: str, maskable: bool) -> Image.Image:
    scale = 4
    s = size * scale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable:
        d.rectangle([0, 0, s, s], fill=board)
        inset = 0.20
    else:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=board)
        inset = 0.13

    left, right = s * inset, s * (1 - inset)
    span = right - left
    r = span / 3 * 0.34
    centres = [left + span * (i + 0.5) / 3 for i in range(3)]
    lit = [True, True, False]
    off = "#54303f"

    glow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    g = ImageDraw.Draw(glow)
    for cx, on in zip(centres, lit):
        if on:
            g.ellipse([cx - r * 1.5, s / 2 - r * 1.5, cx + r * 1.5, s / 2 + r * 1.5], fill=bulb + "88")
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(s * 0.035)))

    d = ImageDraw.Draw(img)
    for cx, on in zip(centres, lit):
        d.ellipse([cx - r, s / 2 - r, cx + r, s / 2 + r], fill=bulb if on else off)
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    out = Path(sys.argv[1]) / "icons"
    board = sys.argv[2] if len(sys.argv) > 2 else "#2a1020"
    bulb = sys.argv[3] if len(sys.argv) > 3 else "#f4c21f"
    out.mkdir(parents=True, exist_ok=True)
    draw(192, board, bulb, False).save(out / "icon-192.png")
    draw(512, board, bulb, False).save(out / "icon-512.png")
    draw(512, board, bulb, True).save(out / "icon-maskable-512.png")
    print(f"Wrote 3 icons to {out}")


if __name__ == "__main__":
    main()
