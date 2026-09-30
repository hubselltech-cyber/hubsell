// ============================================================
// CÔNG THỨC LÃI/LỖ CỦA MỘT ĐƠN — NGUỒN SỐ GỐC DUY NHẤT (SSOT) CỦA TÀI CHÍNH
//
// Tách khỏi routes/finance.ts ngày 30/09/2026 (giai đoạn 1 sổ cái đơn,
// docs/SO-CAI-DON.md): worker ghi sổ, job đối soát đêm, báo cáo và route đều
// gọi ĐÚNG MỘT hàm computePnlRow ở đây. Sổ cái (order_ledger) chỉ là kết quả
// của hàm này được ghi xuống database để cộng bằng SQL — muốn đổi công thức
// thì sửa ở đây rồi tăng LEDGER_FORMULA_VERSION (lib/order-ledger.ts) để
// worker tính lại nền, KHÔNG sửa số trong sổ bằng tay.
//
// Toàn bộ nội dung bên dưới là mã cũ chuyển nguyên văn (kể cả chú thích lịch
// sử các quyết định của anh Trung) — không đổi một dòng công thức nào.
// routes/finance.ts re-export để các nơi import cũ vẫn chạy.
// ============================================================

import {
  ChannelName,
  Prisma,
  ReturnSolution,
  ReturnStatus,
  ShippingStatus,
} from "@prisma/client";

/** Đơn kèm đủ dữ liệu quan hệ để bóc số Lãi/Lỗ. */
export type PnlOrder = Prisma.OrderGetPayload<{
  include: {
    channel: { select: { channelName: true; shopName: true } };
    // Kèm SKU kho gốc + ảnh để /sku-pnl gom nhóm — cùng tập đơn SSOT.
    items: { include: { product: { select: { skuCode: true; imageUrl: true } } } };
    inventoryLogs: { include: { product: { select: { costPrice: true } } } };
    lazadaSettlement: true;
    tiktokSettlement: true;
  };
}>;

/** Quan hệ đi kèm của tập đơn SSOT — dùng chung cho bản có trần và bản phân trang. */
export const PNL_INCLUDE = {
  channel: { select: { channelName: true, shopName: true } },
  items: { include: { product: { select: { skuCode: true, imageUrl: true } } } },
  inventoryLogs: {
    where: { changeQuantity: { lt: 0 } },
    include: { product: { select: { costPrice: true } } },
  },
  // Sao kê quyết toán chi tiết Lazada — bảng tab Lazada đọc số thật từ đây.
  lazadaSettlement: true,
  // Bản kê chi tiết TikTok (đã quyết toán / ước tính của sàn) — tab TikTok.
  tiktokSettlement: true,
} satisfies Prisma.OrderInclude;

// Kiểu đơn đã kèm dữ liệu tính giá vốn
type DeliveredOrder = Prisma.OrderGetPayload<{
  include: {
    channel: { select: { channelName: true; shopName: true } };
    items: true;
    inventoryLogs: {
      include: { product: { select: { costPrice: true } } };
    };
  };
}>;

