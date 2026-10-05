"""Bỏ kênh alpha + kiểm kích thước ảnh màn hình kho (chạy sau render-shots.mjs)."""
from pathlib import Path
from PIL import Image

here = Path(__file__).parent
for folder, size in (("iphone", (1290, 2796)), ("android", (1080, 2160))):
    for f in sorted((here / folder).glob("*.png")):
        im = Image.open(f).convert("RGB")
        assert im.size == size, f"{f.name}: {im.size} khac {size}"
        im.save(f)
        print("ok", folder, f.name, im.size)
