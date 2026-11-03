-- Nút "Đồng bộ từ sàn" / "Lấy sản phẩm mới từ sàn" / Nối nhanh chuyển sang worker
-- (lát 3.7 giai đoạn 3, docs/DONG-BO-GIAI-DOAN-3.md mục 5 — anh Trung chốt 03/11/2026
-- sau sự cố web OOM 7 lần vì kéo danh mục gian ongbocute.vn ngay trong request).
--   productSyncRequestedAt — mốc khách xin kéo; web chỉ ghi mốc này + nextProductSyncAt = now,
--                            worker product-catalog-sync kéo xong (hay lỗi) thì xóa về NULL.
--                            Khác NULL = trang báo "Đang kéo trong vài phút".
-- Một cột NULL, không mặc định, không chỉ mục. ADD COLUMN NULL không ghi lại dòng.
-- IF NOT EXISTS để chạy lại êm. Đường lui: revert commit (cột thừa vô hại).
ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "productSyncRequestedAt" TIMESTAMP(3);
