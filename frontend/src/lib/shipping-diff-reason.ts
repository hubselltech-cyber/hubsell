/**
 * Nhãn khách đọc cho NGUYÊN NHÂN lệch phí vận chuyển — khớp mã backend
 * `lib/shipping-diff-reason.ts` (31/10/2026). Chỉ nhóm `claimable` là ca đòi
 * lại được; phần còn lại là chi phí ship shop chịu theo chính sách sàn.
 */
export type ShippingDiffReason =
  | "FEE_MISMATCH"
  | "LOGISTICS_SURCHARGE"
  | "AWAITING_STATEMENT"
  | "CANCELLED_AFTER_SHIP"
  | "CUSTOMER_RETURN"
  | "SHOP_FREESHIP"
  | "SHOP_BEARS_SHIPPING"
  | "OVER_PLATFORM_SUBSIDY"
  | "OTHER";

export const SHIPPING_DIFF_REASON_META: Record<
  ShippingDiffReason,
  { label: string; hint: string; claimable: boolean }
> = {
  FEE_MISMATCH: {
    label: "Cước thực tế cao hơn cước báo",
    hint: "Sàn tính cước theo cân nặng / kích thước thực tế cao hơn cước báo lúc đặt. Đây là ca khiếu nại đòi lại được — xuất file gửi sàn.",
    claimable: true,
  },
  LOGISTICS_SURCHARGE: {
    label: "Phụ phí vận chuyển",
    hint: "Sàn tính thêm phí bảo hiểm, ký nhận, vùng xa, cồng kềnh… Khiếu nại được nếu shop không đăng ký dịch vụ đó.",
    claimable: true,
  },
  AWAITING_STATEMENT: {
    label: "Chờ sao kê",
    hint: "Sàn chưa trả bản kê quyết toán, số đang là ước tính. Đối soát lại khi có sao kê.",
    claimable: true,
  },
  CANCELLED_AFTER_SHIP: {
    label: "Đơn hủy sau khi gửi",
    hint: "Khách hủy hoặc giao không thành công sau khi kiện đã rời kho → sàn thu cước chiều đi (và chiều về nếu có). Theo chính sách sàn, không khiếu nại; nếu lỗi do đơn vị vận chuyển thì khiếu nại ở mục Giao hàng của sàn.",
    claimable: false,
  },
  CUSTOMER_RETURN: {
    label: "Khách trả hàng",
    hint: "Đơn Trả hàng / Hoàn tiền: shop chịu cước cả chiều đi lẫn chiều về, trừ phần sàn bồi nếu có. Theo chính sách sàn, không khiếu nại.",
    claimable: false,
  },
  SHOP_FREESHIP: {
    label: "Shop tự trợ giá ship",
    hint: "Voucher freeship do shop phát — shop chịu phần này. Không khiếu nại.",
    claimable: false,
  },
  SHOP_BEARS_SHIPPING: {
    label: "Shop chịu cước",
    hint: "Khách được miễn ship và sàn không trợ giá đơn này → shop trả trọn cước. Không khiếu nại.",
    claimable: false,
  },
  OVER_PLATFORM_SUBSIDY: {
    label: "Cước vượt mức sàn trợ",
    hint: "Sàn trợ ship có trần, phần cước vượt trần shop chịu. Không khiếu nại.",
    claimable: false,
  },
  OTHER: {
    label: "Khác",
    hint: "Chưa xếp được vào nhóm nào — xem chi tiết thanh toán của đơn trên sàn.",
    claimable: false,
  },
};

/** Thứ tự hiện trong bộ lọc: ca đòi được trước, chính sách sàn sau. */
export const SHIPPING_DIFF_REASON_ORDER: ShippingDiffReason[] = [
  "FEE_MISMATCH",
  "LOGISTICS_SURCHARGE",
  "AWAITING_STATEMENT",
  "CANCELLED_AFTER_SHIP",
  "CUSTOMER_RETURN",
  "SHOP_FREESHIP",
  "SHOP_BEARS_SHIPPING",
  "OVER_PLATFORM_SUBSIDY",
  "OTHER",
];

/** Giá trị gửi lên `?reason=`: hai nhóm gộp + từng mã. */
export type ShippingDiffReasonFilter = "CLAIMABLE" | "POLICY" | "" | ShippingDiffReason;

