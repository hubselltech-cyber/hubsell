// ============================================================
// VIDEO ĐÓNG HÀNG — LUẬT GIỮ / TỰ XÓA theo TRẠNG THÁI ĐƠN
// HÀM THUẦN: không gọi database, không gọi mạng, không đọc đồng hồ (giờ "bây giờ" do người gọi đưa vào).
//
// Anh Trung chốt 14/11/2026 (tài liệu khảo sát mục 54): giữ tới QUA HẠN KHIẾU NẠI, tự xóa theo trạng thái
// đơn; ⛔ không "cố định N ngày từ ngày quay". Chốt 25/11/2026 (docs/VIDEO-DONG-HANG-THIET-KE.md mục 31–32):
// "Hết hạn khiếu nại 3 ngày thì xóa, trần 90 ngày anh nghĩ đang thừa, 60 ngày là đủ rồi."
//
//   Một câu: XÓA SAU KHI HẾT HẠN 3 NGÀY. "Hạn" của từng trường hợp:
//
//   L4  đã giao, không có dấu hiệu hoàn      hạn = hết thời gian NGƯỜI MUA được xin trả hàng
//                                            (giao + 15 ngày; Lazada + 30)                      → + 3 ngày
//   L7  đơn hoàn, kiện đã về, ca còn mở      hạn = hạn khiếu nại của NGƯỜI BÁN (hạn sàn trả, thiếu thì
//                                            tính theo luật — lib/return-complaint-due.ts)      → + 3 ngày
//   L5  đơn hoàn đã xử lý xong               hạn = lúc ca đóng (kho nhập nguyên vẹn / khiếu nại
//                                            có kết quả)                                        → + 3 ngày
//   L3  đơn hủy, kiện quay đầu về nguyên vẹn hạn = lúc kho nhận                                 → + 3 ngày
//   L2  đơn hủy khi kiện CHƯA rời kho        không có gì để khiếu nại                           → 1 ngày sau khi thấy hủy
//   L1  video ĐÓNG HÀNG không khớp đơn nào   không có đơn để tính hạn                           → ngày quay + 7 ngày
//   —   GIỮ: kho báo hỏng đang khiếu nại · kiện hoàn chưa về (hạn chưa bắt đầu / mới là hạn tạm của sàn) ·
//       kiện hủy đang quay đầu · video khui chưa khớp đơn · đơn chưa giao xong.
//   SÀN không xóa video nào trước ngày quay + 7 ngày (hạn tính theo đơn có thể rơi vào quá khứ khi quay cho
//       đơn cũ — số thật tuần chạy bóng: 4 / 55 video).
//   L6  TRẦN ngày quay + 60 ngày, áp cho MỌI video kể cả đang GIỮ / đang chờ.
//   —   "đã đối soát" KHÔNG phải mốc xóa (mục 12.1, 54.3).
//
// Nguyên tắc an toàn:
//  · Mọi dấu hiệu hoàn đều đưa video sang nhánh đơn hoàn: returnStatus ≠ NONE, có mốc xin hoàn / kiện hoàn về
//    / kho nhận, có tiền hoàn thật hoặc sàn báo tiền hoàn, sàn có trạng thái hoàn, có giải pháp hoàn, hoặc
//    chính video là video KHUI hàng hoàn. Riêng mốc xin hoàn thiếu ở ≈ 86 % đơn có hoàn nên KHÔNG dựa một cờ.
//  · Dữ liệu không đủ chắc (chưa rõ kiện đã rời kho chưa, sàn chưa báo giao) → CHỜ, không đoán — tới trần.
//  · Không nhận ra được gian LazMall (sổ không có cờ) → MỌI gian Lazada dùng mốc 30 ngày.
//  · Hạn xóa tính theo NGÀY LỊCH giờ Việt Nam (cột deleteAfter là DATE). Xóa vào ngày deleteAfter hoặc sau.
//
// Số ngày: 3 và 60 = anh Trung chốt 25/11/2026. 15 / 30 = thời gian người mua được xin trả hàng (mục 16.5;
// prod tháng 10 có ca Shopee xin hoàn ở ngày 16,2 — 15 + 3 = 18 vẫn phủ). 1 / 7 (chưa khớp đơn) / 7 (sàn) =
// số EM TỰ CHỌN, chưa có số đo.
// ============================================================

