-- LUU VAN DON DA IN 60 NGAY (06/11/2026, anh Trung — docs/LUU-VAN-DON-DA-IN.md).
--   labelArchiveEnabledAt — cong tac GIU LICH SU VAN DON cua mot gian: NULL = tat.
--                           Bat = moi lan khach in van don qua Hubsell, tep duoc chep vao kho tep
--                           (Supabase Storage, bucket rieng tu) va giu 60 ngay de in lai sau khi
--                           hang van chuyen da lay kien (san khong tra phieu nua — tham do prod 06/11).
--                           Ve sau la cong tac thu phi.
-- Mot cot NULL tren Channel, khong mac dinh, khong chi muc; KHONG dung bang Order.
-- ADD COLUMN NULL khong ghi lai dong. IF NOT EXISTS de chay lai em. Duong lui: revert commit (cot thua vo hai).
ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "labelArchiveEnabledAt" TIMESTAMP(3);
