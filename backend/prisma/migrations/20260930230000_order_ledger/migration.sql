-- ============================================================
-- SỔ CÁI ĐƠN (giai đoạn 1 kiến trúc quy mô triệu đơn — docs/SO-CAI-DON.md,
-- anh Trung duyệt hướng 30/09/2026)
--
-- Ý tưởng: tiền của MỖI ĐƠN ghi sổ MỘT LẦN (kết quả của computePnlRow, lib/
-- pnl-formula.ts) vào order_ledger; dòng hàng vào order_line_ledger. Báo cáo =
-- SUM trong database, không kéo đơn lên server cộng nữa (nguyên tắc 1, mục 5
-- docs/KIEN-TRUC-QUY-MO-TRIEU-DON.md).
--
-- Giữ sổ luôn đúng: TRIGGER ở database đánh dấu "cần tính lại" (dirtyAt) khi
-- đơn / dòng hàng / bản kê đối soát / sổ kho / giá vốn sản phẩm đổi — không
-- phụ thuộc lập trình viên nhớ gọi hàm (40 điểm ghi hiện có đều được bắt).
-- Worker workers/order-ledger.ts tính lại các dòng bị đánh dấu trong vài giây.
--
-- Chia bảng theo THÁNG (RANGE trên createdDate = ngày tạo đơn giờ VN) ngay từ
-- đầu: bảng còn nhỏ thì rẻ, sau này giữ/dọn theo tháng và truy vấn theo kỳ chỉ
-- chạm các mảnh liên quan. Phân mảnh DEFAULT hứng dòng ngoài dải để KHÔNG BAO
-- GIỜ mất dòng; job đêm đếm mảnh này, phải luôn = 0.
--
-- Prisma migrate deploy áp file này trong MỘT transaction lúc Render khởi động
-- (render.yaml). Mọi lệnh đều idempotent (IF NOT EXISTS / OR REPLACE) để chạy
-- lại không lỗi. KHÔNG dùng CONCURRENTLY (không chạy được trong transaction).
-- ============================================================

-- ---------- 1. Kiểu dữ liệu ----------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LedgerReturnType') THEN
    CREATE TYPE "LedgerReturnType" AS ENUM ('REFUND_ONLY', 'PARTIAL_REFUND', 'PARTIAL_RETURN', 'FULL_RETURN');
  END IF;
END $$;

