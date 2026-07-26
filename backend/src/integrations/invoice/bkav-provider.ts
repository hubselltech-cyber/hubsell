/**
 * ADAPTER BKAV eHoadon — MOCKUP, CHỜ API.
 *
 * BKAV chưa cấp tài liệu tích hợp đại lý cho Hubsell nên adapter này chỉ là
 * khung giữ chỗ: cài đủ interface để registry chọn được, nhưng mọi thao tác
 * đều trả FAILED kèm lời nhắn "sắp ra mắt" — tuyệt đối không giả lập phát hành
 * thành công (khác MISA sandbox) để chủ shop không tưởng nhầm hóa đơn BKAV đã
 * xuất được thật.
 */

import { InvoiceLogStatus } from "@prisma/client";
import type {
  CreateInvoiceInput,
  InvoiceProvider,
  InvoiceResult,
  ProviderCredentials,
} from "./types";

const NOT_READY: InvoiceResult = {
  status: InvoiceLogStatus.FAILED,
  errorMessage:
    "BKAV eHoadon sắp ra mắt — Hubsell đang chờ BKAV cấp API tích hợp đại lý. Tạm thời hãy chọn MISA.",
};

export class BkavInvoiceProvider implements InvoiceProvider {
  readonly name = "BKAV";

  // Nhận creds cho đồng nhất chữ ký với các adapter khác dù chưa dùng tới.
  constructor(_creds: ProviderCredentials) {}

  async createInvoice(_input: CreateInvoiceInput): Promise<InvoiceResult> {
    return NOT_READY;
  }

  async cancelInvoice(
    _transactionId: string,
    _reason: string
  ): Promise<InvoiceResult> {
    return NOT_READY;
  }

  async checkStatus(_transactionId: string): Promise<InvoiceResult> {
    return NOT_READY;
  }
}
