-- ============================================================
-- SỔ QUỸ HQ — ĐỢT APPLE CHUYỂN TIỀN (lát B phải thu Apple, 17/11/2026,
-- docs/APPLE-IAP-MUA-GOI-TRONG-APP.md mục "Thuế + sổ sách cho khoản Apple")
--
-- Anh Trung 17/11: "Vậy làm lát B luôn".
--
-- Mỗi dòng = MỘT LẦN Apple chuyển tiền về tài khoản ngân hàng công ty. Đối
-- soát = chọn các khoản bán qua App Store mà lần chuyển này trả, nhập số tiền
-- ngân hàng nhận + thuế Apple trừ (theo báo cáo tài chính Apple):
--   hoa hồng = tổng khách trả − tiền về − thuế Apple trừ.
-- Bút toán sổ quỹ đi kèm (phiếu thu tổng khách trả, phiếu chi hoa hồng, phiếu
-- chi thuế) và các khoản bán đã đóng mang cột "appleSettlementId".
-- Không khóa ngoại (cùng nguyên tắc pack_hour_grants) — hủy đợt do mã lo trong
-- một giao dịch.
-- Chỉ CREATE + ADD COLUMN trên bảng sổ quỹ nhỏ (vài chục dòng) — không khóa lâu.
-- ============================================================

CREATE TABLE IF NOT EXISTS "apple_settlements" (
  "id"                TEXT NOT NULL,
  -- Ngày tiền về tài khoản ngân hàng (theo sổ phụ).
  "receivedAt"        TIMESTAMP(3) NOT NULL,
  -- Số tiền ngân hàng thực nhận (VND).
  "bankAmount"        DECIMAL(14,2) NOT NULL,
  -- Tổng khách trả của các khoản trong đợt (= tổng hóa đơn đã xuất).
  "grossAmount"       DECIMAL(14,2) NOT NULL,
  -- Hoa hồng Apple giữ = gross − bank − thuế.
  "commissionAmount"  DECIMAL(14,2) NOT NULL,
  -- Thuế (nhà thầu) Apple trừ vào tiền chuyển về, theo báo cáo Apple; 0 nếu báo cáo không tách.
  "taxWithheldAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  -- Mã giao dịch trên sổ phụ ngân hàng.
  "bankRef"           TEXT,
  -- Kỳ / mã báo cáo tài chính Apple làm chứng từ.
  "reportRef"         TEXT,
  "note"              TEXT,
  "createdById"       TEXT,
  "createdByName"     TEXT NOT NULL,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "apple_settlements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "apple_settlements_amounts_check" CHECK (
    "bankAmount" > 0 AND "taxWithheldAmount" >= 0 AND "commissionAmount" >= 0
    AND "grossAmount" = "bankAmount" + "commissionAmount" + "taxWithheldAmount"
  )
);

CREATE INDEX IF NOT EXISTS "apple_settlements_received_idx" ON "apple_settlements" ("receivedAt");

-- RLS (Supabase 30/09/2026: mọi bảng public phải bật).
ALTER TABLE "apple_settlements" ENABLE ROW LEVEL SECURITY;

-- Khoản bán App Store đã được đợt này trả + bút toán do đợt này sinh ra.
ALTER TABLE "platform_ledger_entries" ADD COLUMN IF NOT EXISTS "appleSettlementId" TEXT;
CREATE INDEX IF NOT EXISTS "platform_ledger_entries_appleSettlementId_idx"
  ON "platform_ledger_entries" ("appleSettlementId");