-- ---------- 2. Sổ cái theo ĐƠN ----------
CREATE TABLE IF NOT EXISTS "order_ledger" (
  -- Định danh + khóa phân mảnh
  "orderId"            TEXT NOT NULL,
  "createdDate"        DATE NOT NULL,                       -- ngày tạo đơn theo GIỜ VN (UTC+7)
  "channelId"          TEXT NOT NULL,
  "ownerId"            TEXT NOT NULL,                       -- chủ shop (Channel.userId) — lọc thẳng, không vòng qua bảng gian
  "channelName"        "ChannelName" NOT NULL,
  "orderCode"          TEXT NOT NULL,
  -- Ba trục ngày, mỗi trục kèm khóa ngày VN
  "createdAt"          TIMESTAMP(3) NOT NULL,
  "deliveredAt"        TIMESTAMP(3),
  "deliveredDate"      DATE,
  "settledAt"          TIMESTAMP(3),
  "settledDate"        DATE,
  -- Trục lọc / nhóm (định nghĩa ở lib/finance-definitions.ts, ghi sẵn để SQL không tự diễn giải)
  "shippingStatus"     "ShippingStatus" NOT NULL,
  "returnStatus"       "ReturnStatus" NOT NULL,
  "isSettled"          BOOLEAN NOT NULL DEFAULT false,
  "returnType"         "LedgerReturnType",
  "countsAsRevenue"    BOOLEAN NOT NULL DEFAULT false,      -- không hủy VÀ không đang hoàn
  "isReturning"        BOOLEAN NOT NULL DEFAULT false,      -- đang hoàn/trả (AWAITING/RECEIVED/DAMAGED)
  "isLoss"             BOOLEAN NOT NULL DEFAULT false,      -- lãi < 0
  "missingCostPrice"   BOOLEAN NOT NULL DEFAULT false,
  "itemCount"          INTEGER NOT NULL DEFAULT 0,
  "totalQuantity"      INTEGER NOT NULL DEFAULT 0,
  "returnedQuantity"   INTEGER NOT NULL DEFAULT 0,
  -- Tiền (đúng tên trường của computePnlRow; DECIMAL(14,2) để SUM cả kỳ không tràn)
  "revenueGross"       DECIMAL(14,2) NOT NULL DEFAULT 0,
  "sellerVoucher"      DECIMAL(14,2) NOT NULL DEFAULT 0,
  "actualRevenue"      DECIMAL(14,2) NOT NULL DEFAULT 0,
  "platformSubsidy"    DECIMAL(14,2) NOT NULL DEFAULT 0,
  "shippingFeeQuoted"  DECIMAL(14,2) NOT NULL DEFAULT 0,
  "shippingFeeActual"  DECIMAL(14,2) NOT NULL DEFAULT 0,
  "shippingFeeDiff"    DECIMAL(14,2) NOT NULL DEFAULT 0,
  "shipSubsidyPlatform" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "shipSubsidyShop"    DECIMAL(14,2) NOT NULL DEFAULT 0,
  "feeFixedPayment"    DECIMAL(14,2) NOT NULL DEFAULT 0,
  "feeService"         DECIMAL(14,2) NOT NULL DEFAULT 0,
  "feeSellerProtection" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "feeGmvMax"          DECIMAL(14,2) NOT NULL DEFAULT 0,
  "feeAffiliate"       DECIMAL(14,2) NOT NULL DEFAULT 0,
  "adWalletTopup"      DECIMAL(14,2) NOT NULL DEFAULT 0,
  "platformTax"        DECIMAL(14,2) NOT NULL DEFAULT 0,
  "refundedAmount"     DECIMAL(14,2) NOT NULL DEFAULT 0,
  "refundEstimated"    BOOLEAN NOT NULL DEFAULT false,
  "refundSource"       TEXT,                                -- settled | platform | estimate | NULL
  "returnedCostAtSale" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "recoveredCost"      DECIMAL(14,2) NOT NULL DEFAULT 0,
  "costSnapshot"       DECIMAL(14,2) NOT NULL DEFAULT 0,
  "netRevenue"         DECIMAL(14,2) NOT NULL DEFAULT 0,
  "actualPayout"       DECIMAL(14,2) NOT NULL DEFAULT 0,
  "platformRevenue"    DECIMAL(14,2) NOT NULL DEFAULT 0,
  "platformDeduction"  DECIMAL(14,2) NOT NULL DEFAULT 0,    -- = revenueGross − platformRevenue ("sàn khấu trừ")
  "profit"             DECIMAL(14,2) NOT NULL DEFAULT 0,
  "profitAfterTax"     DECIMAL(14,2) NOT NULL DEFAULT 0,
  -- Thất thu đơn hoàn (computeReturnLoss) ghi sẵn để KPI cộng bằng SQL
  "returnLossCost"     DECIMAL(14,2) NOT NULL DEFAULT 0,
  "returnLossPlatformKept" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "returnLossRefund"   DECIMAL(14,2) NOT NULL DEFAULT 0,
  -- Sổ sách của chính sổ
  "formulaVersion"     INTEGER NOT NULL DEFAULT 0,          -- 0 = chưa tính (dòng nháp do trigger tạo)
  -- Ba mốc dưới dùng TIMESTAMPTZ(3) — độ chính xác MILI GIÂY, khớp Date của
  -- JavaScript: worker so "mốc bẩn lúc nhặt" với mốc trên dòng bằng IS NOT
  -- DISTINCT FROM; để micro giây thì đi qua JS mất 3 số lẻ, không bao giờ khớp.
  "computedAt"         TIMESTAMPTZ(3),
  "dirtyAt"            TIMESTAMPTZ(3),                       -- ≠ NULL = cần tính lại
  "dirtyReason"        TEXT,
  "claimedAt"          TIMESTAMPTZ(3),                       -- worker đang cầm (quá hạn thì worker khác nhặt lại)
  CONSTRAINT "order_ledger_pkey" PRIMARY KEY ("createdDate", "orderId"),
  CONSTRAINT "order_ledger_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE
) PARTITION BY RANGE ("createdDate");

