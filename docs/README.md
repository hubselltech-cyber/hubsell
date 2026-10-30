# Chỉ mục tài liệu `docs/` — theo chủ đề

> Tên tệp viết HOA không dấu, một chủ đề một tệp. Tệp mới → thêm vào đúng nhóm dưới đây.
> Nhật ký phiên ở [`../PROGRESS.md`](../PROGRESS.md), kiến trúc tổng ở [`../README.md`](../README.md).

## Kiến trúc & quy mô
- [KIEN-TRUC-QUY-MO-TRIEU-DON.md](KIEN-TRUC-QUY-MO-TRIEU-DON.md) — gốc 5 giai đoạn tới 1 triệu đơn/ngày
- [HANG-DOI-BEN.md](HANG-DOI-BEN.md) — giai đoạn 2: hàng đợi bền pg-boss, webhook, đẩy tồn
- [SO-CAI-DON.md](SO-CAI-DON.md) — giai đoạn 1: sổ cái đơn, mọi báo cáo đọc sổ
- [MO-HINH-CAY-SAN-PHAM-SAN.md](MO-HINH-CAY-SAN-PHAM-SAN.md) — hợp đồng cây sản phẩm sàn (SPU → lá → dòng đơn), danh tính theo id, 5 lát sửa (18/10/2026)
- [DONG-BO-GIAI-DOAN-3.md](DONG-BO-GIAI-DOAN-3.md) — giai đoạn 3: hợp đồng đọc sàn, mốc nước quét đơn
- [CUNG-HOA-LOP-GOI-SAN.md](CUNG-HOA-LOP-GOI-SAN.md) — 18/10/2026 thiết kế lại lớp đọc sàn (bản 2, 7 nguyên lý, mốc 1 gian 4.000 đơn/ngày); Pha A kiểm 7 giả thuyết bằng `backend/scripts/pha-a-san-probe.ts` + SQL mục 3b
- [RA-CHEO-SO-WEB-MOBILE-BACKEND-2026-10-26.md](RA-CHEO-SO-WEB-MOBILE-BACKEND-2026-10-26.md) — 26/10/2026 rà chéo 65 điểm số liệu web ↔ mobile ↔ backend theo 7 ca; gốc = hai endpoint hai công thức lợi nhuận → `lib/net-profit.ts`; việc chờ anh chốt ở mục 4
- [QUANG-CAO-GOM-TRONG-DATABASE.md](QUANG-CAO-GOM-TRONG-DATABASE.md) — gom số quảng cáo bằng SQL
- [BANG-THONG-WORKER-CO-VIEC-THI-GOI.md](BANG-THONG-WORKER-CO-VIEC-THI-GOI.md) + thư mục `bang-thong-worker-do-2026-10-12/` — đo và cắt băng thông worker
- [HQ-SUC-KHOE.md](HQ-SUC-KHOE.md) — trang Sức khỏe hệ thống cho HQ
- [BAO-MAT-MA-HOA-BI-MAT.md](BAO-MAT-MA-HOA-BI-MAT.md) — mã hóa bí mật trong DB
- [DEPLOY-RENDER-SUPABASE.md](DEPLOY-RENDER-SUPABASE.md) — deploy Render (web + worker) + Supabase + Vercel

## Gói dịch vụ, thanh toán, thuê bao
- [GIA-ENTERPRISE-THEO-DON.md](GIA-ENTERPRISE-THEO-DON.md) — Enterprise 65đ/đơn: lãi/lỗ theo đơn, so đối thủ, cách cấu hình giá công bố (22/10/2026)
- [GOI-NGU-DONG-GIAN-HET-HAN.md](GOI-NGU-DONG-GIAN-HET-HAN.md) — ngủ đông gian khi hết gói quá ân hạn (15/10/2026)
- [HQ-CRM-TU-CHUYEN-TRANG-THAI.md](HQ-CRM-TU-CHUYEN-TRANG-THAI.md) — CRM HQ tự chuyển trạng thái chăm sóc theo thuê bao: thanh toán → Đang dùng ổn định, hết gói quá ân hạn → Đã rời bỏ (22/10/2026)
- [PAYOS-KENH-THANH-TOAN.md](PAYOS-KENH-THANH-TOAN.md) — cổng thanh toán payOS
- [APPLE-IAP-MUA-GOI-TRONG-APP.md](APPLE-IAP-MUA-GOI-TRONG-APP.md) — mua gói trong app iOS

