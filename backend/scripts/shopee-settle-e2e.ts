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

import { prisma } from "../src/prisma";
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

  // Đơn 500.000: khách dùng 10.000 xu (sàn hoàn) + shop voucher 20.000.
  const order = await prisma.order.create({
    data: {
      channelId: channel.id,
      orderCode: ORDER_CODE,
      customerName: "Khách Test Đối Soát",
      totalAmount: 500_000,
      paymentStatus: "PAID",
      shippingStatus: "DELIVERED",
    },
  });

  // order_income mẫu — mọi trường magnitude DƯƠNG như API thật.
  const income = {
    order_selling_price: 500_000,
    commission_fee: 20_000, // 4% hoa hồng
    service_fee: 25_000, // gói Voucher Xtra
    seller_transaction_fee: 11_000, // phí thanh toán
    credit_card_transaction_fee: 2_000,
    campaign_fee: 3_000,
    order_ams_commission_fee: 5_000, // hoa hồng affiliate ads
    voucher_from_seller: 20_000,
    seller_coin_cash_back: 1_000,
    voucher_from_shopee: 15_000, // sàn tài trợ → hoàn lại cho shop
    coins: 10_000,
    actual_shipping_fee: 32_000,
    buyer_paid_shipping_fee: 12_000,
    shopee_shipping_rebate: 15_000,
    shipping_fee_discount_from_3pl: 0,
    final_shipping_fee: 0, // để test nhánh suy từ actual − covered
    escrow_tax: 6_500, // GTGT + TNCN sàn trích
    withholding_tax: 0,
    escrow_amount: 415_500,
  };
  const releasedAt = new Date("2026-07-30T10:00:00Z");

  await prisma.order.update({
    where: { id: order.id },
    data: mapShopeeEscrowToOrder(income, releasedAt),
  });

  // ---- (1) Soi cột GĐ2 ----
  const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  const expect: Record<string, number> = {
    fixedFee: 20_000,
    paymentFee: 13_000, // 11.000 + 2.000
    serviceFee: 28_000, // 25.000 + 3.000
    affiliateFee: 5_000,
    sellerVoucher: 21_000, // 20.000 + 1.000 xu shop hoàn
    platformSubsidy: 25_000, // 15.000 voucher sàn + 10.000 xu
    shippingFeeActual: 32_000,
    shippingFeeQuoted: 27_000, // khách 12.000 + sàn trợ 15.000
    shippingFeeDiff: 5_000, // 32.000 − 27.000 shop chịu
    taxWithheld: 6_500,
    actualPayout: 415_500,
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
  if (pnl.platformRevenue !== 415_500)
    errors.push(`platformRevenue: mong 415.500 (= actualPayout), ra ${pnl.platformRevenue}`);
  if (pnl.feeFixedPayment !== 33_000)
    errors.push(`feeFixedPayment: mong 33.000, ra ${pnl.feeFixedPayment}`);
  if (pnl.feeService !== 28_000) errors.push(`feeService: mong 28.000, ra ${pnl.feeService}`);
  if (pnl.feeAffiliate !== 5_000) errors.push(`feeAffiliate: mong 5.000, ra ${pnl.feeAffiliate}`);
  if (pnl.platformTax !== 6_500) errors.push(`platformTax: mong 6.500, ra ${pnl.platformTax}`);
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