CREATE INDEX IF NOT EXISTS "order_ledger_ownerId_createdDate_idx"    ON "order_ledger" ("ownerId", "createdDate");
CREATE INDEX IF NOT EXISTS "order_ledger_channelId_createdDate_idx"  ON "order_ledger" ("channelId", "createdDate");
CREATE INDEX IF NOT EXISTS "order_ledger_channelId_deliveredDate_idx" ON "order_ledger" ("channelId", "deliveredDate");
CREATE INDEX IF NOT EXISTS "order_ledger_channelId_settledDate_idx"  ON "order_ledger" ("channelId", "settledDate");
CREATE INDEX IF NOT EXISTS "order_ledger_orderId_idx"                ON "order_ledger" ("orderId");
-- Hàng đợi việc của worker: chỉ dòng đang bẩn (partial index — nhỏ dù sổ lớn).
CREATE INDEX IF NOT EXISTS "order_ledger_dirty_idx" ON "order_ledger" ("dirtyAt") WHERE "dirtyAt" IS NOT NULL;

-- ---------- 3. Sổ cái theo DÒNG HÀNG ----------
-- Phí/tiền của đơn PHÂN BỔ xuống dòng theo tỷ trọng giá trị dòng (lib/order-
-- ledger.ts, phần dư làm tròn dồn về dòng lớn nhất nên Σ dòng = đơn từng xu).
CREATE TABLE IF NOT EXISTS "order_line_ledger" (
  "orderItemId"        TEXT NOT NULL,
  "createdDate"        DATE NOT NULL,
  "orderId"            TEXT NOT NULL,
  "channelId"          TEXT NOT NULL,
  "ownerId"            TEXT NOT NULL,
  "channelName"        "ChannelName" NOT NULL,
  "productId"          TEXT,                                -- SKU kho gốc (NULL = chưa nối); mã SKU/ảnh đọc lúc truy vấn
  "channelSku"         TEXT NOT NULL,
  "productName"        TEXT NOT NULL,
  "createdAt"          TIMESTAMP(3) NOT NULL,
  "deliveredDate"      DATE,
  "settledDate"        DATE,
  "shippingStatus"     "ShippingStatus" NOT NULL,
  "returnStatus"       "ReturnStatus" NOT NULL,
  "isSettled"          BOOLEAN NOT NULL DEFAULT false,
  "countsAsRevenue"    BOOLEAN NOT NULL DEFAULT false,
  "missingCostPrice"   BOOLEAN NOT NULL DEFAULT false,      -- cờ CẤP ĐƠN (đơn có dòng thiếu giá vốn)
  "quantity"           INTEGER NOT NULL DEFAULT 0,
  "returnedQuantity"   INTEGER NOT NULL DEFAULT 0,
  "recoveredQuantity"  INTEGER NOT NULL DEFAULT 0,
  "price"              DECIMAL(14,2) NOT NULL DEFAULT 0,
  "costPriceAtSale"    DECIMAL(14,2) NOT NULL DEFAULT 0,
  "lineGross"          DECIMAL(14,2) NOT NULL DEFAULT 0,    -- quantity × price
  "lineCost"           DECIMAL(14,2) NOT NULL DEFAULT 0,    -- quantity × costPriceAtSale (chưa thu hồi)
  "costSnapshot"       DECIMAL(14,2) NOT NULL DEFAULT 0,    -- đã trừ phần thu hồi
  "recoveredCost"      DECIMAL(14,2) NOT NULL DEFAULT 0,
  "share"              DECIMAL(12,10) NOT NULL DEFAULT 0,   -- tỷ trọng phân bổ (Σ dòng của đơn = 1)
  "revenueGross"       DECIMAL(14,2) NOT NULL DEFAULT 0,
  "actualRevenue"      DECIMAL(14,2) NOT NULL DEFAULT 0,
  "platformRevenue"    DECIMAL(14,2) NOT NULL DEFAULT 0,
  "platformDeduction"  DECIMAL(14,2) NOT NULL DEFAULT 0,
  "refundedAmount"     DECIMAL(14,2) NOT NULL DEFAULT 0,
  "feeGmvMax"          DECIMAL(14,2) NOT NULL DEFAULT 0,
  "profit"             DECIMAL(14,2) NOT NULL DEFAULT 0,
  "profitAfterTax"     DECIMAL(14,2) NOT NULL DEFAULT 0,
  "formulaVersion"     INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "order_line_ledger_pkey" PRIMARY KEY ("createdDate", "orderItemId"),
  CONSTRAINT "order_line_ledger_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE,
  CONSTRAINT "order_line_ledger_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE
) PARTITION BY RANGE ("createdDate");

