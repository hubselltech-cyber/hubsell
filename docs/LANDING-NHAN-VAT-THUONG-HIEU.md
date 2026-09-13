# Landing — Nhân vật thương hiệu thay ảnh AI "ảo"

> ✅ 13/09/2026 ĐÃ THAY. Anh Trung sinh ảnh trên Gemini theo prompt bên dưới, Claude crop bỏ
> watermark (bỏ dải phải 294px + 60px trên), xuất `public/shop-owner-stockroom.webp` 1600×1000
> 121 KB, `object-center`. Ảnh tham chiếu nhân vật A lưu tại `docs/landing-persona/`
> (persona-A-portrait.jpg dùng làm reference khi sinh cảnh mới; persona-A-fullbody.jpg).
> Sinh cảnh mới: dán persona-A-portrait.jpg vào Gemini + "Same woman as the reference photo..."

Ngày 13/09/2026. Anh Trung nhận xét ảnh `hubsell-landing/public/seller-workspace.jpg`
(khối 01 "Kiểm soát lợi nhuận âm", `src/components/landing/tour.tsx` → `ProfitVisual`)
trông ảo: kho trống trơn như phim trường, người tí hon, thùng lơ lửng.

Landing hiện chỉ có **1 ảnh người** này; các ảnh còn lại (hero, mobile) là ảnh chụp app thật.

## Nguyên tắc chốt (đề xuất của Claude)

1. **Người trong ảnh là KHÁCH (chủ shop), không phải nhân viên Hubsell.** Sapo trông thật vì
   bối cảnh thật (kệ hàng lộn xộn, máy POS, tem đơn), không phải vì người mẫu đẹp.
   → Prompt xin "ưa nhìn, tự nhiên, đang làm việc" chứ không xin "siêu xinh" kiểu quảng cáo mỹ phẩm.
2. **Một nhân vật cố định, dùng lại nhiều nơi** (landing, /guide, ảnh store mobile, social).
   Nano Banana (`gemini-2.5-flash-image`) nhận ảnh tham chiếu → giữ cùng khuôn mặt qua nhiều cảnh.
   Đây chính là cách "mix nhiều người mẫu AI" đúng nghĩa: tạo 1 character sheet rồi ghép cảnh.
3. **Bố cục phải chừa chỗ cho thẻ Lãi/Lỗ đè lên 60% phía dưới** (ảnh 16:10, `object-position` hiện 78%).
   → Mặt và tay/màn hình nằm ở nửa TRÊN khung, phần dưới là bàn/kiện hàng mờ.
4. Xuất `webp` ≤ 150 KB, 1600×1000, thay đúng 1 dòng `src` trong tour.tsx.

## Character sheet (nhân vật A — chủ shop nữ)

```
Vietnamese woman, late 20s, natural friendly look (not glamour model), shoulder-length
black hair tied loosely, light makeup, small silver earrings. Wearing a mint-green
(#6EE7B7-ish) cotton shirt with sleeves rolled up, or a sage apron over a white tee.
Studio character sheet: front, 3/4 left, 3/4 right, laughing candid. Neutral grey
background, soft window light, photorealistic, 85mm, no text.
```

Nhân vật B (kho, nam, đầu 30, áo thun đen, đeo găng cắt ngón, cầm máy quét) — làm sau nếu cần
ảnh cho khối Hàng hoàn / app mobile.

## Prompt cảnh cho khối 01 (dùng ảnh tham chiếu nhân vật A)

```
Same woman as reference. Candid documentary photo inside a small real Vietnamese
e-commerce stockroom: metal shelving packed with polybagged clothes, cardboard boxes
with Shopee/Lazada shipping labels, a thermal label printer, a roll of tape, a bubble
mailer half open. She sits at a cluttered desk, slightly turned toward camera, looking
at a laptop with a light-green dashboard, one hand on a phone. Warm mixed lighting
(fluorescent + window), slight lens grain, shallow depth of field, shot on 35mm.
Face and hands in the upper half of the frame, lower half is desk and boxes (space
for a UI overlay). 16:10 landscape, photorealistic, no text, no logos legible.
```

Biến thể cần ra để anh chọn: 6 ảnh (2 góc máy × 3 seed). Tránh: nền trắng sạch, bàn trống,
tay 6 ngón, chữ trên tem đọc được (AI hay sai chữ), nụ cười răng quá đều.

## Quy trình

1. Anh cấp `GEMINI_API_KEY` (https://aistudio.google.com/apikey) → đặt env trên máy dev.
2. Claude viết script nhỏ `.claude-tmp/tools/gen-persona.py` (SDK `google-genai`):
   sinh character sheet → chọn → sinh 6 cảnh → anh chọn → crop 16:10 → webp.
3. Thay `src` trong `ProfitVisual`, chỉnh `object-position`, chụp lại kiểm tra laptop + mobile.
4. Lưu prompt + seed đã chọn vào file này để tái tạo nhân vật cho các ảnh sau.

Phương án thay thế nếu không muốn AI: chụp thật tại kho DarkMan/Hi.Bé bằng điện thoại
(1 buổi, ánh sáng cửa sổ) — thật nhất, khớp tinh thần "sản phẩm là bằng chứng" của landing.
