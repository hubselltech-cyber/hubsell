/**
 * NGHIỆP VỤ XỬ LÝ MỘT SỰ KIỆN WEBHOOK MISA meInvoice (chạy trong worker nền).
 *
 * Luồng cho MỖI sự kiện:
 *   1. Tìm InvoiceLog theo TransactionID (mã tra cứu); rơi về RefID (mã đơn
 *      Hubsell). Chưa có log (hóa đơn phát hành ngoài Hubsell / webhook về
 *      trước) → tự tạo từ Order để không rơi chứng từ.
 *   2. ĐỐI SOÁT THUẾ: so tiền thuế MISA tính (tổng + từng dòng) với số Hubsell
 *      tự tính từ cấu hình thuế ĐỘC LẬP (Product.vatRate). Lệch trong biên độ
 *      cho phép (mặc định 500đ, làm tròn) → tự chấp nhận, điều chỉnh theo số
 *      NCC (hóa đơn là chứng từ pháp lý); lệch VƯỢT biên độ → hóa đơn vào
 *      trạng thái LỖI (FAILED) với errorMessage "TAX_MISMATCH: …", GIỮ NGUYÊN
 *      số thuế Hubsell — không tự "sửa sổ" khi chênh lệch bất thường, kế toán
 *      phải vào xem và xử lý tay.
 *   3. Trong MỘT transaction: cập nhật InvoiceLog + đơn hàng liên quan
 *      (Order.einvoiceStatus) + ghi InvoiceStatusHistory (audit log).
 *
 * Idempotent: cùng sự kiện bắn lại (khác hash, lọt dedup) thấy trạng thái đã
 * đúng thì không ghi gì thêm — audit log không bị nhân bản.
 *
 * Hàm NÉM lỗi khi gặp sự cố tạm thời (DB, race hóa đơn chưa kịp ghi log) — để
 * hàng đợi retry theo lịch 3 lần × 5 phút.
 */

import { InvoiceLogStatus, Prisma } from "@prisma/client";
import { prisma } from "../../prisma";
import {
  misaEventStatus,
  type MisaWebhookItem,
  type MisaWebhookPayload,
} from "./misa-webhook";

/**
 * Biên độ lệch thuế cho phép (đồng) giữa MISA và Hubsell do làm tròn khác
 * nhau — trong biên độ thì tự điều chỉnh theo số NCC. Đổi qua env
 * MISA_TAX_TOLERANCE_VND khi cần siết/nới trên sandbox.
 */
export function taxToleranceVnd(): number {
  const raw = Number(process.env.MISA_TAX_TOLERANCE_VND);
  return Number.isFinite(raw) && raw >= 0 ? raw : 500;
}

export interface MisaProcessResult {
  invoiceLogId: string;
  /** false = sự kiện bắn lại, trạng thái đã đúng — không ghi gì thêm. */
  changed: boolean;
  status: InvoiceLogStatus;
  /** Ghi chú đối soát thuế (cũng được lưu vào audit log). */
  taxNote: string | null;
}

/** Kết quả đối soát thuế giữa payload MISA và cấu hình thuế Hubsell. */
interface TaxReconcileResult {
  /** Số tiền thuế CHỐT ghi vào InvoiceLog.vatAmount (null = giữ nguyên). */
  vatAmountToWrite: number | null;
  /** Diễn giải kết quả — ghi vào audit log để tra soát khi test sandbox. */
  note: string;
  /** true = lệch vượt biên độ, cần người xem (đã console.warn). */
  warning: boolean;
}

