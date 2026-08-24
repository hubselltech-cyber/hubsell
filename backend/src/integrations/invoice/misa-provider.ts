/**
 * ADAPTER MISA meInvoice — GỌI API THẬT (nối 23/08/2026 sau khi thông sandbox).
 *
 * Nhận NGUYÊN ROW InvoiceConfig của shop (không chỉ cặp khóa) vì phát hành cần
 * đủ MST/ký hiệu/mẫu số/signMethod. Luồng hiện nối là KÊ KHAI (STANDARD,
 * SignType 2 — HSM meInvoice ký nền); luồng máy tính tiền (POS) chưa nối —
 * trả FAILED với lời nhắn rõ thay vì phát hành sai loại.
 *
 * Theo hợp đồng InvoiceProvider: KHÔNG ném lỗi nghiệp vụ — mọi từ chối/lỗi API
 * (kể cả chốt an toàn MISA_ALLOW_PUBLISH của misa-safety.ts) trả về
 * status FAILED + errorMessage để nơi gọi ghi InvoiceLog và hiển thị.
 */

import { InvoiceLogStatus } from "@prisma/client";
import {
  downloadInvoiceFiles,
  getInvoiceStatuses,
  publishStandardInvoice,
  standardConfigMissing,
  type StandardInvoiceConfig,
} from "./misa-einvoice";
import type {
  CreateInvoiceInput,
  InvoiceProvider,
  InvoiceResult,
} from "./types";

/**
 * Lát cắt InvoiceConfig adapter cần — khớp row Prisma, khai structural để
 * test/dev truyền object thường không cần Prisma type.
 */
export interface MisaProviderConfig extends StandardInvoiceConfig {
  defaultInvoiceType: string; // STANDARD | POS
}

export class MisaInvoiceProvider implements InvoiceProvider {
  readonly name = "MISA";

  constructor(private cfg: MisaProviderConfig) {}

  async createInvoice(input: CreateInvoiceInput): Promise<InvoiceResult> {
    if (this.cfg.defaultInvoiceType === "POS") {
      return {
        status: InvoiceLogStatus.FAILED,
        errorMessage:
          "Luồng hóa đơn máy tính tiền (POS) chưa được nối API — tạm chọn luồng Kê khai ở trang Kết nối & Xuất hóa đơn.",
      };
    }
    const missing = standardConfigMissing(this.cfg);
    if (missing.length > 0) {
      return {
        status: InvoiceLogStatus.FAILED,
        errorMessage: `Chưa đủ cấu hình phát hành — thiếu: ${missing.join(", ")}. Vào Kết nối & Xuất hóa đơn để bổ sung.`,
      };
    }

    try {
      const result = await publishStandardInvoice(input, this.cfg);
      // Tiền thuế lấy THẲNG từ InvoiceLine.vatAmount (đã bóc ngược, đúng số
      // in trên hóa đơn) — KHÔNG nhân lại unitPrice × SL × % (lệch 1đ làm tròn
      // so với chứng từ, đã dính ở HĐ 00000060: log 14.298 vs PDF 14.299).
      const vatAmount = input.lines.reduce((s, l) => s + l.vatAmount, 0);
      return {
        status: InvoiceLogStatus.ISSUED,
        invoiceNo: result.invoiceNo ?? undefined,
        transactionId: result.transactionId ?? undefined,
        vatAmount,
      };
    } catch (err) {
      return {
        status: InvoiceLogStatus.FAILED,
        errorMessage: (err as Error).message,
      };
    }
  }

  /**
   * meInvoice Open API CHƯA có endpoint hủy hóa đơn (khảo sát tài liệu portal
   * 23/08/2026 — chỉ có sendemail/status/publishview/Download/voucher-paper/
   * paging). Hủy phải thao tác trên app3.meinvoice.vn; trạng thái hủy sẽ về
   * Hubsell qua webhook hoặc checkStatus (IsDelete=true).
   */
  async cancelInvoice(
    transactionId: string,
    _reason: string
  ): Promise<InvoiceResult> {
    return {
      status: InvoiceLogStatus.FAILED,
      transactionId,
      errorMessage:
        "meInvoice chưa hỗ trợ hủy hóa đơn qua API — vui lòng hủy trực tiếp trên meInvoice (app3.meinvoice.vn), Hubsell sẽ tự cập nhật trạng thái.",
    };
  }

  async checkStatus(transactionId: string): Promise<InvoiceResult> {
    try {
      const [item] = await getInvoiceStatuses([transactionId], this.cfg);
      if (!item) {
        return {
          status: InvoiceLogStatus.FAILED,
          transactionId,
          errorMessage: "meInvoice không tìm thấy hóa đơn theo mã tra cứu này.",
        };
      }
      if (item.isDeleted) {
        return { status: InvoiceLogStatus.CANCELLED, transactionId };
      }
      if (item.publishStatus === 1) {
        return { status: InvoiceLogStatus.ISSUED, transactionId };
      }
      return { status: InvoiceLogStatus.PENDING, transactionId };
    } catch (err) {
      return {
        status: InvoiceLogStatus.FAILED,
        transactionId,
        errorMessage: (err as Error).message,
      };
    }
  }

  /** Tải bản thể hiện PDF (base64, đã ký HSM) — cho nút tải trên UI sau này. */
  async downloadPdf(transactionId: string): Promise<string | null> {
    const [file] = await downloadInvoiceFiles([transactionId], "Pdf", this.cfg);
    return file?.errorCode ? null : (file?.data ?? null);
  }
}