CREATE INDEX IF NOT EXISTS "order_line_ledger_ownerId_createdDate_idx"   ON "order_line_ledger" ("ownerId", "createdDate");
CREATE INDEX IF NOT EXISTS "order_line_ledger_channelId_createdDate_idx" ON "order_line_ledger" ("channelId", "createdDate");
CREATE INDEX IF NOT EXISTS "order_line_ledger_orderId_idx"               ON "order_line_ledger" ("orderId");
CREATE INDEX IF NOT EXISTS "order_line_ledger_productId_idx"             ON "order_line_ledger" ("productId") WHERE "productId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "order_line_ledger_channelId_channelSku_idx"  ON "order_line_ledger" ("channelId", "channelSku");

-- ---------- 4. Kết quả đối soát đêm (sổ ↔ đơn gốc) ----------
CREATE TABLE IF NOT EXISTS "order_ledger_audit" (
  "id"           BIGSERIAL PRIMARY KEY,
  "ranAt"        TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "durationMs"   INTEGER NOT NULL DEFAULT 0,
  "sampled"      INTEGER NOT NULL DEFAULT 0,       -- số đơn lấy mẫu tính lại từ dữ liệu gốc
  "mismatched"   INTEGER NOT NULL DEFAULT 0,       -- số đơn lệch (≥ 1 đồng ở bất kỳ cột nào) → đã đánh dấu tính lại
  "dirtyBacklog" INTEGER NOT NULL DEFAULT 0,       -- số dòng còn bẩn lúc chạy
  "staleDirty"   INTEGER NOT NULL DEFAULT 0,       -- dòng bẩn quá 10 phút chưa ai tính (worker kẹt?)
  "defaultRows"  INTEGER NOT NULL DEFAULT 0,       -- dòng rơi vào mảnh DEFAULT (phải = 0)
  "details"      JSONB
);
CREATE INDEX IF NOT EXISTS "order_ledger_audit_ranAt_idx" ON "order_ledger_audit" ("ranAt");

-- ---------- 5. RLS (Supabase 30/09/2026: mọi bảng public phải bật) ----------
ALTER TABLE "order_ledger"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_line_ledger"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_ledger_audit" ENABLE ROW LEVEL SECURITY;

-- ---------- 6. Tạo phân mảnh theo tháng ----------
-- Gọi lúc migrate + worker gọi mỗi đêm (tạo trước 3 tháng). Mảnh mới cũng bật RLS.
--
-- Tạo MỘT mảnh tháng cho bảng `p_parent` (order_ledger / order_line_ledger).
-- Nếu mảnh DEFAULT đang giữ dòng thuộc tháng đó (đơn có ngày ngoài dải lúc ghi)
-- thì CREATE ... PARTITION OF sẽ lỗi; khi ấy đi đường vòng: tạo bảng rời, dời
-- dòng từ DEFAULT sang, rồi ATTACH — không bao giờ kẹt vì một đơn ngày lạ.
CREATE OR REPLACE FUNCTION "order_ledger_create_month_partition"(p_parent TEXT, p_month DATE)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_name   TEXT := p_parent || '_' || to_char(p_month, 'YYYY_MM');
  v_next   DATE := (p_month + INTERVAL '1 month')::date;
  v_stray  BOOLEAN;
