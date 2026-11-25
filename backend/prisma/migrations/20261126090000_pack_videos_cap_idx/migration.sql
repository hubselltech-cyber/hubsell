-- ============================================================
-- 26/11/2026 — CHỈ MỤC cho CHUÔNG BÁO TRƯỚC KHI XÓA video đóng hàng
-- (docs/VIDEO-DONG-HANG-THIET-KE.md mục 34, services/pack-video/cap-notice.ts)
--
--   pack_videos_cap_idx   video CÒN LƯU có hạn xóa = TRẦN 60 ngày (luật L6), sắp theo ngày hạn
--
-- Vì sao: mỗi lượt worker dọn hỏi "video chạm trần trong 3 ngày tới" để báo chủ shop tải về. Không có chỉ mục
-- này, câu hỏi đi qua "pack_videos_delete_after_idx" = MỌI video tới hạn trong khoảng đó (ở mốc thiết kế là
-- hàng triệu dòng mỗi ngày, gần hết là luật L4) rồi mới lọc L6. Video chạm trần là số ít nên chỉ mục này rất nhỏ.
--
-- Chỉ thêm chỉ mục trên bảng sổ video (bảng chia mảnh — lệnh trên bảng cha tự tạo cho từng mảnh, mảnh tháng
-- mới sinh sau tự có). Không đổi cột, không đụng "Order". Bảng mới 55 dòng ngày 25/11/2026 nên lệnh chạy tức thì,
-- KHÔNG cần dựng tay trước trên prod.
-- ============================================================

CREATE INDEX IF NOT EXISTS "pack_videos_cap_idx"
  ON "pack_videos" ("deleteAfter") WHERE "status" = 'STORED' AND "deleteRule" = 'L6';
