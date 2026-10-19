-- ============================================================
-- 19/10/2026 — Pha C lát 1 "đọc bóng đơn" (docs/CUNG-HOA-LOP-GOI-SAN.md mục 5c):
-- bảng bóng ghi mã đơn + mốc biến động + trạng thái sàn mà ĐƯỜNG ĐỌC MỚI nhìn
-- thấy, để so với bảng Order của đường cũ (SQL ở docs 5c). Bảng mới, chỉ gian
-- ghi danh trong sync_cursors mới có dòng. FK Channel → khối lấy khóa thử lại.
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
        RAISE NOTICE 'sync_shadow_orders: chưa lấy được khóa (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

CREATE TABLE IF NOT EXISTS "sync_shadow_orders" (
  "channelId"         TEXT         NOT NULL,
  "orderCode"         TEXT         NOT NULL,
  "platformUpdatedAt" TIMESTAMP(3),
  "status"            TEXT,
  "firstSeenAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "seenCount"         INTEGER      NOT NULL DEFAULT 1,
  CONSTRAINT "sync_shadow_orders_pkey" PRIMARY KEY ("channelId", "orderCode"),
  CONSTRAINT "sync_shadow_orders_channelId_fkey" FOREIGN KEY ("channelId")
    REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "sync_shadow_orders_channel_seen_idx" ON "sync_shadow_orders" ("channelId", "firstSeenAt");

ALTER TABLE "sync_shadow_orders" ENABLE ROW LEVEL SECURITY;