/** Xử lý trọn vẹn MỘT sự kiện webhook MISA. Ném lỗi → hàng đợi tự retry. */
export async function processMisaWebhookEvent(
  payload: MisaWebhookPayload
): Promise<MisaProcessResult> {
  const eventType = payload.EventType;
  const targetStatus = misaEventStatus(eventType);
  if (!targetStatus) {
    // Không bao giờ tới đây trong luồng thật (route đã lọc) — chặn để an toàn.
    throw new Error(`Sự kiện MISA không được hỗ trợ: ${eventType}`);
  }

  const transactionId = payload.Data.TransactionID.trim();
  const invoiceNo = payload.Data.InvNo?.trim() || null;
  const refOrderCode = payload.Data.RefID?.trim() || null;

  // ---- 1) Đối chiếu: tìm hóa đơn theo mã tra cứu, rơi về mã đơn gốc ----
  let log = await prisma.invoiceLog.findFirst({
    where: { provider: "MISA", transactionId },
    orderBy: { createdAt: "desc" },
  });
  if (!log && refOrderCode) {
    log = await prisma.invoiceLog.findFirst({
      where: { provider: "MISA", orderCode: refOrderCode, transactionId: null },
      orderBy: { createdAt: "desc" },
    });
  }
  if (!log) {
    log = await createLogFromOrder(transactionId, refOrderCode);
  }
  if (!log) {
    // Có thể là RACE: Hubsell vừa gửi yêu cầu phát hành, InvoiceLog chưa kịp
    // commit mà webhook đã về. Ném lỗi để retry sau 5 phút thay vì bỏ sự kiện.
    throw new Error(
      `Không tìm thấy hóa đơn khớp TransactionID=${transactionId}` +
        (refOrderCode ? ` / mã đơn ${refOrderCode}` : "") +
        " — sẽ thử lại (có thể hóa đơn chưa kịp ghi vào Hubsell)"
    );
  }

  // ---- 2) Đối soát thuế (chỉ có ý nghĩa khi hóa đơn phát hành/ký số) ----
  const reconcile =
    targetStatus === InvoiceLogStatus.ISSUED
      ? await reconcileTax(log.id, log.orderId, payload)
      : null;

  // Lệch thuế VƯỢT biên độ = TAX_MISMATCH → trạng thái cuối là LỖI (FAILED),
  // không phải ISSUED — kế toán bắt buộc phải nhìn thấy và xử lý.
  const finalStatus = reconcile?.warning
    ? InvoiceLogStatus.FAILED
    : targetStatus;

  // ---- Idempotency: sự kiện bắn lại mà mọi thứ đã đúng → không ghi thêm ----
  // (Khóa theo mã tra cứu — InvoiceId phía MISA: cùng mã + cùng trạng thái đích
  // + cùng số hóa đơn thì lần bắn lại không tạo thêm bất kỳ bản ghi audit nào.)
  if (
    log.status === finalStatus &&
    log.transactionId === transactionId &&
    (invoiceNo === null || log.invoiceNo === invoiceNo)
  ) {
    return {
      invoiceLogId: log.id,
      changed: false,
      status: finalStatus,
      taxNote: null,
    };
  }

  // ---- 3) Cập nhật hóa đơn + đơn hàng + audit log trong MỘT transaction ----
  const noteParts: string[] = [];
  if (payload.Data.Reason) noteParts.push(`Lý do NCC: ${payload.Data.Reason}`);
  if (eventType === "InvoiceReplaced")
    noteParts.push("Hóa đơn bị THAY THẾ — chờ bản thay thế về qua sự kiện phát hành mới.");
  if (reconcile) noteParts.push(reconcile.note);
  const note = noteParts.length > 0 ? noteParts.join(" | ") : null;

  await prisma.$transaction(async (tx) => {
    await tx.invoiceLog.update({
      where: { id: log!.id },
      data: {
        status: finalStatus,
        transactionId,
        // Số hóa đơn ghi khi MISA gửi kèm (kể cả case TAX_MISMATCH — vẫn là số
        // NCC đã cấp, giữ để tra soát); sự kiện hủy có thể không gửi.
        ...(invoiceNo ? { invoiceNo } : {}),
        ...(payload.Data.TotalAmount != null
          ? { totalAmount: new Prisma.Decimal(payload.Data.TotalAmount) }
          : {}),
        ...(reconcile?.vatAmountToWrite != null
          ? { vatAmount: new Prisma.Decimal(reconcile.vatAmountToWrite) }
          : {}),
        ...(finalStatus === InvoiceLogStatus.ISSUED
          ? { issuedAt: parseEventDate(payload.EventDate), errorMessage: null }
          : {}),
        // Lỗi có mã phân loại đứng đầu: TAX_MISMATCH (lệch thuế) để màn hình
        // đối soát lọc thẳng theo tiền tố, còn lại là NCC từ chối.
        ...(finalStatus === InvoiceLogStatus.FAILED
          ? {
              errorMessage: reconcile?.warning
                ? `TAX_MISMATCH: ${reconcile.note}`
                : payload.Data.Reason ?? `NCC từ chối (${eventType})`,
            }
          : {}),
      },
    });

    // Đơn hàng liên quan: denormalize trạng thái hóa đơn mới nhất để danh sách
    // đơn lọc "đã/chưa xuất hóa đơn" không phải join InvoiceLog.
    if (log!.orderId) {
      await tx.order.update({
        where: { id: log!.orderId },
        data: { einvoiceStatus: finalStatus },
      });
    }

    // Audit log — mỗi thay đổi một dòng, chỉ insert không bao giờ sửa.
    await tx.invoiceStatusHistory.create({
      data: {
        invoiceLogId: log!.id,
        orderCode: log!.orderCode,
        fromStatus: log!.status,
        toStatus: finalStatus,
        source: "MISA_WEBHOOK",
        note,
      },
    });
  });

  if (reconcile?.warning) {
    console.warn(`[Webhook MISA] ${reconcile.note} (hóa đơn ${log.id}, đơn ${log.orderCode})`);
  }

  return {
    invoiceLogId: log.id,
    changed: true,
    status: finalStatus,
    taxNote: reconcile?.note ?? null,
  };
}

