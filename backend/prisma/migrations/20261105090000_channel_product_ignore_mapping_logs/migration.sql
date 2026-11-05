-- ============================================================
-- 05/11/2026 — THIẾT KẾ LẠI "SẢN PHẨM TRÊN SÀN" (docs/SAN-PHAM-TREN-SAN-THIET-KE-LAI.md)
--   1. ChannelProduct.ignoredAt: khách "Bỏ qua" sản phẩm sàn không muốn quản tồn
--      (quà tặng, combo…) → ra khỏi hàng đợi Cần nối, vẫn nhận đơn. NULL = bình thường.
--   2. mapping_logs: lịch sử liên kết (ai nối / gỡ / tạo / bỏ qua gì, lúc nào, từ đâu).
-- "ChannelProduct" bị worker đồng bộ danh mục UPSERT liên tục → ADD COLUMN NULL là
-- tức thời nhưng vẫn cần khóa ngắn → lấy khóa có thử lại (gotcha deadlock Render).
-- ============================================================
DO $$
DECLARE
  attempt INTEGER := 0;
BEGIN
  LOOP
    BEGIN
      SET LOCAL lock_timeout = '5s';
      LOCK TABLE "ChannelProduct" IN ACCESS EXCLUSIVE MODE;
      EXIT;
    EXCEPTION
      WHEN lock_not_available OR deadlock_detected THEN
        attempt := attempt + 1;
        IF attempt >= 40 THEN
          RAISE;
        END IF;
        RAISE NOTICE 'channel_product_ignore: chưa lấy được khóa ChannelProduct (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

ALTER TABLE "ChannelProduct" ADD COLUMN IF NOT EXISTS "ignoredAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "mapping_logs" (
  "id"               TEXT NOT NULL,
  "ownerId"          TEXT NOT NULL,
  "channelId"        TEXT,
  "channelProductId" TEXT,
  "channelSku"       TEXT,
  "productId"        TEXT,
  "productSku"       TEXT,
  "action"           TEXT NOT NULL,
  "source"           TEXT NOT NULL,
  "actorId"          TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "mapping_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "mapping_logs_ownerId_createdAt_idx" ON "mapping_logs" ("ownerId", "createdAt");

-- Bật RLS như mọi bảng khác (Supabase 30/09/2026); backend đi Prisma nên không cần policy.
ALTER TABLE "mapping_logs" ENABLE ROW LEVEL SECURITY;
