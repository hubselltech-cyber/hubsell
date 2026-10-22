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
- [DON-HOAN-VA-SAO-KE.md](DON-HOAN-VA-SAO-KE.md) — đơn hoàn và đối soát sao kê
- [VI-TRI-CHUA-HANG.md](VI-TRI-CHUA-HANG.md) — vị trí kho
- [DONG-BO-SAN-PHAM-TRUNG-MA-PHAN-LOAI.md](DONG-BO-SAN-PHAM-TRUNG-MA-PHAN-LOAI.md) — SKU phân loại con trùng mã
- [HANG-HOA-CHA-CON-PHAN-LOAI.md](HANG-HOA-CHA-CON-PHAN-LOAI.md) — 22/10/2026 SKU kho có phân loại riêng (variantName/groupKey), bảng Hàng hóa cha–con như Giá vốn, mã dự phòng Shopee dùng mã cha, tự Ngừng bán khi sàn gỡ, hộp Nối SKU bỏ tồn 0 + mã gốc
- [GIA-VON-TEN-PHAN-LOAI-LOC-THEO-KY.md](GIA-VON-TEN-PHAN-LOAI-LOC-THEO-KY.md) — 22/10/2026 nhận xét khách vài nghìn SKU: giá vốn nhóm theo gian + mã SP sàn, tên phân loại cạnh mã; "N đơn chưa có giá vốn" → lọc SKU bán trong kỳ (`sku-products/missing-cost`); cột Chi tiết sản phẩm + Kiểm toán phí in tên · phân loại (`lib/order-line-names`)
- [CASH-FLOW-DESIGN.md](CASH-FLOW-DESIGN.md) — thiết kế trang dòng tiền
- [CUU-DON-API-NHAN-KHACH-KHAO-SAT.md](CUU-DON-API-NHAN-KHACH-KHAO-SAT.md) — khảo sát API nhắn khách (Cứu đơn, đang ẩn)
- [THOI-HAN-UY-QUYEN-SAN.md](THOI-HAN-UY-QUYEN-SAN.md) — hạn ủy quyền từng sàn

## Quảng cáo đa sàn
- [HUBSELL-ADS.md](HUBSELL-ADS.md) — app Hubsell Ads (Shopee)
- [ADS-NHIP-CANH-BAO.md](ADS-NHIP-CANH-BAO.md) — nhịp xung và cảnh báo
- [ADS-SHOPEE-KHAI-THAC-API.md](ADS-SHOPEE-KHAI-THAC-API.md) — API Ads Shopee
- [ADS-TIKTOK-GMV-MAX.md](ADS-TIKTOK-GMV-MAX.md) · [TIKTOK-ADS-XIN-QUYEN-CAMPAIGN.md](TIKTOK-ADS-XIN-QUYEN-CAMPAIGN.md) — GMV Max TikTok, xin quyền
- [ADS-KHAO-SAT-ROI-MUC-TIEU-NGAN-SACH.md](ADS-KHAO-SAT-ROI-MUC-TIEU-NGAN-SACH.md) — khảo sát 15/10: ROI mục tiêu + ngân sách khởi điểm có căn cứ (TikTok/Shopee/ngành/đối thủ)
- [KHAO-SAT-TRO-LY-QUANG-CAO-MOBILE.md](KHAO-SAT-TRO-LY-QUANG-CAO-MOBILE.md) — trợ lý quảng cáo trên mobile
- [DANG-NHAP-GOOGLE-APPLE-TRONG-APP.md](DANG-NHAP-GOOGLE-APPLE-TRONG-APP.md) — bản 1.3.0: nút Google + Sign in with Apple trong app, luật 4.8 / 5.1.1(v), id_token → backend, cấu hình Google Cloud + Apple key (18/10/2026)
- [ADS-TIKTOK-TREN-MOBILE.md](ADS-TIKTOK-TREN-MOBILE.md) — phương án 16/10: Trợ lý quảng cáo TikTok trên app (chỉ loại/khôi phục video, còn lại dẫn sang Seller Center; chờ anh chốt)
- [KOC-TIKTOK-AFFILIATE-API.md](KOC-TIKTOK-AFFILIATE-API.md) · [TIKTOK-BINH-LUAN-VIDEO-KHAO-SAT.md](TIKTOK-BINH-LUAN-VIDEO-KHAO-SAT.md) — khảo sát KOC / bình luận video (để sau)

## Sàn & hồ sơ đối tác
- [SHOPEE-ISV-HO-SO.md](SHOPEE-ISV-HO-SO.md) — hồ sơ ISV Shopee
- [TIKTOK-TICKET-GIUC-XET-DUYET-APP.md](TIKTOK-TICKET-GIUC-XET-DUYET-APP.md) — ticket xét duyệt app TikTok

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
