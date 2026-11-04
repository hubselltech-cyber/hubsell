-- Phễu khách đăng ký từ khi video "Trợ lý TikTok Ads" (1017) lên — dùng để quyết định có chạy quảng cáo trả tiền.
-- Soạn 01/11/2026. CHỈ ĐỌC (toàn SELECT), dán từng khối vào Supabase → SQL Editor.
-- Không lấy email/SĐT/tên: chỉ số đếm.
-- Giới hạn: Hubsell KHÔNG lưu nguồn đăng ký (utm/TikTok), nên đây là MỌI khách đăng ký từ 17/10,
-- không tách riêng được khách của video. Đăng ký trong app = TermsAcceptance.source 'register_app'.

-- ============================================================================
-- Khối 1. Phễu theo nơi đăng ký: đăng ký → nối gian → nối gian TikTok → nối TKQC → cài app → trả tiền
-- ============================================================================
WITH owners AS (
  SELECT u.id, u."createdAt",
         (SELECT t.source FROM "TermsAcceptance" t WHERE t."userId" = u.id
          ORDER BY t."acceptedAt" ASC LIMIT 1) AS nguon
  FROM "User" u
  WHERE u."ownerId" IS NULL AND u."deletedAt" IS NULL AND u."isPlatformAdmin" = false
    AND COALESCE(u.email, '') NOT ILIKE '%@hubsell.%'
    AND u."createdAt" >= '2026-10-17'
)
SELECT
  CASE WHEN o.nguon = 'register_app' THEN 'Đăng ký trong app' ELSE 'Đăng ký trên web' END AS noi_dang_ky,
  COUNT(*) AS dang_ky,
  COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "Channel" c
    WHERE c."userId" = o.id AND c."channelName" <> 'OFFLINE')) AS noi_gian,
  COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "Channel" c
    WHERE c."userId" = o.id AND c."channelName" = 'TIKTOK')) AS noi_gian_tiktok,
  COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM tiktok_ads_auths a
    WHERE a."userId" = o.id AND a.status = 'ACTIVE')) AS noi_tkqc_tiktok,
  COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM push_devices d
    WHERE d."ownerId" = o.id)) AS co_cai_app,
  COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM package_payments p
    WHERE p."userId" = o.id AND p.method <> 'WALLET' AND p.amount > 0)) AS da_tra_tien,
  COALESCE(SUM((SELECT SUM(p.amount) FROM package_payments p
    WHERE p."userId" = o.id AND p.method <> 'WALLET' AND p.amount > 0)), 0) AS tong_tien_da_thu
FROM owners o
GROUP BY 1
ORDER BY 2 DESC;

-- ============================================================================
-- Khối 2. Đăng ký theo tuần, so với trước video (xem video có thực sự đẩy số không)
-- ============================================================================
SELECT
  to_char(date_trunc('week', u."createdAt"), 'YYYY-MM-DD') AS tuan_bat_dau,
  COUNT(*) AS dang_ky,
  COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "Channel" c
    WHERE c."userId" = u.id AND c."channelName" <> 'OFFLINE')) AS noi_gian,
  COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM tiktok_ads_auths a
    WHERE a."userId" = u.id AND a.status = 'ACTIVE')) AS noi_tkqc_tiktok
FROM "User" u
WHERE u."ownerId" IS NULL AND u."deletedAt" IS NULL AND u."isPlatformAdmin" = false
  AND COALESCE(u.email, '') NOT ILIKE '%@hubsell.%'
  AND u."createdAt" >= '2026-09-14'
GROUP BY 1
ORDER BY 1;
