# tools/do-hoa — dựng ảnh store + bìa Facebook

Script chạy trên máy anh, chụp HTML bằng Chrome cài sẵn (playwright-core của
`hubsell-landing`, không tải browser). HTML nguồn và ảnh ra vẫn nằm cạnh tư liệu
trong `docs/` (luật: `docs/` chỉ giữ tư liệu, công cụ để `tools/`). Chạy từ gốc repo.

| Script | Việc | Nguồn / ảnh ra |
| --- | --- | --- |
| `store-feature-graphic.mjs` | chụp ảnh bìa Google Play 2x | `docs/store/feature-graphic.html` → `_feature-graphic@2x.png` |
| `store-finish.py` | thu về 1024×500 RGB + icon 512 (Pillow) | `docs/store/feature-graphic-1024x500.png`, `icon-512.png` |
| `store-check-lengths.py` | đếm độ dài ô có giới hạn của listing | `docs/store/LISTING.md` |
| `facebook-cover.mjs` | bìa Facebook sáng/tối 3280×1440 + ảnh bài chào | `docs/marketing/facebook/*.html` → `*.png` |

```bash
node tools/do-hoa/store-feature-graphic.mjs
python tools/do-hoa/store-finish.py
python tools/do-hoa/store-check-lengths.py
node tools/do-hoa/facebook-cover.mjs
```
