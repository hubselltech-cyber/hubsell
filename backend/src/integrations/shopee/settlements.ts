// ============================================================
// SHOPEE — ĐỒNG BỘ ĐỐI SOÁT PHÍ THẬT (Escrow / Payment API, READ-ONLY)
//
// Cùng triết lý "SỔ ĐỐI SOÁT, KHÔNG BỊA SỐ" với Lazada (syncLazadaSettlements):
//   1) get_escrow_list theo khoảng release_time → CHỈ đơn sàn ĐÃ GIẢI NGÂN
//      mới được đánh dấu isSettled (get_escrow_detail trả được cả số ƯỚC TÍNH
//      cho đơn chưa giải ngân — tuyệt đối không dùng riêng nó làm mốc).
//   2) Mỗi đơn đã giải ngân → get_escrow_detail lấy order_income, bóc vào cột
//      GĐ2 gộp của Order (LƯU DƯƠNG như Lazada). escrow_amount = actualPayout
//      là NGUỒN SỰ THẬT tiền về ví — bucket phí chỉ phục vụ cột hiển thị,
//      lệch phân loại không làm sai dòng tiền.
//
// Idempotent: escrow là ảnh chụp cuối cùng của sàn, chạy lặp ghi đè cùng bộ số.
// ============================================================

import type { Channel } from "@prisma/client";
import { prisma } from "../../prisma";
import {
  getEscrowDetail,
  getEscrowList,
  type ShopeeOrderIncome,
} from "./client";
import { getValidShopeeAccessToken } from "./service";

/** Cửa sổ quét release_time — get_escrow_list giới hạn khoảng hẹp, 15 ngày cho an toàn. */
const WINDOW_SEC = 15 * 24 * 60 * 60;
const PAGE_SIZE = 100;
const MAX_PAGES = 200; // chốt chặn phân trang vô tận (quota 10k call/ngày)

export interface SyncShopeeSettlementsOptions {
  /** Quét đơn giải ngân trong bao nhiêu ngày gần nhất. Mặc định 90. */
  daysBack?: number;
}

export interface SyncShopeeSettlementsResult {
  transactions: number; // số đơn giải ngân đọc được từ escrow_list
  ordersUpdated: number; // số Order được ghi số phí thật
  ordersNotFound: number; // sàn báo giải ngân nhưng đơn chưa đồng bộ về Hubsell
  pages: number;
}

const n = (v: number | undefined | null): number => Number(v ?? 0) || 0;

/**
 * Quy đổi order_income → cột GĐ2 gộp của Order (mọi cột LƯU DƯƠNG).
 * Export riêng để test nghiệm thu bằng payload chuẩn không cần gọi sàn
 * (cùng cách e2e với upsertShopeeOrderTx).
 */
export function mapShopeeEscrowToOrder(
  income: ShopeeOrderIncome,
  releasedAt: Date
) {
  // Vận chuyển: phần shop THỰC CHỊU = cước thật − (khách trả + sàn trợ + 3PL
  // giảm). Ưu tiên final_shipping_fee khi sàn trả (số ròng CÓ DẤU đã điều
  // chỉnh vào payout; âm = shop bị trừ thêm).
  const shipActual = n(income.actual_shipping_fee);
  const shipCovered =
    n(income.buyer_paid_shipping_fee) +
    n(income.shopee_shipping_rebate) +
    n(income.shipping_fee_discount_from_3pl);
  const finalShip = n(income.final_shipping_fee);
  const shipBorne =
    finalShip !== 0
      ? Math.max(-finalShip, 0)
      : Math.max(shipActual - shipCovered, 0);

  return {
    isSettled: true,
    settledAt: releasedAt,
    // Phí lõi — khớp trục cột của bảng Lãi/Lỗ (fixed+payment / service / affiliate).
    fixedFee: n(income.commission_fee),
    paymentFee:
      n(income.seller_transaction_fee) + n(income.credit_card_transaction_fee),
    serviceFee:
      n(income.service_fee) +
      n(income.campaign_fee) +
      n(income.delivery_seller_protection_fee_premium_amount) +
      n(income.reverse_shipping_fee),
    affiliateFee: n(income.order_ams_commission_fee),
    // Voucher/xu SHOP chịu vs SÀN tài trợ (sàn hoàn lại cho shop → thu nhập).
    sellerVoucher: n(income.voucher_from_seller) + n(income.seller_coin_cash_back),
    platformSubsidy: n(income.voucher_from_shopee) + n(income.coins),
    // Vận chuyển & thuế thu hộ.
    shippingFeeActual: shipActual,
    shippingFeeQuoted: shipCovered,
    shippingFeeDiff: shipBorne,
    taxWithheld: n(income.escrow_tax) + n(income.withholding_tax),
    // Tiền THỰC về ví — tổng đại số cuối cùng của sàn, nguồn sự thật dòng tiền.
    actualPayout: n(income.escrow_amount),
  };
}

