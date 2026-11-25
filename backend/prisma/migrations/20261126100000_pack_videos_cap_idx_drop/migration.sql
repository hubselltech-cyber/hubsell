-- ============================================================
-- 26/11/2026 — GỠ chỉ mục "pack_videos_cap_idx" (tạo ở 20261126090000, cùng ngày)
--
-- Chỉ mục phục vụ chuông báo "video đang giữ sắp chạm trần 60 ngày". Anh Trung 26/11/2026: "Chuông → bỏ qua, không
-- cần" → phần chuông đã gỡ khỏi mã, chỉ mục không còn câu nào dùng. Bảng sổ video mới ~55 dòng nên lệnh chạy tức thì.
-- ============================================================

DROP INDEX IF EXISTS "pack_videos_cap_idx";
