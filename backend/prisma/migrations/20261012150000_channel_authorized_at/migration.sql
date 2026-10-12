-- Lần ủy quyền OAuth gần nhất của gian (12/10/2026). Chỉ callback nối/kết nối
-- lại gian ghi cột này; làm mới token không đụng. Gian cũ để NULL = ủy quyền
-- trước khi app Hubsell bật phạm vi TikTok Product Modify (12/10/2026 14:30 VN)
-- → Cài đặt đồng bộ tồn nhắc "Kết nối lại gian" cho gian TikTok.
ALTER TABLE "Channel" ADD COLUMN "authorizedAt" TIMESTAMP(3);