## Đơn hàng, kho, vận hành
- [CHUAN-BI-HANG-THEO-ME.md](CHUAN-BI-HANG-THEO-ME.md) — chuẩn bị hàng theo mẻ, chạy nền
- [DON-HOAN-VA-SAO-KE.md](DON-HOAN-VA-SAO-KE.md) — đơn hoàn và đối soát sao kê; mục 8 (29/10/2026) khảo sát kho quét kiện về báo "Không hoàn": kiện giao thất bại → sàn hủy không vào trục hoàn; lát A (hủy sau giao = Chờ hàng về, 0 call thêm) + C (màn quét hỏi sàn đúng đơn) GIỮ; lát B (webhook type 12 hỏi returns/search) ĐÃ GỠ — anh chốt chậm 30' được, không gọi thêm sàn
- [VI-TRI-CHUA-HANG.md](VI-TRI-CHUA-HANG.md) — vị trí kho
- [DONG-BO-SAN-PHAM-TRUNG-MA-PHAN-LOAI.md](DONG-BO-SAN-PHAM-TRUNG-MA-PHAN-LOAI.md) — SKU phân loại con trùng mã
- [HANG-HOA-CHA-CON-PHAN-LOAI.md](HANG-HOA-CHA-CON-PHAN-LOAI.md) — 22/10/2026 SKU kho có phân loại riêng (variantName/groupKey), bảng Hàng hóa cha–con như Giá vốn, mã dự phòng Shopee dùng mã cha, tự Ngừng bán khi sàn gỡ, hộp Nối SKU bỏ tồn 0 + mã gốc
- [GIA-VON-TEN-PHAN-LOAI-LOC-THEO-KY.md](GIA-VON-TEN-PHAN-LOAI-LOC-THEO-KY.md) — 22/10/2026 nhận xét khách vài nghìn SKU: giá vốn nhóm theo gian + mã SP sàn, tên phân loại cạnh mã; "N đơn chưa có giá vốn" → lọc SKU bán trong kỳ (`sku-products/missing-cost`); cột Chi tiết sản phẩm + Kiểm toán phí in tên · phân loại (`lib/order-line-names`)
- [CASH-FLOW-DESIGN.md](CASH-FLOW-DESIGN.md) — thiết kế trang dòng tiền
- [DONG-TIEN-TONG-GIA-TRI-SAN-PHAM-KHAO-SAT-29-10.md](DONG-TIEN-TONG-GIA-TRI-SAN-PHAM-KHAO-SAT-29-10.md) — 29/10/2026 thẻ "Tổng giá trị sản phẩm" = giá món hàng TRONG GIỎ (anh chốt), voucher/xu = khấu trừ: khảo sát API 3 sàn + số prod; 4 lát ĐÃ LIVE (TikTok revenue_amount + voucher từ Get Order Price Details; 2 phí mới TikTok; 3 cột trên giỏ Shopee; sổ cái v3 + sửa cộng thiếu khi đổi version); còn Lazada (mục 9) và combo Shopee vào khấu trừ (mục 13)
- [SAO-CHEP-SAN-PHAM.md](SAO-CHEP-SAN-PHAM.md) — 29/10/2026 Sao chép sản phẩm lên nhiều gian 3 sàn (anh chốt 2 nguồn: gian đã nối + kho Hubsell; mục con Trợ lý vận hành; nhãn "(demo)" đã bỏ tối 29/10 sau khi đăng thật thành công): thiết kế mục 1–7; lát 1 (bảng listing_copy_*, hàng đợi listing.copy, ListingAdapter + giả lập) mục 8; lát 2 đợt N SP × M gian mục 9; lát 1b adapter THẬT Shopee/TikTok/Lazada + probe chỉ đọc mục 10; góp ý anh trên prod mục 11–12 (lọc sàn→gian, danh mục xổ cha→con, vận chuyển, bảng phân tầng, Sửa bài đăng); ảnh chèn trong mô tả mục 13; lỗi thật đầu tiên prod (Shopee Dimension 0 do TikTok trả "0") + dịch lỗi sàn tiếng Việt + từ điển tên thuộc tính + nhãn Bắt buộc mục 14; lỗi thật lần 2 (TikTok images/upload thừa shop_cipher, Shopee multi warehouse cần location_id) mục 15 (sau đó Shopee DarkMan ĐĂNG ĐƯỢC, TikTok chờ duyệt); sửa giá + tồn từng phân loại trong Sửa bài đăng mục 16; bài TikTok chờ duyệt tự cập nhật (worker 10 phút + khi mở đợt) mục 17; ảnh theo phân loại (ảnh màu) chép 3 sàn mục 18; chuẩn hóa ảnh sharp mục 26; sửa ảnh bài đăng mục 27; gian Shopee không whitelist ảnh mô tả → rơi về mô tả chữ mục 28; dọn mã 30/10 tối (service.ts tách 7 tệp, trang FE 1.964 dòng tách 15 tệp, lib ttl-cache/paginate/tree, probe → script, route hiện tại) mục 29; "Tạo sản phẩm mới" chuyển về Hàng hóa `/products/new`, bỏ hộp Thêm sản phẩm + POST /api/products cũ mục 30
- [KHAO-SAT-SAO-CHEP-SAN-PHAM-DANG-HANG-LOAT-29-10.md](KHAO-SAT-SAO-CHEP-SAN-PHAM-DANG-HANG-LOAT-29-10.md) — 29/10/2026 4 khách thử đòi "Sao chép sản phẩm" + "Đăng hàng loạt": so 10 đối thủ (Ship Xanh, Sapo, KiotViet, Salework, UpBase, Nhanh, Haravan, Pancake, Omisell, BigSeller…) + API tạo SP 3 sàn; không ai có trọn "nhiều gian nhiều sàn 1 lượt + gợi ý danh mục + tự nối SKU"; đề xuất 2 lát, nguồn chỉ gian đã nối; 3 câu hỏi lại khách (mục 7), việc kiểm trước (mục 8) — anh đã chốt làm, mã ở SAO-CHEP-SAN-PHAM.md
- [CUU-DON-API-NHAN-KHACH-KHAO-SAT.md](CUU-DON-API-NHAN-KHACH-KHAO-SAT.md) — khảo sát API nhắn khách (Cứu đơn, đang ẩn)
- [HUY-DON-SAU-CHUAN-BI-HANG-KHAO-SAT.md](HUY-DON-SAU-CHUAN-BI-HANG-KHAO-SAT.md) — 23/10/2026 khách xin hủy sau khi đã chuẩn bị hàng / đang giao: khảo sát API 3 sàn + ĐÃ LÀM lát 1+2 web (cờ `cancelRequestedAt` trục riêng, Shopee IN_CANCEL / TikTok cancellations / Lazada reverse CANCEL, nút Chấp nhận–Từ chối gọi sàn, `cancel-request-decide.ts`); lát 3 + app mobile chờ
- [THOI-HAN-UY-QUYEN-SAN.md](THOI-HAN-UY-QUYEN-SAN.md) — hạn ủy quyền từng sàn