/** Số ngày của từng luật — một chỗ để đổi, test đọc cùng hằng số. */
export const RETENTION_DAYS = {
  /** Xóa sau khi HẾT HẠN ngần này ngày (anh Trung 25/11/2026). */
  AFTER_DEADLINE: 3,
  /** Người mua được xin trả hàng trong ngần này ngày kể từ ngày giao. */
  BUYER_RETURN_WINDOW: 15,
  BUYER_RETURN_WINDOW_LAZADA: 30,
  L1_UNMATCHED: 7,
  L2_CANCELLED_IN_WAREHOUSE: 1,
  /** Sàn: không xóa trước ngày quay + ngần này ngày. */
  MIN_AFTER_RECORDING: 7,
  /** Trần: ngày quay + ngần này ngày (anh Trung 25/11/2026: 60, thay 90). */
  HARD_CAP: 60,
  /** Video đang GIỮ / đang chờ: ghi hạn = trần từ trước trần ngần này ngày, để chip "Sắp tự xóa" kịp hiện. */
  CAP_NOTICE: 3,
} as const;

/**
 * L1 chưa khớp đơn · L2 hủy ngang · L3 kiện quay đầu về nguyên vẹn · L4 giao xong, qua hạn người mua trả hàng ·
 * L5 đơn hoàn đã xử lý xong · L6 trần · L7 đơn hoàn qua hạn khiếu nại. Ghi vào cột deleteRule; tab Lịch sử xóa
 * đổi ra câu tiếng Việt.
 */
export type RetentionRule = "L1" | "L2" | "L3" | "L4" | "L5" | "L6" | "L7";

/** Lý do GIỮ — ghi vào cột holdReason (chữ ngắn, máy đọc; web đổi ra câu tiếng Việt). */
export type HoldReason =
  | "RETURN_OPEN" // đơn hoàn, hạn khiếu nại chưa bắt đầu / chưa chốt
  | "RETURN_DAMAGED" // kho báo hỏng / mất / tráo — đang khiếu nại
  | "UNBOX_UNMATCHED" // video khui hàng hoàn chưa khớp được đơn
  | "PARCEL_RETURNING"; // đơn hủy sau khi kiện đã rời kho — chờ kiện quay về

export type RetentionDecision =
  /** Hạn xóa đã CHẮC — ghi một lần. `deleteAfter` là ngày lịch VN dạng "YYYY-MM-DD". */
  | { kind: "DELETE_AFTER"; deleteAfter: string; rule: RetentionRule }
  /** Phải giữ, chưa có hạn. */
  | { kind: "HOLD"; reason: HoldReason }
  /** Chưa đủ dữ liệu (đơn chưa giao / chưa rõ). Không ghi gì, lượt sau xét lại. */
  | { kind: "WAIT" };

export type Platform = "SHOPEE" | "TIKTOK" | "LAZADA" | "OFFLINE" | string;

export interface RetentionVideo {
  kind: "PACK" | "UNBOX";
  /** Ngày quay (khóa chia mảnh, giờ VN máy chủ) "YYYY-MM-DD". */
  recordedDate: string;
  /** Đã khớp đơn chưa. */
  orderId: string | null;
}

/**
 * Hạn khiếu nại của người bán cho đơn hoàn — người gọi tính bằng `complaintDueOf` (lib/return-complaint-due.ts)
 * rồi đưa vào. `provisional` = hạn TẠM của sàn (kiện còn trên đường) → chưa dùng làm mốc xóa.
 */
export type RetentionComplaintDue =
  | { state: "NOT_NEEDED" | "NOT_STARTED" | "UNKNOWN" }
  | { state: "DUE"; dueAt: Date; provisional: boolean };

/** Các cột của Order luật cần — đọc theo khóa chính, không quét bảng. */
export interface RetentionOrder {
  platform: Platform | null;
  shippingStatus: "PENDING" | "PROCESSED" | "SHIPPING" | "DELIVERED" | "CANCELLED" | string;
  deliveredAt: Date | null;
  /** Kiện đã rời kho (Biên bản bàn giao / sàn báo lấy hàng). */
  stockShippedAt: Date | null;
  returnStatus: "NONE" | "AWAITING" | "RECEIVED" | "RECEIVED_INTACT" | "DAMAGED" | "CLAIM_SETTLED" | "WRITTEN_OFF" | string;
  returnRequestedAt: Date | null;
  returnedAt: Date | null;
  returnDeliveredAt: Date | null;
  refundedAmount: number;
  platformRefundAmount: number;
  platformReturnStatus: string | null;
  returnSolution: string | null;
  complaintDue: RetentionComplaintDue;
}

const MS_DAY = 86_400_000;
const VN_OFFSET_MS = 7 * 3_600_000;

