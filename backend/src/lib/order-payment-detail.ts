/**
 * "THÔNG TIN THANH TOÁN" của MỘT đơn cho màn Chi tiết đơn hàng trên app mobile
 * (nút QR giữa thanh tab — anh Trung 04/10/2026). Bố cục theo trang chi tiết đơn
 * của Shopee Seller Center: Tổng tiền sản phẩm → Phí vận chuyển → Phụ phí → Thuế
 * → Doanh thu đơn hàng (ước tính).
 *
 * CỐ Ý KHÔNG có giá vốn và lợi nhuận: màn quét là màn ai cầm máy cũng xem được
 * (kể cả nhân viên kho). Lãi/lỗ chỉ nằm ở các trang Tài chính có phân quyền.
 *
 * Nguồn số theo sàn (không tự ước phí — sàn chưa báo thì trạng thái "none"):
 *   · Shopee : các cột phí trên Order — số thật khi đã quyết toán, số ƯỚC TÍNH
 *     của Shopee (get_escrow_detail) khi chưa. Thuế chỉ có TỔNG (chưa tách GTGT / TNCN).
 *   · TikTok : bản kê TiktokOrderSettlement — đã quyết toán hoặc ước tính của sàn.
 *   · Lazada : sao kê LazadaOrderSettlement — CHỈ có sau khi sàn ghi sao kê; đơn
 *     chưa có sao kê thì không có khối phí.
 */
import type { Prisma } from "@prisma/client";

export const ORDER_PAYMENT_INCLUDE = {
  channel: { select: { channelName: true } },
  items: { select: { quantity: true, price: true } },
  lazadaSettlement: true,
  tiktokSettlement: true,
} satisfies Prisma.OrderInclude;

type PaymentOrder = Prisma.OrderGetPayload<{ include: typeof ORDER_PAYMENT_INCLUDE }>;

export interface PaymentLine {
  label: string;
  /** Số CÓ DẤU: âm = sàn trừ, dương = shop được cộng. */
  amount: number;
}

export interface PaymentGroup {
  label: string;
  /** null = nhóm chỉ để tham chiếu, không cộng tổng (ship Lazada trộn hai nguồn). */
  total: number | null;
  lines: PaymentLine[];
}

export interface OrderPaymentDetail {
  /** settled = số quyết toán thật; estimated = sàn ước tính; none = sàn chưa báo phí. */
  status: "settled" | "estimated" | "none";
  productTotal: number;
  groups: PaymentGroup[];
  /** Tiền sàn trả về cho đơn — null khi status = none. */
  payout: number | null;
}

const n = (v: Prisma.Decimal | number | null | undefined) => Number(v ?? 0);

/** Bỏ dòng 0, tính tổng nhóm; nhóm rỗng trả null để nơi gọi lọc đi. */
function group(label: string, lines: PaymentLine[], opts: { noTotal?: boolean } = {}): PaymentGroup | null {
  const kept = lines.filter((l) => Math.abs(l.amount) >= 0.5);
  if (kept.length === 0) return null;
  return {
    label,
    total: opts.noTotal ? null : kept.reduce((s, l) => s + l.amount, 0),
    lines: kept,
  };
}

const compact = (gs: (PaymentGroup | null)[]) => gs.filter((g): g is PaymentGroup => g !== null);