## Quảng cáo đa sàn
- [HUBSELL-ADS.md](HUBSELL-ADS.md) — app Hubsell Ads (Shopee)
- [ADS-NHIP-CANH-BAO.md](ADS-NHIP-CANH-BAO.md) — nhịp xung và cảnh báo
- [ADS-SHOPEE-KHAI-THAC-API.md](ADS-SHOPEE-KHAI-THAC-API.md) — API Ads Shopee
- [ADS-TIKTOK-GMV-MAX.md](ADS-TIKTOK-GMV-MAX.md) · [TIKTOK-ADS-XIN-QUYEN-CAMPAIGN.md](TIKTOK-ADS-XIN-QUYEN-CAMPAIGN.md) — GMV Max TikTok, xin quyền
- [ADS-KHAO-SAT-ROI-MUC-TIEU-NGAN-SACH.md](ADS-KHAO-SAT-ROI-MUC-TIEU-NGAN-SACH.md) — khảo sát 15/10: ROI mục tiêu + ngân sách khởi điểm có căn cứ (TikTok/Shopee/ngành/đối thủ)
- [KHAO-SAT-TRO-LY-QUANG-CAO-MOBILE.md](KHAO-SAT-TRO-LY-QUANG-CAO-MOBILE.md) — trợ lý quảng cáo trên mobile
- [DANG-NHAP-GOOGLE-APPLE-TRONG-APP.md](DANG-NHAP-GOOGLE-APPLE-TRONG-APP.md) — bản 1.3.0: nút Google + Sign in with Apple trong app, luật 4.8 / 5.1.1(v), id_token → backend, cấu hình Google Cloud + Apple key (18/10/2026)
- [CHUONG-THONG-BAO-CAU-CHU-GIA-TRI.md](CHUONG-THONG-BAO-CAU-CHU-GIA-TRI.md) — 25/10/2026 câu chữ chuông web + mobile phải cho thấy GIÁ TRỊ (Trợ lý đã làm gì → chặn được bao nhiêu tiền → cần làm gì / không cần làm gì): công thức, bảng trước → sau 17 chuông, chỗ chưa có số
- [THONG-BAO-DAY-MOBILE.md](THONG-BAO-DAY-MOBILE.md) — 23/10/2026 bản mobile 1.4.0: chuông + tin đẩy (Expo Push, bảng `push_devices`), 9 nhóm bật/tắt (`notification-categories.ts`, áp cả web), đơn mới gom đợt / hỏa tốc báo ngay (`new-order-notify.ts`), lọc gian hàng hộp trượt; việc anh làm: Firebase FCM V1; khảo sát API trả lời yêu cầu hoàn 3 sàn
- [MOBILE-NOI-GIAN-GIA-VON.md](MOBILE-NOI-GIAN-GIA-VON.md) — 28/10/2026 nối gian hàng (ủy quyền 3 sàn qua phiên trình duyệt hệ thống, dải tiến độ thay nút Đồng bộ) + màn Giá vốn rút gọn (Cần nhập 30 ngày / Tất cả SKU / áp cả mẫu) + hai ô trạng thái trên Tổng quan; phản biện + 3 điểm chờ anh chốt; lát 2 nảy về app, lát 3 phân trang sku-products
- [ADS-TIKTOK-TREN-MOBILE.md](ADS-TIKTOK-TREN-MOBILE.md) — phương án 16/10: Trợ lý quảng cáo TikTok trên app (chỉ loại/khôi phục video, còn lại dẫn sang Seller Center; chờ anh chốt)
- [KOC-TIKTOK-AFFILIATE-API.md](KOC-TIKTOK-AFFILIATE-API.md) · [TIKTOK-BINH-LUAN-VIDEO-KHAO-SAT.md](TIKTOK-BINH-LUAN-VIDEO-KHAO-SAT.md) — khảo sát KOC / bình luận video (để sau)

