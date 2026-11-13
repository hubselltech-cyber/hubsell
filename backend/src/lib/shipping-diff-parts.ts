import type { ShippingDiffReason, TiktokShipCols } from "./shipping-diff-reason";

/**
 * TÁCH TIỀN lệch phí vận chuyển của MỘT đơn thành các thành phần (khảo sát 13/11/2026, docs
 * DOI-SOAT-PHI-SHIP-NGUYEN-NHAN-KHAO-SAT-31-10.md mục 8).
 *
 * Nhãn nguyên nhân (`classifyShippingDiff`) là MỘT nhãn cho cả đơn; đơn trả hàng vì thế nuốt luôn
 * cước chiều đi, phụ phí và tiền sàn bù vào chữ "Khách trả hàng". Hàm này trả lời câu tiếp theo:
 * trong số tiền shop chịu, bao nhiêu là chiều đi, chiều về, phụ phí, và sàn đã bù lại bao nhiêu.
 *
 * Chỉ TikTok: bản kê có đủ cột có dấu (prod 13/11: Σ cột = shipping_cost_amount ở mọi nhóm đã đo).
 * Shopee chưa lưu cước chiều hoàn, Lazada chưa đối chiếu công thức trên số thật → null (một dòng như cũ).
 */
export interface TiktokShipPartCols extends TiktokShipCols {
  /** Phí vận chuyển thực tế chiều đi (âm = sàn trừ). */
  shipActual: number;
  /** Sàn bù lại trên phí ship (dương): trợ cấp giao hàng không thành công, trả hàng, tiền bồi gói Bảo đảm phí vận chuyển… — 9 khóa gộp, chưa tách. */
  shipReimbursement: number;
  /** Phí Bảo đảm phí vận chuyển shop trả cho đơn này (âm); 0 = không tham gia hoặc bản kê trước 29/10/2026. */
  feeShipGuarantee: number;
}

/** Mọi số là tiền DƯƠNG theo góc shop chịu, riêng `reimbursed` là tiền sàn trả lại. */
export interface ShipDiffParts {
  /** Cước chiều đi shop chịu = cước đi − khách trả − sàn trợ (+ voucher ship của shop). Âm = phần phủ dư. */
  outbound: number;
  /** Cước chiều về của đơn trả hàng. */
  returnLeg: number;
  /** Phụ phí logistics (quá cân, quá khổ, bảo hiểm, vùng xa…). */
  surcharge: number;
  /** Sàn bù lại (xem shipReimbursement) — phần lớn là trợ cấp sàn tự trả, KHÔNG riêng gói Bảo đảm. */
  reimbursed: number;
  /** Phần còn lại để tổng khớp (khoản ship chưa đặt tên, điều chỉnh phí ship). */
  other: number;
}

const cents = (n: number) => Math.round(n * 100);

/**
 * Bất biến: outbound + returnLeg + surcharge − reimbursed + other = diff (đúng từng xu).
 * null = không có bản kê TikTok hoặc bản kê không có cột ship nào khác 0 (không có gì để tách).
 */
export function splitShippingDiff(diff: number, t: TiktokShipPartCols | null | undefined): ShipDiffParts | null {
  if (!t) return null;
  const outbound = 0 - cents(t.shipActual + t.shipCustomerPaid + t.shipPlatformDiscount + t.shipSubsidy + t.shipSellerDiscount);
  const returnLeg = 0 - cents(t.shipReturn);
  const surcharge = 0 - cents(t.shipOther);
  const reimbursed = cents(t.shipReimbursement);
  if (outbound === 0 && returnLeg === 0 && surcharge === 0 && reimbursed === 0) return null;
  const other = cents(diff) - (outbound + returnLeg + surcharge - reimbursed);
  return {
    outbound: outbound / 100,
    returnLeg: returnLeg / 100,
    surcharge: surcharge / 100,
    reimbursed: reimbursed / 100,
    other: other / 100,
  };
}

/**
 * Đơn hủy sau khi gửi / khách trả hàng mà shop ĐÃ TRẢ phí Bảo đảm phí vận chuyển nhưng vẫn lệch:
 *   NOT_REIMBURSED — sàn chưa bù đồng nào;  PARTIAL — có bù nhưng không đủ (khoản bù có thể là trợ cấp giao thất bại, chưa chắc là tiền bồi của gói).
 * Chỉ là dấu hiệu "nên kiểm tra": Hubsell chưa biết điều khoản chương trình nên KHÔNG kết luận đòi được.
 */
export type ShipGuaranteeGap = "NOT_REIMBURSED" | "PARTIAL";

export function shipGuaranteeGap(
  reason: ShippingDiffReason,
  t: Pick<TiktokShipPartCols, "feeShipGuarantee" | "shipReimbursement"> | null | undefined
): ShipGuaranteeGap | null {
  if (!t || t.feeShipGuarantee >= 0) return null;
  if (reason !== "CANCELLED_AFTER_SHIP" && reason !== "CUSTOMER_RETURN") return null;
  return t.shipReimbursement > 0 ? "PARTIAL" : "NOT_REIMBURSED";
}