/** Ngày lịch giờ VN của một mốc. */
export function vnDateKey(d: Date): string {
  return new Date(d.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** Cộng N ngày vào một ngày lịch "YYYY-MM-DD". */
export function addDays(dateKey: string, days: number): string {
  const t = Date.parse(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(t)) throw new Error(`Ngày không hợp lệ: ${dateKey}`);
  return new Date(t + days * MS_DAY).toISOString().slice(0, 10);
}

/** Có BẤT KỲ dấu hiệu hoàn nào không. */
export function hasReturnSignal(o: RetentionOrder): boolean {
  return (
    (o.returnStatus !== "NONE" && o.returnStatus !== "") ||
    o.returnRequestedAt !== null ||
    o.returnedAt !== null ||
    o.returnDeliveredAt !== null ||
    o.refundedAmount > 0 ||
    o.platformRefundAmount > 0 ||
    (o.platformReturnStatus !== null && o.platformReturnStatus.trim() !== "") ||
    o.returnSolution !== null
  );
}

/** Ca hoàn đã ĐÓNG chưa (kho nhập nguyên vẹn, hoặc khiếu nại đã có kết quả). */
function returnCaseClosed(o: RetentionOrder): boolean {
  return o.returnStatus === "RECEIVED_INTACT" || o.returnStatus === "CLAIM_SETTLED" || o.returnStatus === "WRITTEN_OFF";
}

/** Đơn hủy mà kiện đã rời kho / đã từng tới tay người mua (kiện quay đầu). */
function leftWarehouse(o: RetentionOrder): boolean {
  return o.stockShippedAt !== null || o.deliveredAt !== null;
}

function maxKey(a: string, b: string): string {
  return a >= b ? a : b;
}

/** Ngày trần của một video. */
export function hardCapOf(recordedDate: string): string {
  return addDays(recordedDate, RETENTION_DAYS.HARD_CAP);
}

/** Hạn xóa đã tính → kẹp giữa SÀN (ngày quay + 7) và TRẦN (ngày quay + 60). Chạm trần thì luật là L6. */
function datedWithin(recordedDate: string, deleteAfter: string, rule: RetentionRule, ignoreCap: boolean): RetentionDecision {
  const cap = hardCapOf(recordedDate);
  const floored = maxKey(deleteAfter, addDays(recordedDate, RETENTION_DAYS.MIN_AFTER_RECORDING));
  return floored >= cap && !ignoreCap
    ? { kind: "DELETE_AFTER", deleteAfter: cap, rule: "L6" }
    : { kind: "DELETE_AFTER", deleteAfter: floored, rule };
}

/** Đang GIỮ / đang chờ: sát trần (≤ CAP_NOTICE ngày) thì chốt hạn = trần; chưa thì giữ nguyên quyết định. */
function keptUntilCap(recordedDate: string, today: string, decision: RetentionDecision, ignoreCap: boolean): RetentionDecision {
  const cap = hardCapOf(recordedDate);
  return today >= addDays(cap, -RETENTION_DAYS.CAP_NOTICE) && !ignoreCap
    ? { kind: "DELETE_AFTER", deleteAfter: cap, rule: "L6" }
    : decision;
}

export interface RetentionOptions {
  /**
   * true = tính như KHÔNG có trần 60 ngày. Chỉ dùng để hỏi "video chạm trần này lẽ ra còn đang được GIỮ làm bằng
   * chứng không" (chuông báo trước khi xóa — services/pack-video/cap-notice.ts). Việc gán hạn KHÔNG bao giờ đặt cờ này.
   */
  ignoreCap?: boolean;
}

/**
 * Quyết định cho MỘT video đã lưu. `order` = null khi video chưa khớp đơn hoặc đơn không còn đọc được.
 * `now` = lúc xét (mốc của "kể từ lúc thấy hủy / thấy ca đóng" — luôn ≥ mốc thật nên chỉ giữ LÂU hơn).
 */
export function decideRetention(
  video: RetentionVideo,
  order: RetentionOrder | null,
  now: Date,
  opts: RetentionOptions = {}
): RetentionDecision {
  const today = vnDateKey(now);
  const rec = video.recordedDate;
  const plus3 = (key: string) => addDays(key, RETENTION_DAYS.AFTER_DEADLINE);
  const ignoreCap = opts.ignoreCap === true;
  const dated = (r: string, deleteAfter: string, rule: RetentionRule) => datedWithin(r, deleteAfter, rule, ignoreCap);
  const kept = (r: string, t: string, decision: RetentionDecision) => keptUntilCap(r, t, decision, ignoreCap);

  // Video chưa khớp đơn (hoặc có mã đơn mà đơn đã mất khỏi sổ).
  if (!video.orderId || !order) {
    // Video KHUI là bằng chứng hàng hoàn — chưa khớp đơn cũng không tự xóa sớm.
    if (video.kind === "UNBOX") return kept(rec, today, { kind: "HOLD", reason: "UNBOX_UNMATCHED" });
    // Có orderId mà không đọc được đơn → chờ, không xóa theo L1 (L1 chỉ cho video chưa từng khớp).
    if (video.orderId) return kept(rec, today, { kind: "WAIT" });
    return dated(rec, addDays(rec, RETENTION_DAYS.L1_UNMATCHED), "L1");
  }

  // Đơn hoàn — mọi dấu hiệu hoàn (kể cả chính video là video khui).
  if (video.kind === "UNBOX" || hasReturnSignal(order)) {
    // Kho báo hỏng = đang / sắp khiếu nại: video là bằng chứng đang dùng → GIỮ tới khi có kết quả (hoặc trần).
    if (order.returnStatus === "DAMAGED") return kept(rec, today, { kind: "HOLD", reason: "RETURN_DAMAGED" });
    if (returnCaseClosed(order)) {
      // Ca đóng: kiện quay đầu do hủy (không phải khách xin hoàn) là L3; còn lại L5.
      const parcelBackOnly =
        order.shippingStatus === "CANCELLED" &&
        order.returnRequestedAt === null &&
        order.refundedAmount <= 0 &&
        order.platformRefundAmount <= 0 &&
        order.returnSolution === null &&
        order.returnStatus === "RECEIVED_INTACT";
      // Mốc ca đóng: kho nhận kiện (returnedAt) nếu có, nhưng không sớm hơn hôm nay — sổ không ghi lúc khiếu
      // nại có kết quả, nên "kể từ lúc thấy ca đóng" là mốc an toàn.
      const closedKey = order.returnedAt ? maxKey(vnDateKey(order.returnedAt), today) : today;
      return dated(rec, plus3(closedKey), parcelBackOnly ? "L3" : "L5");
    }
    // Ca còn mở: có hạn khiếu nại ĐÃ CHỐT thì xóa sau hạn 3 ngày; hạn chưa bắt đầu / mới là hạn tạm → GIỮ.
    const due = order.complaintDue;
    if (due.state === "DUE" && !due.provisional) return dated(rec, plus3(vnDateKey(due.dueAt)), "L7");
    return kept(rec, today, { kind: "HOLD", reason: "RETURN_OPEN" });
  }

  // Không dấu hiệu hoàn.
  if (order.shippingStatus === "CANCELLED") {
    // Kiện đã rời kho mà đơn hủy → kiện đang quay đầu, chờ kho nhận — không xóa.
    if (leftWarehouse(order)) return kept(rec, today, { kind: "HOLD", reason: "PARCEL_RETURNING" });
    // L2 hủy ngang. Không có cột "hủy lúc nào" → tính từ lúc thấy hủy (hôm nay), chậm hơn mốc thật.
    return dated(rec, addDays(today, RETENTION_DAYS.L2_CANCELLED_IN_WAREHOUSE), "L2");
  }

  if (order.shippingStatus === "DELIVERED" && order.deliveredAt) {
    const window =
      order.platform === "LAZADA" ? RETENTION_DAYS.BUYER_RETURN_WINDOW_LAZADA : RETENTION_DAYS.BUYER_RETURN_WINDOW;
    return dated(rec, plus3(addDays(vnDateKey(order.deliveredAt), window)), "L4");
  }

  // Đang xử lý / đang giao / đã giao mà thiếu mốc giao → chờ sàn báo tiếp (tới trần).
  return kept(rec, today, { kind: "WAIT" });
}

/**
 * Luật tính hạn từ "lúc THẤY" (hôm nay) chứ không từ một mốc cố định của đơn. Lúc tới hạn mà tính lại thì luôn
 * ra ngày muộn hơn → người gọi KHÔNG được coi đó là "hạn dời" (không thì dời mãi).
 */
export function isSeenAnchoredRule(rule: string | null | undefined): boolean {
  return rule === "L2" || rule === "L3" || rule === "L5";
}

/** Tới ngày xóa chưa (so theo ngày lịch VN). */
export function isDue(deleteAfter: string, now: Date): boolean {
  return deleteAfter <= vnDateKey(now);
}
