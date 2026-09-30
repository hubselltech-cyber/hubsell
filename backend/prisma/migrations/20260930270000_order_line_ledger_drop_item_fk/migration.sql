-- ============================================================
-- SỔ CÁI ĐƠN — bỏ khóa ngoại order_line_ledger."orderItemId" → "OrderItem"
-- (anh Trung chốt 30/09/2026 tối, docs/QUANG-CAO-GOM-TRONG-DATABASE.md mục 11.6)
--
-- VÌ SAO: khóa ngoại này ON DELETE CASCADE nhưng sổ dòng hàng KHÔNG có chỉ mục
-- nào bắt đầu bằng "orderItemId" (khóa chính là ("createdDate", "orderItemId")).
-- Mỗi dòng "OrderItem" bị xóa — tức mỗi dòng hàng của mỗi đơn khi XÓA GIAN —
-- kéo theo một lượt dò toàn bộ sổ dòng hàng ở mọi mảnh tháng. Đo trên DB dev
-- khi mảnh tháng có 410.000 dòng: 59 mili giây mỗi lượt dò; xóa gian 300.000
-- đơn (405.000 dòng hàng) chạy hơn 12 phút chưa xong.
--
-- VÌ SAO BỎ ĐƯỢC (thay vì thêm chỉ mục):
--   · Xóa ĐƠN vẫn dọn dòng sổ qua khóa ngoại "orderId" (có chỉ mục) — giữ nguyên.
--   · Xóa riêng một dòng "OrderItem" (code hiện không làm): trigger
--     order_ledger_on_order_item_ins_del đánh dấu đơn cần tính lại, worker ghi
--     lại toàn bộ dòng sổ của đơn (xóa theo ("createdDate", "orderId") rồi ghi
--     mới) → dòng sổ của dòng hàng đã mất tự biến mất.
--   · Thêm chỉ mục thì mỗi lượt worker ghi sổ phải cập nhật thêm một chỉ mục ở
--     mọi mảnh; bỏ khóa ngoại thì mỗi dòng sổ ghi vào còn bớt một lượt kiểm.
--
-- KHÓA: DROP CONSTRAINT cần ACCESS EXCLUSIVE trên sổ dòng hàng VÀ trên
-- "OrderItem" (gỡ trigger kiểm khóa ngoại phía bảng được tham chiếu). Lấy cả hai
-- ngay từ đầu, một lệnh, lock_timeout 5 giây, thử lại tối đa 40 lần khi đụng
-- khóa hoặc deadlock — cùng khuôn với 20260930230000_order_ledger.
-- Thứ tự "OrderItem" TRƯỚC, sổ dòng hàng SAU là có chủ ý: giao dịch ghi đơn của
-- app chỉ chạm "OrderItem" (không bao giờ cần sổ dòng hàng) nên chỉ XẾP HÀNG
-- sau migration, không thể nằm trong một vòng khóa chéo. Vòng khóa chéo nếu có
-- chỉ gồm migration và worker ghi sổ (worker giữ sổ dòng hàng rồi mới kiểm khóa
-- ngoại sang "OrderItem"); bên nào bị Postgres chọn hủy cũng tự thử lại được
-- (migration: khối dưới đây; worker: nhả các dòng đã nhặt, lượt sau tính lại).
-- Lệnh DROP chỉ sửa danh mục, không quét bảng: giữ khóa vài chục mili giây.
-- Idempotent (IF EXISTS).
-- ============================================================

DO $$
DECLARE
  attempt INTEGER := 0;
BEGIN
  LOOP
    BEGIN
      SET LOCAL lock_timeout = '5s';
      LOCK TABLE "OrderItem", "order_line_ledger" IN ACCESS EXCLUSIVE MODE;
      EXIT;
    EXCEPTION
      WHEN lock_not_available OR deadlock_detected THEN
        attempt := attempt + 1;
        IF attempt >= 40 THEN
          RAISE;
        END IF;
        RAISE NOTICE 'order_line_ledger_drop_item_fk: chưa lấy được khóa (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

ALTER TABLE "order_line_ledger" DROP CONSTRAINT IF EXISTS "order_line_ledger_orderItemId_fkey";
