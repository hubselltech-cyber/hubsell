# Bộ trang tính năng riêng trên landing — khuôn, từ khóa, cách vẽ hình (22/11/2026)

**Anh Trung 22/11/2026:** "Các tính năng khác anh cũng muốn có trang riêng và chuẩn SEO cũng phải như vậy. Tuy nhiên anh muốn em tham
khảo chuẩn quốc tế về cách trình bày. Yêu cầu là phải ngắn chữ, dùng hình ảnh minh họa khoa học là chính." Giữa lúc dựng trang mẫu anh
thêm: **"Anh thích sự trừu tượng hơn là việc show hết những gì bên trong sản phẩm của mình ra"** → ⛔ không dùng ảnh chụp màn hình app
thật trên các trang này; hình là minh họa trừu tượng vẽ bằng HTML / SVG.

Trang đầu (cách làm chung, từ khóa, chuẩn AI search): [SEO-TRANG-QUAY-VIDEO-DONG-HANG.md](SEO-TRANG-QUAY-VIDEO-DONG-HANG.md).
Mã (repo `hubsell-landing`): `src/lib/features.ts` (danh mục trang, cờ `live`, ngày sửa) · `src/components/feature/feature-kit.tsx`
(khuôn) · `src/components/feature/illus/` (hình minh họa từng trang + `primitives.tsx`) · trang mẫu
`src/app/quan-ly-quang-cao-shopee/page.tsx`.

Mức chắc: **[C]** đã mở trang / đã chạy · **[S]** suy ra.

## 1. Chuẩn trình bày quốc tế (đọc 11 trang, 22/11)

Linear Insights, Stripe Billing / Radar, Ramp Expense, Triple Whale Attribution, Jungle Scout Product Database, Notion Calendar, Vercel
Observability, HubSpot Email, Shopify POS, Helium 10 Magnet [C — mở trình duyệt và đo bằng JS, trừ Stripe Radar / Shopify / Helium 10
chỉ đọc chữ].

- **Một khối = một ý:** nhãn 2–4 chữ · tiêu đề 3–8 chữ · một câu 12–35 chữ · một hình.
- Trang tối giản 275–375 chữ (Linear, Notion); trang mạnh SEO 650–950 chữ (Triple Whale, Jungle Scout, Ramp, Vercel), phần lớn chữ nằm ở
  hỏi đáp + định nghĩa phía dưới.
- Thứ tự: đầu trang → định nghĩa / vì sao → 3–8 khối tính năng → số liệu → lời khách → hỏi đáp → dải kêu gọi.
- Hình: mảnh cắt giao diện (đa số) HOẶC giao diện vẽ bằng HTML/SVG (Stripe, Vercel — chữ trong hình đọc được); Trước / Sau (Ramp); sơ đồ
  luồng (Triple Whale). Không ảnh kho, không 3D, không khối màu trang trí.
- Không trang nào có bảng so sánh với đối thủ.

Căn cứ chữ tối thiểu: Google "important content is available in textual form"; Google Images lấy nghĩa ảnh từ chữ quanh ảnh; Bing
Webmaster Guidelines: ảnh / video không được là nguồn thông tin duy nhất [C].

## 2. Khuôn trang Hubsell (`feature-kit.tsx`)

| # | Khối | Chữ |
|---|---|---|
| 1 | `FeatureHero`: nhãn + H1 (từ khóa) + MỘT câu trả lời + 2 nút + dòng sàn / ngày cập nhật, hình minh họa lớn bên dưới | ~35 |
| 2 | `AnswerBlock`: "X là gì / vì sao" 1–2 câu | ~40 |
| 3 | `BeforeAfter`: Cách cũ / Với Hubsell, mỗi bên 3 dòng | ~25 |
| 4 | `FlowSteps`: 3 bước | ~30 |
| 5 | 4–5 × `FeatureBlock`: nhãn + tiêu đề + một câu + hình | ~25 / khối |
| 6 | (tuỳ trang) bảng nhỏ "mỗi sàn làm được gì" — nói đúng khả năng, chặn hứa quá | ~40 |
| 7 | `FeatureFaq`: 4–6 câu, LUÔN MỞ | ~250 |
| 8 | `RelatedFeatures` (chỉ trang `live`) + `FinalCtaSection` | — |

JSON-LD mỗi trang (`FeatureJsonLd`): WebApplication + BreadcrumbList + FAQPage; không aggregateRating (chưa có đánh giá thật).
Trang mẫu đo được: ~950–990 chữ trong `<main>` (gồm hỏi đáp + bảng), phần trên hỏi đáp rất thưa chữ.

## 3. Hình minh họa trừu tượng (anh chốt 22/11)

- Khối bo tròn trắng trên nền kem có lưới chấm (`IlluFrame`); **dải xám thay cho tên thật** (`Bar`); chip trạng thái 3 màu (`Chip`: xanh =
  ổn / lãi, vàng = cần xem, hồng = lỗ / dừng, xanh trời = thông tin).
