# Trang con "Quay video đóng hàng" — căn cứ SEO + tìm kiếm bằng AI (22/11/2026)

**Anh Trung 22/11/2026:** "landing em bổ sung tính năng Quay video gói hàng… thiết kế vào một trang con và dẫn link vào thôi… viết chuẩn SEO
và đặc biệt phải chuẩn SEO tìm kiếm trên các phần mềm AI… khách vào chatGPT, Claude, gemini… tìm được đúng link web mình." Sau đó anh dặn
thêm: "Phần này sẽ có camera toàn cảnh và camera cận cảnh mã vận đơn".

Mã nguồn (repo `hubsell-landing`, 22/11 khuya đã chuyển sang khuôn chung — xem SEO-TRANG-TINH-NANG.md): `src/app/quay-video-dong-hang/page.tsx`
(cấu hình trang) · `src/components/feature/pack-video-frame.tsx` (khung video đầu trang) · `src/components/feature/illus/pack-video.tsx` · ngày sửa ở `src/lib/features.ts` · `src/app/sitemap.ts` · `src/app/layout.tsx`
(JSON-LD Organization + WebSite cho mọi trang) · link vào: ô "Quay video đóng hàng" ở lưới tính năng (`tour.tsx`, hiện ở trang chủ và
/tinh-nang) + cột Sản phẩm ở chân trang.

Mức chắc: **[C]** = đã đọc trang gốc / đã kiểm · **[NC]** = nghiên cứu của bên thứ ba · **[S]** = suy ra, chưa có số.

## 1. Từ khóa — vì sao đường dẫn là `/quay-video-dong-hang`

Không có nguồn công khai cho lượng tìm kiếm. Bảng dưới xếp theo độ dày gợi ý của Google (hl=vi, gl=vn, ~55 cụm gốc, kéo 22/11) [C cho gợi ý,
S cho thứ hạng]:

| Nhóm | Cụm |
|---|---|
| Chính | **quay video đóng hàng** (cây gợi ý dày nhất; "đóng hàng" hơn hẳn "đóng gói", "gói hàng") · phần mềm quay video đóng hàng · quay video đóng hàng shopee |
| Phụ | quay video đóng gói hàng · app quay video đóng hàng · app quay đóng hàng tra cứu mã vận đơn · phần mềm quay video đóng hàng miễn phí · cách quay video đóng hàng shopee · camera / bộ / combo quay đóng hàng · video đóng hàng điện thoại |
| Câu hỏi | phần mềm quay đóng hàng là gì · cách quay video khiếu nại shopee · quay video mở hàng shopee · biên bản đồng kiểm hàng hoàn |
| Gần như không ai gõ | quay video đóng hàng tiktok / lazada · quay video khui hàng hoàn · lưu video đóng hàng · quay bằng webcam |

→ Tiêu đề `Phần mềm quay video đóng hàng Shopee, TikTok Shop, Lazada — Hubsell`; H1 `Phần mềm quay video đóng hàng tự động theo mã vận đơn`.
Chữ "gói hàng" anh dùng không đặt vào đường dẫn / tiêu đề vì ít người gõ [S].

## 2. Đối thủ đang lên top (đọc 19 trang, 22/11)

Thứ tự lấy qua DuckDuckGo vùng Việt Nam (chạy trên chỉ mục Bing) vì trang kết quả Google cần JavaScript [S]. Đầu bảng "phần mềm quay video
đóng hàng": bài liệt kê của GHN (~4.100 chữ), Cambox, EffiTrack, Ship Xanh, Dohana, CamSight, ECAM, Boxcam, CAM CHECK (quayvideodongdon.com —
SEO trên trang mạnh nhất: 20 câu FAQ, VideoObject, bảng so cách quay). Trang phần mềm dài 600–4.800 chữ; trang tốt có FAQ + bảng giá + "dành
cho ai".

**Chỗ trống em dùng cho trang mình:** (1) không trang nào DẪN LINK quy định chính thức của sàn; không ai nêu giới hạn tải thẳng 1 phút của
Shopee hay câu "dấu thời gian hiển thị rõ" của TikTok; (2) số ngày lưu ai cũng đặt tùy ý (20, 30–90 ngày); (3) không ai so ba sàn cạnh nhau;
(4) không ai tính giá ra đồng / đơn; (5) gần như không ai gắn video với dữ liệu đơn + yêu cầu hoàn.

## 3. Nguồn chính thức của sàn (đã đọc 22/11) [C]