BEGIN
  IF to_regclass(format('%I', v_name)) IS NOT NULL THEN
    RETURN false;
  END IF;
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE "createdDate" >= %L AND "createdDate" < %L)',
                 p_parent || '_default', p_month, v_next)
    INTO v_stray;
  IF NOT v_stray THEN
    EXECUTE format('CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)', v_name, p_parent, p_month, v_next);
  ELSE
    EXECUTE format('CREATE TABLE %I (LIKE %I INCLUDING DEFAULTS INCLUDING CONSTRAINTS)', v_name, p_parent);
    EXECUTE format('WITH moved AS (DELETE FROM %I WHERE "createdDate" >= %L AND "createdDate" < %L RETURNING *) INSERT INTO %I SELECT * FROM moved',
                   p_parent || '_default', p_month, v_next, v_name);
    EXECUTE format('ALTER TABLE %I ATTACH PARTITION %I FOR VALUES FROM (%L) TO (%L)', p_parent, v_name, p_month, v_next);
  END IF;
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', v_name);
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION "order_ledger_ensure_partitions"(p_from DATE, p_months_ahead INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  m       DATE := date_trunc('month', p_from)::date;
  last_m  DATE;
  created INTEGER := 0;
BEGIN
  IF p_months_ahead < 0 THEN p_months_ahead := 0; END IF;
  -- Tháng hiện tại theo giờ VN + p_months_ahead tháng.
  last_m := (date_trunc('month', (now() AT TIME ZONE 'UTC') + INTERVAL '7 hours') + (p_months_ahead * INTERVAL '1 month'))::date;
  WHILE m <= last_m LOOP
    IF "order_ledger_create_month_partition"('order_ledger', m) THEN created := created + 1; END IF;
    IF "order_ledger_create_month_partition"('order_line_ledger', m) THEN created := created + 1; END IF;
    m := (m + INTERVAL '1 month')::date;
  END LOOP;
  RETURN created;
END;
$$;

-- Mảnh DEFAULT: hứng mọi ngày ngoài dải đã tạo (đơn có ngày lạ) — không mất dòng.
DO $$ BEGIN
  IF to_regclass('order_ledger_default') IS NULL THEN
    CREATE TABLE "order_ledger_default" PARTITION OF "order_ledger" DEFAULT;
    ALTER TABLE "order_ledger_default" ENABLE ROW LEVEL SECURITY;
  END IF;
  IF to_regclass('order_line_ledger_default') IS NULL THEN
    CREATE TABLE "order_line_ledger_default" PARTITION OF "order_line_ledger" DEFAULT;
    ALTER TABLE "order_line_ledger_default" ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- Mảnh từ tháng của đơn CŨ NHẤT đang có (chưa có đơn → tháng này) tới 3 tháng
-- sau hôm nay. Mảnh DEFAULT phải tạo TRƯỚC bước này (khối DO ở trên).
SELECT "order_ledger_ensure_partitions"(
  COALESCE(
    (SELECT (min("createdAt") + INTERVAL '7 hours')::date FROM "Order"),
    (date_trunc('month', (now() AT TIME ZONE 'UTC') + INTERVAL '7 hours'))::date
  ),
  3
);

-- ---------- 7. Đánh dấu "cần tính lại" ----------
-- Tạo dòng nháp nếu đơn chưa có trong sổ; có rồi thì chỉ đặt dirtyAt. Khi
-- p_check_date = true (đơn đổi createdAt) thì dời dòng sang mảnh đúng trước.
CREATE OR REPLACE FUNCTION "order_ledger_mark"(p_order_id TEXT, p_reason TEXT, p_check_date BOOLEAN DEFAULT false)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_date DATE;
BEGIN
  IF p_check_date THEN
    SELECT ("createdAt" + INTERVAL '7 hours')::date INTO v_date FROM "Order" WHERE "id" = p_order_id;
    IF v_date IS NOT NULL THEN
      UPDATE "order_ledger" SET "createdDate" = v_date WHERE "orderId" = p_order_id AND "createdDate" <> v_date;
      UPDATE "order_line_ledger" SET "createdDate" = v_date WHERE "orderId" = p_order_id AND "createdDate" <> v_date;
    END IF;
  END IF;

  INSERT INTO "order_ledger" (
    "orderId", "createdDate", "channelId", "ownerId", "channelName", "orderCode",
    "createdAt", "shippingStatus", "returnStatus", "dirtyAt", "dirtyReason"
  )
  SELECT o."id", (o."createdAt" + INTERVAL '7 hours')::date, o."channelId", c."userId", c."channelName", o."orderCode",
         o."createdAt", o."shippingStatus", o."returnStatus", clock_timestamp(), p_reason
  FROM "Order" o
  JOIN "Channel" c ON c."id" = o."channelId"
  WHERE o."id" = p_order_id
  ON CONFLICT ("createdDate", "orderId") DO UPDATE
    SET "dirtyAt" = clock_timestamp(),
        "dirtyReason" = EXCLUDED."dirtyReason";
END;
$$;

-- 7a. Đơn: mọi cột công thức đọc (kể cả trạng thái, mốc giao/quyết toán). WHEN
-- so giá trị cũ/mới để đồng bộ ghi lại đơn không đổi (288 lần/2 ngày) không
-- sinh việc thừa.
CREATE OR REPLACE FUNCTION "order_ledger_trg_order"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM "order_ledger_mark"(NEW."id", 'order:insert', false);
  ELSE
    PERFORM "order_ledger_mark"(NEW."id", 'order:update', OLD."createdAt" IS DISTINCT FROM NEW."createdAt");
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS "order_ledger_on_order_insert" ON "Order";
CREATE TRIGGER "order_ledger_on_order_insert"
  AFTER INSERT ON "Order"
  FOR EACH ROW EXECUTE FUNCTION "order_ledger_trg_order"();

DROP TRIGGER IF EXISTS "order_ledger_on_order_update" ON "Order";
CREATE TRIGGER "order_ledger_on_order_update"
  AFTER UPDATE ON "Order"
  FOR EACH ROW
  WHEN (
    ROW(OLD."channelId", OLD."orderCode", OLD."createdAt", OLD."totalAmount", OLD."sellerVoucher",
        OLD."fixedFee", OLD."paymentFee", OLD."serviceFee", OLD."sellerProtectionFee", OLD."affiliateFee",
        OLD."shippingFeeQuoted", OLD."shippingFeeActual", OLD."shippingFeeDiff", OLD."platformSubsidy",
        OLD."actualPayout", OLD."taxWithheld", OLD."adWalletTopup", OLD."shipSubsidyPlatform", OLD."shipSubsidyShop",
        OLD."refundedAmount", OLD."platformRefundAmount", OLD."platformReturnStatus", OLD."returnSolution",
        OLD."returnDeliveredAt", OLD."returnStatus", OLD."shippingStatus", OLD."isSettled", OLD."settledAt",
        OLD."deliveredAt", OLD."stockRestoredAt", OLD."packedAt", OLD."itemCount")
    IS DISTINCT FROM
    ROW(NEW."channelId", NEW."orderCode", NEW."createdAt", NEW."totalAmount", NEW."sellerVoucher",
        NEW."fixedFee", NEW."paymentFee", NEW."serviceFee", NEW."sellerProtectionFee", NEW."affiliateFee",
        NEW."shippingFeeQuoted", NEW."shippingFeeActual", NEW."shippingFeeDiff", NEW."platformSubsidy",
        NEW."actualPayout", NEW."taxWithheld", NEW."adWalletTopup", NEW."shipSubsidyPlatform", NEW."shipSubsidyShop",
        NEW."refundedAmount", NEW."platformRefundAmount", NEW."platformReturnStatus", NEW."returnSolution",
        NEW."returnDeliveredAt", NEW."returnStatus", NEW."shippingStatus", NEW."isSettled", NEW."settledAt",
        NEW."deliveredAt", NEW."stockRestoredAt", NEW."packedAt", NEW."itemCount")
  )
  EXECUTE FUNCTION "order_ledger_trg_order"();

-- 7b. Dòng hàng (kể cả script vá giá vốn hàng loạt UPDATE thẳng OrderItem).
CREATE OR REPLACE FUNCTION "order_ledger_trg_order_item"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM "order_ledger_mark"(OLD."orderId", 'item:delete', false);
  ELSE
    PERFORM "order_ledger_mark"(NEW."orderId", 'item:' || lower(TG_OP), false);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS "order_ledger_on_order_item_ins_del" ON "OrderItem";
CREATE TRIGGER "order_ledger_on_order_item_ins_del"
  AFTER INSERT OR DELETE ON "OrderItem"
  FOR EACH ROW EXECUTE FUNCTION "order_ledger_trg_order_item"();

DROP TRIGGER IF EXISTS "order_ledger_on_order_item_update" ON "OrderItem";
CREATE TRIGGER "order_ledger_on_order_item_update"
  AFTER UPDATE ON "OrderItem"
  FOR EACH ROW
  WHEN (
    ROW(OLD."orderId", OLD."productId", OLD."channelSku", OLD."productName", OLD."quantity", OLD."price",
        OLD."costPriceAtSale", OLD."returnedQuantity", OLD."returnRestocked")
    IS DISTINCT FROM
    ROW(NEW."orderId", NEW."productId", NEW."channelSku", NEW."productName", NEW."quantity", NEW."price",
        NEW."costPriceAtSale", NEW."returnedQuantity", NEW."returnRestocked")
  )
  EXECUTE FUNCTION "order_ledger_trg_order_item"();

-- 7c. Bản kê đối soát Lazada / TikTok — mọi thay đổi.
CREATE OR REPLACE FUNCTION "order_ledger_trg_settlement"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM "order_ledger_mark"(OLD."orderId", 'settlement:' || TG_TABLE_NAME, false);
  ELSE
    PERFORM "order_ledger_mark"(NEW."orderId", 'settlement:' || TG_TABLE_NAME, false);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS "order_ledger_on_lazada_settlement" ON "lazada_order_settlements";
CREATE TRIGGER "order_ledger_on_lazada_settlement"
  AFTER INSERT OR UPDATE OR DELETE ON "lazada_order_settlements"
  FOR EACH ROW EXECUTE FUNCTION "order_ledger_trg_settlement"();

DROP TRIGGER IF EXISTS "order_ledger_on_tiktok_settlement" ON "tiktok_order_settlements";
CREATE TRIGGER "order_ledger_on_tiktok_settlement"
  AFTER INSERT OR UPDATE OR DELETE ON "tiktok_order_settlements"
  FOR EACH ROW EXECUTE FUNCTION "order_ledger_trg_settlement"();

-- 7d. Sổ kho gắn đơn (giá vốn của đơn CŨ chưa có dòng hàng tính từ đây).
CREATE OR REPLACE FUNCTION "order_ledger_trg_inventory_log"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_order TEXT := COALESCE(NEW."orderId", OLD."orderId");
BEGIN
  IF v_order IS NOT NULL THEN
    PERFORM "order_ledger_mark"(v_order, 'inventory-log', false);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS "order_ledger_on_inventory_log" ON "InventoryLog";
CREATE TRIGGER "order_ledger_on_inventory_log"
  AFTER INSERT OR UPDATE OR DELETE ON "InventoryLog"
  FOR EACH ROW EXECUTE FUNCTION "order_ledger_trg_inventory_log"();

-- 7e. Giá vốn sản phẩm đổi → chỉ đơn CŨ không có dòng hàng (đọc giá vốn hiện
-- tại qua sổ kho) mới đổi số; đơn có dòng hàng dùng costPriceAtSale (snapshot).
CREATE OR REPLACE FUNCTION "order_ledger_trg_product_cost"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT il."orderId" AS oid
    FROM "InventoryLog" il
    WHERE il."productId" = NEW."id"
      AND il."orderId" IS NOT NULL
      AND il."changeQuantity" < 0
      AND NOT EXISTS (SELECT 1 FROM "OrderItem" oi WHERE oi."orderId" = il."orderId")
  LOOP
    PERFORM "order_ledger_mark"(r.oid, 'product:costPrice', false);
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS "order_ledger_on_product_cost" ON "Product";
CREATE TRIGGER "order_ledger_on_product_cost"
  AFTER UPDATE OF "costPrice" ON "Product"
  FOR EACH ROW
  WHEN (OLD."costPrice" IS DISTINCT FROM NEW."costPrice")
  EXECUTE FUNCTION "order_ledger_trg_product_cost"();

-- ---------- 8. Dựng sổ cho đơn ĐÃ CÓ: tạo dòng nháp bẩn, worker tính dần ----------
-- Chỉ ghi ~120 byte/đơn ở đây; phần đọc nặng (đơn kèm dòng hàng, bản kê) do
-- worker làm theo lô có nhịp (LEDGER_BATCH / LEDGER_POLL_MS) — không dồn vào
-- lúc deploy. Chạy lại không tạo trùng (ON CONFLICT DO NOTHING).
INSERT INTO "order_ledger" (
  "orderId", "createdDate", "channelId", "ownerId", "channelName", "orderCode",
  "createdAt", "shippingStatus", "returnStatus", "dirtyAt", "dirtyReason"
)
SELECT o."id", (o."createdAt" + INTERVAL '7 hours')::date, o."channelId", c."userId", c."channelName", o."orderCode",
       o."createdAt", o."shippingStatus", o."returnStatus", clock_timestamp(), 'backfill:migration'
FROM "Order" o
JOIN "Channel" c ON c."id" = o."channelId"
ON CONFLICT ("createdDate", "orderId") DO NOTHING;