// Tính giá vốn (COGS) THỰC TÍNH của một đơn + phát hiện SKU chưa cấu hình giá
// vốn. XỬ LÝ HOÀN/TRẢ: phần hàng đã QUAY VỀ được thu hồi giá vốn (không tính
// COGS nữa) — "đã trả hàng + hoàn tiền thì không lỗ giá trị sản phẩm, chỉ còn
// lỗ phí/ship" (anh Trung 19/08). Căn cứ hàng đã về, KHÔNG bịa:
//   - Kho xác nhận: returnStatus = RECEIVED / RECEIVED_INTACT (đã quét / đã nhập
//     kho), hoặc dòng có returnRestocked.
//   - SÀN xác nhận: returnSolution = RETURN_REFUND + returnDeliveredAt (Shopee
//     reverse_logistics_status = LOGISTICS_DELIVERY_DONE) — kho chưa kịp quét
//     vẫn thu hồi; kho đánh DAMAGED / WRITTEN_OFF sau đó thì mất vốn thật.
//   - Đơn HỦY mà kho đã hoàn tồn (stockRestoredAt) → vốn không mất (hàng còn).
// Phần trả = các dòng có returnedQuantity (từ item[] của sàn); chưa có dữ liệu
// dòng → coi hoàn CẢ ĐƠN. Chỉ hoàn tiền (REFUND_ONLY, khách giữ hàng) thì KHÔNG
// thu hồi gì. DAMAGED / WRITTEN_OFF / đang chờ hàng về: shop vẫn gánh.
export function returnGoodsRecovered(order: {
  shippingStatus: ShippingStatus;
  returnStatus: ReturnStatus;
  returnSolution: ReturnSolution | null;
  returnDeliveredAt: Date | null;
  stockRestoredAt: Date | null;
}): boolean {
  if (
    order.returnStatus === ReturnStatus.DAMAGED ||
    order.returnStatus === ReturnStatus.WRITTEN_OFF
  ) {
    return false;
  }
  if (
    order.returnStatus === ReturnStatus.RECEIVED ||
    order.returnStatus === ReturnStatus.RECEIVED_INTACT ||
    order.returnStatus === ReturnStatus.CLAIM_SETTLED
  ) {
    return true;
  }
  if (order.returnSolution === ReturnSolution.RETURN_REFUND && order.returnDeliveredAt) {
    return true;
  }
  // Đơn HỦY: hàng chưa xuất đi (khách hủy trước giao) hoặc kiện đã quay về
  // người gửi (giao thất bại / hư hỏng khi vận chuyển → sàn hủy, "hoàn trả
  // thành công") → KHÔNG mất giá trị sản phẩm; mất thật chỉ khi kho đánh
  // DAMAGED/WRITTEN_OFF (đã chặn ở trên). Không phụ thuộc stockRestoredAt —
  // đơn không quản tồn kho (giá vốn từ ChannelProduct) không có mốc đó, trước
  // đây bị tính nguyên vốn (đơn 26081266V7GRHG, anh Trung 20/08).
  if (order.shippingStatus === ShippingStatus.CANCELLED) return true;
  return false;
}

function orderCost(order: DeliveredOrder): {
  cost: number;
  recoveredCost: number;
  missingCostPrice: boolean;
} {
  const recoveredAll = returnGoodsRecovered(order);
  if (order.items.length > 0) {
    const hasLineData = order.items.some((it) => it.returnedQuantity > 0);
    let cost = 0;
    let recoveredCost = 0;
    for (const it of order.items) {
      const unit = Number(it.costPriceAtSale);
      // Số lượng thu hồi được vốn:
      //   - dòng đã restock (cờ kho) → phần trả của dòng;
      //   - hàng đã về (kho/sàn/hủy-hoàn-tồn): có dữ liệu dòng → phần trả của
      //     dòng; không có → cả dòng (hoàn cả đơn).
      let recoveredQty = 0;
      if (it.returnRestocked) {
        recoveredQty = Math.min(it.returnedQuantity, it.quantity);
      } else if (recoveredAll) {
        recoveredQty = hasLineData ? Math.min(it.returnedQuantity, it.quantity) : it.quantity;
      }
      cost += (it.quantity - recoveredQty) * unit;
      recoveredCost += recoveredQty * unit;
    }
    // Có dòng nào giá vốn = 0 nghĩa là SKU đó chưa được nhập giá vốn
    const missingCostPrice = order.items.some(
      (it) => Number(it.costPriceAtSale) <= 0
    );
    return { cost, recoveredCost, missingCostPrice };
  }

  // Fallback cho đơn cũ (trước khi có OrderItem): log trừ kho × giá vốn hiện tại
  const deductions = order.inventoryLogs.filter((l) => l.changeQuantity < 0);
  const rawCost = deductions.reduce(
    (sum, log) =>
      sum + Math.abs(log.changeQuantity) * Number(log.product?.costPrice ?? 0),
    0
  );
  const missingCostPrice =
    deductions.length === 0 ||
    deductions.some((l) => Number(l.product?.costPrice ?? 0) <= 0);
  // Đơn cũ đã về hàng (kho/sàn/hủy): vốn được thu hồi toàn bộ.
  return {
    cost: recoveredAll ? 0 : rawCost,
    recoveredCost: recoveredAll ? rawCost : 0,
    missingCostPrice,
  };
}