| Trang | Điều trích lên trang mình |
|---|---|
| help.shopee.vn/portal/4/article/79467 (bằng chứng Trả hàng/Hoàn tiền) | video quay xuyên suốt, liên tục, không cắt ghép; mã vận đơn khớp đơn; tải thẳng tối đa 1 phút, dài hơn gửi đường dẫn Drive / YouTube; quay 6 mặt kiện; trả lời bổ sung trong 24 giờ |
| help.shopee.vn/portal/4/article/188931 (quy định chung) | người mua gửi yêu cầu trong 15 ngày từ "Đã nhận được hàng" |
| seller-vn.tiktok.com … knowledge_id=101756645132049 | tài liệu bổ sung trong 24 giờ; kháng nghị trong 2 ngày theo lịch, một lần |
| seller-vn.tiktok.com … knowledge_id=1683292772615953 | video phải có dấu thời gian hiển thị rõ + mã đơn liên quan |
| Lazada | KHÔNG tìm thấy trang chính thức về video đóng hàng → trang mình nói thẳng như vậy |

Chưa đọc được (trang cần JavaScript / đăng nhập): banhang.shopee.vn/edu/article/25057, 3647, 239. Muốn trích thì mở bằng Chrome có đăng nhập.

## 4. Chuẩn kỹ thuật cho AI tìm thấy — đã làm / không làm

| Việc | Căn cứ | Trạng thái |
|---|---|---|
| Cho bot tìm kiếm của AI vào: OAI-SearchBot (ChatGPT), Claude-SearchBot, PerplexityBot, Bingbot (Copilot), Googlebot (Gemini, AI Overviews) | tài liệu bot của OpenAI, Anthropic, Perplexity, Google [C] | **Đã sẵn**: robots.txt `User-Agent: * Allow: /`; 22/11 gửi thử bằng tên từng bot → hubsell.vn trả 200 cả 6 |
| Chữ nằm sẵn trong HTML (bot AI không chạy JavaScript) | Vercel/MERJ 12/2024 [NC] | **Đã sẵn**: trang tĩnh server component; curl giả OAI-SearchBot thấy đủ chữ |
| Câu trả lời ngay đầu trang, H2 dạng câu hỏi, bảng, bước đánh số, số liệu cụ thể, dẫn nguồn | Microsoft 10/2025, Bing 02/2026 [C]; bài GEO KDD 2024: dẫn nguồn +26 %, số liệu +29 % [NC] | Đã làm |
| FAQ LUÔN MỞ, không gập | Microsoft khuyên không giấu câu trả lời trong ô gập [C] | Đã làm (khác các trang cũ dùng `<details>`) |
| Ngày "Cập nhật" hiện trên trang = `dateModified` JSON-LD = `lastModified` sitemap | Ahrefs: AI hay trích trang mới hơn [NC] | Đã làm — CHỈ đổi khi sửa chữ thật |
| JSON-LD: WebApplication (giá 2.000 đ / giờ), BreadcrumbList, FAQPage; Organization + WebSite toàn trang | Google chỉ đòi khớp chữ hiển thị [C]; Bing nói schema giúp Copilot [NC] | Đã làm. KHÔNG có aggregateRating (chưa có đánh giá thật) |
| FAQPage | Google ngừng hiện FAQ từ 07/05/2026 [C] | Vẫn gắn — rẻ, Bing / Copilot còn đọc |
| HowTo | Google đã bỏ [C] | Không làm |
| llms.txt | Google không dùng; Ahrefs 06/2026: 97 % tệp không ai đọc [NC] | **Không làm** |
| Google-Extended | chặn nó là mất cả phần Gemini trích dẫn [C] | Để mở (đang mở) |

## 5. Việc sau khi đăng (chưa làm — cần anh)

1. ✅ **Google Search Console** (22/11, tài khoản `dev@hubsell.vn`, thuộc tính Miền `hubsell.vn`): sitemap `https://hubsell.vn/sitemap.xml`
   gửi LẦN ĐẦU (trước đó chưa từng gửi) → **Thành công, 12 trang**; "Yêu cầu lập chỉ mục" `/quay-video-dong-hang` → đã vào hàng ưu tiên
   (lượt đầu Google báo lỗi tạm, bấm lại thì qua). Lúc gửi, trang "chưa được lập chỉ mục — đã phát hiện qua sitemap". Search Console cho
   tổng 315 lượt nhấp từ trước tới nay.
2. ✅ **Bing Webmaster Tools** (22/11): đăng nhập bằng Google `dev@hubsell.vn`, nhập site từ Search Console → `https://hubsell.vn/` (quyền
   Administrator, không phải xác minh lại); cấp cho bing.com quyền CHỈ XEM Search Console (gỡ được ở myaccount.google.com → Bảo mật → Ứng
   dụng bên thứ ba). Gửi tay sitemap → "Submitted / Processing". Cookie Bing: chọn Reject. Có báo cáo **AI Performance** (Copilot trích trang)
   ở menu trái — xem sau ~1–2 tuần.
