// ============================================================
// KHÁCH YÊU CẦU XUẤT HÓA ĐƠN — kéo thông tin người mua điền khi đặt hàng
// (Shopee VN, get_buyer_invoice_info; tính năng ra 08/2026 theo NĐ 254 Đ.17c)
//
// Vì sao phải kéo về LƯU: Shopee ẨN thông tin sau 30 NGÀY kể từ đơn hoàn
// thành (Luật bảo vệ dữ liệu cá nhân) — chờ tới lúc seller bấm xuất là có thể
// đã mất. Worker auto-sync gọi mỗi nhịp: đơn ĐÃ GIAO chưa hỏi → hỏi sàn →
// lưu Order.invoiceRequestType + buyerInvoiceInfo (JSON chuẩn hóa).
//
// Chuẩn hóa + đối xử dữ liệu:
//   · "receipt settings not found" = khách KHÔNG yêu cầu → chỉ đóng dấu
//     buyerInvoiceFetchedAt (type null), hóa đơn sẽ ghi "Bán cho người tiêu
//     dùng" theo Khoản 4 Phụ lục NĐ 254.
//   · Giá trị bị che dạng "A****b" (sàn che khi đơn chưa tới trạng thái mở
//     info) → KHÔNG lưu, KHÔNG đóng dấu — lượt quét sau thử lại; đơn quá cửa
//     sổ MAX_ORDER_AGE_DAYS tự rời vòng quét nên không lặp vô hạn.
//   · Bản lưu bị cron log-cleanup XÓA sau khi hóa đơn phát hành 30 ngày hoặc
//     sau 90 ngày không phát hành — data chỉ "ghé qua" Hubsell.
//
// ĐIỀU KIỆN PHÍA SHOPEE: shop phải xác thực định danh + nhờ CSKH Shopee mở
// tính năng. Chưa mở → API lỗi ở envelope; ta backoff 24h/gian cho đỡ tốn
// quota thay vì gõ mãi.
// ============================================================

import type { Channel, Prisma } from "@prisma/client";
import { ShippingStatus } from "@prisma/client";
import { prisma } from "../../prisma";
import { getBuyerInvoiceInfo, type ShopeeBuyerInvoiceItem } from "./client";
import { getValidShopeeAccessToken } from "./service";

/** Chỉ hỏi đơn tạo trong N ngày — sàn ẩn info sau 30 ngày từ lúc hoàn thành,
 *  cộng dư vài ngày cho đơn giao chậm; đơn cũ hơn coi như hết cửa. */
const MAX_ORDER_AGE_DAYS = 45;
/** Trần số đơn hỏi mỗi lượt quét của MỘT gian. */
const MAX_ORDERS_PER_SWEEP = 50;
/** Số order_sn mỗi call API (docs không ghi trần — đi 20 cho an toàn). */
const BATCH_SIZE = 20;
/** Gian bị lỗi envelope (chưa được mở tính năng…) nghỉ chừng này rồi mới thử lại. */
const CHANNEL_BACKOFF_MS = 24 * 60 * 60 * 1000;

/** channelId → thời điểm được thử lại (in-memory, mất khi restart — vô hại). */
const channelRetryAt = new Map<string, number>();

// ---------- Phần THUẦN (không API, không DB) — có vitest ----------

export type InvoiceRequestType = "PERSONAL" | "COMPANY" | "HOUSEHOLD";

/** JSON chuẩn hóa lưu vào Order.buyerInvoiceInfo. */
export interface StoredBuyerInvoiceInfo {
  name?: string;
  email?: string;
  /** MST (household/cá nhân có MST) — công ty nằm ở companyTaxId. */
  taxId?: string;
  /** Số định danh cá nhân (personal, VN) — từ 07/2025 thay MST cá nhân. */
  nationalId?: string;
  address?: string;
  companyName?: string;
  companyTaxId?: string;
  companyEmail?: string;
  companyAddress?: string;
}

/** Sàn che dữ liệu dạng "A****b" khi đơn chưa tới trạng thái mở thông tin. */
export function isMaskedValue(v: string | undefined): boolean {
  return typeof v === "string" && v.includes("*");
}

export interface MappedBuyerInvoice {
  type: InvoiceRequestType;
  info: StoredBuyerInvoiceInfo;
  /** Có trường trọng yếu đang bị che → khoan lưu, lượt sau hỏi lại. */
  masked: boolean;
}

/**
 * Chuẩn hóa một item của get_buyer_invoice_info. Trả null khi đơn KHÔNG có
 * yêu cầu (error "receipt settings not found" / thiếu type / thiếu detail).
 */
