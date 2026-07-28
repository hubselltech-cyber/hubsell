/**
 * HỢP ĐỒNG PAYLOAD WEBHOOK MISA meInvoice (Sandbox) + VALIDATE SƠ BỘ.
 *
 * File này CHỈ chứa phần "hình dạng dữ liệu": kiểu payload, kiểm tra cấu trúc
 * tối thiểu để route ack nhanh, xác thực chữ ký (nếu bật) và bảng map trạng
 * thái MISA → InvoiceLogStatus. Nghiệp vụ nặng (đối chiếu DB, thuế) nằm ở
 * misa-webhook-service.ts; hàng đợi + retry nằm ở misa-webhook-queue.ts.
 *
 * Trường đặt tên PascalCase theo đúng phong cách API meInvoice v3 — khi nối
 * sandbox thật chỉ cần chỉnh tên trường tại ĐÂY, service không phải đổi.
 */

import crypto from "crypto";
import { InvoiceLogStatus } from "@prisma/client";

/** Một dòng hàng hóa MISA gửi kèm trong webhook (phục vụ đối soát thuế). */
export interface MisaWebhookItem {
  /** Mã hàng hóa — Hubsell phát hành bằng SKU nên dùng khớp OrderItem/Product. */
  ItemCode?: string;
  Quantity?: number;
  /** Đơn giá CHƯA thuế GTGT — cùng quy ước InvoiceLine.unitPrice. */
  UnitPrice?: number;
  /** % thuế suất GTGT của dòng: 0 / 5 / 8 / 10. */
  VATRate?: number;
  /** Tiền thuế GTGT của dòng do MISA tính (đã làm tròn phía NCC). */
  VATAmount?: number;
}

/** Payload MISA meInvoice bắn về khi hóa đơn đổi trạng thái. */
export interface MisaWebhookPayload {
  /** InvoicePublished | InvoiceCancelled | InvoiceReplaced | InvoiceAdjusted | InvoiceRejected */
  EventType: string;
  /** Thời điểm sự kiện phía MISA (ISO string). */
  EventDate?: string;
  Data: {
    /** Mã giao dịch/mã tra cứu hóa đơn — khớp InvoiceLog.transactionId. */
    TransactionID: string;
    /** Số hóa đơn NCC cấp, VD "C26TAA-00001234" (có khi đã phát hành/ký số). */
    InvNo?: string;
    /** Mã đơn hàng gốc của Hubsell — MISA lưu làm số tham chiếu lúc tạo. */
    RefID?: string;
    /** Tổng tiền hàng đã gồm thuế trên hóa đơn. */
    TotalAmount?: number;
    /** TỔNG tiền thuế GTGT trên hóa đơn do MISA tính. */
    TotalVATAmount?: number;
    /** Lý do (khi hủy/thay thế/từ chối). */
    Reason?: string;
    /** Chi tiết dòng hàng — dùng đối soát thuế từng mặt hàng. */
    InvoiceItems?: MisaWebhookItem[];
  };
}

/**
 * Các EventType được xử lý → trạng thái đích trên InvoiceLog.
 *
 * MISA có HAI kiểu đặt tên tùy phiên bản tài liệu: PascalCase ("InvoiceSigned")
 * và topic chấm ("invoice.signed") — hỗ trợ cả hai, tra cứu qua
 * misaEventStatus() (thử nguyên văn rồi thử lowercase) để không lệ thuộc hoa
 * thường của từng bản sandbox.
 */
export const MISA_EVENT_STATUS: Record<string, InvoiceLogStatus> = {
  // Phát hành/ký số thành công — hóa đơn có hiệu lực.
  InvoicePublished: InvoiceLogStatus.ISSUED,
  InvoiceSigned: InvoiceLogStatus.ISSUED,
  "invoice.published": InvoiceLogStatus.ISSUED,
  "invoice.signed": InvoiceLogStatus.ISSUED,
  // Hóa đơn bị hủy, hoặc bị THAY THẾ bởi hóa đơn khác (bản cũ hết hiệu lực —
  // bản thay thế sẽ về bằng một sự kiện phát hành mới với TransactionID mới).
  InvoiceCancelled: InvoiceLogStatus.CANCELLED,
  InvoiceReplaced: InvoiceLogStatus.CANCELLED,
  "invoice.canceled": InvoiceLogStatus.CANCELLED, // chính tả Mỹ theo spec topic
  "invoice.cancelled": InvoiceLogStatus.CANCELLED,
  "invoice.replaced": InvoiceLogStatus.CANCELLED,
  // Cơ quan thuế/NCC từ chối cấp mã — coi như phát hành thất bại.
  InvoiceRejected: InvoiceLogStatus.FAILED,
  "invoice.rejected": InvoiceLogStatus.FAILED,
};

/** Tra trạng thái đích của một EventType/topic — null = ngoài phạm vi xử lý. */
export function misaEventStatus(eventType: string): InvoiceLogStatus | null {
  return (
    MISA_EVENT_STATUS[eventType] ??
    MISA_EVENT_STATUS[eventType.toLowerCase()] ??
    null
  );
}

/**
 * VALIDATE SƠ BỘ trên luồng nhận — chỉ soi cấu trúc tối thiểu đủ để job xử lý
 * được, KHÔNG đụng DB (route phải ack trong 3 giây). Trả thông điệp lỗi tiếng
 * Việt để MISA/console đọc được, null = hợp lệ.
 */
export function validateMisaPayload(body: unknown): string | null {
  const p = body as Partial<MisaWebhookPayload> | null | undefined;
  if (!p || typeof p !== "object") return "Body không phải JSON object";
  if (typeof p.EventType !== "string" || !p.EventType.trim())
    return "Thiếu trường EventType";
  if (!p.Data || typeof p.Data !== "object") return "Thiếu trường Data";
  if (typeof p.Data.TransactionID !== "string" || !p.Data.TransactionID.trim())
    return "Thiếu Data.TransactionID (mã tra cứu hóa đơn)";
  return null;
}

/** Sự kiện có nằm trong phạm vi xử lý không (loại lạ thì ack rồi bỏ qua). */
export function isHandledMisaEvent(eventType: string): boolean {
  return misaEventStatus(eventType) !== null;
}

/**
 * Production BẮT BUỘC có MISA_WEBHOOK_SECRET — endpoint công khai trên URL
 * HTTPS thật (Render) mà không kiểm chữ ký là nhận request giả mạo tùy ý.
 * Route dùng hàm này để trả 503 thay vì mở cửa tự do.
 */
export function misaSecretMissingInProduction(): boolean {
  return (
    process.env.NODE_ENV === "production" && !process.env.MISA_WEBHOOK_SECRET
  );
}

/**
 * Xác thực chữ ký webhook: header `x-misa-signature` = HMAC-SHA256(secret, RAW
 * body) dạng hex. CHỈ bật khi đã cấu hình MISA_WEBHOOK_SECRET — dev local chưa
 * có secret thì bỏ qua (trả true); production không được phép thiếu secret
 * (route chặn từ trước bằng misaSecretMissingInProduction).
 */
export function verifyMisaWebhookSignature(
  rawBody: Buffer | string,
  signature: string | undefined
): boolean {
  const secret = process.env.MISA_WEBHOOK_SECRET;
  if (!secret) return true; // sandbox: chưa có secret → không chặn
  if (!signature) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  // So sánh thời gian cố định — chống timing attack dò chữ ký.
  const a = Buffer.from(signature.toLowerCase(), "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
