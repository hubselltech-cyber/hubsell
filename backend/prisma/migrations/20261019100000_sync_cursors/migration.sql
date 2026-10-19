-- ============================================================
-- 19/10/2026 — Pha B "Nền" lớp đọc sàn (docs/CUNG-HOA-LOP-GOI-SAN.md mục 5b):
-- bảng con trỏ máy đọc sàn (N2) kiêm hàng việc của làn (N6: thuê bao có nhịp tim). Bảng MỚI, chưa worker nào đọc/ghi — Pha C mới
-- bật từng luồng theo cờ gian. Khóa ngoại tới "Channel" lấy SHARE ROW EXCLUSIVE
-- trên bảng gian (worker ghi Channel liên tục) → khối lấy khóa có thử lại như các
-- migration trước (bẫy deadlock khi deploy 30/09).
-- ============================================================
DO $$
DECLARE
  attempt INTEGER := 0;
BEGIN
  LOOP
    BEGIN
      SET LOCAL lock_timeout = '5s';
      LOCK TABLE "Channel" IN SHARE ROW EXCLUSIVE MODE;
      EXIT;
    EXCEPTION
      WHEN lock_not_available OR deadlock_detected THEN
        attempt := attempt + 1;
        IF attempt >= 40 THEN
          RAISE;
        END IF;
        RAISE NOTICE 'sync_cursors: chưa lấy được khóa (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

CREATE TABLE IF NOT EXISTS "sync_cursors" (
  "channelId"  TEXT         NOT NULL,
  "stream"     TEXT         NOT NULL,
  "cursorAt"   TIMESTAMP(3) NOT NULL,
  "windowMs"   INTEGER      NOT NULL,
  "lastRunAt"  TIMESTAMP(3),
  "lastStatus" TEXT,
  "lastPages"  INTEGER,
  -- Làn + thuê bao (N6, lát B3): làn nào nhặt, tới hạn lúc nào, ai đang cầm tới bao giờ.
  "lane"       TEXT         NOT NULL DEFAULT 'orders',
  "dueAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseOwner" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sync_cursors_pkey" PRIMARY KEY ("channelId", "stream"),
  CONSTRAINT "sync_cursors_channelId_fkey" FOREIGN KEY ("channelId")
    REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Nhặt việc: làn + tới hạn sớm nhất trước (FOR UPDATE SKIP LOCKED, services/sync-lanes.ts).
CREATE INDEX IF NOT EXISTS "sync_cursors_lane_due_idx" ON "sync_cursors" ("lane", "dueAt");

-- Mọi bảng mới phải bật RLS (PostgREST không đọc được; backend dùng vai trò chủ).
ALTER TABLE "sync_cursors" ENABLE ROW LEVEL SECURITY;
