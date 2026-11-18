// ============================================================
// VIDEO ĐÓNG HÀNG — LUẬT GIỮ / TỰ XÓA theo TRẠNG THÁI ĐƠN (lát W5, 18/11/2026)
// HÀM THUẦN: không gọi database, không gọi mạng, không đọc đồng hồ (giờ "bây giờ" do người gọi đưa vào).
//
// Anh Trung chốt 14/11 (tài liệu khảo sát mục 54): "lưu tới qua hạn khiếu nại… hệ thống tự xóa video các
// đơn hàng hủy, hủy ngang, đã đối soát, hết hạn khiếu nại". Bảng luật = mục 12.2 + 54.2 tài liệu khảo sát:
//
//   L1  video ĐÓNG HÀNG không khớp được đơn nào          → xóa ở ngày quay + 3 ngày
//   L2  đơn hủy khi kiện CHƯA rời kho (hủy ngang)        → xóa sau 1 ngày kể từ lúc thấy hủy
//   L3  đơn hủy khi kiện ĐÃ rời kho (kiện quay đầu)      → giữ tới khi kho nhận kiện nguyên vẹn + 7 ngày
//   L4  đã giao, không có dấu hiệu hoàn                  → xóa ở ngày giao + 20 ngày (Lazada + 35)
//   L5  có BẤT KỲ dấu hiệu hoàn nào                      → CHẶN xóa; ca đóng (kho nhập nguyên vẹn /
//                                                           khiếu nại xong) mới tính + 10 ngày
//   L6  trần cứng                                        → không quá ngày quay + 90 (Shopee DPP 10.6)
//   L7  shop tắt tính năng / hết giờ                     → không đổi gì: video có sẵn đi tiếp L1–L6
//   —   "đã đối soát" KHÔNG phải mốc xóa (mục 12.1, 54.3)
//
// Nguyên tắc an toàn (mọi chỗ nghi ngờ đều nghiêng về GIỮ):
//  · Mọi dấu hiệu hoàn đều chặn xóa: returnStatus ≠ NONE, có mốc xin hoàn / kiện hoàn về / kho nhận, có
//    tiền hoàn thật hoặc sàn báo tiền hoàn, sàn có trạng thái hoàn, có giải pháp hoàn, hoặc chính video là
//    video KHUI hàng hoàn. Riêng mốc xin hoàn thiếu ở ≈ 86 % đơn có hoàn (mục 8) nên KHÔNG dựa một cờ.
//  · Ca hoàn ĐANG MỞ thì không có hạn xóa, kể cả trần 90 ngày (lời dặn lịch 18/11: "mọi dấu hiệu hoàn đều
//    CHẶN xóa"). Mục 54.4 lại ghi "trần 90 ngày vẫn áp cho video đang giữ" → hai câu vênh nhau, để anh
//    quyết (docs/VIDEO-DONG-HANG-THIET-KE.md mục 19.9). Bây giờ chạy bóng nên chưa xóa gì.
//  · Dữ liệu không đủ chắc (chưa rõ kiện đã rời kho chưa, sàn chưa báo giao) → CHỜ, không đoán.
//  · Không nhận ra được gian LazMall (sổ không có cờ) → MỌI gian Lazada dùng mốc LazMall 35 ngày.
//  · Hạn xóa tính theo NGÀY LỊCH giờ Việt Nam (cột deleteAfter là DATE). Xóa vào ngày deleteAfter hoặc sau.
//
// Số ngày: 3 / 1 / 7 / 10 là số EM TỰ CHỌN (mục 12.2); 20 = 15 ngày người mua được xin hoàn + 5 ngày biên
// (prod tháng 10 có ca 16,2 ngày Shopee — mục 16.5); 35 = 30 ngày LazMall + 5; 90 = Shopee DPP 10.6.
// ============================================================

/** Số ngày của từng luật — một chỗ để đổi, test đọc cùng hằng số. */
export const RETENTION_DAYS = {
  L1_UNMATCHED: 3,
  L2_CANCELLED_IN_WAREHOUSE: 1,
  L3_RETURNED_TO_SENDER: 7,
  L4_AFTER_DELIVERY: 20,
  L4_AFTER_DELIVERY_LAZADA: 35,
  L5_AFTER_CASE_CLOSED: 10,
  L6_HARD_CAP: 90,
} as const;

export type RetentionRule = "L1" | "L2" | "L3" | "L4" | "L5" | "L6";

/** Lý do GIỮ — ghi vào cột holdReason (chữ ngắn, máy đọc; web đổi ra câu tiếng Việt). */
export type HoldReason =
  | "RETURN_OPEN" // có dấu hiệu hoàn, ca chưa đóng
  | "RETURN_DAMAGED" // kho báo hỏng / mất / tráo — chờ khiếu nại
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

/** Có BẤT KỲ dấu hiệu hoàn nào không (L5). */
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

