# Chẩn đoán marketing ban đầu — 17/10/2026

> **Anh Trung chốt 17/10 (ghi đè thứ tự cược bên dưới):** kênh chính = đăng bài số liệu thật vào nhóm nhà bán;
> đội tiếp thị = người dạy bán hàng trên YouTube, TikTok; máy tính ROAS hòa vốn là đích đến của mọi bài/video,
> nút chính "Đăng nhập để tính bằng lãi lỗ thật từng đơn". Bản kế hoạch hiện hành có hình:
> [ke-hoach-90-ngay.html](ke-hoach-90-ngay.html). Còn chờ anh chốt: ưu đãi riêng cho đối tác (10 % có thể chưa đủ).

Bản này soạn TRƯỚC khi có số thật (chờ anh chạy `so-lieu/SQL-SO-THAT-KHACH-HANG.sql`). Mọi kết luận ở đây
là **giả thuyết**, mỗi cái có một con số sẽ xác nhận hoặc bác bỏ. Khi có số: điền mục 2, rồi chạy
`/marketing-plan hubsell` ra kế hoạch 90 ngày + 12 tháng đầy đủ trong `chien-luoc/`.

## 1. Kết luận trong 6 dòng

1. **Bài toán đáng làm.** Tiền quảng cáo là nỗi đau lớn và xảy ra **hằng ngày** — đúng ô tốt nhất của
   ma trận "cỡ vấn đề × tần suất" (skill marketing-plan). Sản phẩm không "chết" vì thị trường.
2. **Giai đoạn hiện tại là "mài khách đầu" (dưới ~250 triệu ₫/năm doanh thu), không phải "khuếch đại".**
   Ở giai đoạn này, quảng cáo trả tiền gần như luôn đốt tiền vì chưa biết khách ở lại bao lâu.
3. **Nguồn lực thật:** anh + Claude, gần như 0 ngân sách → chỉ chọn kênh có đòn bẩy: anh tự nói (founder-led),
   công cụ miễn phí, đối tác có sẵn tập khách.
4. **Trước khi đổ thêm khách vào, phải biết phễu đang rò ở đâu.** Nếu khách đăng ký mà không nối gian /
   không thấy "chiến dịch dưới hòa vốn" thì thêm khách chỉ là đổ nước vào thùng thủng.
5. **Ba cược lớn 90 ngày** (mục 3): Máy tính ROAS hòa vốn miễn phí · Anh tự "soi lãi thật" trong cộng đồng
   seller · Đối tác người dạy bán hàng ăn hoa hồng giới thiệu.
6. **Thước đo chính đề xuất:** số shop trong tuần có ít nhất 1 chiến dịch được trợ lý canh (khách đang thật
   sự dùng đúng thứ mình bán).

## 2. Số cần có (điền khi anh dán kết quả SQL)

| Câu hỏi | Khối SQL | Số | Nếu số xấu thì |
|---|---|---|---|
| Bao nhiêu chủ shop đã đăng ký? | 1 | [CHƯA CÓ] | — |
| % nối gian trong 7 ngày đầu | 2 | [CHƯA CÓ] | < 50 % (mốc tự chọn): sửa onboarding TRƯỚC, tạm dừng kéo khách |
| % có chi ads 30 ngày (dùng đúng trợ lý) | 1, 4 | [CHƯA CÓ] | thấp: đang hút nhầm khách (shop không chạy ads) → đổi kênh/thông điệp |
| Bao nhiêu khách trả tiền, MRR | 1, 3 | [CHƯA CÓ] | — |
| Khách chi ads ở nhóm nào nhiều nhất | 4 | [CHƯA CÓ] | xác định lại khách lý tưởng (10–200 triệu/tháng là giả thuyết) |
| Sàn nào chiếm đa số | 5 | [CHƯA CÓ] | ưu tiên kênh cộng đồng của sàn đó |
| Referral có chạy không | 6 | [CHƯA CÓ] | 0 khách qua giới thiệu: chương trình chưa ai biết, không phải chương trình dở |

Ngoài SQL cần thêm: lượt truy cập landing/tháng và tỉ lệ landing → đăng ký (Vercel Analytics), lượt cài app
2 kho.

## 3. Ba cược lớn 90 ngày (giả thuyết, xếp theo đòn bẩy / chi phí)

### Cược 1 — "Máy tính ROAS hòa vốn" miễn phí trên landing
- **Cơ chế:** chủ shop nhập giá bán, giá vốn, sàn, ngành → ra ROAS hòa vốn + phí sàn bóc tách. Không cần
  đăng ký; muốn tính tự động cho cả shop → nối gian Hubsell. Công cụ này là đúng lõi khác biệt "lãi thật".
