"""Hoàn thiện bộ ảnh listing App & Service Store TikTok Shop (docs/store/tiktok/):
- 0N-*.png do tiktok-store-images.mjs chụp ra ở RGBA → ghi lại PNG RGB (không kênh alpha).
- logo-256.png: logo dịch vụ 256×256 (TikTok yêu cầu đúng 256×256, jpg/png) từ logo gốc 417px.
Chạy từ gốc repo: python tools/do-hoa/tiktok-store-finish.py
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "store" / "tiktok"

for png in sorted(OUT.glob("0*.png")):
    im = Image.open(png).convert("RGB")
    assert im.size == (1500, 900), (png.name, im.size)
    im.save(png, optimize=True)
    print(f"OK {png.name} {im.size} RGB {png.stat().st_size // 1024} KB")

logo = Image.open(ROOT / "frontend" / "public" / "logo-hubsell.png").convert("RGB")
logo = logo.resize((256, 256), Image.LANCZOS)
logo.save(OUT / "logo-256.png", optimize=True)
print("OK logo-256.png", logo.size)
