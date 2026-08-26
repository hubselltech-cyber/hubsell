/**
 * Script chạy MỘT LẦN: cập nhật dữ liệu cũ cho cơ chế phí sàn 2 giai đoạn.
 *  1) Gán % phí sàn mặc định cho các gian hàng đã kết nối từ trước.
 *  2) Quyết toán các đơn "Đã giao" phát sinh trước khi có tính năng này.
 *
 * Chạy:  npx tsx prisma/backfill-settlement.ts
 */
import { PrismaClient } from "@prisma/client";
import { PLATFORM_FEE_RATE, mockSettlement } from "../src/marketplace/mockMarketplace";

const prisma = new PrismaClient();

async function main() {
  console.log("🔧 Bắt đầu cập nhật dữ liệu cũ...\n");

  // 1) Gán % phí sàn cho kênh chưa có
  const channels = await prisma.channel.findMany({ where: { feeRate: 0 } });
  for (const c of channels) {
    const rate = PLATFORM_FEE_RATE[c.channelName];
    if (rate > 0) {
      await prisma.channel.update({
        where: { id: c.id },
        data: { feeRate: rate },
      });
      console.log(`   ✓ ${c.channelName}: % phí sàn = ${(rate * 100).toFixed(0)}%`);
    }
  }
  console.log(`→ Đã cập nhật ${channels.length} gian hàng\n`);

  // 2) Quyết toán các đơn Đã giao chưa có số liệu thực tế
  // Quét lại TẤT CẢ đơn Đã giao để bổ sung các khoản phí mới (affiliate,
  // voucher shop, chênh lệch ship) cho những đơn quyết toán ở phiên bản cũ.
  const unsettled = await prisma.order.findMany({
    where: { shippingStatus: "DELIVERED" },
    include: { channel: { select: { channelName: true } } },
  });

  for (const o of unsettled) {
    const s = mockSettlement(
      o.channel.channelName,
      Number(o.totalAmount),
      o.orderCode
    );
    await prisma.order.update({
      where: { id: o.id },
      data: {
        isSettled: true,
        settledAt: new Date(),
        fixedFee: s.fixedFee,
        serviceFee: s.serviceFee,
        paymentFee: s.paymentFee,
        affiliateFee: s.affiliateFee,
        sellerVoucher: s.sellerVoucher,
        shippingFeeQuoted: s.shippingFeeQuoted,
        shippingFeeActual: s.shippingFeeActual,
        shippingFeeDiff: s.shippingFeeDiff,
        platformSubsidy: s.platformSubsidy,
        actualPayout: s.actualPayout,
      },
    });
    console.log(
      `   ✓ ${o.orderCode.padEnd(24)} doanh thu ${Number(o.totalAmount).toLocaleString("vi-VN")}` +
        ` → phí thực tế ${s.totalFee.toLocaleString("vi-VN")}` +
        ` → thực nhận ${s.actualPayout.toLocaleString("vi-VN")}`
    );
  }
  console.log(`→ Đã quyết toán ${unsettled.length} đơn hàng\n`);
  console.log("✅ Hoàn tất!");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("❌ Lỗi:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
