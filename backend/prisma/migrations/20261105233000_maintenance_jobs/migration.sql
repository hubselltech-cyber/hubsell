-- ============================================================
-- 05/11/2026 đêm — SỔ TIẾN ĐỘ VIỆC BẢO TRÌ CHẠY MỘT LẦN (docs/QUAN-LY-KHO-TAI-CAU-TRUC.md mục 6.6)
-- Anh Trung chọn "Máy tự điền chậm" cho mã vạch của sản phẩm cũ: worker điền dần theo lô nhỏ.
-- Việc dài nên phải NHỚ ĐÃ LÀM TỚI ĐÂU qua các lần worker khởi động lại (deploy nhiều lần / ngày):
--   · cursor  — id dòng cuối đã duyệt, lượt sau đi tiếp từ đó (không quét lại từ đầu);
--   · doneAt  — xong hẳn thì các lần khởi động sau KHÔNG đụng bảng lớn nữa (một câu đọc theo khóa).
-- Một dòng / một việc (khóa chữ). Bảng mới, vài dòng — không đụng bảng nóng nào.
-- ============================================================
CREATE TABLE IF NOT EXISTS "maintenance_jobs" (
  "key"       TEXT NOT NULL,
  "cursor"    TEXT,
  "processed" INTEGER NOT NULL DEFAULT 0,
  "doneAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "maintenance_jobs_pkey" PRIMARY KEY ("key")
);

-- Bật RLS như mọi bảng khác (Supabase 30/09/2026); backend đi Prisma nên không cần policy.
ALTER TABLE "maintenance_jobs" ENABLE ROW LEVEL SECURITY;
