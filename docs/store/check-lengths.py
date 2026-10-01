"""Đếm độ dài các ô có giới hạn trong LISTING.md — chạy lại mỗi khi sửa câu chữ.
Kho đếm theo ký tự hiển thị; chuẩn hóa NFC để chữ Việt có dấu tính một ký tự.
"""
import re
import sys
import unicodedata
from pathlib import Path

text = unicodedata.normalize("NFC", (Path(__file__).resolve().parent / "LISTING.md").read_text(encoding="utf-8"))

LIMITS = {"Tên app": 30, "Phụ đề": 30, "Mô tả ngắn": 80, "Từ khóa": 100, "Dòng quảng bá": 170}
ok = True
for label, limit in LIMITS.items():
    m = re.search(rf"^\| {re.escape(label)} \| \d+ \| `([^`]+)` \|", text, re.M)
    if not m:
        print(f"KHÔNG TÌM THẤY ô {label}")
        ok = False
        continue
    n = len(m.group(1))
    print(f"{label:14} {n:4}/{limit}  {'OK' if n <= limit else 'VƯỢT'}")
    ok &= n <= limit

long_desc = re.search(r"<!-- LONG-START -->\n(.*?)\n<!-- LONG-END -->", text, re.S).group(1)
print(f"{'Mô tả dài':14} {len(long_desc):4}/4000  {'OK' if len(long_desc) <= 4000 else 'VƯỢT'}")
ok &= len(long_desc) <= 4000

whats_new = re.search(r"### Có gì mới.*?```\n(.*?)\n```", text, re.S).group(1)
print(f"{'Có gì mới':14} {len(whats_new):4}/500   {'OK' if len(whats_new) <= 500 else 'VƯỢT'}")
ok &= len(whats_new) <= 500

notes = re.search(r"## 4\. Ghi chú gửi người duyệt.*?```\n(.*?)\n```", text, re.S).group(1)
print(f"{'Ghi chú duyệt':14} {len(notes):4}/4000  {'OK' if len(notes) <= 4000 else 'VƯỢT'}")
ok &= len(notes) <= 4000

sys.exit(0 if ok else 1)
