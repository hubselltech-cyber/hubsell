-- ============================================================
-- ĐO ẢNH HƯỞNG TỚI QUẢNG CÁO TRƯỚC KHI PUSH (lớp 3, 05/11/2026)
--
-- BẮT BUỘC chạy khi đổi: LEDGER_FORMULA_VERSION, cờ missingCostPrice, cách tính
-- profit/actualRevenue, hoặc luật chọn đơn của hòa vốn/biên lãi quảng cáo. Trả cho
-- anh Trung bảng này TRƯỚC khi push. Vì sao: đêm 04/11 Lát A đổi cờ thiếu giá vốn,
-- em báo "không ảnh hưởng" mà chưa đo; Hellokityhh từ hòa vốn 2,47 sang "Lỗ sẵn"
-- (docs/TAI-CHINH-GIA-VON-0-ROI-ROAS-KHAO-SAT-02-11.md mục 10–12).
--
-- CÁCH DÙNG: dán vào Supabase SQL Editor (chỉ SELECT). Chỉ sửa khối "luat": viết
-- luật CŨ và MỚI bằng cờ của đơn, xem CTE "don". Kết quả: mỗi chiến dịch đang chạy
-- một dòng biên lãi theo hai luật, xếp theo độ lệch; cột cuối là tổng toàn nền tảng.
-- Đọc: doi2d (số chiến dịch lệch ≥ 2 điểm), sang_am (số chiến dịch dương thành âm).
--
-- GIỚI HẠN: mô phỏng trên sổ hiện tại nên chỉ đo được luật CHỌN ĐƠN. Đổi cách tính
-- tiền trong từng đơn (profit...) thì phải viết thêm biểu thức thay cho "lai" ở "x".
-- Khớp luật thật ở lib/tiktok-breakeven.ts và lib/ads-margin.ts, không thay thế test.
-- ============================================================
WITH
"l" AS (
  SELECT "orderId", "channelId", "channelName", "itemId", "createdAt", "shippingStatus", "isSettled",
         "lineGross", "costPriceAtSale", "quantity", "actualRevenue", "profit", "feeGmvMax"
  FROM "order_line_ledger"
  WHERE "formulaVersion" = (SELECT max("formulaVersion") FROM "order_ledger" WHERE "createdDate" >= current_date - 1)
    AND "createdDate" >= current_date - 61
    AND "createdAt" >= now() - interval '60 days'
),
"don" AS (
  SELECT "orderId",
         -- thieu: cờ thiếu giá vốn đang dùng (sổ v4).
         bool_or("costPriceAtSale" <= 0 AND "lineGross" > 0) AS "thieu",
         -- thieu_v3: cờ trước sổ v4, kể cả dòng quà 0 đ.
         bool_or("costPriceAtSale" <= 0) AS "thieu_v3",
         -- gia_von_qua: giá vốn trên dòng giá bán 0 đ; dt: doanh thu đơn.
         COALESCE(sum("costPriceAtSale" * "quantity") FILTER (WHERE "lineGross" = 0), 0) AS "gia_von_qua",
         sum("actualRevenue") AS "dt"
  FROM "l"
  GROUP BY "orderId"
),
"luat" AS (
  SELECT "orderId",
         -- ▼▼▼ CHỈ SỬA HAI DÒNG NÀY: TRUE = đơn đứng ngoài biên lãi ▼▼▼
         "thieu" AS "loai_cu",
         ("thieu" OR ("gia_von_qua" > "dt" AND "dt" > 0)) AS "loai_moi"
         -- ▲▲▲ ví dụ đang điền: rào giá vốn quà > doanh thu đơn ▲▲▲
  FROM "don"
),
"st" AS (
  SELECT o."orderId", o."channelId", o."createdAt"
  FROM "order_ledger" o
  JOIN "tiktok_order_settlements" t ON t."orderId" = o."orderId" AND NOT t."estimated"
  WHERE o."channelName" = 'TIKTOK' AND o."createdDate" >= current_date - 61
    AND o."createdAt" >= now() - interval '60 days'
    AND o."isSettled" AND o."shippingStatus" <> 'CANCELLED'
),
"cut" AS (SELECT "channelId", max("createdAt") AS "at" FROM "st" GROUP BY 1),
"camp" AS (
  SELECT a."id", a."channelId", a."name", unnest(string_to_array(a."itemIds", ',')) AS "item"
  FROM "AdsCampaign" a
  WHERE a."status" = 'ongoing' AND a."itemIds" <> ''
),
"x" AS (
  SELECT m."id", m."name", m."channelId" AS "ch", l."channelName" AS "san", l."actualRevenue" AS "dt",
         l."profit" - l."feeGmvMax" AS "lai", r."loai_cu", r."loai_moi",
         -- "tinh_dt": đơn vào mẫu số; "tinh_lai": đơn vào tử số. TikTok: đã đối soát + hủy cùng lứa, 60 ngày. Shopee: không hủy, 30 ngày. Lazada: thêm đã đối soát.
         CASE l."channelName"
           WHEN 'TIKTOK' THEN (s."orderId" IS NOT NULL OR (l."shippingStatus" = 'CANCELLED' AND l."createdAt" <= c."at"))
           WHEN 'LAZADA' THEN (l."isSettled" AND l."shippingStatus" <> 'CANCELLED' AND l."createdAt" >= now() - interval '30 days')
           ELSE (l."shippingStatus" <> 'CANCELLED' AND l."createdAt" >= now() - interval '30 days')
         END AS "tinh_dt",
         CASE l."channelName"
           WHEN 'TIKTOK' THEN s."orderId" IS NOT NULL
           WHEN 'LAZADA' THEN (l."isSettled" AND l."shippingStatus" <> 'CANCELLED' AND l."createdAt" >= now() - interval '30 days')
           ELSE (l."shippingStatus" <> 'CANCELLED' AND l."createdAt" >= now() - interval '30 days')
         END AS "tinh_lai"
  FROM "camp" m
  JOIN "l" ON l."itemId" = m."item" AND l."channelId" = m."channelId"
  JOIN "luat" r ON r."orderId" = l."orderId"
  LEFT JOIN "st" s ON s."orderId" = l."orderId"
  LEFT JOIN "cut" c ON c."channelId" = l."channelId"
  WHERE l."lineGross" > 0
),
"a" AS (
  SELECT "id", min("name") AS "name", min("ch") AS "ch", min("san"::text) AS "san",
         sum("dt") FILTER (WHERE "tinh_dt") AS "dt_tat_ca",
         sum("dt") FILTER (WHERE "tinh_dt" AND NOT "loai_cu") AS "dt_cu",
         sum("lai") FILTER (WHERE "tinh_lai" AND NOT "loai_cu") AS "lai_cu",
         sum("dt") FILTER (WHERE "tinh_dt" AND NOT "loai_moi") AS "dt_moi",
         sum("lai") FILTER (WHERE "tinh_lai" AND NOT "loai_moi") AS "lai_moi"
  FROM "x"
  GROUP BY "id"
),
"b" AS (
  SELECT *, 100 * "lai_cu" / NULLIF("dt_cu", 0) AS "bien_cu", 100 * "lai_moi" / NULLIF("dt_moi", 0) AS "bien_moi"
  FROM "a"
  WHERE COALESCE("dt_cu", 0) > 0 OR COALESCE("dt_moi", 0) > 0
)
SELECT left(c."shopName", 16) AS "gian", left(b."san", 2) AS "san", left(b."name", 16) AS "chien_dich",
       round(b."dt_tat_ca" / 1e6) AS "dt_tr",
       round(b."bien_cu", 1) AS "bien_cu", round(b."bien_moi", 1) AS "bien_moi",
       round(100 * b."dt_moi" / NULLIF(b."dt_tat_ca", 0)) AS "phu_moi",
       count(*) OVER () AS "tong_cd",
       count(*) FILTER (WHERE abs(COALESCE(b."bien_moi", 0) - COALESCE(b."bien_cu", 0)) >= 2) OVER () AS "doi2d",
       count(*) FILTER (WHERE b."bien_cu" > 0 AND b."bien_moi" <= 0) OVER () AS "sang_am"
FROM "b"
JOIN "Channel" c ON c."id" = b."ch"
ORDER BY abs(COALESCE(b."bien_moi", 0) - COALESCE(b."bien_cu", 0)) DESC
LIMIT 15;
