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
import { Prisma, ShippingStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
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
    // Riêng VOUCHER (không xu hoàn) — chiết khấu trừ vào hóa đơn (issue-order):
    // voucher giảm thẳng số khách trả đơn này, xu hoàn thì khách vẫn trả đủ.
    sellerDiscountVoucher: n(income.voucher_from_seller),
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
    // ĐƠN HOÀN: tiền sàn đã trả lại khách (API trả số ÂM → lưu magnitude
    // DƯƠNG như mọi cột khác). computePnlRow dùng làm số hoàn THẬT thay cho
    // tạm tính — phủ cả 4 kịch bản refund-only/partial/return của Shopee.
    refundedAmount: Math.abs(n(income.seller_return_refund)),
    // adWalletTopup / shipSubsidyShop: escrow không có nguồn — giữ nguyên 0.
  };
}

// ============================================================
// KIỂM TOÁN "SÀN TRẢ THIẾU" — DIFF TỪNG THÀNH PHẦN (01/09/2026)
//
// Bài học đơn 26082480K9AARJ: so TỔNG expectedPayout − escrow thì mọi khoản
// chỉ chốt lúc quyết toán (hoa hồng affiliate AMS, phí sàn đẻ mới sau này...)
// đều thành cáo buộc oan. Đổi luật: chụp NGUYÊN BẢN order_income ước tính làm
// mẫu số, lúc quyết toán diff từng thành phần —
//   · Phí CÓ mẫu số ước tính mà thu vượt / trợ giá HỨA mà bù thiếu → lời hứa
//     vỡ của chính sàn, buộc tội được.
//   · Khoản chỉ chốt lúc giải ngân hoặc shop tự chi → ghi nhận, KHÔNG buộc tội.
//   · Phần chênh không bóc tách được (trường lạ ngoài danh mục) → "thiếu mẫu
//     số thì không kết luận" — cùng triết lý đã chốt với Lazada. Sàn thêm
//     loại phí mới thì nó rơi vào đây: im lặng theo dõi thay vì báo oan.
// ============================================================

/** Bản income đã ép về map số thuần — dạng chung cho snapshot lẫn diff. */
type IncomeSnapshot = Record<string, number>;

/** Đọc một trường của snapshot, thiếu/NaN về 0 (cùng tinh thần hàm n). */
const gv = (inc: IncomeSnapshot, key: string): number =>
  Number(inc[key] ?? 0) || 0;

/**
 * Chụp các trường SỐ của order_income (bỏ mảng/object lồng — không dùng để
 * diff). Ghi vào Order.expectedIncome mỗi lần ước tính; bản mới nhất trước
 * giải ngân chính là "lời hứa" gần nhất của sàn.
 */
