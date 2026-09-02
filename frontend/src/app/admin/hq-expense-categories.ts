// DANH MỤC KHOẢN MỤC CHI của sổ quỹ HQ — nguồn nhãn duy nhất cho dialog phiếu
// chi, bảng sổ quỹ, cơ cấu chi theo khoản mục và file Excel. Bộ key phải khớp
// HQ_EXPENSE_CATEGORY_KEYS phía backend (admin.ts) — thêm khoản mục là sửa CẢ
// HAI nơi (cố ý không dùng enum DB để khỏi migration).
// `hint` là lưu ý CHỨNG TỪ/THUẾ cho người ghi sổ — hiện dưới ô chọn khoản mục;
// đây là gợi ý vận hành, quyết định hạch toán cuối cùng thuộc kế toán dịch vụ.

export interface HqExpenseCategory {
  key: string;
  label: string;
  /** Lưu ý chứng từ/thuế hiện trong dialog khi chọn khoản mục này. */
  hint?: string;
  /** true = không cho chọn khi ghi tay (bút toán tự sinh). */
  autoOnly?: boolean;
}

export const HQ_EXPENSE_CATEGORIES: HqExpenseCategory[] = [
  {
    key: "RENT",
    label: "Thuê văn phòng, mặt bằng",
    hint: "Giữ hợp đồng thuê + chứng từ CK. Thuê của cá nhân trên 100tr/năm: phải khấu trừ, nộp thay thuế cho chủ nhà.",
  },
  {
    key: "SALARY",
    label: "Lương & thù lao nhân viên",
    hint: "Kèm hợp đồng lao động + bảng lương có ký nhận — không cần hóa đơn nhưng thiếu bộ này sẽ bị loại chi phí.",
  },
  {
    key: "INSURANCE",
    label: "Bảo hiểm bắt buộc (BHXH·BHYT·BHTN)",
    hint: "Số tiền theo thông báo đóng hàng tháng của cơ quan BHXH — giữ thông báo làm chứng từ.",
  },
  {
    key: "SOFTWARE",
    label: "Phần mềm & hạ tầng (AI, server, domain)",
    hint: "NCC nước ngoài (Anthropic, Render, Supabase…) phát sinh THUẾ NHÀ THẦU — gom riêng khoản mục này để kế toán kê khai thay.",
  },
  { key: "MARKETING", label: "Marketing & quảng cáo" },
  { key: "BANK_FEE", label: "Phí ngân hàng & cổng thanh toán" },
  {
    key: "TAX_FEE",
    label: "Thuế, phí & lệ phí nhà nước",
    hint: "Môn bài, lệ phí ĐKKD, thuế nộp NSNN… — không có hóa đơn, giữ biên lai/giấy nộp tiền.",
  },
  { key: "EQUIPMENT", label: "Thiết bị & công cụ dụng cụ" },
  {
    key: "REFERRAL",
    label: "Hoa hồng giới thiệu",
    hint: "Tự sinh khi duyệt lệnh rút — không ghi tay.",
    autoOnly: true,
  },
  { key: "OTHER_EXPENSE", label: "Chi khác" },
];

export const HQ_EXPENSE_CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  HQ_EXPENSE_CATEGORIES.map((c) => [c.key, c.label])
);

/** Khoản mục hiển thị của một bút toán CHI — dòng cũ chưa phân loại và chi hoa
 *  hồng tự sinh đời đầu vẫn về đúng nhóm (cùng logic backend). */
export function displayExpenseCategory(entry: {
  expenseCategory: string | null;
  source: string;
}): string {
  if (entry.expenseCategory) return entry.expenseCategory;
  return entry.source === "REFERRAL_PAYOUT" ? "REFERRAL" : "OTHER_EXPENSE";
}

/** Ngưỡng Luật GTGT: mua vào từ 5 triệu trả TIỀN MẶT là mất quyền khấu trừ. */
export const CASH_DEDUCT_LIMIT = 5_000_000;
