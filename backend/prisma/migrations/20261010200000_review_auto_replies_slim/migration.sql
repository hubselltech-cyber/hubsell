-- ============================================================
-- SỔ CHỐNG TRÙNG TỰ TRẢ LỜI ĐÁNH GIÁ — BẢN GỌN (10/10/2026, tối)
--
-- Anh hỏi "có tốn thêm database không" ở quy mô nhiều shop dùng. Ước tính quy mô
-- thiết kế (>1 triệu đơn/ngày): ~200.000 đánh giá được tự trả lời mỗi ngày → sổ
-- là bảng lớn nhất của tính năng. Bản đầu (20261010180000) mỗi dòng mang id cuid
-- + ownerId + updatedAt + 3 chỉ mục (~330 byte/dòng). Bản gọn:
--   · khóa chính (channelId, reviewId) thay id + unique riêng → bớt một chỉ mục;
--   · bỏ ownerId, updatedAt (không câu truy vấn nào dùng).
-- Giữ 30 ngày (worker dọn) thay 180: sổ chỉ cần sống lâu hơn độ trễ dữ liệu sàn
-- (vài giờ) và cửa sổ quét (lượt trước − 2 ngày, lần đầu 14 ngày).
--
-- Bảng vừa tạo ở bản deploy trước, chưa shop nào bật (cấu hình chỉ có khi khách
-- mở trang) → DROP + CREATE an toàn, không khóa bảng nào khác.
-- ============================================================

DROP TABLE IF EXISTS "review_auto_replies";

CREATE TABLE "review_auto_replies" (
  "channelId" TEXT NOT NULL,
  "reviewId"  TEXT NOT NULL,
  "rating"    SMALLINT NOT NULL,
  "status"    TEXT NOT NULL DEFAULT 'SENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "review_auto_replies_pkey" PRIMARY KEY ("channelId", "reviewId")
);

CREATE INDEX "review_auto_replies_createdAt_idx" ON "review_auto_replies" ("createdAt");

ALTER TABLE "review_auto_replies" ENABLE ROW LEVEL SECURITY;