/**
 * Webhook về cho hóa đơn Hubsell CHƯA có log (phát hành từ web MISA, hoặc log
 * bị xóa) — tạo InvoiceLog mới từ Order để chứng từ không rơi. Cần RefID để
 * tìm đơn; không có đơn thì trả null (nơi gọi quyết định retry).
 */
async function createLogFromOrder(
  transactionId: string,
  refOrderCode: string | null
) {
  if (!refOrderCode) return null;
  const order = await prisma.order.findFirst({
    where: { orderCode: refOrderCode },
    include: { channel: { include: { user: { select: { id: true, ownerId: true } } } } },
  });
  if (!order) return null;

  // Chủ shop thật sự: kênh có thể do nhân viên tạo — leo lên owner gốc.
  const ownerId = order.channel.user.ownerId ?? order.channel.user.id;
  return prisma.invoiceLog.create({
    data: {
      ownerId,
      orderId: order.id,
      orderCode: order.orderCode,
      provider: "MISA",
      transactionId,
      status: InvoiceLogStatus.PENDING, // trạng thái thật do sự kiện quyết định
    },
  });
}

/**
 * ĐỐI SOÁT THUẾ — trái tim của module.
 *
 * Số Hubsell tự tính từ cấu hình thuế ĐỘC LẬP: mỗi OrderItem nối về Product
 * gốc lấy % thuế suất (Product.vatRate: 0/5/8/10 — mỗi mặt hàng một mức), tiền
 * thuế dòng = đơn giá × SL × %thuế (đơn giá CHƯA thuế, cùng quy ước
 * InvoiceLine.unitPrice khi phát hành). So với số MISA gửi về ở cả 2 mức:
 *   · TỪNG DÒNG (khớp ItemCode ↔ SKU sàn / SKU kho) — bắt lệch làm tròn lẻ tẻ;
 *   · TỔNG (TotalVATAmount ↔ tổng Hubsell) — chốt cuối cùng.
 *
 * Lệch tổng ≤ biên độ → tự chấp nhận, điều chỉnh vatAmount theo số MISA (chứng
 * từ pháp lý); vượt biên độ → warning=true để nơi gọi chốt hóa đơn sang FAILED
 * với errorMessage "TAX_MISMATCH: …" (giữ nguyên số thuế Hubsell).
 */
