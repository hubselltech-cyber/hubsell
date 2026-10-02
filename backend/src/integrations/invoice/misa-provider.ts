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
  type MisaInvoiceStatusItem,
  type StandardInvoiceConfig,
} from "./misa-einvoice";
import type {
  CreateInvoiceInput,
  InvoiceProvider,
  InvoiceResult,
  ProviderCapabilities,
  ReferenceLookup,
} from "./types";

/**
 * Lát cắt InvoiceConfig adapter cần — khớp row Prisma, khai structural để
 * test/dev truyền object thường không cần Prisma type.
 */
export interface MisaProviderConfig extends StandardInvoiceConfig {
  defaultInvoiceType: string; // STANDARD | POS
}

/**
 * BẢNG KHẢ NĂNG của meInvoice. Nguồn từng dòng:
 *   [doc]        tài liệu meInvoice (doc.meinvoice.vn / portal developer.misa.vn)
 *   [thử 02/10]  bài thử scripts/misa-refid-probe.ts chạy trên sandbox 02/10/2026
 *                (kết quả chép ở docs/HANG-DOI-BEN.md mục 4.6)
 */
export const MISA_CAPABILITIES: ProviderCapabilities = {
  // [doc] "Lưu ý khi bắt đầu": số hóa đơn cấp liên tục theo ký hiệu, lệnh chen
  // ngang bị từ chối với InvoiceNumberNotCotinuous.
  sequentialIssue: true,
  // [thử 02/10] gửi lại mã đã lập → DuplicateInvoiceRefID (cả hóa đơn bán lẫn điều
  // chỉnh); hai lệnh CÙNG LÚC cùng một mã → đúng một tờ được lập, lệnh kia báo trùng.
  dedupesByReference: true,
  // [thử 02/10] một mã bị từ chối hai kiểu (ký hiệu không tồn tại, thuế suất sai)
  // rồi gửi lại hợp lệ thì được nhận (hóa đơn bán). Hóa đơn điều chỉnh: bị từ chối
  // vì thuế suất sai rồi gửi lại đúng mã đó thì được nhận (tờ sandbox 00000137).
  referenceReusableAfterReject: true,
  // [thử 02/10] /invoice/status?inputType=2 tra theo RefID. Mã chưa từng gửi trả
  // danh sách rỗng. Hóa đơn bán thấy ngay (3/3 lượt); hóa đơn điều chỉnh có 2/2
  // lượt tra ngay sau khi lập trả RỖNG, 140 ms sau thì thấy. 60 giây là mức TỰ
  // CHỌN, gấp vài trăm lần độ trễ đã thấy.
  findByReference: { supported: true, settleSeconds: 60 },
  // Cỡ lô worker hỏi trạng thái đang chạy từ 03/09/2026 (body là mảng mã tra cứu).
  statusBatchSize: 50,
  // [doc] chỉ có /invoice/status để hỏi; không có webhook.
  webhook: false,
  // [doc] portal đọc 23/08/2026 không có endpoint hủy. (doc.meinvoice.vn/itg có
  // nhắc POST /cancel — CHƯA kiểm, nên khai mức an toàn.)
  cancelViaApi: false,
  // [thử 02/10] sandbox nhận và lập cả tờ điều chỉnh trỏ vào số hóa đơn gốc không tồn tại.
  validatesAdjustmentOriginal: false,
};

export class MisaInvoiceProvider implements InvoiceProvider {
  readonly name = "MISA";
  readonly capabilities = MISA_CAPABILITIES;

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
    // Tra không được / không thấy / tờ đã bị xóa thì rơi về thông điệp lỗi trùng như cũ.
    const found = await this.findByReference(input.orderCode);
    if (found.state !== "FOUND" || found.deleted || !found.issued) return null;
    if (!found.transactionId || !found.invoiceNo) return null;
    return {
      status: InvoiceLogStatus.ISSUED,
      invoiceNo: found.invoiceNo,
      transactionId: found.transactionId,
      vatAmount: input.lines.reduce((s, l) => s + l.vatAmount, 0),
    };
  }

  /**
   * Tra ngược theo mã tham chiếu (RefID) đã gửi lúc phát hành. MISA trả danh sách
   * rỗng cho mã chưa có hóa đơn. Nhiều tờ cùng mã (không mong đợi — MISA chặn
   * trùng) thì ưu tiên tờ còn hiệu lực và báo số tờ ở `matches`.
   */
  async findByReference(reference: string): Promise<ReferenceLookup> {
    let items: MisaInvoiceStatusItem[];
    try {
      items = await getInvoiceStatuses([reference], this.cfg, "refId");
    } catch (err) {
      return { state: "LOOKUP_FAILED", message: (err as Error).message };
    }
    if (items.length === 0) return { state: "NOT_FOUND" };
    const live = items.find((it) => !it.isDeleted && it.publishStatus === 1);
    const chosen = live ?? items[0];
    return {
      state: "FOUND",
      invoiceNo: chosen.invoiceNo,
      transactionId: chosen.transactionId,
      issued: chosen.publishStatus === 1,
      deleted: chosen.isDeleted,
      matches: items.length,
    };
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