3. ✅ **IndexNow** (Bing, Yandex, Naver…; Google không tham gia) — LÀM 22/11: tệp khóa `public/9aeb7a0d2f9e99bdd2201e0318aae53e.txt`
   (khóa công khai theo thiết kế, không phải bí mật) + `scripts/indexnow.mjs`. Đã báo 5 trang (mới, /privacy, /xoa-tai-khoan, /, /tinh-nang)
   → **200 OK**. Lần sau sửa trang thật thì chạy `node scripts/indexnow.mjs /duong-dan` từ PowerShell (Git Bash phải đặt
   `MSYS_NO_PATHCONV=1`, không thì "/privacy" thành "C:/Program Files/Git/privacy" — lượt đầu 22/11 đã gửi nhầm như vậy, script nay chặn).
   Search Console (mục 1) chỉ vào được bằng **dev@hubsell.vn** — thuộc tính Miền hubsell.vn xác minh TXT từ 01/10; Gmail của anh không có quyền.
4. **Video YouTube hướng dẫn** có chữ "Hubsell" + "quay video đóng hàng" ở tiêu đề / mô tả / lời nói, rồi nhúng vào trang (thêm VideoObject).
   Ahrefs: nhắc tên trên YouTube tương quan mạnh nhất với việc AI nhắc thương hiệu (≈ 0,74) [NC, tương quan chứ không phải nhân quả].
   Đây là việc đáng làm nhất ngoài trang.
5. **Câu trả lời thật** ở nơi công khai (YouTube, diễn đàn) — nhóm Facebook phần lớn bot không đọc được [S].
6. Đo: Search Console (báo cáo AI), Bing AI Performance, nguồn giới thiệu `chatgpt.com` trong thống kê.

AI trả lời bằng chỉ mục của nó, nên trang mới phải đợi bot ghé + xếp hạng: tính bằng tuần, không phải ngày [S].

## 6. Ràng buộc nội dung (ai sửa trang phải giữ)

- Điện thoại CHƯA quay được với khách (bản có quay mới ở TestFlight) → chỉ "sắp có".
- Không ghi số ngày lưu cụ thể: luật tự xóa còn chạy bóng, anh chưa chốt số (THIET-KE 19.9). Chỉ nói "giữ theo trạng thái đơn".
- Camera an ninh / đầu ghi: CHƯA nhận.
- Hai camera: toàn cảnh (bắt buộc) + cận cảnh mã vận đơn (tùy chọn), ghép hình-trong-hình ngay lúc quay, ô mặc định góc phải dưới
  (`pip-layout.ts` `PIP_DEFAULT`), khách kéo / phóng to một lần.
- Giá theo `backend/src/config/pack-video.ts`. Ví dụ "36 giây / đơn ≈ 20 đ" là phép chia từ buổi đóng thử 20/11 (THIET-KE 25.13), không
  phải số trung bình của khách.
- Khung video trên trang là HÌNH VẼ CSS với mã bịa — không dùng ảnh khung video thật (tem có tên + SĐT người nhận).

## 7. Đăng + Chính sách bảo mật (22/11 — anh: "Sửa cả hai rồi đăng")

- Trang đăng ở `AVAILABILITY = "early"`: nút chính "Đăng ký dùng sớm" (form tư vấn, nguồn `pack-video-page`) + dòng "đang mở dần", vì tính
  năng còn chỉ mở cho `admin@hubsell.vn` (`PACK_VIDEO_PILOT_EMAILS`). Mở cho mọi khách thì đổi thành `"open"`.
- Chính sách bảo mật bản 22/11/2026: trước đó mục Camera viết hình ảnh camera "không lưu và không gửi về Hubsell" và mục bên xử lý phụ thiếu
  kho lưu video → đã sửa mục 2, 3, 5, 7, 8, 15 + trang Xóa tài khoản; `PRIVACY_VERSION` = `2026-11-22` (điều kiện 3 của THIET-KE mục 8 xong).
- ⚠️ Lời hứa mới ở mục 8 (video tự xóa theo trạng thái đơn, xóa cùng tài khoản) cần BẬT `PACK_VIDEO_DELETE_ENABLED` +
  `PACK_VIDEO_ACCOUNT_PURGE` trước khi mở tính năng cho khách. Mục 13 hứa xin đồng ý lại khi thêm bên nhận dữ liệu → khi mở cho khách cần
  bước đồng ý ở cửa tính năng (chưa có).