async function reconcileTax(
  invoiceLogId: string,
  orderId: string | null,
  payload: MisaWebhookPayload
): Promise<TaxReconcileResult> {
  const misaTotal = payload.Data.TotalVATAmount;
  if (misaTotal == null) {
    return {
      vatAmountToWrite: null,
      note: "MISA không gửi TotalVATAmount — bỏ qua đối soát thuế.",
      warning: false,
    };
  }

  // Không còn nối được về đơn (đơn đã xóa theo kênh) → không có dữ liệu gốc để
  // đối chiếu, đành tin số NCC và ghi chú rõ.
  if (!orderId) {
    return {
      vatAmountToWrite: misaTotal,
      note: `Hóa đơn không còn gắn đơn gốc — ghi nhận thuế theo MISA: ${fmt(misaTotal)}.`,
      warning: false,
    };
  }

  const items = await prisma.orderItem.findMany({
    where: { orderId },
    include: { product: { select: { skuCode: true, vatRate: true } } },
  });

  // ---- Số Hubsell: tính từng dòng theo Product.vatRate ----
  let hubsellTotal = 0;
  const bySku = new Map<string, { expectedTax: number; vatRate: number }>();
  for (const it of items) {
    const vatRate = it.product?.vatRate ?? 0;
    const expectedTax = (Number(it.price) * it.quantity * vatRate) / 100;
    hubsellTotal += expectedTax;
    // Cho phép MISA tra theo SKU sàn lẫn SKU kho — hai hệ có thể in mã khác nhau.
    bySku.set(it.channelSku, { expectedTax, vatRate });
    if (it.product?.skuCode) bySku.set(it.product.skuCode, { expectedTax, vatRate });
  }
  hubsellTotal = Math.round(hubsellTotal);

  const tolerance = taxToleranceVnd();
  const lineNotes = reconcileLines(payload.Data.InvoiceItems, bySku, tolerance);

  const diff = Math.abs(misaTotal - hubsellTotal);
  if (diff === 0) {
    return {
      vatAmountToWrite: misaTotal,
      note: `Đối soát thuế KHỚP: ${fmt(misaTotal)}.${lineNotes}`,
      warning: false,
    };
  }
  if (diff <= tolerance) {
    return {
      vatAmountToWrite: misaTotal,
      note:
        `Đối soát thuế lệch ${fmt(diff)} (làm tròn, trong biên độ ${fmt(tolerance)}) — ` +
        `TỰ ĐIỀU CHỈNH theo MISA: ${fmt(misaTotal)} (Hubsell tính ${fmt(hubsellTotal)}).${lineNotes}`,
      warning: false,
    };
  }
  return {
    vatAmountToWrite: null, // giữ số Hubsell — không tự sửa sổ khi lệch bất thường
    note:
      `CẢNH BÁO LỆCH THUẾ vượt biên độ ${fmt(tolerance)}: MISA ${fmt(misaTotal)} ≠ ` +
      `Hubsell ${fmt(hubsellTotal)} (lệch ${fmt(diff)}) — giữ số Hubsell, cần kiểm tra ` +
      `cấu hình thuế suất sản phẩm.${lineNotes}`,
    warning: true,
  };
}

/** So thuế TỪNG DÒNG MISA gửi về với số Hubsell — trả chuỗi ghi chú các dòng lệch. */
function reconcileLines(
  misaItems: MisaWebhookItem[] | undefined,
  bySku: Map<string, { expectedTax: number; vatRate: number }>,
  tolerance: number
): string {
  if (!misaItems || misaItems.length === 0) return "";
  const problems: string[] = [];
  for (const mi of misaItems) {
    if (!mi.ItemCode || mi.VATAmount == null) continue;
    const local = bySku.get(mi.ItemCode);
    if (!local) {
      problems.push(`dòng ${mi.ItemCode} không khớp SKU nào của đơn`);
      continue;
    }
    const lineDiff = Math.abs(mi.VATAmount - Math.round(local.expectedTax));
    if (lineDiff > tolerance) {
      problems.push(
        `dòng ${mi.ItemCode} lệch ${fmt(lineDiff)} (MISA ${fmt(mi.VATAmount)} / ` +
          `Hubsell ${fmt(Math.round(local.expectedTax))}, thuế suất ${local.vatRate}%)`
      );
    }
  }
  return problems.length > 0 ? ` Chi tiết dòng: ${problems.join("; ")}.` : "";
}

/** EventDate của MISA có thể thiếu/sai định dạng — rơi về thời điểm xử lý. */
function parseEventDate(raw: string | undefined): Date {
  if (!raw) return new Date();
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

/** Format tiền cho ghi chú audit: 1234567 → "1.234.567đ". */
function fmt(n: number): string {
  return `${new Intl.NumberFormat("vi-VN").format(n)}đ`;
}
