-- Bóc thẻ "Truy thu phí ship" (Kiểm toán phí) của MỘT tài khoản theo nguyên nhân — CHỈ ĐỌC.
-- Luật phân loại chép từ backend/src/lib/shipping-diff-reason.ts (TikTok + Shopee đủ; Lazada gộp 1 dòng).
-- Nhóm khiếu nại được = FEE_MISMATCH, LOGISTICS_SURCHARGE, AWAITING_STATEMENT (chưa sao kê, số đang ước tính).
-- Đổi email ở dòng `params`. Dùng cho video truy thu ship ngành nặng 10/11/2026.

WITH params AS (SELECT lower('<email-chu-shop>') AS email),
lech AS (
  SELECT
    c."channelName" AS san,
    c."shopName"    AS gian,
    o."createdAt",
    o."shippingFeeDiff" AS tien,
    CASE c."channelName"
      WHEN 'TIKTOK' THEN CASE
        WHEN NOT o."isSettled" OR t.estimated THEN 'AWAITING_STATEMENT'
        WHEN o."shippingStatus" = 'CANCELLED' AND o."returnStatus" = 'NONE' THEN 'CANCELLED_AFTER_SHIP'
        WHEN o."returnStatus" <> 'NONE' OR t."shipReturn" < 0 THEN 'CUSTOMER_RETURN'
        WHEN t."orderId" IS NULL THEN 'OTHER'
        WHEN t."shipOther" < 0 THEN 'LOGISTICS_SURCHARGE'
        WHEN t."shipSellerDiscount" < 0 THEN 'SHOP_FREESHIP'
        WHEN t."shipCustomerPaid" = 0 AND t."shipPlatformDiscount" = 0 AND t."shipSubsidy" = 0 THEN 'SHOP_BEARS_SHIPPING'
        WHEN t."shipPlatformDiscount" > 0 OR t."shipSubsidy" > 0 THEN 'OVER_PLATFORM_SUBSIDY'
        ELSE 'OTHER' END
      WHEN 'SHOPEE' THEN CASE
        WHEN NOT o."isSettled" THEN 'AWAITING_STATEMENT'
        WHEN o."shippingStatus" = 'CANCELLED' AND o."returnStatus" = 'NONE' THEN 'CANCELLED_AFTER_SHIP'
        WHEN o."returnStatus" <> 'NONE' THEN 'CUSTOMER_RETURN'
        ELSE 'FEE_MISMATCH' END
      ELSE 'LAZADA_CHUA_BOC'
    END AS nguyen_nhan
  FROM "Order" o
  JOIN "Channel" c ON c.id = o."channelId"
  JOIN "User" u    ON u.id = c."userId"
  LEFT JOIN tiktok_order_settlements t ON t."orderId" = o.id
  WHERE lower(u.email) = (SELECT email FROM params)
    AND o."shippingFeeDiff" > 0
)
-- Khối 1: theo nguyên nhân (cả lịch sử)
SELECT 'theo_nguyen_nhan' AS khoi, san::text, nguyen_nhan AS nhom,
       count(*) AS so_don, round(sum(tien)) AS tong_tien,
       round(avg(tien)) AS tb_moi_don,
       to_char(min("createdAt"), 'DD/MM/YYYY') || ' - ' || to_char(max("createdAt"), 'DD/MM/YYYY') AS khoang
FROM lech GROUP BY san, nguyen_nhan
UNION ALL
-- Khối 2: theo tháng (để biết 29,6 tr là bao nhiêu tháng)
SELECT 'theo_thang', san::text, to_char(date_trunc('month', "createdAt"), 'YYYY-MM'),
       count(*), round(sum(tien)), round(avg(tien)), NULL
FROM lech GROUP BY san, date_trunc('month', "createdAt")
UNION ALL
-- Khối 3: theo gian
SELECT 'theo_gian', san::text, gian, count(*), round(sum(tien)), round(avg(tien)), NULL
FROM lech GROUP BY san, gian
ORDER BY 1, 2, 5 DESC;