- Ưu tiên hình "khoa học": thước / thang đo (ROAS so với hòa vốn), biểu đồ thanh có số (biên lãi → ROAS tối thiểu), ma trận 2 × 2 (biên lãi
  × nhịp bán), sơ đồ luồng (luật → diễn tập → kiểm → chạy thật).
- Số trên hình là SỐ VÍ DỤ, phải đúng toán (vd ROAS hòa vốn ≈ 1 ÷ biên lãi: 41 % → 2,4x, 10 % → 10x) và ghi "số ví dụ" khi cần.
- Mỗi hình có `figcaption` "Minh họa: …" — máy tìm kiếm đọc được ý của hình.
- ⛔ Không ảnh chụp màn hình app; không tên cột / bố cục thật của màn hình.

Bài học khi dựng: (1) khối đảo chiều phải đảo cả tỉ lệ cột (`lg:grid-cols-[1.75fr_1fr]`), không thì hình lọt cột hẹp; (2) ảnh soi trang
phải chụp bằng Edge (`channel: "msedge"`), Chrome 99 trên máy không vẽ màu Tailwind v4.

## 3b. Khảo sát lại 22/11 tối — "hình trừu tượng có phải chuẩn mới nhất không?" (anh hỏi, nhấn: phải hợp sản phẩm SaaS)

13 trang mở thật trong trình duyệt (Helium 10 chặn bot, không vượt). Phân loại: A ảnh chụp thật · B cắt sát giao diện thật · C trừu
tượng / giản lược (dải xám, khối giữ chỗ) · D giao diện vẽ bằng code trông như thật, dữ liệu giả · E ảnh người / 3D / minh họa.

| Trang | Kiểu |
|---|---|
| Linear features | B (+ ký hiệu trừu tượng) |
| Stripe Billing | D |
| Attio | B/D |
| Notion Projects | A/B |
| Mercury business banking | A + B/D + C |
| Ramp expense | E + C/D |
| Brex expense | C |
| Shopify Analytics (VN) | B/D, số tiền ₫ bản địa |
| Triple Whale | C/E |
| Gorgias | E + D |
| BigSeller | C + E |
| Sapo | E + C |
| KiotViet | A + E + D |

**Kết luận: TRỪU TƯỢNG THUẦN KHÔNG phải chuẩn mới nhất** (mức: khá chắc với mẫu này). Kiểu phổ biến nhất ở SaaS nhiều số liệu 2025–2026
là **giao diện trông như thật, dữ liệu giả, tách thành từng thẻ nổi** (D); trừu tượng (C) dùng làm lớp phụ: sơ đồ luồng, thẻ nhỏ, nền.
Không trang nào chỉ dùng dải xám cho phần số liệu chính.

Bằng chứng (mỏng): Baymard 2022 (kiểm thử khả dụng B2B SaaS): hình trừu tượng "kém hơn" ảnh giao diện thật vì người xem coi là ý
tưởng của nhà thiết kế, khuyên mỗi trang tính năng có ít nhất một hình giao diện. StatusCake A/B: hoạt hình → ảnh giao diện +96 % đăng
ký dùng thử (không công bố cỡ mẫu). Không tìm thấy thử nghiệm A/B nào giữa giản lược và giao diện thật trên trang B2B SaaS. Kiểu này có
tên "Simplified User Interface" (SUI), có từ ~2018 — là kỹ thuật lâu năm, không phải chuẩn mới. Hệ thiết kế Morningstar: không dùng ảnh
chụp, dùng minh họa "đúng với sản phẩm thật", thay chi tiết nhạy cảm bằng dữ liệu giả hợp lý — đúng lo ngại "không lộ bên trong".

**Đề xuất cho Hubsell (SaaS web + app, nhiều số, bán cho shop vừa và nhỏ):** kết hợp — **D làm chính** (thẻ giao diện trông như thật,
tên shop / sản phẩm / mã đơn GIẢ, 2–3 con số chính đọc được, phần còn lại có thể là dải xám; không chụp nguyên màn, không bố cục thật
đầy đủ) + **C cho phần khái niệm** (sơ đồ luồng, 3 bước, ma trận, thước đo). Che bên trong bằng dữ liệu giả, không bằng cách xóa hết chữ.
✅ **Anh chốt 22/11 tối: "Chuyển sang kết hợp"** — đã áp cho cả 7 trang (mục 5).

## 4. Từ khóa từng trang (gợi ý Google hl=vi gl=vn ~260 cụm, 22/11) [C cho gợi ý, S cho thứ hạng]

Người bán gõ theo SÀN, nhất là "shopee"; cụm có "đa sàn" gần như 0 gợi ý ("quảng cáo đa sàn", "đồng bộ tồn kho đa sàn" = 0).

