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
// KỲ GHI NHẬN = NGÀY KHO BÁO HỎNG (anh Trung chốt 20/11/2026 — 13/11 → 20/11 ghi
// theo ngày tạo đơn nên báo hỏng hôm nay mà xem kỳ "Hôm nay" không thấy). Đây là
// dòng DUY NHẤT của báo cáo chạy trục thời gian khác trục ngày tạo đơn, nên có
// hai phép đọc trên hai trục:
//   · `total`    — đơn kho báo hỏng TRONG kỳ (trục ngày báo hỏng) → dòng Thất thu.
//   · `inActive` — giá vốn hàng hỏng đang nằm sẵn trong dòng Giá vốn của kỳ: đơn
//     TẠO trong kỳ, đã báo hỏng (bất kể ngày nào) mà vẫn là đơn tính doanh thu
//     (WRITTEN_OFF trên đơn sàn không hủy) → tách khỏi dòng Giá vốn để cả đời
//     đơn chỉ bị trừ giá vốn hàng hỏng đúng MỘT lần, ở kỳ báo hỏng.
//   · `outside` = total − inActive → phần Lợi nhuận ròng của kỳ phải trừ thêm
//     ngoài lãi đơn. ÂM được: kỳ có đơn tạo trong kỳ nhưng báo hỏng ở kỳ khác.
//
// KHÔNG đổi công thức sổ cái (không tăng LEDGER_FORMULA_VERSION): số tiền lấy từ
// cột sổ đã có, mốc ngày báo hỏng đọc ở bảng đơn. Đơn đã được đền bù
// (CLAIM_SETTLED) giữ cách cũ — coi như không mất vốn.
// docs/DOI-SOAT-DON-HOAN-HANG-LOAT-VA-THAT-THU.md mục 5.7 + 17
// ============================================================

export const DAMAGED_LOSS_LABEL = "Thất thu hàng mất/hỏng";
export const DAMAGED_LOSS_HINT =
  "Giá vốn của hàng hoàn mà kho đã báo hỏng / mất (không nhập lại kho được), tính vào ngày kho báo hỏng. Tách riêng khỏi Giá vốn sản phẩm.";

/**
 * Điều kiện + biểu thức SQL — MỘT chỗ cho mọi câu đọc (kiểm trên Postgres ở
 * integrations/__tests__/damaged-loss-db.test.ts). `alias` = bí danh bảng kèm
 * dấu chấm (vd `l.`), bỏ trống khi câu chỉ có một bảng.
 *   · Trạng thái: DAMAGED (kho báo hỏng / mất) + WRITTEN_OFF (đã chốt không được đền).
 *     Vị từ này cũng là vị từ của chỉ mục một phần "Order_return_damaged_idx" —
 *     đổi ở đây phải đổi cả migration.
 *   · Số tiền (cột của order_ledger) — đơn có loại hoàn (không hủy): `returnLossCost`
 *     = giá vốn chưa thu hồi của PHẦN bị trả (đơn trả một phần không tính cả phần
 *     khách vẫn giữ và đã trả tiền). Đơn sàn đã hủy (returnType NULL — giao thất
 *     bại, kiện quay đầu rồi hỏng): sổ không bóc "thất thu đơn hoàn" cho đơn hủy
 *     → lấy `costSnapshot` (cả đơn).
 *   · Mốc ghi nhận (cột của "Order"): returnDamagedAt; đơn báo hỏng trước
 *     20/11/2026 chưa có mốc → lùi về lúc kho nhận kiện (returnedAt), rồi ngày tạo
 *     đơn — không bao giờ để một đơn hỏng rơi khỏi mọi kỳ.
 */
export const damagedLossWhereSql = (alias = ""): string =>
  `${alias}"returnStatus" IN ('DAMAGED', 'WRITTEN_OFF')`;
export const damagedLossAmountSql = (alias = ""): string =>
  `CASE WHEN ${alias}"returnType" IS NULL THEN ${alias}"costSnapshot" ELSE ${alias}"returnLossCost" END`;
export const damagedAtSql = (alias = ""): string =>
  `COALESCE(${alias}"returnDamagedAt", ${alias}"returnedAt", ${alias}"createdAt")`;

export interface DamagedLoss {
  /** Tổng dòng "Thất thu hàng mất/hỏng" của kỳ — đơn kho báo hỏng TRONG kỳ. */
  total: number;
  /**
   * Giá vốn hàng hỏng đang nằm sẵn trong giá vốn của đơn tính doanh thu TẠO
   * trong kỳ → tách khỏi dòng Giá vốn (đã / sẽ ghi ở dòng Thất thu của kỳ báo hỏng).
   */
  inActive: number;
  /** total − inActive: phần Lợi nhuận ròng của kỳ trừ thêm ngoài lãi đơn (âm được). */
  outside: number;
  /** Số đơn kho báo hỏng trong kỳ. */
  orderCount: number;
  inActiveByChannelName: Map<string, number>;
  /**
   * Phần `outside` theo ngày (giờ VN) — cho chuỗi chi phí theo ngày: + thất thu
   * ở ngày báo hỏng, − phần đã nằm trong giá vốn ở ngày tạo đơn.
   */
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

export interface DamagedLossInput {
  /** Đơn kho báo hỏng trong kỳ, gom theo NGÀY BÁO HỎNG (giờ VN). */
  damagedDays: { day: string; count: number; amount: number }[];
  /** Đơn tính doanh thu TẠO trong kỳ đã bị báo hỏng, gom theo sàn × NGÀY TẠO ĐƠN. */
  inActive: { channelName: string; day: string; amount: number }[];
  /** Chỉ dựng chuỗi ngày từ mốc này ("yyyy-mm-dd"); bỏ trống = không dựng. */
  byDaySince?: string;
}

/** Gom hai phép đọc (trục ngày báo hỏng + trục ngày tạo đơn) thành bộ số của dòng. */
export function buildDamagedLoss(input: DamagedLossInput): DamagedLoss {
  const out = emptyDamagedLoss();
  const since = input.byDaySince;
  const addDay = (day: string, amount: number) => {
    if (!since || day < since || !amount) return;
    const next = (out.outsideByDay.get(day) ?? 0) + amount;
    if (next) out.outsideByDay.set(day, next);
    else out.outsideByDay.delete(day);
  };
  for (const d of input.damagedDays) {
    out.orderCount += d.count;
    out.total += d.amount;
    addDay(d.day, d.amount);
  }
  for (const g of input.inActive) {
    out.inActive += g.amount;
    out.inActiveByChannelName.set(
      g.channelName,
      (out.inActiveByChannelName.get(g.channelName) ?? 0) + g.amount
    );
    addDay(g.day, -g.amount);
  }
  out.outside = out.total - out.inActive;
  return out;
}