## Sàn & hồ sơ đối tác
- [SHOPEE-ISV-HO-SO.md](SHOPEE-ISV-HO-SO.md) — hồ sơ ISV Shopee
- [TIKTOK-TICKET-GIUC-XET-DUYET-APP.md](TIKTOK-TICKET-GIUC-XET-DUYET-APP.md) — ticket xét duyệt app TikTok
- [TIKTOK-APP-STORE-NIEM-YET.md](TIKTOK-APP-STORE-NIEM-YET.md) — 23/10/2026 niêm yết lên App & Service Store TikTok Shop theo định vị Trợ lý quảng cáo: luật TikTok đã kiểm, quyết định nâng cấp app cũ (kệ ERP) vs app mới kệ Marketing, nội dung listing tiếng Việt, bộ ảnh `store/tiktok/`, luồng cài từ App Store (callback không state)

## Hóa đơn điện tử & thuế
- [MISA-TICKET-SANDBOX.md](MISA-TICKET-SANDBOX.md) · [MISA-TICKET-TAI-NGUYEN-HOA-DON.md](MISA-TICKET-TAI-NGUYEN-HOA-DON.md) · [MISA-TICKET-MA-THAM-CHIEU-HOA-DON-DA-XOA.md](MISA-TICKET-MA-THAM-CHIEU-HOA-DON-DA-XOA.md) — hỏi đáp MISA
- [HOA-DON-HQ-KY-NEN-KHAO-SAT-07-10.md](HOA-DON-HQ-KY-NEN-KHAO-SAT-07-10.md) — ký nền hóa đơn HQ
- [THUE-NHA-THAU-NCC-NUOC-NGOAI.md](THUE-NHA-THAU-NCC-NUOC-NGOAI.md) — thuế nhà thầu
- [KHAO-SAT-SALEWORK-ETAX-08-10.md](KHAO-SAT-SALEWORK-ETAX-08-10.md) — so đối thủ