export function snapshotIncome(income: ShopeeOrderIncome): IncomeSnapshot {
  const out: IncomeSnapshot = {};
  for (const [key, value] of Object.entries(income)) {
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

/** Một dòng diff ước tính ↔ quyết toán — lưu payoutShortfallDetail, FE hiển thị. */
export interface ShortfallDetailItem {
  key: string;
  label: string;
  expected: number;
  actual: number;
  /** Tiền shop NHẬN THIẾU vì thành phần này so với ước tính (âm = nhận dư). */
  lost: number;
  /** true = tính vào payoutShortfall ("sàn trả thiếu" thật, đáng khiếu nại). */
  accused: boolean;
  note?: string;
}

interface IncomeComponent {
  key: string;
  label: string;
  read: (inc: IncomeSnapshot) => number;
  /** "fee": quyết toán CAO hơn ước tính là mất tiền; "subsidy": THẤP hơn là mất. */
  direction: "fee" | "subsidy";
  /** false = khoản chính đáng/chốt-muộn: ghi vào detail nhưng không buộc tội. */
  accusable: boolean;
  note?: string;
}

/** Ship shop THỰC CHỊU — GIỮ KHỚP công thức shipBorne trong mapShopeeEscrowFields. */
const shipBorneOf = (inc: IncomeSnapshot): number =>
  Math.max(
    gv(inc, "actual_shipping_fee") -
      (gv(inc, "buyer_paid_shipping_fee") +
        gv(inc, "shopee_shipping_rebate") +
        gv(inc, "shipping_fee_discount_from_3pl")),
    0
  );

/**
 * Danh mục thành phần diff. Trường của order_income KHÔNG có mặt ở đây (kể cả
 * trường tương lai sàn thêm) tự rơi vào dòng "chênh chưa bóc tách" không buộc
 * tội — thêm loại phí mới chỉ việc bổ sung một dòng, không sửa thuật toán.
 */
const INCOME_COMPONENTS: IncomeComponent[] = [
  // — Phí sàn CÓ trong ước tính: thu vượt là lời hứa vỡ → buộc tội —
  {
    key: "commission_fee",
    label: "Phí cố định (hoa hồng sàn)",
    read: (i) => gv(i, "commission_fee"),
    direction: "fee",
    accusable: true,
  },
  {
    key: "service_fee",
    label: "Phí Dịch Vụ (Freeship/Voucher Xtra)",
    read: (i) => gv(i, "service_fee"),
    direction: "fee",
    accusable: true,
  },
  {
    // Cùng luật chống đếm đôi seller/credit của mapShopeeEscrowFields.
    key: "transaction_fee",
    label: "Phí xử lý giao dịch",
    read: (i) => {
      const seller = gv(i, "seller_transaction_fee");
      return seller > 0 ? seller : gv(i, "credit_card_transaction_fee");
    },
    direction: "fee",
    accusable: true,
  },
  {
    key: "piship_fee",
    label: "Phí dịch vụ PiShip",
    read: (i) => gv(i, "shipping_seller_protection_fee_amount"),
    direction: "fee",
    accusable: true,
  },
  {
    key: "delivery_protection_fee",
    label: "Phí bảo hiểm giao hàng",
    read: (i) => gv(i, "delivery_seller_protection_fee_premium_amount"),
    direction: "fee",
    accusable: true,
  },
  // — Trợ giá sàn HỨA bù vào payout: bù thiếu cũng là mất tiền → buộc tội —
  {
    key: "shopee_discount",
    label: "Trợ giá Shopee vào giá bán",
    read: (i) => gv(i, "shopee_discount"),
    direction: "subsidy",
    accusable: true,
  },
  // — Khoản chính đáng / chỉ chốt lúc quyết toán: KHÔNG buộc tội —
  {
    key: "ams_fee",
    label: "Phí hoa hồng Tiếp thị liên kết (AMS)",
    read: (i) => gv(i, "order_ams_commission_fee"),
    direction: "fee",
    accusable: false,
    note: "Hoa hồng affiliate chỉ chốt lúc quyết toán — chi phí thuê KOC/affiliate của shop, không phải sàn trả thiếu.",
  },
  {
    key: "campaign_fee",
    label: "Phí chương trình khuyến mãi",
    read: (i) => gv(i, "campaign_fee"),
    direction: "fee",
    accusable: false,
    note: "Phí chương trình shop tự đăng ký với sàn.",
  },
  {
    key: "seller_voucher",
    label: "Voucher/xu do shop chịu",
    read: (i) => gv(i, "voucher_from_seller") + gv(i, "seller_coin_cash_back"),
    direction: "fee",
    accusable: false,
    note: "Khuyến mãi shop tự chi cho khách — không phải phí sàn.",
  },
  {
    key: "shipping",
    label: "Phí vận chuyển shop chịu",
    read: shipBorneOf,
    direction: "fee",
    accusable: false,
    note: "Đã theo dõi riêng ở rổ Truy thu phí ship — không tính đôi.",
  },
  {
    key: "tax",
    label: "Thuế sàn thu hộ (GTGT + TNCN)",
    read: (i) =>
      gv(i, "escrow_tax") +
      gv(i, "withholding_tax") +
      gv(i, "withholding_vat_tax") +
      gv(i, "withholding_pit_tax"),
    direction: "fee",
    accusable: false,
    note: "Thuế thu hộ theo giá trị quyết toán — nghĩa vụ thuế, không khiếu nại sàn được.",
  },
  {
    key: "selling_price",
    label: "Giá bán ghi nhận",
    read: (i) => gv(i, "order_selling_price"),
    direction: "subsidy",
    accusable: false,
    note: "Giá trị hàng thay đổi (điều chỉnh/hủy một phần) — không phải phí sàn.",
  },
];

export interface PayoutAuditResult {
  shortfall: number;
  detail: ShortfallDetailItem[] | null;
}

/**
 * So bản income ước tính ↔ quyết toán theo TỪNG THÀNH PHẦN.
 * payoutShortfall = tổng phần mất của các thành phần buộc-tội-được, chặn trần
 * bằng mức tụt escrow thật (các thành phần rẻ đi bù trừ cho thành phần đắt lên
 * — không thể "trả thiếu" nhiều hơn số tiền thực sự hụt).
 */
export function computePayoutShortfall(
  expected: IncomeSnapshot | null,
  final: IncomeSnapshot
): PayoutAuditResult {
  if (!expected) return { shortfall: 0, detail: null };
  const gap = gv(expected, "escrow_amount") - gv(final, "escrow_amount");
  // Nhận đủ hoặc dư so với sàn hứa → không có gì để soi.
  if (gap <= 0) return { shortfall: 0, detail: null };

  const detail: ShortfallDetailItem[] = [];
  let explained = 0;
  let accusedTotal = 0;
  for (const c of INCOME_COMPONENTS) {
    const exp = c.read(expected);
    const act = c.read(final);
    const lost = c.direction === "fee" ? act - exp : exp - act;
    if (lost === 0) continue;
    explained += lost;
    const accused = c.accusable && lost > 0;
    if (accused) accusedTotal += lost;
    detail.push({
      key: c.key,
      label: c.label,
      expected: exp,
      actual: act,
      lost,
      accused,
      ...(c.note ? { note: c.note } : {}),
    });
  }

  // Phần chênh KHÔNG bóc tách được theo thành phần đã biết — chỗ "sàn đẻ loại
  // phí mới" rơi vào: ghi nhận để theo dõi, không buộc tội (thiếu mẫu số thì
  // không kết luận). Ngưỡng 1đ chỉ để nuốt sai số làm tròn.
  const residual = gap - explained;
  if (Math.abs(residual) >= 1) {
    detail.push({
      key: "unexplained",
      label: "Chênh lệch chưa bóc tách được",
      expected: 0,
      actual: 0,
      lost: residual,
      accused: false,
      note: "Phần chênh nằm ở trường ngoài danh mục theo dõi — ghi lại để soi thêm, không buộc tội khi thiếu mẫu số.",
    });
  }

  return { shortfall: Math.min(accusedTotal, gap), detail };
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
      // affiliateFee: mẫu số phí AMS cho chế độ tương thích bên dưới — chỉ
      // còn là GIÁ TRỊ ƯỚC TÍNH khi đơn CHƯA settle (isSettled phân xử).
      select: {
        id: true,
        expectedPayout: true,
        expectedIncome: true,
        affiliateFee: true,
        isSettled: true,
      },
    });
    if (!order) {
      result.ordersNotFound++;
      continue;
    }

    try {
      const detail = await getEscrowDetail({ accessToken, shopId, orderSn });
      const income = detail.response?.order_income;
      if (!income) continue;

      // KIỂM TOÁN PHÍ SÀN rổ #2 "sàn trả thiếu": diff snapshot ước tính CỦA
      // CHÍNH SÀN với bản quyết toán, TỪNG THÀNH PHẦN (computePayoutShortfall
      // — chỉ buộc tội phí có mẫu số bị thu vượt, khoản chốt-muộn như hoa hồng
      // AMS không thành cáo buộc). Đơn CÓ hoàn tiền (seller_return_refund ≠ 0)
      // bị loại: payout tụt vì khách hoàn là CHÍNH ĐÁNG, báo là báo oan.
      // Ghi một lần lúc quyết toán; chạy lặp idempotent ra cùng số.
      const hasRefund = Math.abs(n(income.seller_return_refund)) > 0;
      const expectedSnap =
        order.expectedIncome && typeof order.expectedIncome === "object"
          ? (order.expectedIncome as IncomeSnapshot)
          : null;
      let audit: PayoutAuditResult = { shortfall: 0, detail: null };
      if (!hasRefund) {
        if (expectedSnap) {
          audit = computePayoutShortfall(expectedSnap, snapshotIncome(income));
        } else if (order.expectedPayout !== null) {
          // CHẾ ĐỘ TƯƠNG THÍCH — đơn chụp ước tính trước bản diff thành phần:
          // chỉ có tổng expectedPayout, trừ tay được đúng thủ phạm báo oan đã
          // biết là phí AMS. Mẫu số AMS: đơn CHƯA settle thì cột affiliateFee
          // còn là số ước tính; đơn ĐÃ settle (worker quét lặp cửa sổ 90 ngày)
          // cột đã bị ghi đè số thật — coi ước tính là 0 (AMS vốn chỉ chốt lúc
          // quyết toán), kẻo amsDelta tự triệt tiêu và số oan sống lại mỗi giờ.
          const estimatedAms = order.isSettled ? 0 : Number(order.affiliateFee);
          const amsDelta = Math.max(
            n(income.order_ams_commission_fee) - estimatedAms,
            0
          );
          audit.shortfall = Math.max(
            Number(order.expectedPayout) - n(income.escrow_amount) - amsDelta,
            0
          );
        }
      }

      await prisma.order.update({
        where: { id: order.id },
        data: {
          ...mapShopeeEscrowToOrder(income, releasedAt),
          payoutShortfall: audit.shortfall,
          payoutShortfallDetail:
            audit.detail === null
              ? Prisma.DbNull
              : (audit.detail as unknown as Prisma.InputJsonValue),
        },
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
        data: {
          ...mapShopeeEscrowFields(income), // KHÔNG đụng isSettled/settledAt
          // Snapshot MẪU SỐ cho Kiểm toán phí sàn: số escrow ước tính mới nhất
          // của chính Shopee + NGUYÊN BẢN các trường số (diff từng thành phần
          // lúc quyết toán). syncShopeeSettlements KHÔNG ghi đè hai cột này.
          expectedPayout: n(income.escrow_amount),
          expectedIncome: snapshotIncome(income),
        },
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

/**
 * Ước tính phí escrow cho MỘT đơn — móc từ worker webhook: đơn vừa tạo/đổi
 * trạng thái nhận số phí tạm tính NGAY (yêu cầu chủ shop 06/08: P&L đơn mới
 * đang phải chờ nhịp quét nên phí hiện chậm), không đợi vòng quét.
 * Đơn đã isSettled bỏ qua — số THẬT do syncShopeeSettlements quản, không cho
 * ước tính ghi đè. Sàn chưa dựng bản nháp phí (đơn quá mới) → trả false êm,
 * lượt webhook đổi trạng thái sau hoặc vòng quét sẽ lấy được.
 */
export async function syncShopeeEscrowEstimateForOrder(
  channel: Channel,
  orderCode: string
): Promise<boolean> {
  const order = await prisma.order.findUnique({
    where: { channelId_orderCode: { channelId: channel.id, orderCode } },
    select: { id: true, isSettled: true },
  });
  if (!order || order.isSettled) return false;

  const { accessToken, shopId } = await getValidShopeeAccessToken(channel);
  const detail = await getEscrowDetail({ accessToken, shopId, orderSn: orderCode });
  const income = detail.response?.order_income;
  if (!income) return false;

  await prisma.order.update({
    where: { id: order.id },
    data: {
      ...mapShopeeEscrowFields(income), // KHÔNG đụng isSettled/settledAt
      // Snapshot mẫu số Kiểm toán phí sàn — cùng lý do với vòng quét ước tính.
      expectedPayout: n(income.escrow_amount),
      expectedIncome: snapshotIncome(income),
    },
  });
  return true;
}
