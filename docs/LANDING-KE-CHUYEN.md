# Landing kể chuyện — mạch mới (13/09/2026)

> ★ CHỐT CUỐI 13/09 khuya (anh Trung): "bản cũ đang sử dụng tốt hơn" → GIỮ bố cục cũ, chỉ
> (1) rút chữ, (2) thay mock bằng ẢNH APP THẬT. ✅ Cả hai ĐÃ XONG trên nhánh `landing-got`
> (hubsell-landing, từ master, CHƯA PUSH — lên prod sau khi ISV Shopee duyệt):
> - Rút chữ: mỗi chốt 1 câu + 3 gạch tiêu đề (TourCopy slice 3, desc không render), lưới vệ
>   tinh/pain/trust rút, AI/mobile chip, bảng so sánh giá vào <details>. 3.744 → 2.951 chữ.
> - Ảnh thật: `public/screens/tour-{pnl,returns,shipping,ads,rescue,invoice}.webp` qua
>   component `AppShot` (tour.tsx); khối 01 = ảnh nhân vật A + màn "Cảnh báo & P&L sản phẩm".
> - Pipeline tái lập: backend `npx tsx scripts/seed-landing-demo.ts && npx tsx
>   scripts/seed-landing-tour.ts` (DB local) → chạy backend 4000 + frontend 3000 →
>   hubsell-landing `node scripts/capture-tour.mjs` (RAW=1 để dò khung; tên màn làm tham số).
> - Gotcha headless: body font ra Times (var --font-sans không resolve) và Base UI Switch không
>   vẽ data-checked → script vá CSS; DB local phải áp đủ migration (13/09 áp 27 cái thiếu).
> 14/09: ĐÃ PUSH & LIVE (dd56254). Bản kể chuyện 10 khối KHÔNG dùng — nhánh đã xóa, còn tag local `archive/landing-ke-chuyen` trong repo landing nếu cần xem lại (không push).

> 🏗️ 13/09 tối: ĐÃ DỰNG XONG TRÊN NHÁNH LOCAL `landing-ke-chuyen` (repo hubsell-landing,
> commit đầu nhánh), CHƯA PUSH — anh Trung chốt "đợi ISV Shopee duyệt xong mới lên", rồi đổi
> ý "làm local trước, xem ok không". Xem local: `git checkout landing-ke-chuyen` + `npm run dev`.
> Kết quả đo 1440px: 15.636px / 3.744 chữ → 12.942px / 2.375 chữ, ảnh 4 → 8.
> Khác đề xuất ban đầu: KHÔNG có khối "Bằng chứng" (chưa có khách thật), waterfall 8 bậc
> thay bằng thẻ "sàn báo 128,4 → còn 42,3" đè lên ảnh nhân vật A; pain.tsx + trust.tsx cũ
> không còn dùng nhưng giữ file (waterfall SVG có thể tái dùng).
> Việc còn lại sau khi anh duyệt: (1) merge + push sau ISV; (2) 2 buổi seed + chụp app thật
> thay 4 mock (OrdersVisual, ReturnsVisual, AdsVisual, TaxVisual); (3) sinh 2 cảnh nhân vật A.

Anh Trung: seller vào trang hiện tại thấy bối rối; muốn "nhìn phát hiểu ngay sản phẩm gì,
bán cái gì, giúp ích gì", kể chuyện chứ không khoe mẽ. Tham khảo cách Sapo làm.

## Đo đạc (1440px, 13/09)

| Trang | Cao | Chữ | Ảnh | Chữ/1000px |
|---|---|---|---|---|
| hubsell.tech | 15.636 | 3.744 | 4 | 240 |
| sapo.vn (home) | 5.751 | 1.369 | ~100 | 238 |
| sapo.vn/omnichannel | 10.035 | 2.459 | ~60 | 245 |

Mật độ chữ Sapo KHÔNG thấp hơn. Khác biệt nằm ở **nhịp và hình**, không phải số chữ:
- Mỗi khối Sapo = 1 câu nỗi đau (in nghiêng) + "Sapo giúp chủ shop:" + 3 gạch + 1 ảnh NGƯỜI THẬT
  có thẻ UI nổi + nút. Khuôn lặp lại nên đọc lướt được.
- Tiêu đề Sapo là câu hỏi/câu nói đời thường: "Vì sao càng bán đa kênh, bạn càng dễ mất kiểm
  soát?", "Gom tất cả kênh bán về một màn hình duy nhất". Hubsell dùng ẩn dụ phải giải mã:
  "6 chốt chặn thất thoát lợi nhuận", "Trung tâm kiểm soát thất thoát".
- Sapo chia theo NGƯỜI (mô hình bán hàng: sàn / MXH / cửa hàng) → seller tự thấy mình.
  Hubsell chia theo TÍNH NĂNG (6 chốt) → seller phải tự map.
- Sapo có tầng bằng chứng: logo khách, 6 câu chuyện khách có ảnh cửa hàng thật. Hubsell chưa có.