export function shippingDiffReasonLabel(reason: ShippingDiffReason | undefined): string {
  return reason ? SHIPPING_DIFF_REASON_META[reason].label : "—";
}

// ------------------------------------------------------------
// TÁCH TIỀN một đơn lệch + cờ "có bảo đảm, vẫn lệch" (13/11/2026) — khớp backend
// `lib/shipping-diff-parts.ts`. Nhãn nguyên nhân là MỘT nhãn cho cả đơn; phần này nói trong số
// tiền shop chịu có bao nhiêu là chiều đi, chiều về, phụ phí và sàn đã bồi lại bao nhiêu.
// ------------------------------------------------------------

/** Tiền DƯƠNG theo góc shop chịu; riêng `reimbursed` là tiền sàn trả lại. Hiện mới tách được đơn TikTok. */
export interface ShipDiffParts {
  outbound: number;
  returnLeg: number;
  surcharge: number;
  reimbursed: number;
  other: number;
}

const SHIP_DIFF_PART_META: { key: keyof ShipDiffParts; short: string; label: string; hint: string }[] = [
  { key: "outbound", short: "Chiều đi", label: "Cước chiều đi", hint: "cước giao đi sau khi trừ phần khách trả và sàn trợ" },
  { key: "returnLeg", short: "Chiều về", label: "Cước chiều về", hint: "cước kiện quay về của đơn trả hàng" },
  { key: "surcharge", short: "Phụ phí", label: "Phụ phí vận chuyển", hint: "quá cân, quá khổ, bảo hiểm, vùng xa…" },
  { key: "reimbursed", short: "Sàn bồi", label: "Sàn bồi lại", hint: "giao thất bại, trả hàng, Bảo đảm phí vận chuyển" },
  { key: "other", short: "Khác", label: "Khoản khác", hint: "điều chỉnh phí ship hoặc khoản sàn chưa đặt tên" },
];

export interface ShipDiffPartEntry {
  key: keyof ShipDiffParts;
  short: string;
  label: string;
  hint: string;
  /** Có dấu theo góc shop: dương = shop chịu, âm = được trả lại. Σ các dòng = số "Bị trừ thêm" của đơn. */
  amount: number;
}

/** Các phần CÓ tiền của một đơn, theo thứ tự cố định; tiền sàn bồi mang dấu âm. */
export function shipDiffPartEntries(parts: ShipDiffParts | null | undefined): ShipDiffPartEntry[] {
  if (!parts) return [];
  return SHIP_DIFF_PART_META.map((m) => ({
    ...m,
    amount: m.key === "reimbursed" ? -parts.reimbursed : parts[m.key],
  })).filter((e) => e.amount !== 0);
}

/** Cột Excel của từng phần (mọi phần, kể cả 0) — cùng thứ tự + dấu với màn hình. */
export const SHIP_DIFF_PART_COLUMNS: { key: keyof ShipDiffParts; label: string }[] = SHIP_DIFF_PART_META.map((m) => ({
  key: m.key,
  label: m.label,
}));

/**
 * Đơn hủy sau khi gửi / khách trả hàng ĐÃ TRẢ phí Bảo đảm phí vận chuyển mà shop vẫn chịu thêm.
 * Chỉ là dấu hiệu nên kiểm tra: Hubsell chưa biết điều khoản chương trình nên không ghi "đòi được".
 */
export type ShipGuaranteeGap = "NOT_REIMBURSED" | "PARTIAL";

export const SHIP_GUARANTEE_GAP_LABEL = "Có bảo đảm, vẫn lệch";

export const SHIP_GUARANTEE_GAP_META: Record<ShipGuaranteeGap, { label: string; hint: string }> = {
  NOT_REIMBURSED: {
    label: "Có bảo đảm · chưa được bồi",
    hint: "Đơn này đã trả phí Bảo đảm phí vận chuyển nhưng bản kê chưa có khoản sàn bồi nào. Nên mở chi tiết thanh toán của đơn trên sàn để kiểm tra — Hubsell chưa xác định được đơn có thuộc diện được bồi hay không.",
  },
  PARTIAL: {
    label: "Có bảo đảm · bồi chưa đủ",
    hint: "Đơn này đã trả phí Bảo đảm phí vận chuyển và được sàn bồi một phần, shop vẫn chịu phần còn lại. Nên kiểm tra mức bồi của đơn trên sàn.",
  },
};
