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
import { ShippingStatus } from "@prisma/client";
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
 * Quy đổi order_income → cột nguyên bản của Order (mọi cột LƯU DƯƠNG),
 * MAP 1:1 THEO ĐÚNG THIẾT KẾ BẢNG SHOPEE 24 CỘT (chốt chủ shop 31/07 —
 * KHÔNG gộp nhiều loại phí vào một bucket kiểu Lazada):
 *   commission_fee → fixedFee ("Phí sàn CĐ"), seller_transaction_fee (+thẻ
 *   tín dụng) → paymentFee ("TT"), service_fee → serviceFee ("PiShip/Xtra"),
 *   order_ams → affiliateFee, voucher shop/xu shop hoàn → sellerVoucher
 *   ("Trợ giá người bán"), voucher sàn + xu sàn → platformSubsidy ("Trợ giá
 *   Shopee"), shopee_shipping_rebate → shipSubsidyPlatform ("Trợ giá VC
 *   Shopee"), estimated/actual → shippingFeeQuoted/Actual.
 * Các phí lẻ KHÔNG có cột riêng (campaign, bảo hiểm, ship hoàn...) KHÔNG ép
 * vào cột nào — số tiền của chúng vẫn nằm trong escrow_amount (actualPayout),
 * nguồn sự thật mọi phép tính lợi nhuận, nên dòng tiền không sót một đồng.
 * Export riêng để test nghiệm thu bằng payload chuẩn không cần gọi sàn.
 */
export function mapShopeeEscrowToOrder(
  income: ShopeeOrderIncome,
  releasedAt: Date
) {
  return {
    isSettled: true,
    settledAt: releasedAt,
    ...mapShopeeEscrowFields(income),
  };
}

/**
 * Phần THÂN dùng chung của mapper: bóc order_income → các cột phí/payout,
 * KHÔNG đụng cờ isSettled/settledAt. Dùng cho cả 2 luồng:
 *   - Đơn ĐÃ giải ngân (mapShopeeEscrowToOrder): số THẬT + isSettled=true.
 *   - Đơn CHƯA giải ngân (syncShopeePendingEscrowEstimates): get_escrow_detail
 *     trả SỐ ƯỚC TÍNH của chính Shopee (khớp màn "Doanh thu đơn hàng ước tính"
 *     Seller Center) — ghi vào cùng bộ cột để P&L hiển thị real-time, nhưng
 *     GIỮ isSettled=false làm nhãn "chờ đối soát".
 */
export function mapShopeeEscrowFields(income: ShopeeOrderIncome) {
  // "Chênh lệch phí VC" = phần ship shop THỰC CHỊU = cước thật − (khách trả +
  // sàn trợ + 3PL giảm). KHÔNG dùng final_shipping_fee: đối chiếu đơn VN thật
  // 2607303CGEHBCA (05/08/2026) — final_shipping_fee = −11.000 trong khi khách
  // trả 11.000 + sàn trợ 30.000 đã phủ đủ cước 41.000, escrow KHÔNG trừ đồng
  // ship nào (field này không tính phần khách trả, tin nó là bịa phí cho shop).
  const shipActual = n(income.actual_shipping_fee);
  const shipCovered =
    n(income.buyer_paid_shipping_fee) +
    n(income.shopee_shipping_rebate) +
    n(income.shipping_fee_discount_from_3pl);
  const shipBorne = Math.max(shipActual - shipCovered, 0);

  // Phí xử lý giao dịch: đơn VN thật trả seller_transaction_fee VÀ
  // credit_card_transaction_fee CÙNG một giá trị cho CÙNG một khoản (Seller
  // Center chỉ hiện MỘT dòng 18.000) — cộng cả hai là đếm đôi. Lấy
  // seller_transaction_fee làm chuẩn, chỉ rơi về credit_card khi seller = 0.
  const sellerTxnFee = n(income.seller_transaction_fee);
  const creditTxnFee = n(income.credit_card_transaction_fee);

  return {
    // Phí sàn — mỗi loại đúng một cột như file quyết toán Shopee.
    fixedFee: n(income.commission_fee),
    paymentFee: sellerTxnFee > 0 ? sellerTxnFee : creditTxnFee,
    serviceFee: n(income.service_fee),
    // Phí "dịch vụ PiShip" (bảo hiểm giao hàng) — Seller Center tách dòng
    // riêng khỏi Phí Dịch Vụ nên map cột riêng, không ép vào serviceFee.
    sellerProtectionFee: n(income.shipping_seller_protection_fee_amount),
    affiliateFee: n(income.order_ams_commission_fee),
    // Trợ giá: SHOP chịu (voucher + xu shop hoàn) vs SÀN bù THẬT cho shop.
    sellerVoucher:
      n(income.voucher_from_seller) + n(income.seller_coin_cash_back),
    // "Trợ giá Shopee" = shopee_discount — sàn giảm trực tiếp vào giá bán rồi
    // BÙ LẠI trong escrow (đơn 260728T943X8PX: +8.750 khớp payout từng đồng).
    // KHÔNG dùng voucher_from_shopee/coins: đó là tiền sàn bù cho NGƯỜI MUA,
    // không chảy vào ví shop (đơn 2607303CGEHBCA: 52.020 không có trong escrow).
    platformSubsidy: n(income.shopee_discount),
    // Vận chuyển — đúng cột nhóm "Phí vận chuyển" của bảng Shopee.
    shippingFeeQuoted: n(income.estimated_shipping_fee),
    shippingFeeActual: shipActual,
    shipSubsidyPlatform: n(income.shopee_shipping_rebate),
    shippingFeeDiff: shipBorne,
    // Thuế sàn thu hộ. Đơn VN dùng cặp withholding_vat_tax/withholding_pit_tax
    // (GTGT + TNCN) — escrow_tax/withholding_tax là tên vùng khác, giữ để
    // tương thích (payload thật VN không trả các field đó nên không đếm đôi).
    taxWithheld:
      n(income.escrow_tax) +
      n(income.withholding_tax) +
      n(income.withholding_vat_tax) +
      n(income.withholding_pit_tax),
    // Tiền THỰC về ví — tổng đại số cuối cùng của sàn, GỐC của mọi phép tính
    // lợi nhuận (computePnlRow: platformRevenue/profitAfterTax đọc từ đây).
    actualPayout: n(income.escrow_amount),
    // adWalletTopup / shipSubsidyShop: escrow không có nguồn — giữ nguyên 0.
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

// ============================================================
// ƯỚC TÍNH PHÍ CHO ĐƠN CHƯA GIẢI NGÂN — P&L REAL-TIME
//
// get_escrow_detail trả được SỐ ƯỚC TÍNH của chính Shopee cho đơn CHƯA payout
// (khớp màn "Doanh thu đơn hàng ước tính" trên Seller Center). Yêu cầu chủ shop
// 05/08: bảng Lãi/Lỗ phải real-time — đơn mới có phí tạm tính ngay, không chờ
// giải ngân. Ghi vào CÙNG bộ cột phí nhưng GIỮ isSettled=false ("chờ đối
// soát"); khi sàn giải ngân thật, syncShopeeSettlements ghi đè số cuối cùng.
// ============================================================

export interface SyncShopeePendingEstimatesOptions {
  /** Chỉ ước tính cho đơn tạo trong N ngày gần nhất. Mặc định 7. */
  daysBack?: number;
  /** Trần số đơn mỗi lượt (mỗi đơn 1 call API — giữ quota). */
  limit?: number;
}

export interface SyncShopeePendingEstimatesResult {
  scanned: number;
  updated: number;
  errors: number;
}

export async function syncShopeePendingEscrowEstimates(
  channel: Channel,
  opts: SyncShopeePendingEstimatesOptions = {}
): Promise<SyncShopeePendingEstimatesResult> {
  const { accessToken, shopId } = await getValidShopeeAccessToken(channel);
  const daysBack = opts.daysBack ?? 7;
  const limit = opts.limit ?? 300;

  // Đơn CHƯA quyết toán, chưa hủy, mới tạo gần đây — đơn hủy không có escrow,
  // đơn đã settled do luồng chính thống quản.
  const orders = await prisma.order.findMany({
    where: {
      channelId: channel.id,
      isSettled: false,
      shippingStatus: { not: ShippingStatus.CANCELLED },
      createdAt: { gte: new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000) },
    },
    select: { id: true, orderCode: true },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const result: SyncShopeePendingEstimatesResult = {
    scanned: orders.length,
    updated: 0,
    errors: 0,
  };

  for (const order of orders) {
    try {
      const detail = await getEscrowDetail({
        accessToken,
        shopId,
        orderSn: order.orderCode,
      });
      const income = detail.response?.order_income;
      // Đơn quá mới sàn chưa dựng xong bản nháp phí → bỏ qua êm, lượt sau lấy.
      if (!income) continue;

      await prisma.order.update({
        where: { id: order.id },
        data: mapShopeeEscrowFields(income), // KHÔNG đụng isSettled/settledAt
      });
      result.updated++;
    } catch (err) {
      // Lỗi một đơn (đơn chưa có escrow, mạng...) không chặn đơn khác.
      result.errors++;
      console.error(
        `[Shopee Estimate] Lỗi escrow_detail đơn ${order.orderCode} (gian "${channel.shopName}"):`,
        (err as Error).message
      );
    }
  }

  return result;
}
