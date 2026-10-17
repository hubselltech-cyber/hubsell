-- Số thật khách hàng Hubsell — nguyên liệu cho chiến lược marketing
-- Soạn 17/10/2026. CHỈ ĐỌC (toàn SELECT), dán từng khối vào Supabase → SQL Editor, chạy lần lượt.
-- Không lấy email/SĐT/tên: chỉ số đếm, đủ để lập chiến lược mà không lộ thông tin khách.
-- Chủ shop = "User" có "ownerId" IS NULL (nhân viên có ownerId), chưa xóa, không phải quản trị nền tảng.
-- Loại tài khoản nội bộ theo đuôi email hubsell.* (dev@, reviewer@...). Nếu còn tài khoản thử
-- của anh dùng email khác, thêm vào danh sách NOT IN ở CTE owners của từng khối.

-- ============================================================================
-- Khối 1. Phễu tổng: đăng ký → nối gian → có đơn → chạy ads → trả tiền
-- ============================================================================
WITH owners AS (
  SELECT u.id, u."createdAt"
  FROM "User" u
  WHERE u."ownerId" IS NULL AND u."deletedAt" IS NULL AND u."isPlatformAdmin" = false
    AND COALESCE(u.email, '') NOT ILIKE '%@hubsell.%'
),
ch AS (
  SELECT c."userId", COUNT(*) AS so_gian,
         COUNT(DISTINCT c."channelName") AS so_san
  FROM "Channel" c WHERE c."channelName" <> 'OFFLINE'
  GROUP BY c."userId"
),
ads AS (
  SELECT c."userId", SUM(a.amount) AS ads_30n
  FROM "AdSpend" a JOIN "Channel" c ON c.id = a."channelId"
  WHERE a.date >= CURRENT_DATE - 30
  GROUP BY c."userId"
),
paid AS (
  SELECT p."userId", SUM(p.amount) AS da_tra
  FROM package_payments p
  WHERE p.method <> 'WALLET' AND p.amount > 0
  GROUP BY p."userId"
)
SELECT
  COUNT(*)                                             AS chu_shop_dang_ky,
  COUNT(ch."userId")                                   AS da_noi_it_nhat_1_gian,
  COUNT(*) FILTER (WHERE ch.so_san >= 2)               AS noi_tu_2_san,
  COUNT(ads."userId") FILTER (WHERE ads.ads_30n > 0)   AS co_chi_ads_30_ngay,
  COUNT(paid."userId")                                 AS da_tung_tra_tien,
  COALESCE(SUM(paid.da_tra), 0)                        AS tong_tien_da_thu
FROM owners o
LEFT JOIN ch   ON ch."userId"   = o.id
LEFT JOIN ads  ON ads."userId"  = o.id
LEFT JOIN paid ON paid."userId" = o.id;

-- ============================================================================
-- Khối 2. Đăng ký theo tháng + tỉ lệ nối gian trong 7 ngày đầu (xem đà tăng)
-- ============================================================================
WITH owners AS (
  SELECT u.id, u."createdAt"
  FROM "User" u
  WHERE u."ownerId" IS NULL AND u."deletedAt" IS NULL AND u."isPlatformAdmin" = false
    AND COALESCE(u.email, '') NOT ILIKE '%@hubsell.%'
),
first_ch AS (
  SELECT c."userId", MIN(c."createdAt") AS noi_luc
  FROM "Channel" c WHERE c."channelName" <> 'OFFLINE'
  GROUP BY c."userId"
)
SELECT
  to_char(date_trunc('month', o."createdAt"), 'YYYY-MM')                           AS thang,
  COUNT(*)                                                                         AS dang_ky,
  COUNT(*) FILTER (WHERE f.noi_luc <= o."createdAt" + interval '7 days')           AS noi_gian_trong_7_ngay,
  COUNT(*) FILTER (WHERE o."createdAt" > now() - interval '7 days')                AS con_trong_7_ngay_dau
FROM owners o LEFT JOIN first_ch f ON f."userId" = o.id
GROUP BY 1 ORDER BY 1;