export function mapBuyerInvoiceItem(
  item: ShopeeBuyerInvoiceItem
): MappedBuyerInvoice | null {
  if (item.error || !item.invoice_type || !item.invoice_detail) return null;
  const type = item.invoice_type.toUpperCase();
  if (type !== "PERSONAL" && type !== "COMPANY" && type !== "HOUSEHOLD") return null;

  const d = item.invoice_detail;
  const clean = (v: string | undefined) => {
    const s = v?.trim();
    return s ? s : undefined;
  };
  const info: StoredBuyerInvoiceInfo =
    type === "COMPANY"
      ? {
          name: clean(d.name),
          companyName: clean(d.company_name),
          companyTaxId: clean(d.company_tax_id),
          companyEmail: clean(d.company_email),
          companyAddress: clean(d.company_address),
        }
      : {
          name: clean(d.name),
          email: clean(d.email),
          taxId: clean(d.tax_id),
          nationalId: clean(d.national_id),
          address: clean(d.address),
        };

  // Trường TRỌNG YẾU cho hóa đơn (tên + mã số) bị che → coi như chưa mở.
  const masked =
    type === "COMPANY"
      ? isMaskedValue(info.companyName) || isMaskedValue(info.companyTaxId)
      : isMaskedValue(info.name) || isMaskedValue(info.taxId) || isMaskedValue(info.nationalId);

  return { type: type as InvoiceRequestType, info, masked };
}

// ---------- Phần gọi API + ghi DB ----------

export interface BuyerInvoiceSyncResult {
  /** Số đơn đã hỏi sàn trong lượt này. */
  scanned: number;
  /** Số đơn có yêu cầu xuất hóa đơn (đã lưu info). */
  requested: number;
  /** Số đơn sàn báo không có yêu cầu (đóng dấu đã hỏi). */
  none: number;
  /** Số đơn info còn bị che — lượt sau hỏi lại. */
  maskedRetry: number;
}

const EMPTY: BuyerInvoiceSyncResult = { scanned: 0, requested: 0, none: 0, maskedRetry: 0 };

/**
 * Một lượt kéo yêu cầu xuất hóa đơn cho MỘT gian Shopee: đơn ĐÃ GIAO THÀNH
 * CÔNG trong cửa sổ tuổi, chưa từng hỏi (buyerInvoiceFetchedAt null).
 */
export async function syncShopeeBuyerInvoiceRequests(
  channel: Channel,
  opts: { limit?: number } = {}
): Promise<BuyerInvoiceSyncResult> {
  const retryAt = channelRetryAt.get(channel.id) ?? 0;
  if (retryAt > Date.now()) return EMPTY;

  const since = new Date(Date.now() - MAX_ORDER_AGE_DAYS * 24 * 60 * 60 * 1000);
  const orders = await prisma.order.findMany({
    where: {
      channelId: channel.id,
      shippingStatus: ShippingStatus.DELIVERED,
      buyerInvoiceFetchedAt: null,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    take: opts.limit ?? MAX_ORDERS_PER_SWEEP,
    select: { id: true, orderCode: true },
  });
  if (orders.length === 0) return EMPTY;

  const idByCode = new Map(orders.map((o) => [o.orderCode, o.id]));
  const result: BuyerInvoiceSyncResult = { ...EMPTY };

  let auth: { accessToken: string; shopId: string };
  try {
    auth = await getValidShopeeAccessToken(channel);
  } catch (err) {
    // Token hỏng đã có luồng đồng bộ đơn báo — ở đây chỉ nghỉ lượt.
    channelRetryAt.set(channel.id, Date.now() + CHANNEL_BACKOFF_MS);
    throw err;
  }

  for (let i = 0; i < orders.length; i += BATCH_SIZE) {
    const batch = orders.slice(i, i + BATCH_SIZE).map((o) => o.orderCode);
    let items: ShopeeBuyerInvoiceItem[];
    try {
      items = await getBuyerInvoiceInfo(auth.accessToken, auth.shopId, batch);
    } catch (err) {
      // Lỗi envelope (thường: shop chưa được Shopee mở tính năng / app thiếu
      // quyền) → backoff 24h cho gian này, khỏi đốt quota mỗi nhịp.
      channelRetryAt.set(channel.id, Date.now() + CHANNEL_BACKOFF_MS);
      throw err;
    }

    const byCode = new Map(items.map((it) => [it.order_sn, it]));
    for (const code of batch) {
      const orderId = idByCode.get(code)!;
      const mapped = mapBuyerInvoiceItem(byCode.get(code) ?? { order_sn: code, error: "missing" });
      result.scanned += 1;

      if (mapped === null) {
        // Không có yêu cầu — đóng dấu đã hỏi để không hỏi lại.
        result.none += 1;
        await prisma.order.update({
          where: { id: orderId },
          data: { buyerInvoiceFetchedAt: new Date(), invoiceRequestType: null },
        });
        continue;
      }
      if (mapped.masked) {
        // Sàn còn che — KHÔNG đóng dấu, lượt quét sau thử lại.
        result.maskedRetry += 1;
        continue;
      }
      result.requested += 1;
      await prisma.order.update({
        where: { id: orderId },
        data: {
          buyerInvoiceFetchedAt: new Date(),
          invoiceRequestType: mapped.type,
          buyerInvoiceInfo: mapped.info as unknown as Prisma.InputJsonValue,
        },
      });
    }
  }
  return result;
}