## Pháp lý, công ty, thương hiệu
- [THONG-BAO-BO-CONG-THUONG.md](THONG-BAO-BO-CONG-THUONG.md) — hồ sơ Bộ Công Thương (cam kết với khách)
- [DANG-KY-NHAN-HIEU-HUBSELL.md](DANG-KY-NHAN-HIEU-HUBSELL.md) · [DOI-TEN-TIENG-ANH-DKDN.md](DOI-TEN-TIENG-ANH-DKDN.md) — nhãn hiệu, tên tiếng Anh (script sinh hồ sơ ở `tools/phap-ly/`)
- [CHUYEN-TEN-MIEN-HUBSELL-VN.md](CHUYEN-TEN-MIEN-HUBSELL-VN.md) — chuyển sang hubsell.vn
- [HUY-HIEU-TIN-CAY-LANDING.md](HUY-HIEU-TIN-CAY-LANDING.md) — huy hiệu tin cậy chân trang

## Landing, marketing, store
- [LANDING-KE-CHUYEN.md](LANDING-KE-CHUYEN.md) · [LANDING-NHAN-VAT-THUONG-HIEU.md](LANDING-NHAN-VAT-THUONG-HIEU.md) · `landing-persona/`
- `marketing/` — định vị lại (DINH-VI-LAI-HUBSELL-QUANG-CAO), thư khách hiện có, quy trình video, bài Facebook
- Việc marketing mới (từ 17/10/2026) làm ở thư mục riêng [`../hubsell-marketing/`](../hubsell-marketing/README.md): bối cảnh sản phẩm, skill marketing, SQL số khách, chiến lược
- `store/` — [DUA-APP-LEN-CH-PLAY-APP-STORE.md](DUA-APP-LEN-CH-PLAY-APP-STORE.md), LISTING, thư trả Apple REPLY-1…7, ảnh/feature graphic (script dựng ở `../tools/do-hoa/`)

## Lưu trữ
- [archive/PROGRESS-2026-07-09.md](archive/PROGRESS-2026-07-09.md) — nhật ký phiên 28/07 → 24/09/2026 (36 phiên) tách khỏi PROGRESS.md ngày 21/10/2026