-- ============================================================================
-- Khối 3. Khách đang trả tiền theo gói (không tính dùng thử) + MRR quy đổi theo giá tháng
-- ============================================================================
SELECT
  sp.code, sp.name, sp."priceMonthly",
  COUNT(*) FILTER (WHERE s."isTrial" = false AND s."currentPeriodEnd" > now() AND s.status = 'ACTIVE') AS dang_tra,
  COUNT(*) FILTER (WHERE s."isTrial" = true  AND s."currentPeriodEnd" > now())                       AS dang_dung_thu,
  COUNT(*) FILTER (WHERE s."currentPeriodEnd" <= now())                                              AS da_het_han,
  SUM(sp."priceMonthly") FILTER (WHERE s."isTrial" = false AND s."currentPeriodEnd" > now() AND s.status = 'ACTIVE') AS mrr_quy_doi
FROM subscriptions s
JOIN service_plans sp ON sp.id = s."planId"
JOIN "User" u ON u.id = s."userId"
WHERE u."deletedAt" IS NULL AND u."isPlatformAdmin" = false
  AND COALESCE(u.email, '') NOT ILIKE '%@hubsell.%'
GROUP BY sp.code, sp.name, sp."priceMonthly", sp.tier
ORDER BY sp.tier;

-- ============================================================================
-- Khối 4. Phân bố chi tiêu quảng cáo 30 ngày theo chủ shop (ai là khách lý tưởng)
-- ============================================================================
WITH owners AS (
  SELECT u.id FROM "User" u
  WHERE u."ownerId" IS NULL AND u."deletedAt" IS NULL AND u."isPlatformAdmin" = false
    AND COALESCE(u.email, '') NOT ILIKE '%@hubsell.%'
),
ads AS (
  SELECT c."userId", SUM(a.amount) AS ads_30n
  FROM "AdSpend" a JOIN "Channel" c ON c.id = a."channelId"
  WHERE a.date >= CURRENT_DATE - 30
  GROUP BY c."userId"
)
SELECT
  CASE
    WHEN ads.ads_30n IS NULL OR ads.ads_30n = 0 THEN '0. Không chạy ads'
    WHEN ads.ads_30n < 1000000   THEN '1. Dưới 1 triệu'
    WHEN ads.ads_30n < 10000000  THEN '2. 1–10 triệu'
    WHEN ads.ads_30n < 50000000  THEN '3. 10–50 triệu'
    WHEN ads.ads_30n < 200000000 THEN '4. 50–200 triệu'
    ELSE '5. Trên 200 triệu'
  END AS nhom_chi_ads_30_ngay,
  COUNT(*) AS so_chu_shop
FROM owners o LEFT JOIN ads ON ads."userId" = o.id
GROUP BY 1 ORDER BY 1;

-- ============================================================================
-- Khối 5. Cơ cấu sàn: chủ shop nối những sàn nào (kênh tiếp cận nên ưu tiên sàn nào)
-- ============================================================================
WITH owners AS (
  SELECT u.id FROM "User" u
  WHERE u."ownerId" IS NULL AND u."deletedAt" IS NULL AND u."isPlatformAdmin" = false
    AND COALESCE(u.email, '') NOT ILIKE '%@hubsell.%'
)
SELECT combo, COUNT(*) AS so_chu_shop
FROM (
  SELECT o.id, string_agg(DISTINCT c."channelName"::text, ' + ' ORDER BY c."channelName"::text) AS combo
  FROM owners o JOIN "Channel" c ON c."userId" = o.id AND c."channelName" <> 'OFFLINE'
  GROUP BY o.id
) t
GROUP BY combo ORDER BY so_chu_shop DESC;

-- ============================================================================
-- Khối 6. Giới thiệu (referral 10%): bao nhiêu khách tới qua giới thiệu, bao nhiêu đã trả tiền
-- ============================================================================
SELECT
  COUNT(*)                                                                      AS khach_qua_gioi_thieu,
  COUNT(DISTINCT u."referredById")                                              AS so_nguoi_gioi_thieu,
  COUNT(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM package_payments p
    WHERE p."userId" = u.id AND p.method <> 'WALLET' AND p.amount > 0))         AS trong_do_da_tra_tien
FROM "User" u
WHERE u."ownerId" IS NULL AND u."deletedAt" IS NULL AND u."referredById" IS NOT NULL;
