/**
 * HỢP ĐỒNG CHUNG CHO MỌI NHÀ CUNG CẤP HÓA ĐƠN ĐIỆN TỬ (Multi-Vendor).
 *
 * Mỗi NCC (MISA / BKAV / Viettel…) là một adapter cài `InvoiceProvider`. Code
 * nghiệp vụ CHỈ được gọi qua interface này — không import thẳng adapter — để
 * thêm NCC mới chỉ là thêm một file + một dòng đăng ký ở index.ts, không phải
 * sửa chỗ phát hành hóa đơn.
 *
 * Trạng thái trả về dùng chung enum InvoiceLogStatus của Prisma để ghi thẳng
 * vào bảng InvoiceLog, khỏi phải map qua lại hai bộ trạng thái.
 */

import type { InvoiceLogStatus } from "@prisma/client";

/**
 * Một dòng hàng hóa trên hóa đơn.
 *
 * QUY ƯỚC TIỀN (đổi 24/08 — anh Trung chốt BÓC NGƯỢC sau khảo sát Salework +
 * chuẩn kế toán TMĐT): giá bán trên sàn là giá ĐÃ GỒM thuế GTGT (giá khách
 * trả), nơi dựng dòng (issue-order.buildInvoiceLines) bóc ngược ra tiền chưa
 * thuế + tiền thuế sao cho amountWithoutVat + vatAmount = ĐÚNG số khách trả
 * từng dòng. Adapter NCC dùng THẲNG hai số này, không tự suy lại từ
 * unitPrice × quantity (nhân lại là lệch làm tròn).
 */
export interface InvoiceLine {
  /** Tên hàng hóa IN TRÊN HÓA ĐƠN — ưu tiên Product.taxName, fallback tên bán. */
  name: string;
  sku: string;
  quantity: number;
  /** Đơn giá CHƯA thuế (bóc từ giá bán — có thể lẻ 2 số thập phân khi SL>1). */
  unitPrice: number;
  /** % thuế suất GTGT đầu ra của dòng: 0 / 5 / 8 / 10 (SKU khai riêng, fallback defaultVatRate của shop). */
  vatRate: number;
  /** Thành tiền CHƯA thuế của dòng (VND nguyên) — số liệu chính của payload. */
  amountWithoutVat: number;
  /** Tiền thuế GTGT dòng = giá khách trả − amountWithoutVat. */
  vatAmount: number;
}

/** Dữ liệu cần để phát hành một hóa đơn cho một đơn hàng. */
export interface CreateInvoiceInput {
  /** Mã đơn hàng nội bộ — NCC lưu làm số tham chiếu, dùng đối soát 2 chiều. */
  orderCode: string;
  buyerName: string;
  /** Họ tên NGƯỜI ĐẶT khi mua danh nghĩa công ty — in dòng "Họ tên người mua hàng". */
  buyerContactName?: string;
  /** MST người mua (công ty/hộ KD) hoặc số định danh cá nhân — trống với khách lẻ. */
  buyerTaxCode?: string;
  /** Địa chỉ người mua — bắt buộc kèm khi xuất theo đơn vị (BuyerLegalName). */
  buyerAddress?: string;
  /** Email người mua — NCC gửi hóa đơn điện tử về địa chỉ này. */
  buyerEmail?: string;
  lines: InvoiceLine[];
  /** Tổng tiền hàng đã gồm thuế (đối chiếu với tổng tính từ lines). */
  totalAmount: number;
}

/** Kết quả một thao tác với NCC — dùng chung cho cả create/cancel/checkStatus. */
export interface InvoiceResult {
  status: InvoiceLogStatus;
  /** Số hóa đơn NCC cấp (chỉ có khi đã phát hành). */
  invoiceNo?: string;
  /** Mã giao dịch phía NCC — giữ lại để checkStatus/cancel về sau. */
  transactionId?: string;
  /** Tiền thuế GTGT đầu ra NCC tính. */
  vatAmount?: number;
  /** Thông điệp lỗi khi status = FAILED. */
  errorMessage?: string;
}

/** Thông tin kết nối đọc từ bảng InvoiceConfig của shop. */
export interface ProviderCredentials {
  clientId: string | null;
  secretKey: string | null;
  /** API key riêng theo gian hàng (nếu shop cấu hình). */
  apiKey: string | null;
  /** Endpoint tùy biến — chỉ dùng khi provider = CUSTOM. */
  customApiUrl: string | null;
  /** Mã đại lý ISV của Hubsell — NCC ghi nhận hoa hồng theo mã này. */
  partnerCode: string | null;
}

/**
 * Interface mọi adapter NCC hóa đơn phải cài đủ.
 *
 * Cả 3 phương thức đều KHÔNG được ném lỗi vì sự cố nghiệp vụ (NCC từ chối,
 * sai MST…) — trả `status: FAILED` + errorMessage để nơi gọi ghi log và hiển
 * thị; chỉ ném khi lỗi lập trình thật sự (thiếu tham số bắt buộc).
 */
export interface InvoiceProvider {
  /** Tên định danh khớp cột InvoiceConfig.provider: "MISA" | "BKAV" | … */
  readonly name: string;

  /** Gửi yêu cầu phát hành hóa đơn cho một đơn hàng. */
  createInvoice(input: CreateInvoiceInput): Promise<InvoiceResult>;

  /** Hủy một hóa đơn đã phát hành (theo transactionId NCC cấp lúc tạo). */
  cancelInvoice(transactionId: string, reason: string): Promise<InvoiceResult>;

  /** Tra trạng thái hiện tại của một hóa đơn phía NCC. */
  checkStatus(transactionId: string): Promise<InvoiceResult>;
}