/** Đơn hủy mà kiện đã rời kho / đã từng tới tay người mua (kiện quay đầu, L3). */
function leftWarehouse(o: RetentionOrder): boolean {
  return o.stockShippedAt !== null || o.deliveredAt !== null;
}

function capped(recordedDate: string, deleteAfter: string, rule: RetentionRule): RetentionDecision {
  const cap = addDays(recordedDate, RETENTION_DAYS.L6_HARD_CAP);
  return deleteAfter > cap
    ? { kind: "DELETE_AFTER", deleteAfter: cap, rule: "L6" }
    : { kind: "DELETE_AFTER", deleteAfter, rule };
}

/**
 * Quyết định cho MỘT video đã lưu. `order` = null khi video chưa khớp đơn hoặc đơn không còn đọc được.
 * `now` = lúc xét (mốc của "kể từ lúc thấy hủy / thấy ca đóng" — luôn ≥ mốc thật nên chỉ giữ LÂU hơn).
 */
export function decideRetention(
  video: RetentionVideo,
  order: RetentionOrder | null,
  now: Date
): RetentionDecision {
  const today = vnDateKey(now);

  // Video chưa khớp đơn (hoặc có mã đơn mà đơn đã mất khỏi sổ).
  if (!video.orderId || !order) {
    // Video KHUI là bằng chứng hàng hoàn — chưa khớp đơn cũng không tự xóa sớm.
    if (video.kind === "UNBOX") return { kind: "HOLD", reason: "UNBOX_UNMATCHED" };
    // Có orderId mà không đọc được đơn → chờ, không xóa theo L1 (L1 chỉ cho video chưa từng khớp).
    if (video.orderId) return { kind: "WAIT" };
    return capped(video.recordedDate, addDays(video.recordedDate, RETENTION_DAYS.L1_UNMATCHED), "L1");
  }

  // L5 — mọi dấu hiệu hoàn (kể cả chính video là video khui) đều chặn xóa cho tới khi ca đóng.
  if (video.kind === "UNBOX" || hasReturnSignal(order)) {
    if (order.returnStatus === "DAMAGED") return { kind: "HOLD", reason: "RETURN_DAMAGED" };
    if (!returnCaseClosed(order)) return { kind: "HOLD", reason: "RETURN_OPEN" };
    // Ca đóng: kiện quay đầu do hủy (không phải khách xin hoàn) dùng L3 + 7; còn lại L5 + 10.
    const parcelBackOnly =
      order.shippingStatus === "CANCELLED" &&
      order.returnRequestedAt === null &&
      order.refundedAmount <= 0 &&
      order.platformRefundAmount <= 0 &&
      order.returnSolution === null &&
      order.returnStatus === "RECEIVED_INTACT";
    const rule: RetentionRule = parcelBackOnly ? "L3" : "L5";
    const days = parcelBackOnly ? RETENTION_DAYS.L3_RETURNED_TO_SENDER : RETENTION_DAYS.L5_AFTER_CASE_CLOSED;
    // Mốc ca đóng: kho nhận kiện (returnedAt) nếu có, nhưng không sớm hơn hôm nay — sổ không ghi lúc khiếu
    // nại có kết quả, nên "kể từ lúc thấy ca đóng" là mốc an toàn.
    const closedKey = order.returnedAt ? maxKey(vnDateKey(order.returnedAt), today) : today;
    return capped(video.recordedDate, addDays(closedKey, days), rule);
  }

  // Không dấu hiệu hoàn.
  if (order.shippingStatus === "CANCELLED") {
    // Kiện đã rời kho mà đơn hủy → kiện đang quay đầu, chờ kho nhận (L3) — không xóa.
    if (leftWarehouse(order)) return { kind: "HOLD", reason: "PARCEL_RETURNING" };
    // L2 hủy ngang. Không có cột "hủy lúc nào" → tính từ lúc thấy hủy (hôm nay), chậm hơn mốc thật.
    return capped(video.recordedDate, addDays(today, RETENTION_DAYS.L2_CANCELLED_IN_WAREHOUSE), "L2");
  }

  if (order.shippingStatus === "DELIVERED" && order.deliveredAt) {
    const days =
      order.platform === "LAZADA" ? RETENTION_DAYS.L4_AFTER_DELIVERY_LAZADA : RETENTION_DAYS.L4_AFTER_DELIVERY;
    return capped(video.recordedDate, addDays(vnDateKey(order.deliveredAt), days), "L4");
  }

  // Đang xử lý / đang giao / đã giao mà thiếu mốc giao → chờ sàn báo tiếp.
  return { kind: "WAIT" };
}

function maxKey(a: string, b: string): string {
  return a >= b ? a : b;
}

/** Tới ngày xóa chưa (so theo ngày lịch VN). */
export function isDue(deleteAfter: string, now: Date): boolean {
  return deleteAfter <= vnDateKey(now);
}