Nguyên nhân gốc bên Hubsell: trang được viết cho 2 khán giả (seller + reviewer ISV Shopee/
Lazada/TikTok, xem comment đầu page.tsx). Phần tour 6 chốt sâu là để reviewer thấy sản phẩm
thật → seller gánh 1.775 chữ không dành cho mình.

## Mạch mới đề xuất (≈1.800 chữ, ≈10.000px, 8–10 ảnh app thật + 2 ảnh nhân vật A)

0. **Tách khán giả**: landing `/` kể chuyện cho seller; chuyển nguyên 6 khối tour hiện tại
   sang trang `/tinh-nang` cho reviewer ISV + seller muốn đào sâu (giữ SEO, không mất công
   đã làm). Menu "Tính năng" trỏ sang đó.

1. **Hero** — 1 câu nói thẳng: *"Bán trên Shopee, Lazada — biết ngay mỗi đơn lãi bao nhiêu."*
   Phụ đề 1 câu. Nút Dùng thử 14 ngày. Ảnh laptop dashboard thật + phone (giữ), bỏ 3 thẻ nổi
   thừa. Dải 3 sàn.
2. **Nỗi đau** — *"Vì sao bán càng nhiều càng không biết mình lãi hay lỗ?"* 4 gạch ngắn
   (phí sàn 25 loại / hoàn ảo / phí ship trừ sai / cuối tháng mới biết) + ảnh nhân vật A
   nhìn bảng Excel mệt mỏi có thẻ UI "Sàn báo 128tr → về ví 42tr". Waterfall giữ nhưng
   thu gọn thành thẻ nổi trên ảnh (đây là khoảnh khắc kể chuyện mạnh nhất, không bỏ).
3. **Một ngày của chủ shop dùng Hubsell** — timeline 4 bước, mỗi bước 1 câu + 1 ảnh app thật:
   Sáng mở app thấy lãi hôm qua (dashboard) → Đơn về tự đồng bộ, in vận đơn 1 chạm (Xử lý đơn)
   → Hàng hoàn về quét mã, không cộng kho nhầm (mobile Kho) → Cuối tháng đối soát tự khớp,
   hóa đơn tự xuất (P&L + Hóa đơn). Thay cho sơ đồ "Trung tâm kiểm soát" + 6 khối.
4. **Hubsell hợp với shop nào** — 3 thẻ theo NGƯỜI (khuôn Sapo: 1 câu nỗi đau + 3 gạch + 1 ảnh):
   - Shop 1 người bán Shopee/Lazada: lãi từng đơn, cảnh báo SKU lỗ, hóa đơn tự động.
   - Shop có kho + nhân viên: tồn kho đa sàn, quét hoàn 2 công đoạn, phân quyền.
   - Shop chạy ads nhiều: ROAS hòa vốn theo SKU, cứu đơn giao thất bại.
   6 "chốt chặn" cũ sống trong các gạch này, mỗi cái 1 dòng, link sang /tinh-nang#...
5. **Trợ lý AI** — giữ band tối, rút còn 1 câu + hội thoại demo (bỏ 3 gạch).
6. **Ứng dụng di động** — giữ, rút 4 gạch còn 3 dòng.
7. **Bắt đầu 3 bước + Bảo mật** — gộp 1 band: 3 bước ngang + 1 dòng "OAuth chính thức, không
   bao giờ hỏi mật khẩu sàn" + link chính sách.
8. **Bảng giá** — 5 thẻ giữ; bảng so sánh 1.700px toàn dấu tích → 1 dải chip "Mọi gói đều có
   18 tính năng" (bấm mở rộng nếu muốn).
9. **Bằng chứng** — hiện chưa có khách; phương án: dải "Đang vận hành thật cho gian hàng
   nghìn đơn/tháng" + số thật (đơn đã đối soát, hóa đơn đã phát hành) lấy từ HQ. Dùng tên
   3 shop nhà (DarkMan/ANO/Hi.Bé) hay không: anh quyết.
10. **FAQ + CTA + footer** — giữ.

## Ảnh cần có
- App thật (pipeline capture-screens.mjs, seed cần mở rộng): dashboard (có), xử lý đơn + in
  vận đơn, P&L từng đơn, kho mobile (có), hóa đơn hàng chờ, trợ lý quảng cáo ROAS. ≈2 buổi.
- Nhân vật A: cảnh 2 "nhìn Excel mệt" (khối 2), cảnh 3 "quét mã kiện hoàn" (khối 4 thẻ 2).
  Prompt gốc trong LANDING-NHAN-VAT-THUONG-HIEU.md.

## Ước công
- Buổi 1: dựng mạch mới với ảnh có sẵn + thẻ mock tạm, tách /tinh-nang. Anh duyệt chữ.
- Buổi 2–3: seed + chụp app thật, thay mock. Sinh 2 cảnh nhân vật A.
