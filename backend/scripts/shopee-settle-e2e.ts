// ============================================================
// NGHIỆM THU ĐỐI SOÁT SHOPEE BẰNG PAYLOAD CHUẨN (không gọi sàn)
//
// Cùng cách nghiệm thu với order-sync (shopee-order-e2e.ts): nạp một
// order_income mẫu — số dựng theo cấu trúc phí Shopee VN điển hình — qua ĐÚNG
// hàm mapShopeeEscrowToOrder rồi ghi DB, sau đó kiểm tra:
//   1) Cột GĐ2 của Order nhận đúng từng bucket.
//   2) computePnlRow đọc đơn này ra bộ số nhất quán (platformRevenue =
//      actualPayout, phí hiển thị đúng cột).
// Chạy: npx tsx scripts/shopee-settle-e2e.ts   (DB dev; dữ liệu TEST- tự dọn)
// ============================================================

import { prisma } from "../src/lib/prisma";
import { mapShopeeEscrowToOrder } from "../src/integrations/shopee/settlements";
import { computePnlRow, fetchPnlOrders } from "../src/routes/finance";

const ORDER_CODE = "TEST-SETTLE-SPE-001";

async function main() {
  const channel = await prisma.channel.findFirst({
    where: { channelName: "SHOPEE" },
    orderBy: { createdAt: "asc" },
  });
  if (!channel) throw new Error("DB dev chưa có gian Shopee nào");

  // Dọn bản chạy trước (idempotent).
  await prisma.order.deleteMany({
    where: { channelId: channel.id, orderCode: ORDER_CODE },
  });

  const order = await prisma.order.create({
    data: {
      channelId: channel.id,
      orderCode: ORDER_CODE,
      customerName: "Khách Test Đối Soát",
      totalAmount: 289_000,
      paymentStatus: "PAID",
      shippingStatus: "DELIVERED",
    },
  });

  // order_income = NGUYÊN VĂN đơn VN THẬT 2607303CGEHBCA (DarkMan Store,
  // 05/08/2026) — từng con số đã đối chiếu khớp màn "Chi tiết doanh thu"
  // Seller Center. Payload này cài sẵn đủ 3 bẫy thực địa:
  //   1) seller_transaction_fee và credit_card_transaction_fee CÙNG 18.000
  //      cho CÙNG một khoản (Seller Center chỉ có MỘT dòng) → cấm đếm đôi.
  //   2) final_shipping_fee = −11.000 nhưng khách trả 11.000 + sàn trợ 30.000
  //      đã phủ đủ cước 41.000 → chênh lệch VC phải = 0, không tin field này.
  //   3) thuế nằm ở withholding_vat_tax/withholding_pit_tax (không phải
  //      escrow_tax), PiShip nằm ở shipping_seller_protection_fee_amount.
  const income = {
    order_selling_price: 289_000,
    commission_fee: 47_685, // "Phí cố định"
    service_fee: 18_895, // "Phí Dịch Vụ" (Freeship/Voucher Xtra)
    shipping_seller_protection_fee_amount: 2_700, // "Phí dịch vụ PiShip"
    seller_transaction_fee: 18_000, // "Phí xử lý giao dịch"
    credit_card_transaction_fee: 18_000, // BẪY: trùng khoản trên
    order_ams_commission_fee: 5_119, // "Phí hoa hồng TTLK"
    voucher_from_shopee: 52_020, // sàn bù cho NGƯỜI MUA — không cộng vào DT
    estimated_shipping_fee: 41_000,
    actual_shipping_fee: 41_000,
    buyer_paid_shipping_fee: 11_000,
    shopee_shipping_rebate: 30_000,
    shipping_fee_discount_from_3pl: 0,
    final_shipping_fee: -11_000, // BẪY: phải bị bỏ qua
    withholding_vat_tax: 2_890, // "Thuế GTGT"
    withholding_pit_tax: 1_445, // "Thuế TNCN"
    escrow_amount: 192_266, // "Doanh Thu Đơn Hàng" — SSOT
  };
  const releasedAt = new Date("2026-07-30T10:00:00Z");

  await prisma.order.update({
    where: { id: order.id },
    data: mapShopeeEscrowToOrder(income, releasedAt),
  });

  // ---- (1) Soi cột GĐ2 ----
  const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  const expect: Record<string, number> = {
    fixedFee: 47_685, // "Phí cố định"
    paymentFee: 18_000, // MỘT khoản giao dịch — không đếm đôi credit_card
    serviceFee: 18_895, // "Phí Dịch Vụ" (Xtra)
    sellerProtectionFee: 2_700, // "Phí dịch vụ PiShip" — cột riêng
    affiliateFee: 5_119,
    sellerVoucher: 0,
    platformSubsidy: 0, // voucher_from_shopee bù cho NGƯỜI MUA — không phải trợ giá shop
    shippingFeeQuoted: 41_000,
    shippingFeeActual: 41_000,
    shipSubsidyPlatform: 30_000,
    shipSubsidyShop: 0, // escrow không có nguồn — giữ chỗ
    adWalletTopup: 0, // escrow không có nguồn — giữ chỗ
    shippingFeeDiff: 0, // khách 11.000 + sàn 30.000 phủ đủ cước 41.000
    taxWithheld: 4_335, // GTGT 2.890 + TNCN 1.445
    actualPayout: 192_266,
  };
  const errors: string[] = [];
  for (const [k, v] of Object.entries(expect)) {
    const got = Number((row as unknown as Record<string, unknown>)[k]);
    if (got !== v) errors.push(`${k}: mong ${v}, DB ghi ${got}`);
  }
  if (!row.isSettled) errors.push("isSettled phải = true");
  if (row.settledAt?.toISOString() !== releasedAt.toISOString())
    errors.push(`settledAt: mong ${releasedAt.toISOString()}, DB ${row.settledAt}`);

  // ---- (2) computePnlRow đọc ra bộ số nhất quán ----
  const pnlOrders = await fetchPnlOrders({ userId: channel.userId, id: channel.id });
  const pnl = pnlOrders.map(computePnlRow).find((r) => r.orderCode === ORDER_CODE);
  if (!pnl) throw new Error("computePnlRow không thấy đơn test");
  if (pnl.platformRevenue !== 192_266)
    errors.push(`platformRevenue: mong 192.266 (= actualPayout), ra ${pnl.platformRevenue}`);
  if (pnl.profitAfterTax !== 192_266)
    errors.push(
      `profitAfterTax: mong 192.266 (= escrow_amount − giá vốn 0), ra ${pnl.profitAfterTax}`
    );
  // PHÉP THỬ VÀNG: đơn đã quyết toán thì "Doanh thu ước tính" (tái lập từ các
  // cột phí) phải KHỚP TỪNG ĐỒNG với escrow_amount — chính là yêu cầu đối soát
  // chủ shop chốt 05/08/2026.
  if (pnl.netRevenue !== 192_266)
    errors.push(`netRevenue: mong 192.266 (khớp actualPayout), ra ${pnl.netRevenue}`);
  if (pnl.feeFixedPayment !== 65_685)
    errors.push(`feeFixedPayment: mong 65.685 (47.685 + 18.000), ra ${pnl.feeFixedPayment}`);
  if (pnl.feeService !== 18_895) errors.push(`feeService: mong 18.895, ra ${pnl.feeService}`);
  if (pnl.feeSellerProtection !== 2_700)
    errors.push(`feeSellerProtection: mong 2.700, ra ${pnl.feeSellerProtection}`);
  if (pnl.feeAffiliate !== 5_119) errors.push(`feeAffiliate: mong 5.119, ra ${pnl.feeAffiliate}`);
  if (pnl.platformTax !== 4_335) errors.push(`platformTax: mong 4.335, ra ${pnl.platformTax}`);
  if (!pnl.isSettled) errors.push("PnlRow.isSettled phải = true");

  if (errors.length > 0) {
    console.error("==> FAIL:\n - " + errors.join("\n - "));
  } else {
    console.log(
      "Cột GĐ2:",
      Object.fromEntries(Object.keys(expect).map((k) => [k, Number((row as unknown as Record<string, unknown>)[k])]))
    );
    console.log("PnlRow:", {
      platformRevenue: pnl.platformRevenue,
      feeFixedPayment: pnl.feeFixedPayment,
      feeService: pnl.feeService,
      feeAffiliate: pnl.feeAffiliate,
      platformTax: pnl.platformTax,
      isSettled: pnl.isSettled,
    });
    console.log("==> PASS");
  }

  // Dọn dữ liệu test.
  await prisma.order.delete({ where: { id: order.id } });
  console.log("Đã dọn đơn test.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