// Doanh thu gốc (tổng tiền hàng) của một đơn — NGUỒN CÔNG THỨC DUY NHẤT, dùng
// chung cho /realized-pnl và /analytics để hai màn hình ước thuế sàn trên cùng
// một cơ sở. Ưu tiên tổng dòng sản phẩm; đơn cũ chưa có OrderItem thì suy từ
// totalAmount (đã trừ voucher shop) cộng ngược sellerVoucher.
// LƯU Ý: riêng LAZADA giá dòng hàng là paid_price ĐÃ trừ voucher shop —
// computePnlRow cộng ngược lại từ sao kê/totalAmount, không xử lý ở đây.
function orderGrossRevenue(order: {
  items: { quantity: number; price: Prisma.Decimal }[];
  totalAmount: Prisma.Decimal;
  sellerVoucher: Prisma.Decimal;
}): number {
  if (order.items.length > 0) {
    return order.items.reduce((s, it) => s + it.quantity * Number(it.price), 0);
  }
  return Number(order.totalAmount) + Number(order.sellerVoucher);
}
/** Dòng Lãi/Lỗ đã bóc số của một đơn — đơn vị số liệu gốc của mọi báo cáo. */
export type PnlRow = ReturnType<typeof computePnlRow>;

// Bóc toàn bộ số liệu tài chính của MỘT đơn — công thức gốc duy nhất.
// EXPORT cho Tổng quan (/api/analytics) dùng chung SSOT, không tự tính riêng.
export function computePnlRow(o: PnlOrder) {
  // cost = giá vốn THỰC TÍNH (đã thu hồi phần hàng trả về kho nguyên vẹn)
  const { cost, recoveredCost, missingCostPrice } = orderCost(o);

  // ---- DOANH THU GỐC & VOUCHER SHOP ----
  // LAZADA khác Shopee/TikTok: OrderItem.price là paid_price ĐÃ trừ voucher
  // shop, còn totalAmount (order.price) là giá GỐC CHƯA trừ (đối chiếu đơn
  // thật 527296226771786: totalAmount 248.000 = "Item Price Credit" sao kê;
  // Σ items 241.676 = 248.000 − 6.324 voucher). Order.sellerVoucher của
  // Lazada luôn 0 (xem chú thích syncLazadaSettlements) nên bóc tại đây:
  //  - ĐÃ đối soát: itemRevenue + sellerVoucher CÓ DẤU của sao kê — đúng số
  //    bảng tab Lazada hiển thị, thẻ Tổng SUM lên là khớp từng xu.
  //  - CHƯA đối soát: suy từ totalAmount − Σ paid_price (phần shop giảm giá).
  let revenueGross = orderGrossRevenue(o);
  let sellerVoucher = Number(o.sellerVoucher);
  if (o.channel.channelName === "LAZADA") {
    const lz = o.lazadaSettlement;
    if (o.isSettled && lz && Number(lz.itemRevenue) !== 0) {
      revenueGross = Number(lz.itemRevenue);
      sellerVoucher = -Number(lz.sellerVoucher); // sao kê âm → magnitude dương
    } else {
      sellerVoucher = Math.max(Number(o.totalAmount) - revenueGross, 0);
      revenueGross += sellerVoucher; // trả cột "Giá trị đơn hàng" về giá gốc
    }
  }
  // TIKTOK (16/09/2026): khi đã có bản kê chi tiết (thật hoặc ước tính của
  // sàn), "Giá trị đơn hàng" = GIÁ GỐC SẢN PHẨM (subtotal_before_discount) và
  // voucher shop = Chiết khấu của nhà bán hàng — đúng cách TikTok tính hoa hồng
  // (giá gốc − CK nhà bán hàng). Trước đó OrderItem.price = sale_price đã trừ
  // cả CK shop lẫn CK nền tảng nên gross/voucher đều là 0 giả. Tổng sau cấn
  // trừ không đổi: revenue_amount của sàn = giá gốc − CK shop (đã gồm phần sàn
  // bù chiết khấu nền tảng, nên platformSubsidy của Order cố ý = 0 ở mapper).
  const tt = o.channel.channelName === "TIKTOK" ? o.tiktokSettlement : null;
  if (tt && Number(tt.grossSales) > 0) {
    revenueGross = Number(tt.grossSales);
    sellerVoucher = Math.abs(Number(tt.sellerDiscount));
  }

  // Gộp phí theo bucket cột. CẬP NHẬT QUYẾT ĐỊNH CHỦ SHOP 05/08: bảng Lãi/Lỗ
  // hiển thị REAL-TIME — đơn CHƯA quyết toán dùng SỐ ƯỚC TÍNH CỦA CHÍNH SHOPEE
  // (sync từ get_escrow_detail, xem syncShopeePendingEscrowEstimates), gắn
  // nhãn "chờ đối soát" qua isSettled. Vẫn giữ nguyên tắc 30/07: TUYỆT ĐỐI
  // không tự bịa phí % kênh — chưa sync được số của sàn thì cột = 0.
  const feeFixedPayment = Number(o.fixedFee) + Number(o.paymentFee);
  const feeService = Number(o.serviceFee);
  // Phí "dịch vụ PiShip" (bảo hiểm giao hàng Shopee VN) — cột riêng, xem
  // mapShopeeEscrowToOrder. Sàn khác chưa có nguồn → luôn 0.
  const feeSellerProtection = Number(o.sellerProtectionFee);
  const feeAffiliate = Number(o.affiliateFee);
  // Trợ giá sàn chỉ có nghĩa khi ĐI KÈM số "Tổng tiền" của sàn (escrow thật /
  // ước tính). Đơn mới chỉ có trợ giá từ API đơn hàng mà chưa có payout thì
  // cộng vào là bóc tách lệch (Tổng quan 16/09: donut "Khấu trừ khác" 293.470đ
  // trong khi Tổng chi phí 0đ — toàn bộ từ platform_discount đơn TikTok chờ).
  const platformSubsidy = Number(o.actualPayout) !== 0 ? Number(o.platformSubsidy) : 0;
  const shippingFeeDiff = Number(o.shippingFeeDiff);

  // Thuế sàn TMĐT của đơn: số THẬT sàn trích (đã quyết toán) hoặc số sàn ƯỚC
  // TÍNH (chưa quyết toán, sync từ escrow detail). Trang Báo cáo thuế
  // (/api/tax/report) vẫn tự ước nghĩa vụ 1,5% riêng — không dùng trường này.
  const platformTax = Number(o.taxWithheld);

  // DOANH THU THỰC TẾ = Giá trị đơn hàng − giảm giá bằng xu/voucher của Shop.
  // CHƯA trừ phí/thuế sàn — mạch đọc trên UI: Giá trị đơn hàng → các cột phí &
  // thuế bóc tách → Doanh thu thực tế → Giá vốn → Lợi nhuận thực tế.
  const actualRevenue = revenueGross - sellerVoucher;

  /*
   * ---- HOÀN TIỀN / TRẢ HÀNG: 4 KỊCH BẢN, SỐ LẤY THEO SÀN (chốt 19/08) ----
   * Nguyên tắc anh Trung: "KHÔNG ĐƯỢC BỊA GIÁ" — tiền hoàn & hàng-về-hay-không
   * đều lấy số của sàn, không tự tạm tính full doanh thu nữa.
   * refundedAmount = tiền TRẢ LẠI KHÁCH của đơn, ưu tiên theo thứ tự:
   *   1. Số THẬT sao kê (Shopee escrow seller_return_refund, Lazada reversal…).
   *   2. Số SÀN BÁO trên yêu cầu hoàn (Shopee Returns refund_amount — kể cả
   *      đang treo REQUESTED/PROCESSING hay đã ACCEPTED sau khi escrow đã trả):
   *      gắn nhãn "sàn báo, chờ quyết toán".
   *   3. Không có cả hai → 0. NGOẠI LỆ Lazada: sàn báo đơn "returned" nhưng
   *      Hubsell chưa đọc Reverse Order API (chưa có refund_amount) → vẫn tạm
   *      tính hoàn full như cũ cho tới khi nối API (ghi rõ là tạm tính).
   *   - CLAIM_SETTLED (thắng khiếu nại, đã được đền) → không tạm tính nữa.
   * Giá vốn: phần hàng ĐÃ VỀ (kho quét / sàn xác nhận giao về / đơn hủy đã hoàn
   * tồn) được thu hồi trong orderCost — đơn trả hàng chỉ còn lỗ phí/ship/PiShip.
   * KB1 hoàn 100% khách giữ hàng: refund = full → doanh thu 0, vốn mất 100%.
   * KB2 hoàn 1 phần giữ hàng:     refund một phần → doanh thu = giá − hoàn.
   * KB3 trả 1 vài SKU:            refund theo sàn; vốn SKU trả thu hồi khi về.
   * KB4 trả toàn bộ:              refund theo sàn; vốn thu hồi khi hàng về.
   * Đơn HỦY (shippingStatus CANCELLED) KHÔNG phải đơn hoàn — returnType null,
   * tiền sàn trả lại khách (escrow) vẫn trừ để doanh thu = 0.
   */
  const isCancelled = o.shippingStatus === ShippingStatus.CANCELLED;
  const pendingReturn =
    o.returnStatus !== ReturnStatus.NONE &&
    o.returnStatus !== ReturnStatus.CLAIM_SETTLED;
  const refundRecorded = Number(o.refundedAmount);
  const refundPlatform = Number(o.platformRefundAmount);
  // Tạm tính hoàn full CHỈ còn cho đơn Lazada chưa được Reverse Order API quét
  // tới (returnSolution null — cờ AWAITING đến từ order status "returned").
  // Đã có dữ liệu Reverse mà sàn báo hoàn 0 thì tin số 0 (20/08, sau khi nối
  // syncLazadaReturns).
  const lazadaLegacyEstimate =
    o.channel.channelName === ChannelName.LAZADA &&
    pendingReturn &&
    o.returnSolution === null &&
    refundRecorded <= 0 &&
    refundPlatform <= 0;
  // ĐƠN HỦY = DOANH THU 0 (anh Trung chốt 30/09/2026). Đơn hủy mà sàn chưa báo
  // số hoàn (chưa có escrow / yêu cầu hoàn) trước đây rơi về nguyên giá bán,
  // giá vốn lại đã thu hồi → cả đơn thành "lãi" ảo (tháng 8 tài khoản demo: 99
  // đơn, thừa 26,2 triệu ở tab Tất cả của Lãi/Lỗ). Coi như hoàn đủ cho khách.
  const cancelledNoRefund = isCancelled && refundRecorded <= 0 && refundPlatform <= 0;
  const refundedAmount =
    refundRecorded > 0
      ? refundRecorded
      : refundPlatform > 0
        ? Math.min(refundPlatform, Math.max(actualRevenue, 0))
        : lazadaLegacyEstimate || cancelledNoRefund
          ? Math.max(actualRevenue, 0)
          : 0;

  // Phân loại hình thức hoàn để UI gắn badge. Nguồn: giải pháp sàn chốt
  // (returnSolution) + số lượng trả cấp dòng SKU (từ item[] của sàn); đơn chỉ có
  // cờ returnStatus (kiểu cũ, chưa có dữ liệu sàn) coi là trả hàng cả đơn.
  const totalQuantity = o.items.reduce((s, it) => s + it.quantity, 0);
  const returnedQuantity = o.items.reduce((s, it) => s + it.returnedQuantity, 0);
  // Giá vốn (tại thời điểm bán) của RIÊNG phần hàng bị trả — mẫu số để tính
  // "giá vốn chưa thu hồi" của đơn trả MỘT PHẦN (computeReturnLoss).
  const returnedCostAtSale = o.items.reduce(
    (s, it) => s + it.returnedQuantity * Number(it.costPriceAtSale),
    0
  );
  let returnType:
    | "REFUND_ONLY"
    | "PARTIAL_REFUND"
    | "PARTIAL_RETURN"
    | "FULL_RETURN"
    | null = null;
  const hasReturnSignal =
    o.returnSolution !== null ||
    o.returnStatus !== ReturnStatus.NONE ||
    refundRecorded > 0 ||
    refundPlatform > 0;
  if (isCancelled) {
    returnType = null; // đơn hủy nằm trên trục Đã hủy, không phải Hoàn/Trả
  } else if (o.returnSolution === ReturnSolution.REFUND_ONLY) {
    // Sàn chưa báo số tiền (refund 0, yêu cầu mới/đang treo) → coi là hoàn tiền
    // (chưa biết phần hay toàn bộ), không gắn nhãn "hoàn 1 phần" với số 0.
    returnType =
      refundedAmount <= 0 || refundedAmount >= Math.max(actualRevenue, 0) - 0.5
        ? "REFUND_ONLY"
        : "PARTIAL_REFUND";
  } else if (
    o.returnSolution === ReturnSolution.RETURN_REFUND ||
    o.returnStatus !== ReturnStatus.NONE ||
    returnedQuantity > 0
  ) {
    returnType =
      returnedQuantity > 0 && returnedQuantity < totalQuantity
        ? "PARTIAL_RETURN"
        : "FULL_RETURN";
  } else if (hasReturnSignal && refundedAmount > 0) {
    // Chỉ có số hoàn từ sao kê (không có yêu cầu hoàn nào ghi nhận) → khách giữ hàng.
    returnType =
      refundedAmount >= Math.max(actualRevenue, 0) - 0.5 ? "REFUND_ONLY" : "PARTIAL_REFUND";
  }

  // "Doanh thu ước tính" — TÁI LẬP từ các cột phí đã bóc, để ĐỐI CHIẾU với
  // actualPayout: đơn đã quyết toán mà hai số lệch nhau nghĩa là còn khoản
  // chưa bóc đúng cột. Đối chiếu đơn VN thật 2607303CGEHBCA + 260728T943X8PX
  // (05/08/2026):
  //   - platformSubsidy (Shopee) = shopee_discount: sàn giảm trực tiếp vào giá
  //     rồi BÙ LẠI trong escrow → CỘNG. (voucher_from_shopee/coins bù cho
  //     NGƯỜI MUA đã bị loại từ tầng mapping — xem mapShopeeEscrowToOrder.)
  //   - Trừ cả PiShip + thuế sàn thu hộ (trước đây bỏ sót 2 khoản này).
  // Đơn HOÀN (seller_return_refund) cố ý KHÔNG ước — lệch ước tính/payout
  // trên đơn hoàn là tín hiệu thật, đọc theo returnStatus.
  const netRevenue =
    actualRevenue -
    refundedAmount -
    feeFixedPayment -
    feeService -
    feeSellerProtection -
    feeAffiliate -
    shippingFeeDiff -
    platformTax +
    platformSubsidy;
  const profit = netRevenue - cost;

  // DOANH THU THỰC TẾ TRÊN SÀN — "Tổng tiền" sàn báo: đơn ĐÃ đối soát =
  // escrow_amount thật (ĐÃ net tiền hoàn); đơn CHƯA đối soát = escrow_amount
  // ƯỚC TÍNH của sàn nếu đã sync được, không thì rơi về số từ API đơn hàng
  // TRỪ tiền hoàn — đơn hoàn chưa quyết toán KHÔNG còn rơi về nguyên giá bán
  // (trước đây gây lãi dương ảo bằng full doanh thu). UI phân biệt qua isSettled.
  const platformRevenueRaw =
    Number(o.actualPayout) !== 0
      ? Number(o.actualPayout)
      : Math.max(actualRevenue - refundedAmount, 0);
  // Đơn hủy: tối đa 0. Số ÂM giữ nguyên — đó là phí sàn vẫn trừ dù đơn hủy
  // (PiShip, cước chiều về…), thiệt hại thật. Số DƯƠNG là ước tính sàn tính
  // trước khi đơn bị hủy, không còn giá trị.
  const platformRevenue = isCancelled ? Math.min(platformRevenueRaw, 0) : platformRevenueRaw;

  // LÃI SAU THUẾ = MỘT công thức duy nhất chủ shop chốt (31/07):
  // Doanh thu thực tế − Giá vốn. Đơn đã đối soát: payout đã net hết
  // phí/thuế/xu; đơn chờ: doanh thu tạm từ API đơn − giá vốn (không ước phí).
  const profitAfterTax = platformRevenue - cost;

  return {
    id: o.id,
    orderCode: o.orderCode,
    shippingStatus: o.shippingStatus,
    // Trục hoàn/trả — Tổng quan cần để loại đơn đang hoàn khỏi doanh thu.
    returnStatus: o.returnStatus,
    isSettled: o.isSettled,
    channelId: o.channelId,
    channelName: o.channel.channelName,
    shopName: o.channel.shopName,
    createdAt: o.createdAt,
    shippedAt: o.packedAt, // mốc bàn giao ĐVVC (gần nhất với "ngày gửi ĐVVC")
    customerName: o.customerName,
    carrier: o.carrier,
    items: o.items.map((it) => ({
      sku: it.channelSku,
      name: it.productName,
      variation: "", // OrderItem chưa tách trường phân loại — giữ chỗ
      quantity: it.quantity,
      price: Number(it.price),
      costPriceAtSale: Number(it.costPriceAtSale),
    })),
    // Doanh thu & trợ giá
    revenueGross,
    sellerVoucher,
    // Doanh thu thực tế = Giá trị đơn hàng − voucher/xu Shop (chưa trừ phí/thuế)
    actualRevenue,
    platformSubsidy,
    // Vận chuyển
    shippingFeeQuoted: Number(o.shippingFeeQuoted),
    shippingFeeActual: Number(o.shippingFeeActual),
    shippingFeeDiff,
    shipSubsidyPlatform: Number(o.shipSubsidyPlatform),
    shipSubsidyShop: Number(o.shipSubsidyShop),
    // Phí sàn theo bucket
    feeFixedPayment,
    feeService,
    feeSellerProtection, // phí "dịch vụ PiShip" (bảo hiểm giao hàng)
    // Phí GMV Max TikTok sàn trừ TRONG ĐƠN (số có dấu, đã nằm trong feeService).
    // ≠ 0 ⇒ sàn thu ads theo đơn → Báo cáo dòng tiền không cộng AdSpend gian đó nữa.
    feeGmvMax: tt ? Number(tt.feeGmvMax) : 0,
    feeAffiliate,
    // Khấu trừ lúc giải ngân — bóc tách hiển thị, đã nằm trong actualPayout
    adWalletTopup: Number(o.adWalletTopup),
    taxWithheld: Number(o.taxWithheld),
    // Hoàn tiền / trả hàng — 4 kịch bản (null = đơn bán bình thường)
    returnType,
    refundedAmount, // tiền trả khách: số thật sao kê / số sàn báo / (Lazada) tạm tính
    refundEstimated: refundRecorded === 0 && refundedAmount > 0, // chưa phải số sao kê
    // Nguồn số hoàn để UI ghi chú đúng: sao kê thật / sàn báo trên yêu cầu hoàn
    // (chờ quyết toán) / tạm tính (Lazada chưa nối Reverse API) / không có.
    refundSource:
      refundRecorded > 0
        ? ("settled" as const)
        : refundPlatform > 0
          ? ("platform" as const)
          : refundedAmount > 0
            ? ("estimate" as const)
            : null,
    // Số của sàn về yêu cầu hoàn — UI hiện trạng thái + kiện về tay chưa.
    returnSolution: o.returnSolution,
    platformReturnStatus: o.platformReturnStatus,
    returnDeliveredAt: o.returnDeliveredAt,
    returnedQuantity,
    totalQuantity,
    returnedCostAtSale, // giá vốn (lúc bán) của riêng phần hàng bị trả
    recoveredCost, // giá vốn đã thu hồi nhờ hàng trả nhập lại kho nguyên vẹn
    // Hiệu quả
    costSnapshot: cost,
    netRevenue,
    actualPayout: Number(o.actualPayout),
    // "Tổng tiền" sàn báo — nguồn duy nhất của cột "Doanh thu trên sàn"
    platformRevenue,
    profit,
    // Thuế sàn TMĐT (số thật khi đã quyết toán / 0 khi chờ đối soát) + lãi sau thuế
    platformTax,
    profitAfterTax,
    missingCostPrice,
    // SAO KÊ CHI TIẾT LAZADA — số CÓ DẤU NGUYÊN BẢN từ Finance API (null
    // với đơn sàn khác / đơn Lazada chưa đối soát). Tab Lazada dùng 100%
    // số thật này, không dùng bucket gộp phía trên.
    lazada: o.lazadaSettlement
      ? Object.fromEntries(
          (
            [
              "itemRevenue", "shipFee", "shipFeeCustomer",
              "shipDiscountPlatform", "shipDiscountSeller", "shipFeeReturn",
              "shipFeeAdjustment", "feeFixed", "feeOrderProcessing",
              "feePayment", "feeCommission",
              "feeShipSeller", "shipSubsidySeller", "feeFreeshipMax",
              "feeCashbackMax", "feeSponsoredDiscovery", "feeLazadaBonus",
              "bonusLzdCofund", "feeBuyerReview", "feeLazpick",
              "feeCampaign", "feeAffiliate", "feeInfrastructure",
              "feeOther", "subsidyOther", "sellerVoucher",
              "vatFee", "incomeTaxFee", "actualPayout",
            ] as const
          ).map((k) => [k, Number(o.lazadaSettlement![k])])
        )
      : null,
    // BẢN KÊ CHI TIẾT TIKTOK — số CÓ DẤU nguyên bản (bản kê 202501 hoặc ước
    // tính unsettled 202507, phân biệt qua estimated). Tab TikTok dùng số này.
    tiktok: o.tiktokSettlement
      ? {
          estimated: o.tiktokSettlement.estimated,
          estimatedSettlementAt: o.tiktokSettlement.estimatedSettlementAt,
          unsettledReason: o.tiktokSettlement.unsettledReason,
          adjustmentTypes: o.tiktokSettlement.adjustmentTypes,
          ...Object.fromEntries(
            (
              [
                "grossSales", "sellerDiscount", "refundGross", "sellerDiscountRefund",
                "revenueAmount", "platformDiscount", "customerRefund",
                "shipActual", "shipCustomerPaid", "shipPlatformDiscount", "shipSubsidy",
                "shipSellerDiscount", "shipReturn", "shipOther", "shipReimbursement",
                "shippingCost",
                "feeCommission", "feeTransaction", "feeOrderProcessing", "feeSfp",
                "feeVoucherXtra", "feeFlashSale", "feeAffiliate", "feeAffiliateAds",
                "feeAffiliatePartner", "feeGmvMax", "feeOther", "feeTaxAmount",
                "taxVat", "taxPit", "taxOther", "adjustmentAmount", "settlementAmount",
              ] as const
            ).map((k) => [k, Number(o.tiktokSettlement![k])])
          ),
        }
      : null,
  };
}

