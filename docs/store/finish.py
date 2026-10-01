"""Chốt kích thước ảnh nộp kho (chạy sau render.mjs):
  - feature-graphic-1024x500.png : thu bản chụp 2x về đúng 1024×500, RGB không alpha (Google bắt buộc).
  - icon-512.png                 : icon Google Play 512×512, thu từ icon-1024 của app.
"""
from pathlib import Path

from PIL import Image

here = Path(__file__).resolve().parent
root = here.parent.parent

fg = Image.open(here / "_feature-graphic@2x.png").convert("RGB")
assert fg.size == (2048, 1000), fg.size
fg.resize((1024, 500), Image.LANCZOS).save(here / "feature-graphic-1024x500.png", optimize=True)

icon = Image.open(root / "hubsell-mobile" / "assets" / "images" / "icon-1024.png").convert("RGB")
assert icon.size == (1024, 1024), icon.size
icon.resize((512, 512), Image.LANCZOS).save(here / "icon-512.png", optimize=True)

(here / "_feature-graphic@2x.png").unlink()  # bản chụp 2x chỉ là trung gian

for name in ("feature-graphic-1024x500.png", "icon-512.png"):
    im = Image.open(here / name)
    print(name, im.size, im.mode, f"{(here / name).stat().st_size // 1024} KB")
