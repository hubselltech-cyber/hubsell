-- Đếm khách đăng ký theo MÃ KÊNH quảng cáo — soạn 09/11/2026 cho đợt chạy thử Spark Ads TikTok.
-- CHỈ ĐỌC (toàn SELECT), dán từng khối vào Supabase → SQL Editor.
--
-- Mã kênh = mã giới thiệu (HUBSELL<số>) của MỘT tài khoản nội bộ dành riêng cho kênh đó.
-- Nút quảng cáo dẫn về https://app.hubsell.vn/login?ref=<mã> → app ghi User.referredById lúc đăng ký
-- (cả đăng ký bằng form lẫn bằng Google). Không dùng pixel, không gửi gì cho TikTok.
-- Giới hạn: khách bấm quảng cáo rồi hôm sau tự vào hubsell.vn đăng ký thì KHÔNG mang mã → đếm thiếu,
-- không đếm thừa. Đăng ký trong app điện thoại không mang mã.

-- ============================================================================
-- Khối 0. Chọn tài khoản làm mã kênh: các tài khoản nội bộ, mã của chúng, đã giới thiệu mấy người
-- "da_kich_hoat" = false → mã CHƯA dùng được: đăng nhập tài khoản đó, mở trang Affiliate một lần.
-- ============================================================================
SELECT
  u.email,
  'HUBSELL' || u."referralSeq"                       AS ma_kenh,
  COALESCE(u."referralCode" = 'HUBSELL' || u."referralSeq", false) AS da_kich_hoat,
  (SELECT COUNT(*) FROM "User" r WHERE r."referredById" = u.id) AS da_gioi_thieu,
  u."isPlatformAdmin"                                AS la_quan_tri_nen_tang
FROM "User" u
WHERE u."ownerId" IS NULL AND u."deletedAt" IS NULL
  AND u.email ILIKE '%@hubsell.%'
ORDER BY u."createdAt";

-- ============================================================================
-- Khối 1. Đăng ký qua mã kênh theo NGÀY (giờ Việt Nam) + đi tới đâu trong phễu
-- Đổi 'HUBSELL0' thành mã kênh đã chọn ở khối 0.
-- ============================================================================
WITH kenh AS (
  SELECT id FROM "User" WHERE "referralCode" = 'HUBSELL0'
)
SELECT
  to_char((u."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD') AS ngay,
  COUNT(*) AS dang_ky,
  COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "Channel" c
    WHERE c."userId" = u.id AND c."channelName" <> 'OFFLINE')) AS noi_gian,
  COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM tiktok_ads_auths a
    WHERE a."userId" = u.id AND a.status = 'ACTIVE')) AS noi_tkqc_tiktok,
  COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM package_payments p
    WHERE p."userId" = u.id AND p.method <> 'WALLET' AND p.amount > 0)) AS da_tra_tien
FROM "User" u
WHERE u."referredById" = (SELECT id FROM kenh)
  AND u."ownerId" IS NULL AND u."deletedAt" IS NULL
GROUP BY 1
ORDER BY 1;

-- ============================================================================
-- Khối 2. Cùng kỳ: qua mã kênh so với KHÔNG qua mã nào (tự nhiên) — để biết quảng cáo có "ăn" vào
-- lượng tự nhiên không. Đổi 'HUBSELL0' và ngày bắt đầu chạy quảng cáo.
-- Giá mỗi đăng ký = tiền đã chi trong Ads Manager cùng kỳ ÷ dang_ky của dòng "Qua mã kênh".
-- ============================================================================
WITH kenh AS (
  SELECT id FROM "User" WHERE "referralCode" = 'HUBSELL0'
)
SELECT
  CASE
    WHEN u."referredById" = (SELECT id FROM kenh) THEN 'Qua mã kênh'
    WHEN u."referredById" IS NULL THEN 'Tự nhiên (không mã)'
    ELSE 'Qua mã giới thiệu khác'
  END AS nguon,
  COUNT(*) AS dang_ky,
  COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "Channel" c
    WHERE c."userId" = u.id AND c."channelName" <> 'OFFLINE')) AS noi_gian,
  COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM package_payments p
    WHERE p."userId" = u.id AND p.method <> 'WALLET' AND p.amount > 0)) AS da_tra_tien
FROM "User" u
WHERE u."ownerId" IS NULL AND u."deletedAt" IS NULL AND u."isPlatformAdmin" = false
  AND COALESCE(u.email, '') NOT ILIKE '%@hubsell.%'
  AND (u."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Ho_Chi_Minh' >= '2026-11-10'
GROUP BY 1
ORDER BY 2 DESC;
