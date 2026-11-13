// ============================================================
// THẤT THU HÀNG MẤT/HỎNG (13/11/2026) — phần thuần, không chạm DB.
//
// Anh Trung chốt: "Chỉ cần kho quét hàng hoàn và báo là hỏng thì tính là thất
// thu và trừ đi giá vốn của hàng đó là được." Hàng hoàn về nguyên vẹn giữ cách
// cũ (trừ theo API của sàn ở Lãi/Lỗ thực hiện).
//
// Một dòng trong CHI PHÍ của Báo cáo dòng tiền + Tổng quan:
//   = Σ giá vốn phần hàng kho đã báo hỏng / mất (returnStatus DAMAGED, hoặc
//     WRITTEN_OFF sau khi chốt "không được đền"), KỂ CẢ đơn sàn đã hủy và đơn
//     chưa chốt khiếu nại — hai nhóm này không phải "đơn tính doanh thu" nên
//     trước đây giá vốn hàng hỏng không vào Lợi nhuận ròng.
//
// KHÔNG đổi công thức sổ cái (không tăng LEDGER_FORMULA_VERSION): số lấy từ cột
// sổ đã có. Đơn đã được đền bù (CLAIM_SETTLED) giữ cách cũ — coi như không mất vốn.
// docs/DOI-SOAT-DON-HOAN-HANG-LOAT-VA-THAT-THU.md mục 5.7
// ============================================================

export const DAMAGED_LOSS_LABEL = "Thất thu hàng mất/hỏng";
export const DAMAGED_LOSS_HINT =
  "Giá vốn của hàng hoàn mà kho đã báo hỏng / mất (không nhập lại kho được). Tách riêng khỏi Giá vốn sản phẩm.";

/**
 * Điều kiện + biểu thức SQL trên order_ledger — MỘT chỗ cho mọi câu đọc
 * (kiểm trên Postgres ở integrations/__tests__/damaged-loss-db.test.ts).
 *   · Trạng thái: DAMAGED (kho báo hỏng / mất) + WRITTEN_OFF (đã chốt không được đền).
 *   · Đơn có loại hoàn (không hủy): `returnLossCost` = giá vốn chưa thu hồi của
 *     PHẦN bị trả (đơn trả một phần không tính cả phần khách vẫn giữ và đã trả tiền).
 *   · Đơn sàn đã hủy (returnType NULL — giao thất bại, kiện quay đầu rồi hỏng):
 *     sổ không bóc "thất thu đơn hoàn" cho đơn hủy → lấy `costSnapshot` (cả đơn).
 */
export const DAMAGED_LOSS_WHERE_SQL = `"returnStatus" IN ('DAMAGED', 'WRITTEN_OFF')`;
export const DAMAGED_LOSS_AMOUNT_SQL = `CASE WHEN "returnType" IS NULL THEN "costSnapshot" ELSE "returnLossCost" END`;

export interface DamagedLoss {
  /** Tổng dòng "Thất thu hàng mất/hỏng" của kỳ. */
  total: number;
  /** Phần ĐÃ nằm trong giá vốn của đơn tính doanh thu → tách khỏi dòng Giá vốn, không trừ lợi nhuận lần nữa. */
  inActive: number;
  /** Phần của đơn KHÔNG tính doanh thu (đơn hủy, đơn hỏng chờ khiếu nại) → trừ thêm vào lợi nhuận. */
  outside: number;
  orderCount: number;
  inActiveByChannelName: Map<string, number>;
  /** Phần `outside` theo ngày tạo đơn (giờ VN) — cho chuỗi chi phí theo ngày. */
  outsideByDay: Map<string, number>;
}

export function emptyDamagedLoss(): DamagedLoss {
  return {
    total: 0,
    inActive: 0,
    outside: 0,
    orderCount: 0,
    inActiveByChannelName: new Map(),
    outsideByDay: new Map(),
  };
}

/** Gom các nhóm (sàn × có tính doanh thu) + chuỗi ngày thành bộ số của dòng. */
export function buildDamagedLoss(
  groups: { channelName: string; countsAsRevenue: boolean; count: number; amount: number }[],
  outsideDays: { day: string; amount: number }[] = []
): DamagedLoss {
  const out = emptyDamagedLoss();
  for (const g of groups) {
    out.orderCount += g.count;
    out.total += g.amount;
    if (g.countsAsRevenue) {
      out.inActive += g.amount;
      out.inActiveByChannelName.set(
        g.channelName,
        (out.inActiveByChannelName.get(g.channelName) ?? 0) + g.amount
      );
    } else {
      out.outside += g.amount;
    }
  }
  for (const d of outsideDays) {
    if (d.amount) out.outsideByDay.set(d.day, (out.outsideByDay.get(d.day) ?? 0) + d.amount);
  }
  return out;
}
