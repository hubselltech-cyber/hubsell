/**
 * ADAPTER MISA meInvoice — hiện chạy SANDBOX GIẢ LẬP.
 *
 * Khung code đã theo đúng luồng thật của meInvoice (đăng nhập lấy token bằng
 * clientId/secretKey → gọi API kèm mã đại lý ISV), nhưng CHƯA gọi HTTP thật vì
 * đang chờ hợp đồng đại lý + tài khoản sandbox từ MISA. Khi có tài khoản, chỉ
 * thay ruột 3 phương thức bằng fetch tới endpoint thật của meInvoice
 * (https://api.meinvoice.vn/api/v3) — chữ ký hàm giữ nguyên.
 */

import { InvoiceLogStatus } from "@prisma/client";
import type {
  CreateInvoiceInput,
  InvoiceProvider,
  InvoiceResult,
  ProviderCredentials,
} from "./types";

export class MisaInvoiceProvider implements InvoiceProvider {
  readonly name = "MISA";

  constructor(private creds: ProviderCredentials) {}

  /** Chưa đủ clientId/secretKey thì mọi thao tác phải fail sớm với lời nhắn rõ. */
  private missingCreds(): InvoiceResult | null {
    if (!this.creds.clientId || !this.creds.secretKey) {
      return {
        status: InvoiceLogStatus.FAILED,
        errorMessage:
          "Chưa cấu hình Client ID / Secret Key của MISA — vào Kết nối & Xuất hóa đơn để nhập.",
      };
    }
    return null;
  }

  async createInvoice(input: CreateInvoiceInput): Promise<InvoiceResult> {
    const err = this.missingCreds();
    if (err) return err;

    // ---- SANDBOX: giả lập NCC phát hành thành công ngay ----
    // Số hóa đơn theo mẫu ký hiệu 2026: C26T + AA-<số tăng dần giả lập>.
    const vatAmount = input.lines.reduce(
      (s, l) => s + (l.unitPrice * l.quantity * l.vatRate) / 100,
      0
    );
    return {
      status: InvoiceLogStatus.ISSUED,
      invoiceNo: `C26TAA-${String(Date.now()).slice(-8)}`,
      transactionId: `MISA-SBX-${input.orderCode}`,
      vatAmount: Math.round(vatAmount),
    };
  }

  async cancelInvoice(
    transactionId: string,
    _reason: string
  ): Promise<InvoiceResult> {
    const err = this.missingCreds();
    if (err) return err;
    return { status: InvoiceLogStatus.CANCELLED, transactionId };
  }

  async checkStatus(transactionId: string): Promise<InvoiceResult> {
    const err = this.missingCreds();
    if (err) return err;
    // Sandbox không có kho trạng thái phía NCC — coi như đã phát hành.
    return { status: InvoiceLogStatus.ISSUED, transactionId };
  }
}