| Trang | Đường dẫn | Tiêu đề | Câu hỏi thật nên trả lời |
|---|---|---|---|
| Quảng cáo | `/quan-ly-quang-cao-shopee` | Phần mềm quản lý quảng cáo Shopee, TikTok GMV Max | roas shopee bao nhiêu là tốt · chạy quảng cáo không ra đơn · gmv max là gì |
| Lãi lỗ | `/tinh-loi-nhuan-shopee` | Tính lợi nhuận Shopee, TikTok Shop từng đơn hàng | cách tính lợi nhuận bán shopee · phí sàn shopee bao nhiêu % |
| Hàng hoàn | `/quan-ly-hang-hoan` | Quản lý hàng hoàn Shopee, TikTok Shop, đối soát đơn hoàn | đơn hoàn người bán có mất phí không · hàng hoàn bị mất làm sao |
| Phí ship | `/doi-soat-phi-van-chuyen` | Đối soát phí vận chuyển Shopee, TikTok Shop sai cân nặng | phí ship shopee tính thế nào · shopee truy thu phí vận chuyển là gì |
| Hóa đơn | `/xuat-hoa-don-dien-tu-shopee` | Xuất hóa đơn điện tử cho đơn hàng Shopee, TikTok tự động | xuất hóa đơn shopee như thế nào · tiktok shop có xuất hóa đơn không |
| Tồn kho | `/dong-bo-ton-kho` | Đồng bộ tồn kho Shopee, TikTok Shop, Lazada tự động | quản lý kho đa sàn là gì |
| Đơn hàng | `/quan-ly-don-hang` | Phần mềm quản lý đơn hàng Shopee, TikTok Shop, Lazada | in đơn hàng loạt shopee · in lại mã vận đơn |

Giẫm chân nhau phải tránh: "ROAS hòa vốn" chỉ ở /tinh-roas-hoa-von; "phí vận chuyển" không vào tiêu đề trang lãi lỗ; câu "đơn hoàn mất phí"
về trang hàng hoàn; trang đơn hàng luôn nói "vận đơn" (không "hóa đơn"); trang tồn kho không có "đơn hàng" trong tiêu đề.
Lưu ý nội dung: trang tồn kho phải nói đúng nối MỘT CHIỀU sàn → Tổng kho, khớp trùng mã SKU; trang hóa đơn câu "xuất theo giá nào" là
câu thuế — ghi mức chắc; người tìm gõ "bồi hoàn phí vận chuyển" nhưng luật chữ trong app là "Sàn bù" (anh chưa nói luật này có áp cho chữ
SEO không).

⚠️ Trang chủ + /tinh-nang đang nhắm "trợ lý quảng cáo đa sàn" — 0 gợi ý. Cụm có người gõ hơn: "phần mềm quản lý bán hàng đa sàn" (gợi ý
mỏng), "quản lý bán hàng đa kênh" (10 gợi ý nhưng lẫn phần mềm bán tại quầy). Đụng định vị anh chốt 15/10 → anh quyết, em không tự đổi.

## 5. Trạng thái

- 22/11 tối: 7 trang LIVE trên hubsell.vn (landing `7660504`): `/quan-ly-quang-cao-shopee`, `/tinh-loi-nhuan-shopee`, `/quan-ly-hang-hoan`,
  `/doi-soat-phi-van-chuyen`, `/xuat-hoa-don-dien-tu-shopee`, `/dong-bo-ton-kho`, `/quan-ly-don-hang`. Một khuôn `feature-page.tsx`;
  danh mục `lib/features.ts` (menu 8 mục, chân trang, sitemap, thẻ liên quan đọc từ đây). Hình kết hợp: `FAKE` trong
  `feature/illus/primitives.tsx` là nguồn dữ liệu giả duy nhất.
- Đã gửi: IndexNow 9 URL (200) + Search Console "Yêu cầu lập chỉ mục" đủ 7 trang (dev@hubsell.vn). Xem lại báo cáo sau 1–2 tuần.
- Thêm trang mới: thêm vào `FEATURE_PAGES`, tạo `src/app/<đường-dẫn>/page.tsx` khai `FeaturePageConfig`, hình vào `components/feature/illus/`; sửa
  chữ thật thì đổi `updatedAt` của trang rồi chạy `node scripts/indexnow.mjs /<đường-dẫn>`.
- 22/11 khuya: trang video làm lại theo khuôn (anh: "Làm lại cho đồng bộ", landing `645c4b1`) — khuôn có `hero.primaryNode`, `hero.note`,
  `extras[]`, `cta` cho trang cần nút / câu riêng. Cả 8 trang tính năng giờ chung một khuôn.
- Chưa làm: ảnh tour trang chủ / Tính năng vẫn là ảnh chụp app tháng 9 (trái luật hình kết hợp) — chờ anh.
