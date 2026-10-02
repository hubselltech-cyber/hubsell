-- ============================================================
-- SAO KÊ TIKTOK: DỰNG LẠI SAO KÊ MỘT LẦN CHO MỌI GIAN (02/10/2026), bước 2/2.
--
-- Bản sửa ở bước 1 chặn lỗi ghi đè từ nay về sau, nhưng các đơn ĐÃ bị ghi đè
-- (chỉ còn dòng hoàn, mất dòng bán) không tự lành: bản kê của chúng đã ra khỏi
-- cửa sổ 7 ngày nên không lượt nào đọc lại. Cờ "settlementRebuildPending" bảo
-- worker (workers/order-auto-sync.ts, tầng giờ) đọc lại TOÀN BỘ bản kê của gian
-- từ đơn cũ nhất rồi ghi lại sao kê từng đơn, xong không lỗi mới hạ cờ.
--
-- Bật cờ cho mọi gian TikTok đang nối. Sàn khác để false (Shopee đọc ký quỹ
-- trọn theo từng đơn nên không dính; Lazada xử lý riêng).
--
-- Bảng "Channel" nhỏ (vài chục dòng) nhưng worker ghi liên tục (khóa lịch quét)
-- → lấy khóa trước, lock_timeout 5s, thử lại. Chỉ đụng MỘT bảng.
-- ============================================================

DO $$
DECLARE
  attempt INTEGER := 0;
BEGIN
  LOOP
    BEGIN
      SET LOCAL lock_timeout = '5s';
      LOCK TABLE "Channel" IN ACCESS EXCLUSIVE MODE;
      EXIT;
    EXCEPTION
      WHEN lock_not_available OR deadlock_detected THEN
        attempt := attempt + 1;
        IF attempt >= 40 THEN
          RAISE;
        END IF;
        RAISE NOTICE 'channel_settlement_rebuild_pending: chưa lấy được khóa (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

ALTER TABLE "Channel"
  ADD COLUMN IF NOT EXISTS "settlementRebuildPending" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Channel"
SET "settlementRebuildPending" = true
WHERE "channelName" = 'TIKTOK'
  AND "refreshToken" IS NOT NULL;
