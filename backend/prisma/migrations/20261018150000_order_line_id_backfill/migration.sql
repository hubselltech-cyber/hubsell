-- 18/10/2026 — Lát 2 của docs/MO-HINH-CAY-SAN-PHAM-SAN.md (mục 7): BÙ ID LÁ CHO ĐƠN CŨ.
--
-- 1. Trigger sổ cái trên OrderItem: thêm "externalId" vào điều kiện đánh dấu — dòng
--    chỉ đổi id (mã giữ nguyên) cũng phải được tính lại để sổ dòng hàng có itemId.
--    CREATE OR REPLACE TRIGGER chỉ cần SHARE ROW EXCLUSIVE (không DROP) — khối lấy
--    khóa có thử lại như 20260930230000_order_ledger (bẫy deadlock 30/09).
-- 2. Bảng tiến độ bù id theo gian (worker order-line-id-backfill): resumable sau
--    restart, đọc được trên HQ / SQL. Bảng mới, không đụng bảng cũ.
DO $$
DECLARE
  attempt INTEGER := 0;
BEGIN
  LOOP
    BEGIN
      SET LOCAL lock_timeout = '5s';
      LOCK TABLE "OrderItem" IN SHARE ROW EXCLUSIVE MODE;
      EXIT;
    EXCEPTION
      WHEN lock_not_available OR deadlock_detected THEN
        attempt := attempt + 1;
        IF attempt >= 40 THEN
          RAISE;
        END IF;
        RAISE NOTICE 'order_line_id_backfill: chưa lấy được khóa (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

CREATE OR REPLACE TRIGGER "order_ledger_on_order_item_update"
  AFTER UPDATE ON "OrderItem"
  FOR EACH ROW
  WHEN (
    ROW(OLD."orderId", OLD."productId", OLD."channelSku", OLD."productName", OLD."quantity", OLD."price",
        OLD."costPriceAtSale", OLD."returnedQuantity", OLD."returnRestocked", OLD."externalId")
    IS DISTINCT FROM
    ROW(NEW."orderId", NEW."productId", NEW."channelSku", NEW."productName", NEW."quantity", NEW."price",
        NEW."costPriceAtSale", NEW."returnedQuantity", NEW."returnRestocked", NEW."externalId")
  )
  EXECUTE FUNCTION "order_ledger_trg_order_item"();

CREATE TABLE IF NOT EXISTS "order_line_id_backfill" (
  "channelId"    TEXT NOT NULL,
  "status"       TEXT NOT NULL DEFAULT 'pending',   -- pending | running | done | error
  "phase"        TEXT NOT NULL DEFAULT 'orphan',    -- orphan (mã không còn trong danh mục) → all → infer (gian không gọi được sàn)
  "cursorAt"     TIMESTAMP(3),                      -- createdAt của đơn cuối đã xử lý trong phase (đi lùi theo thời gian)
  "ordersDone"   INTEGER NOT NULL DEFAULT 0,
  "linesSet"     INTEGER NOT NULL DEFAULT 0,        -- dòng ghi được id lá
  "linesSpu"     INTEGER NOT NULL DEFAULT 0,        -- dòng gộp nhiều lá cùng SPU → ghi SPU
  "linesSkipped" INTEGER NOT NULL DEFAULT 0,        -- không khớp được / khác SPU / sàn không trả
  "apiCalls"     INTEGER NOT NULL DEFAULT 0,
  "lastError"    TEXT,
  "nextRunAt"    TIMESTAMP(3) NOT NULL DEFAULT now(),
  "startedAt"    TIMESTAMP(3),
  "finishedAt"   TIMESTAMP(3),
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "order_line_id_backfill_pkey" PRIMARY KEY ("channelId"),
  CONSTRAINT "order_line_id_backfill_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "order_line_id_backfill_status_nextRunAt_idx" ON "order_line_id_backfill"("status", "nextRunAt");
ALTER TABLE "order_line_id_backfill" ENABLE ROW LEVEL SECURITY;