/**
 * Kéo đối soát thật của MỘT gian Shopee: escrow_list (đơn đã giải ngân trong
 * daysBack ngày) → escrow_detail từng đơn → ghi cột GĐ2 của Order.
 */
export async function syncShopeeSettlements(
  channel: Channel,
  opts: SyncShopeeSettlementsOptions = {}
): Promise<SyncShopeeSettlementsResult> {
  const { accessToken, shopId } = await getValidShopeeAccessToken(channel);
  const daysBack = opts.daysBack ?? 90;

  const result: SyncShopeeSettlementsResult = {
    transactions: 0,
    ordersUpdated: 0,
    ordersNotFound: 0,
    pages: 0,
  };

  // Gom (order_sn → thời điểm giải ngân) trên toàn lượt chạy rồi mới ghi DB.
  const released = new Map<string, Date>();

  const nowSec = Math.floor(Date.now() / 1000);
  const startFrom = nowSec - daysBack * 24 * 60 * 60;

  for (
    let winFrom = startFrom;
    winFrom < nowSec && result.pages < MAX_PAGES;
    winFrom += WINDOW_SEC
  ) {
    const winTo = Math.min(winFrom + WINDOW_SEC, nowSec);
    let pageNo = 1; // Shopee đánh số trang từ 1
    let more = true;

    while (more && result.pages < MAX_PAGES) {
      const data = await getEscrowList({
        accessToken,
        shopId,
        releaseTimeFrom: winFrom,
        releaseTimeTo: winTo,
        pageNo,
        pageSize: PAGE_SIZE,
      });
      result.pages++;

      const list = data.response?.escrow_list ?? [];
      for (const row of list) {
        if (!row.order_sn) continue;
        result.transactions++;
        released.set(
          row.order_sn,
          row.escrow_release_time
            ? new Date(row.escrow_release_time * 1000)
            : new Date()
        );
      }

      more = data.response?.more === true && list.length > 0;
      pageNo++;
    }
  }

  // Chi tiết từng đơn đã giải ngân → cột GĐ2. Lỗi MỘT đơn không chặn đơn khác.
  for (const [orderSn, releasedAt] of released) {
    const order = await prisma.order.findUnique({
      where: { channelId_orderCode: { channelId: channel.id, orderCode: orderSn } },
      select: { id: true },
    });
    if (!order) {
      result.ordersNotFound++;
      continue;
    }

    try {
      const detail = await getEscrowDetail({ accessToken, shopId, orderSn });
      const income = detail.response?.order_income;
      if (!income) continue;

      await prisma.order.update({
        where: { id: order.id },
        data: mapShopeeEscrowToOrder(income, releasedAt),
      });
      result.ordersUpdated++;
    } catch (err) {
      console.error(
        `[Shopee Settle] Lỗi escrow_detail đơn ${orderSn} (gian "${channel.shopName}"):`,
        (err as Error).message
      );
    }
  }

  return result;
}
