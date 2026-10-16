"""Bỏ kênh alpha + kiểm kích thước ảnh màn hình kho (chạy sau render-shots.mjs)."""
from pathlib import Path
from PIL import Image

here = Path(__file__).parent
for folder, size in (("iphone-6.3", (1206, 2622)), ("android", (1080, 2160))):
    for f in sorted((here / folder).glob("*.png")):
        im = Image.open(f).convert("RGB")
        assert im.size == size, f"{f.name}: {im.size} khac {size}"
        im.save(f)
        print("ok", folder, f.name, im.size)

# Xem nhanh cả bộ iPhone trên một ảnh.
ims = [Image.open(f).convert("RGB") for f in sorted((here / "iphone-6.3").glob("*.png"))]
th = [im.resize((im.width * 400 // im.height, 400)) for im in ims]
sheet = Image.new("RGB", (sum(t.width for t in th) + 12 * (len(th) + 1), 424), "white")
x = 12
for t in th:
    sheet.paste(t, (x, 12))
    x += t.width + 12
sheet.save(here / "xem-nhanh.png")
print("ok xem-nhanh.png", sheet.size)