export function orderPaymentDetail(o: PaymentOrder): OrderPaymentDetail {
  const itemsTotal = o.items.reduce((s, it) => s + it.quantity * n(it.price), 0);
  const fallbackTotal = itemsTotal > 0 ? itemsTotal : n(o.totalAmount);
  const channel = o.channel.channelName;

  if (channel === "TIKTOK") {
    const t = o.tiktokSettlement;
    if (!t) return { status: "none", productTotal: fallbackTotal, groups: [], payout: null };
    return {
      status: t.estimated ? "estimated" : "settled",
      productTotal: n(t.grossSales) || fallbackTotal,
      groups: compact([
        group("Giảm giá của shop", [
          { label: "Chiết khấu của nhà bán hàng", amount: n(t.sellerDiscount) },
        ]),
        group("Hoàn tiền", [
          { label: "Doanh thu hoàn trả", amount: n(t.refundGross) },
          { label: "Chiết khấu được trả lại khi hoàn", amount: n(t.sellerDiscountRefund) },
        ]),
        group(
          "Phí vận chuyển",
          [
            { label: "Phí vận chuyển thực tế", amount: n(t.shipActual) },
            { label: "Khách hàng trả", amount: n(t.shipCustomerPaid) },
            { label: "Nền tảng chiết khấu", amount: n(t.shipPlatformDiscount) },
            { label: "Trợ cấp phí vận chuyển", amount: n(t.shipSubsidy) },
            { label: "Nhà bán hàng chiết khấu", amount: n(t.shipSellerDiscount) },
            { label: "Phí vận chuyển trả hàng", amount: n(t.shipReturn) },
            { label: "Phụ phí logistics khác", amount: n(t.shipOther) },
            { label: "Sàn bồi hoàn phí vận chuyển", amount: n(t.shipReimbursement) },
          ],
          // Các dòng là bóc tách tham chiếu; số shop thực chịu là shippingCost.
          { noTotal: true }
        ),
        group("Phí vận chuyển shop chịu", [{ label: "Phí vận chuyển của nhà bán hàng", amount: n(t.shippingCost) }]),
        group("Phụ phí", [
          { label: "Phí hoa hồng nền tảng", amount: n(t.feeCommission) },
          { label: "Phí giao dịch", amount: n(t.feeTransaction) },
          { label: "Phí xử lý đơn hàng", amount: n(t.feeOrderProcessing) },
          { label: "Phí Freeship Xtra", amount: n(t.feeSfp) },
          { label: "Phí Voucher Xtra", amount: n(t.feeVoucherXtra) },
          { label: "Phí Flash Sale", amount: n(t.feeFlashSale) },
          { label: "Hoa hồng affiliate", amount: n(t.feeAffiliate) },
          { label: "Hoa hồng quảng cáo affiliate", amount: n(t.feeAffiliateAds) },
          { label: "Hoa hồng đối tác affiliate", amount: n(t.feeAffiliatePartner) },
          { label: "Nạp quảng cáo từ đơn (GMV Max)", amount: n(t.feeGmvMax) },
          { label: "Phí khác", amount: n(t.feeOther) },
        ]),
        group("Thuế", [
          { label: "Thuế GTGT", amount: n(t.taxVat) },
          { label: "Thuế TNCN", amount: n(t.taxPit) },
          { label: "Thuế khác", amount: n(t.taxOther) },
        ]),
        group("Điều chỉnh", [{ label: t.adjustmentTypes || "Khoản điều chỉnh", amount: n(t.adjustmentAmount) }]),
      ]),
      payout: n(t.settlementAmount),
    };
  }

  if (channel === "LAZADA") {
    const l = o.lazadaSettlement;
    if (!l || !o.isSettled) {
      return { status: "none", productTotal: n(o.totalAmount) || fallbackTotal, groups: [], payout: null };
    }
    return {
      status: "settled",
      productTotal: n(l.itemRevenue) || n(o.totalAmount) || fallbackTotal,
      groups: compact([
        group("Giảm giá của shop", [{ label: "Voucher người bán", amount: n(l.sellerVoucher) }]),
        group(
          "Phí vận chuyển",
          [
            { label: "Phí vận chuyển", amount: n(l.shipFee) },
            { label: "Khách trả", amount: n(l.shipFeeCustomer) },
            { label: "Nền tảng giảm giá", amount: n(l.shipDiscountPlatform) },
            { label: "Người bán giảm giá", amount: n(l.shipDiscountSeller) },
            { label: "Phí vận chuyển hoàn", amount: n(l.shipFeeReturn) },
          ],
          // Cước gốc / khách trả / giảm giá đến từ API đơn hàng, không phải dòng
          // sao kê — chỉ để tham chiếu, không cộng vào tiền về.
          { noTotal: true }
        ),
        group("Phụ phí", [
          { label: "Phí cố định", amount: n(l.feeFixed) },
          { label: "Phí xử lý đơn hàng", amount: n(l.feeOrderProcessing) },
          { label: "Phí thanh toán", amount: n(l.feePayment) },
          { label: "Phí hoa hồng", amount: n(l.feeCommission) },
          { label: "Phí vận chuyển người bán trả", amount: n(l.feeShipSeller) },
          { label: "Trợ giá vận chuyển (người bán)", amount: n(l.shipSubsidySeller) },
          { label: "Phí Freeship Max", amount: n(l.feeFreeshipMax) },
          { label: "Phí Cashback Max", amount: n(l.feeCashbackMax) },
          { label: "Phí Discovery tài trợ", amount: n(l.feeSponsoredDiscovery) },
          { label: "Phí Lazada Bonus", amount: n(l.feeLazadaBonus) },
          { label: "LZD đồng tài trợ", amount: n(l.bonusLzdCofund) },
          { label: "Phí đánh giá người mua", amount: n(l.feeBuyerReview) },
          { label: "Hoa hồng Lazpick / LazTop", amount: n(l.feeLazpick) },
          { label: "Điều chỉnh phí vận chuyển", amount: n(l.shipFeeAdjustment) },
          { label: "Phí chiến dịch", amount: n(l.feeCampaign) },
          { label: "Phí tiếp thị liên kết", amount: n(l.feeAffiliate) },
          { label: "Phí hạ tầng", amount: n(l.feeInfrastructure) },
          { label: "Phí khác", amount: n(l.feeOther) },
          { label: "Trợ giá từ sàn", amount: n(l.subsidyOther) },
        ]),
        group("Thuế", [
          { label: "Thuế GTGT", amount: n(l.vatFee) },
          { label: "Thuế TNCN", amount: n(l.incomeTaxFee) },
        ]),
      ]),
      payout: n(l.actualPayout),
    };
  }

  // SHOPEE (và kênh khác dùng chung bộ cột phí của Order). Chưa có số "Tổng tiền"
  // của sàn (escrow thật / ước tính) thì coi như sàn chưa báo phí.
  const payout = n(o.actualPayout);
  if (payout === 0) return { status: "none", productTotal: fallbackTotal, groups: [], payout: null };

  const shipActual = n(o.shippingFeeActual);
  const shipRebate = n(o.shipSubsidyPlatform);
  const shipBorne = n(o.shippingFeeDiff);
  // Phần cước do người mua trả hoặc hãng vận chuyển giảm — suy từ ba số trên.
  const shipOthers = Math.max(shipActual - shipRebate - shipBorne, 0);
  return {
    status: o.isSettled ? "settled" : "estimated",
    productTotal: fallbackTotal,
    groups: compact([
      group("Giảm giá của shop", [{ label: "Voucher / xu của shop", amount: -n(o.sellerVoucher) }]),
      group("Sàn trợ giá sản phẩm", [{ label: "Shopee trợ giá", amount: n(o.platformSubsidy) }]),
      group("Hoàn tiền", [{ label: "Hoàn tiền cho người mua", amount: -n(o.refundedAmount) }]),
      group("Phí vận chuyển", [
        { label: "Phí vận chuyển", amount: -shipActual },
        { label: "Shopee trợ giá phí vận chuyển", amount: shipRebate },
        { label: "Người mua trả / hãng vận chuyển giảm", amount: shipOthers },
      ]),
      group("Phụ phí", [
        { label: "Phí cố định", amount: -n(o.fixedFee) },
        { label: "Phí dịch vụ", amount: -n(o.serviceFee) },
        { label: "Phí xử lý giao dịch", amount: -n(o.paymentFee) },
        { label: "Phí dịch vụ PiShip", amount: -n(o.sellerProtectionFee) },
        { label: "Phí tiếp thị liên kết", amount: -n(o.affiliateFee) },
      ]),
      group("Thuế", [{ label: "Thuế GTGT + TNCN sàn khấu trừ", amount: -n(o.taxWithheld) }]),
    ]),
    payout,
  };
}
