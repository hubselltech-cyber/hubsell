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
import { explainInvoiceError } from "./invoice-errors";
import { clearMisaTokenCache } from "./misa-auth";
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
        errorScope: "ACCOUNT",
        errorCode: "HUBSELL_POS_NOT_SUPPORTED",
        errorMessage:
          "Luồng hóa đơn máy tính tiền (POS) chưa được nối API — tạm chọn luồng Kê khai ở trang Kết nối & Xuất hóa đơn.",
      };
    }
    const missing = standardConfigMissing(this.cfg);
    if (missing.length > 0) {
      return {
        status: InvoiceLogStatus.FAILED,
        errorScope: "ACCOUNT",
        errorCode: "HUBSELL_CONFIG_MISSING",
        errorMessage: `Chưa đủ cấu hình phát hành — thiếu: ${missing.join(", ")}. Vào Kết nối & Xuất hóa đơn để bổ sung.`,
      };
    }

    try {
      const result = await this.publishWithRetry(input);
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
      const recovered = await this.recoverDuplicate(input, err);
      if (recovered) return recovered;
      // Dịch mã lỗi NCC ra VIỆC CẦN LÀM + phân tầm ảnh hưởng (invoice-errors.ts)
      // — worker tự động dựa vào errorScope để ngắt mạch thay vì đốt cả lô.
      const explained = explainInvoiceError(err);
      // Token bị MISA thu hồi trước hạn (đổi mật khẩu…) → bỏ cache để lượt sau
      // đăng nhập lại thay vì cầm token chết tới hết 14 ngày.
      if (explained.code === "TokenExpiredCode" || explained.code === "InvalidTokenCode") {
        clearMisaTokenCache();
      }
      return {
        status: InvoiceLogStatus.FAILED,
        errorMessage: explained.message,
        errorCode: explained.code ?? undefined,
        errorScope: explained.scope,
      };
    }
  }

  /**
   * MISA báo TRÙNG mã đơn = hóa đơn ĐÃ phát hành ở lần trước nhưng Hubsell không
   * nhận được kết quả (đứt mạng / server restart giữa chừng) → log kẹt FAILED,
   * ngày nào worker cũng thử lại và ngày nào cũng trùng, còn seller không thấy số
   * hóa đơn nên dễ lập tay thêm một tờ. Tra ngược theo RefID: tờ đó còn sống thì
   * NỐI LẠI vào log như một lần phát hành thành công; đã bị xóa/hủy bên MISA hoặc
   * tra không ra thì để nguyên lỗi cho seller tự quyết.
   */
  private async recoverDuplicate(
    input: CreateInvoiceInput,
    err: unknown
  ): Promise<InvoiceResult | null> {
    const code = explainInvoiceError(err).code;
    if (code !== "InvoiceDuplicated" && code !== "DuplicateInvoiceRefID") return null;
    try {
      const [found] = await getInvoiceStatuses([input.orderCode], this.cfg, "refId");
      if (!found || found.isDeleted || found.publishStatus !== 1) return null;
      if (!found.transactionId || !found.invoiceNo) return null;
      return {
        status: InvoiceLogStatus.ISSUED,
        invoiceNo: found.invoiceNo,
        transactionId: found.transactionId,
        vatAmount: input.lines.reduce((s, l) => s + l.vatAmount, 0),
      };
    } catch {
      return null; // tra không được thì rơi về thông điệp lỗi trùng như cũ
    }
  }

  /**
   * Tài liệu meInvoice ("Lưu ý khi bắt đầu") yêu cầu RETRY với lỗi cấp số
   * InvoiceNumberNotCotinuous: MISA cấp số liên tục theo ký hiệu, một hóa đơn
   * khác (seller lập tay trên meInvoice, hoặc instance khác) đang giữ số là bị
   * từ chối. Thử lại ĐÚNG 1 lần sau 2 giây — RefID chống trùng phía MISA nên
   * retry không thể sinh 2 hóa đơn; còn lỗi nữa thì trả về để lượt sau xử lý.
   */
  private async publishWithRetry(input: CreateInvoiceInput) {
    try {
      return await publishStandardInvoice(input, this.cfg);
    } catch (err) {
      if (explainInvoiceError(err).code !== "InvoiceNumberNotCotinuous") throw err;
      await new Promise((r) => setTimeout(r, 2000));
      return publishStandardInvoice(input, this.cfg);
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
