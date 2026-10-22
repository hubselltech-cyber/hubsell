-- ============================================================
-- 22/10/2026 — SKU KHO CÓ PHÂN LOẠI RIÊNG + KHÓA GOM CHA–CON (bảng Hàng hóa).
-- Khách phàn nàn: 6 phân loại váy kéo từ Shopee về cùng một tên, chỉ khác id.
-- "Product" bị webhook/worker UPDATE tồn liên tục → khóa có thử lại như các
-- migration trước. Hai cột NULL thêm vào là tức thời, không ghi lại bảng.
-- ============================================================
DO $$
DECLARE
  attempt INTEGER := 0;
BEGIN
  LOOP
    BEGIN
      SET LOCAL lock_timeout = '5s';
      LOCK TABLE "Product" IN ACCESS EXCLUSIVE MODE;
      EXIT;
    EXCEPTION
      WHEN lock_not_available OR deadlock_detected THEN
        attempt := attempt + 1;
        IF attempt >= 40 THEN
          RAISE;
        END IF;
        RAISE NOTICE 'product_variant_name_group_key: chưa lấy được khóa (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "variantName" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "groupKey" TEXT;

CREATE INDEX IF NOT EXISTS "Product_userId_groupKey_idx" ON "Product"("userId", "groupKey");

-- BACKFILL một lần: SKU kho tạo từ sàn (tên kho = tên sản phẩm sàn, chưa có phân
-- loại) nhận phân loại của dòng sàn ĐÃ NỐI đầu tiên có tên phân loại. Chuẩn hóa
-- "Đen,M" → "Đen, M" như marketplace/sku-key.ts normalizeVariantName.
-- Dùng [[:space:]] thay \s: chuỗi '\s' đi qua Prisma raw (apply-migration-local) bị
-- mất dấu gạch chéo → regex thành 's+' và xóa mọi chữ s (phát hiện khi kiểm 22/10).
UPDATE "Product" p
SET "variantName" = v.vn,
    "groupKey" = lower(regexp_replace(btrim(p."productName"), '[[:space:]]+', ' ', 'g'))
FROM (
  SELECT DISTINCT ON (cp."productId")
         cp."productId",
         cp."productName" AS cp_name,
         btrim(regexp_replace(regexp_replace(cp."variantName", '[[:space:]]*,[[:space:]]*', ', ', 'g'), '[[:space:]]+', ' ', 'g')) AS vn
  FROM "ChannelProduct" cp
  WHERE cp."productId" IS NOT NULL
    AND cp."variantName" IS NOT NULL
    AND btrim(cp."variantName") <> ''
  ORDER BY cp."productId", cp."createdAt"
) v
WHERE p.id = v."productId"
  AND p."variantName" IS NULL
  AND p."productName" = v.cp_name;
