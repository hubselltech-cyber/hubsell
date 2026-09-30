-- ============================================================
-- SỔ CÁI ĐƠN — hàm đánh dấu "cần tính lại" không được dò cả bảng "Order"
-- (phát hiện 30/09/2026 tối khi dựng gian thử TikTok, docs/QUANG-CAO-GOM-TRONG-DATABASE.md mục 12.6)
--
-- LỖI: trigger của hai bảng bản kê (lazada_order_settlements, tiktok_order_settlements)
-- gọi order_ledger_mark(mã đơn, 'settlement:' || TG_TABLE_NAME, false). TG_TABLE_NAME
-- có kiểu `name`, mang luật so chuỗi "C". PL/pgSQL lấy luật so chuỗi của LỜI GỌI
-- làm luật của mọi tham số kiểu chuỗi, nên bên trong hàm câu
--     ... FROM "Order" o ... WHERE o."id" = p_order_id
-- so theo luật "C" trong khi chỉ mục khóa chính của "Order" dựng theo luật mặc
-- định → Postgres không dùng được chỉ mục và DÒ CẢ BẢNG "Order" cho MỖI dòng bản
-- kê được ghi / sửa / xóa. Đo trên DB dev khi "Order" có 600.000 dòng: 55 mili
-- giây mỗi dòng bản kê (gọi hàm với lý do kiểu text: 0,3 mili giây). Chi phí
-- tăng theo tổng số đơn của MỌI shop. Các trigger khác (đơn, dòng hàng, sổ kho,
-- giá vốn) truyền lý do kiểu text nên không dính.
--
-- SỬA: trong hàm, mã đơn đi qua một biến khai báo luật so chuỗi mặc định — hàm
-- dùng được chỉ mục bất kể nơi gọi truyền tham số theo luật nào. Thân hàm còn
-- lại giữ nguyên từng chữ so với 20260930230000_order_ledger.
--
-- KHÓA: CREATE OR REPLACE FUNCTION chỉ sửa danh mục hàm, không khóa bảng nào,
-- không đụng trigger. Idempotent.
-- ============================================================

CREATE OR REPLACE FUNCTION "order_ledger_mark"(p_order_id TEXT, p_reason TEXT, p_check_date BOOLEAN DEFAULT false)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_date DATE;
  v_order_id TEXT COLLATE "default" := p_order_id;
BEGIN
  IF p_check_date THEN
    SELECT ("createdAt" + INTERVAL '7 hours')::date INTO v_date FROM "Order" WHERE "id" = v_order_id;
    IF v_date IS NOT NULL THEN
      UPDATE "order_ledger" SET "createdDate" = v_date WHERE "orderId" = v_order_id AND "createdDate" <> v_date;
      UPDATE "order_line_ledger" SET "createdDate" = v_date WHERE "orderId" = v_order_id AND "createdDate" <> v_date;
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
  WHERE o."id" = v_order_id
  ON CONFLICT ("createdDate", "orderId") DO UPDATE
    SET "dirtyAt" = clock_timestamp(),
        "dirtyReason" = EXCLUDED."dirtyReason";
END;
$$;
