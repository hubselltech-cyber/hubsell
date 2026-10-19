-- ============================================================
-- 19/10/2026 — LÀN ADS RIÊNG (docs/ADS-NHIP-CANH-BAO.md mục 13, lát 1 "tách khoang"):
-- xung + lịch sử ads rời vòng đồng bộ đơn sang worker ads-lane với vé riêng
-- "adsLockedAt" (Ads bị chặn / chậm không giữ chỗ của đơn, tồn, dòng tiền).
-- Thêm chỉ mục hạn lịch sử ads (làn nhặt theo xung HOẶC lịch sử), và cột
-- "adsShops" cho ảnh chụp sức khỏe HQ (gian Shopee nối Hubsell Ads — mẫu số
-- quota, mốc Đ2/Đ3/Đ4 bảng 13.5).
-- "Channel" bị worker UPDATE liên tục → lấy khóa có thử lại như các migration
-- trước (bẫy deadlock khi deploy 30/09). ADD COLUMN NULL / DEFAULT hằng trên
-- Postgres 11+ chỉ ghi catalog, không ghi lại bảng.
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
        RAISE NOTICE 'channel_ads_lane: chưa lấy được khóa (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "adsLockedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Channel_status_nextAdsSyncAt_idx" ON "Channel"("status", "nextAdsSyncAt");

ALTER TABLE "platform_health_snapshots" ADD COLUMN IF NOT EXISTS "adsShops" INTEGER NOT NULL DEFAULT 0;