/**
 * BÓC 3 KHOẢN THẤT THU của MỘT đơn hoàn/trả (đơn thường → toàn 0).
 *
 * CHỐT ANH TRUNG 15/09: KHÔNG SUY DIỄN — mọi khoản phải là số đã nằm sẵn
 * trong dòng Lãi/Lỗ thực hiện của đơn. Bản cũ cộng các CỘT PHÍ của đơn rồi
 * coi là "phí sàn không hoàn" — sai, vì đơn hoàn sau giải ngân sàn có thể
 * trả lại phí bằng dòng điều chỉnh kỳ sau mà cột phí của đơn vẫn là số gốc.
 *   - costLoss    : GIÁ VỐN CHƯA THU HỒI — hoàn tiền 100% khách giữ hàng /
 *     hoàn cả đơn → costSnapshot (đã trừ phần hàng về kho); trả một phần →
 *     vốn phần trả − phần đã nhập lại kho; hoàn tiền một phần khách giữ hàng
 *     → 0 (hàng vẫn bán).
 *   - platformKept: TIỀN SÀN GIỮ LẠI — phần ví bị ÂM trên sao kê của đơn
 *     (actualPayout < 0), tức tiền thật sàn đã trừ mà không trả lại: gộp phí
 *     sàn + phí vận chuyển sàn trừ, KHÔNG tách vì sao kê chỉ cho tổng. Đơn
 *     chưa quyết toán: actualPayout là số sàn ƯỚC TÍNH nếu đã sync, chưa có
 *     thì 0 (chờ đối soát) — đúng nguyên tắc không bịa phí.
 *   - refundLoss  : HOÀN TIỀN KHÁCH GIỮ HÀNG — đơn hoàn MỘT PHẦN không trả
 *     hàng: số tiền hoàn theo sàn/sao kê là thiệt hại thật (bán được hàng
 *     nhưng thu thiếu), bản cũ bỏ rơi khoản này.
 * Đơn hoàn TOÀN BỘ (ví âm): costLoss + platformKept = −profitAfterTax của
 * chính dòng đó trong bảng Lãi/Lỗ → thẻ KPI khớp bảng từng đồng.
 */
export function computeReturnLoss(r: PnlRow) {
  if (r.returnType === null) {
    return { costLoss: 0, platformKept: 0, refundLoss: 0, total: 0 };
  }
  let costLoss = 0;
  if (r.returnType === "REFUND_ONLY" || r.returnType === "FULL_RETURN") {
    costLoss = Math.max(r.costSnapshot, 0);
  } else if (r.returnType === "PARTIAL_RETURN") {
    costLoss = Math.max(r.returnedCostAtSale - r.recoveredCost, 0);
  }
  const platformKept = Math.max(-r.actualPayout, 0);
  const refundLoss =
    r.returnType === "PARTIAL_REFUND" ? Math.max(r.refundedAmount, 0) : 0;
  return {
    costLoss,
    platformKept,
    refundLoss,
    total: costLoss + platformKept + refundLoss,
  };
}
