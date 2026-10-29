// ============================================================
// TIKTOK — "Get Order Price Details" 202407: BÓC VOUCHER SHOP RA KHỎI CHIẾT KHẤU
//
// Bản kê (202501/202507) gộp giảm giá sản phẩm + voucher shop vào MỘT số
// seller_discount_amount. Probe đơn thật 29/10/2026 (docs/DONG-TIEN-TONG-GIA-TRI-
// SAN-PHAM-KHAO-SAT-29-10.md mục 12, nhiều gian, cả ước tính lẫn đã quyết toán):
//   sku_list_price                 = subtotal_before_discount bản kê (mọi đơn)
//   sku_list_price − subtotal_deduction_seller = revenue_amount dòng ORDER (mọi đơn)
//   voucher_deduction_seller       = PHẦN voucher shop NẰM TRONG subtotal_deduction_seller
//                                    (có đơn bằng cả subtotal_deduction_seller)
// → Tổng giá trị SP "giá trong giỏ" (anh Trung chốt 29/10) = revenue_amount dòng
//   ORDER + voucher_deduction_seller; dòng "Voucher & xu của shop" = voucher_deduction_seller.
// Mọi số là trường sàn trả, không công thức ước. Đọc MỘT lần mỗi đơn (lưu
// Order.tiktokVoucherSeller + tiktokPriceDetailAt), bù nền cho đơn đã có bản kê.
// ============================================================

import type { Channel } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { callApi } from "./client";
import { getValidAccessToken } from "./service";

type Amount = string | number | undefined | null;

export interface TikTokPriceLine {
  id?: string;
  sku_list_price?: Amount;
  sku_sale_price?: Amount;
  subtotal_deduction_seller?: Amount;
  subtotal_deduction_platform?: Amount;
  voucher_deduction_seller?: Amount;
  voucher_deduction_platform?: Amount;
}

/** Payload đơn (cấp đơn + từng dòng hàng) — payload VN KHÔNG có seller_funded_product_promotions. */
export interface TikTokOrderPriceDetail extends TikTokPriceLine {
  currency?: string;
  line_items?: TikTokPriceLine[];
}

const n = (v: Amount): number => Number(v ?? 0) || 0;

/**
 * Voucher shop của đơn từ payload price_detail: ưu tiên số cấp đơn
 * (`voucher_deduction_seller`), thiếu thì Σ dòng hàng. Trả null khi payload không
 * có trường nào (phiên bản API khác) — nơi gọi KHÔNG ghi, để lượt sau đọc lại.
 */
export function voucherSellerFromPriceDetail(pd: TikTokOrderPriceDetail | null | undefined): number | null {
  if (!pd) return null;
  if (pd.voucher_deduction_seller !== undefined && pd.voucher_deduction_seller !== null) {
    return n(pd.voucher_deduction_seller);
  }
  const lines = pd.line_items ?? [];
  if (lines.length === 0) return null;
  if (lines.every((l) => l.voucher_deduction_seller === undefined || l.voucher_deduction_seller === null)) return null;
  return lines.reduce((s, l) => s + n(l.voucher_deduction_seller), 0);
}

export async function fetchOrderPriceDetail(params: {
  accessToken: string;
  shopCipher: string;
  orderId: string;
}): Promise<TikTokOrderPriceDetail> {
  return callApi<TikTokOrderPriceDetail>({
    path: `/order/202407/orders/${encodeURIComponent(params.orderId)}/price_detail`,
    accessToken: params.accessToken,
    shopCipher: params.shopCipher,
    kind: "read",
  });
}

export interface PriceDetailBackfillResult {
  scanned: number;
  written: number;
  noField: number;
  errors: number;
}

/**
 * Đọc price_detail cho các đơn của gian ĐÃ CÓ bản kê (thật hoặc ước tính) mà
 * chưa đọc (`tiktokPriceDetailAt` null), mới nhất trước, tối đa `limit` đơn mỗi
 * lượt. Gọi sau mỗi lượt đồng bộ bản kê (worker giờ + nút tay) → đơn mới được
 * bóc voucher trong vòng một nhịp, đơn cũ 90 ngày bù dần; mọi call đi qua làn
 * giới hạn nhịp của gian (client.ts). Lỗi từng đơn: ghi log, để null, lượt sau
 * thử lại; lỗi token: trả về ngay.
 */
export async function backfillTiktokPriceDetails(
  channel: Channel,
  opts: { limit?: number; daysBack?: number } = {}
): Promise<PriceDetailBackfillResult> {
  const result: PriceDetailBackfillResult = { scanned: 0, written: 0, noField: 0, errors: 0 };
  const limit = Math.max(1, Math.min(2000, opts.limit ?? 200));
  const since = new Date(Date.now() - (opts.daysBack ?? 90) * 86_400_000);
  const orders = await prisma.order.findMany({
    where: {
      channelId: channel.id,
      createdAt: { gte: since },
      tiktokPriceDetailAt: null,
      tiktokSettlement: { isNot: null },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, orderCode: true },
  });
  if (orders.length === 0) return result;

  const { accessToken, shopCipher } = await getValidAccessToken(channel);
  for (const o of orders) {
    result.scanned++;
    let pd: TikTokOrderPriceDetail;
    try {
      pd = await fetchOrderPriceDetail({ accessToken, shopCipher, orderId: o.orderCode });
    } catch (err) {
      result.errors++;
      console.warn(
        `[TikTok] price_detail "${channel.shopName}" đơn ${o.orderCode}: ${(err as Error).message}`
      );
      // Sàn quá tải/lỗi liên tiếp → dừng lượt này, giữ null để lượt sau đọc tiếp.
      if (result.errors >= 5) break;
      continue;
    }
    const voucher = voucherSellerFromPriceDetail(pd);
    if (voucher === null) {
      result.noField++;
      continue;
    }
    await prisma.order.update({
      where: { id: o.id },
      select: { id: true },
      data: { tiktokVoucherSeller: voucher, tiktokPriceDetailAt: new Date() },
    });
    result.written++;
  }
  if (result.written > 0 || result.errors > 0) {
    console.log(
      `[TikTok] price_detail "${channel.shopName}": đọc ${result.scanned} đơn, ghi voucher ${result.written}, thiếu trường ${result.noField}, lỗi ${result.errors}`
    );
  }
  return result;
}
