"""Downscale the maid-atelier sidebar cutout for display at sidebar width.

The source is 1122x2019 lossless WebP (1 MB) but it renders at ~280 CSS px wide,
so a 4x-downsampled lossy WebP keeps every visible detail while dropping an order
of magnitude in bytes. Alpha is preserved (it is a transparent cutout).
"""
from PIL import Image

SRC = r"C:\Users\Summer\Documents\deepseek-harness\default-workspace\dsh-deep-whale\maid-atelier\assets\maid-atelier-maid-left-v5.webp"
OUT = r"C:\Users\Summer\Documents\deepseek-harness\default-workspace\_perf-probe"

img = Image.open(SRC)
print(f"source: {img.size[0]}x{img.size[1]} {img.mode}")
rgba = img.convert("RGBA")

for width, quality in ((800, 88), (560, 88), (800, 78)):
    height = round(rgba.height * width / rgba.width)
    resized = rgba.resize((width, height), Image.LANCZOS)
    path = rf"{OUT}\maid-left-w{width}-q{quality}.webp"
    resized.save(path, "WEBP", quality=quality, method=6, exact=True)
    import os
    print(f"  w={width:<4} q={quality}  ->  {height}px tall  {os.path.getsize(path)/1024:.1f} KB  ({os.path.basename(path)})")