- **Vì sao:** một tài sản dùng nhiều lần: lên Google ("cách tính ROAS hòa vốn Shopee"), làm mồi bài Facebook,
  người dạy bán hàng chia cho học viên. Hubsell đã có công thức phí sàn → chi phí làm thấp.
- **Đo:** lượt dùng máy tính/tuần → tỉ lệ bấm "tính tự động cho shop tôi" → đăng ký.
- **Skill:** `free-tools`, `programmatic-seo` (mỗi ngành một trang), `cro`.

### Cược 2 — Anh tự nói: "soi lãi thật" trong cộng đồng seller
- **Cơ chế:** 3–4 bài/tuần trong các nhóm Facebook/Zalo nhà bán sàn và TikTok cá nhân: lấy số thật shop nhà
  ("ROAS 5 mà lỗ, đây là lý do"), hoặc soi miễn phí màn quảng cáo cho người comment. Không quảng cáo lộ liễu;
  Hubsell xuất hiện như công cụ anh dùng để soi.
- **Vì sao:** ở giai đoạn này người mua tin **người**, chưa tin thương hiệu. Một chủ shop thật nói chuyện tiền
  quảng cáo bằng số thật là thứ đối thủ lớn không bắt chước được.
- **Đo:** lượt hỏi/inbox, đăng ký có mã giới thiệu riêng cho từng kênh.
- **Skill:** `social`, `community-marketing`, `video` (theo quy trình video đã chốt ở `docs/marketing/`).

### Cược 3 — Đối tác người dạy bán hàng / chạy ads thuê
- **Cơ chế:** người dạy bán Shopee/TikTok và người chạy ads thuê đã có sẵn tập học viên/khách đúng chân dung.
  Mời họ dùng miễn phí, nhận hoa hồng giới thiệu 10 % vĩnh viễn (đã có sẵn trong app), cùng làm 1 buổi live
  "đọc lãi thật chiến dịch".
- **Vì sao:** referral 10 % đã xây xong nhưng chưa ai đẩy; một đối tác có 2.000 học viên bằng hàng trăm bài
  đăng. [CẦN KIỂM] luồng ghi nhận thanh toán → hoa hồng đã chạy thật với payOS chưa.
- **Đo:** số đối tác hoạt động, khách qua giới thiệu (SQL khối 6), % trả tiền.
- **Skill:** `referrals`, `co-marketing`, `influencer-marketing`.

### Việc nền đi kèm (không phải cược, nhưng phải đúng)
- **Kho ứng dụng của sàn** (TikTok Shop App Store / chợ dịch vụ Shopee, Lazada): chỗ seller đang tìm công cụ,
  ý định mua cao. [CẦN KIỂM] Hubsell đã có trang trên các kho này chưa. Skill: `aso`.
- **Onboarding tới "aha" trong 10 phút** (màn "N chiến dịch dưới hòa vốn") — đã nêu ở tài liệu định vị mục 5;
  làm theo số khối 2. Skill: `onboarding`, `signup`.

## 4. Cố ý chưa làm

| Việc | Vì sao chưa |
|---|---|
| Chạy quảng cáo trả tiền (Facebook/Google) | Chưa biết khách ở lại bao lâu → chưa tính được trả tối đa bao nhiêu cho một khách |
| Viết blog SEO dài hạn | Chậm 6–12 tháng mới có kết quả; máy tính miễn phí (cược 1) lấy phần SEO nhanh hơn |
| Rải đều 10 kênh | Một người làm marketing: 1–2 kênh làm tới nơi thắng 10 kênh làm dở |
| Cold email, LinkedIn, Product Hunt | Kênh của SaaS Mỹ, chủ shop Việt không ở đó |
| Đổi giá | Đã hẹn bàn ở lát 3 định vị, cần số chi ads (khối 4) trước |

## 5. Bước tiếp theo

1. Anh dán 6 khối SQL vào Supabase, gửi em kết quả (chỉ số đếm, không có thông tin khách).
2. Em điền mục 2, sửa cược theo số, rồi chạy `/marketing-plan hubsell` ra kế hoạch đầy đủ.
3. Song song: anh hỏi 5 khách đang dùng 3 câu — "Vì sao bạn thử Hubsell?", "Trước đó bạn làm thế nào?",
   "Nếu Hubsell biến mất bạn tiếc gì nhất?" — em dùng `/customer-research` tổng hợp, thay lời khách soạn sẵn
   trong bối cảnh bằng lời thật.
