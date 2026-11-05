-- Keo danh muc san pham TANG DAN (lat 3.9 giai doan 3, docs/DONG-BO-GIAI-DOAN-3.md muc 7 —
-- anh Trung chot 03/11/2026: "moi lan keo lai phai keo lai het thi qua gay").
--   productSyncWatermark — moc nuoc danh muc: thoi diem BAT DAU cua luot doc DU gan nhat
--                          (toan bo hoac tang dan). Luot tang dan doc tu (moc - khoang chong lan).
--                          Chi tien khi luot doc du; NULL = chua co moc -> keo toan bo.
--   productFullSyncAt    — thoi diem bat dau cua luot keo TOAN BO du gan nhat; qua nhip
--                          (7-9 ngay, so tu chon) thi luot dem keo toan bo de phat hien san pham bi go.
-- Hai cot NULL, khong mac dinh, khong chi muc. ADD COLUMN NULL khong ghi lai dong.
-- IF NOT EXISTS de chay lai em. Duong lui: revert commit (cot thua vo hai).
ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "productSyncWatermark" TIMESTAMP(3);
ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "productFullSyncAt" TIMESTAMP(3);
