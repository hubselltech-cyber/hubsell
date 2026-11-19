-- ============================================================
-- 20/11/2026 — KIỂM KÊ THEO PHIÊN (kho chuẩn quốc tế lát 5, docs/QUAN-LY-KHO-CHUAN-QUOC-TE.md mục 17)
--
--   stocktake_sessions  một phiên đếm: COUNTING → PENDING (chờ duyệt) → APPROVED | CANCELLED
--   stocktake_lines     mỗi mã một dòng trong phiên: số đếm, số sổ LÚC ĐẾM, ai đếm; lúc duyệt ghi
--                       thêm phần chênh đã áp vào kho
--
-- Hai bảng MỚI, rỗng → không khóa bảng nào đang chạy. Không khóa ngoại tới "Product": dòng giữ ảnh
-- chụp mã + tên để biên bản in lại y nguyên dù mã bị xóa sau này. RLS bật theo luật chung (backend
-- đi bằng vai trò chủ database nên không cần policy).
-- ============================================================

CREATE TABLE IF NOT EXISTS "stocktake_sessions" (
  "id"            TEXT NOT NULL,
  "ownerId"       TEXT NOT NULL,
  "code"          TEXT NOT NULL,
  "status"        TEXT NOT NULL DEFAULT 'COUNTING',
  "stockModel"    TEXT NOT NULL DEFAULT 'LEGACY',
  "locationId"    TEXT,
  "locationName"  TEXT,
  "blind"         BOOLEAN NOT NULL DEFAULT false,
  "note"          TEXT,
  "createdById"   TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submittedById" TEXT,
  "submittedAt"   TIMESTAMP(3),
  "approvedById"  TEXT,
  "approvedAt"    TIMESTAMP(3),
  "cancelledAt"   TIMESTAMP(3),
  "lineCount"     INTEGER NOT NULL DEFAULT 0,
  "adjustedCount" INTEGER NOT NULL DEFAULT 0,
  "totalDown"     INTEGER NOT NULL DEFAULT 0,
  "totalUp"       INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "stocktake_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stocktake_sessions_status_check" CHECK ("status" IN ('COUNTING', 'PENDING', 'APPROVED', 'CANCELLED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "stocktake_sessions_ownerId_code_key" ON "stocktake_sessions" ("ownerId", "code");
CREATE INDEX IF NOT EXISTS "stocktake_sessions_ownerId_createdAt_idx" ON "stocktake_sessions" ("ownerId", "createdAt");

CREATE TABLE IF NOT EXISTS "stocktake_lines" (
  "id"          TEXT NOT NULL,
  "sessionId"   TEXT NOT NULL,
  "productId"   TEXT NOT NULL,
  "skuCode"     TEXT NOT NULL,
  "productName" TEXT NOT NULL,
  "counted"     INTEGER NOT NULL,
  "bookAtCount" INTEGER NOT NULL,
  "countedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "countedById" TEXT,
  "bookAtApply" INTEGER,
  "delta"       INTEGER,
  "appliedAt"   TIMESTAMP(3),
  CONSTRAINT "stocktake_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stocktake_lines_counted_check" CHECK ("counted" >= 0),
  CONSTRAINT "stocktake_lines_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "stocktake_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "stocktake_lines_sessionId_productId_key" ON "stocktake_lines" ("sessionId", "productId");

ALTER TABLE "stocktake_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stocktake_lines" ENABLE ROW LEVEL SECURITY;
