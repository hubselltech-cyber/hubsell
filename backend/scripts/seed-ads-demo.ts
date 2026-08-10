// ============================================================
// SEED DEMO — Trợ lý quảng cáo Shopee GĐ1 (CHỈ DB DEV, xem UI local)
//
// DB dev không còn gian Shopee nào (sandbox đã dọn) nên script tự dựng đủ bộ:
//   1. Gian "Shopee Demo Ads" (externalShopId DEMO-ADS-SHOP)
//   2. 3 SKU sàn (externalId = item_id) với giá vốn khác nhau → 3 mức biên lãi
//   3. 18 đơn ĐÃ ĐỐI SOÁT (6 đơn/SKU, phí thật từng bucket) → nền P&L
//   4. 4 campaign demo + 7 ngày hiệu suất: 1 xanh (lãi), 1 vàng (sát hòa vốn),
//      1 đỏ (ROAS dương vẫn lỗ), 1 tạm dừng
//
// Mọi bản ghi mang tiền tố DEMO — chạy lặp tự xóa cắm lại. KHÔNG chạy trên
// production; dữ liệu thật do syncShopeeAdsCampaigns lo.
//
// Chạy: npx tsx scripts/seed-ads-demo.ts
// Xóa:  npx tsx scripts/seed-ads-demo.ts --clean
// ============================================================

import { prisma } from "../src/prisma";

const SHOP_EXTERNAL_ID = "DEMO-ADS-SHOP";

async function main() {
  const clean = process.argv.includes("--clean");

  const owner = await prisma.user.findUnique({
    where: { email: "admin@hubsell.vn" },
  });
  if (!owner) throw new Error("Không thấy tài khoản admin@hubsell.vn trên DB dev");

  const existing = await prisma.channel.findFirst({
    where: {
      userId: owner.id,
      channelName: "SHOPEE",
      externalShopId: SHOP_EXTERNAL_ID,
    },
  });

  // Xóa sạch dữ liệu demo cũ (Order/ChannelProduct/AdsCampaign cascade theo Channel)
  if (existing) await prisma.channel.delete({ where: { id: existing.id } });
  if (clean) {
    console.log("Đã xóa gian demo Trợ lý quảng cáo (nếu có)");
    return;
  }

  const channel = await prisma.channel.create({
    data: {
      userId: owner.id,
      channelName: "SHOPEE",
      shopName: "Shopee Demo Ads",
      externalShopId: SHOP_EXTERNAL_ID,
      status: "ACTIVE",
    },
  });

  // ---- 3 SKU sàn: giá bán 210k, giá vốn tạo 3 mức biên lãi ----
  // Phí mỗi đơn: CĐ&TT 6%+2% (16.800) + DV 5% (10.500) + thuế 1,5% (3.150)
  //   TC008 vốn 120k → lãi 59.550 (28,4%) → hòa vốn ≈ 3,5x
  //   AOGIO vốn 130k → lãi 49.550 (23,6%) → hòa vốn ≈ 4,2x
  //   TAT   vốn 175k → lãi  4.550 ( 2,2%) → hòa vốn ≈ 46x (gần như vô vọng)
  const skus = [
    { sku: "DEMO-TC008", itemId: "900001", name: "Túi đeo chéo TC008 (demo)", cost: 120_000 },
    { sku: "DEMO-AOGIO", itemId: "900002", name: "Áo gió nam (demo)", cost: 130_000 },
    { sku: "DEMO-TAT", itemId: "900003", name: "Tất thể thao VDT_001 (demo)", cost: 175_000 },
  ];
  for (const s of skus) {
    await prisma.channelProduct.create({
      data: {
        channelId: channel.id,
        channelSku: s.sku,
        productName: s.name,
        price: 210_000,
        externalId: s.itemId,
        status: "ACTIVE",
      },
    });
  }

  // ---- 18 đơn đã đối soát (6 đơn/SKU) rải 20 ngày gần nhất ----
  const PRICE = 210_000;
  let orderNo = 0;
  for (const s of skus) {
    for (let i = 0; i < 6; i++) {
      orderNo++;
      const createdAt = new Date(Date.now() - (2 + i * 3) * 86_400_000);
      await prisma.order.create({
        data: {
          channelId: channel.id,
          orderCode: `DEMO-ADS-${String(orderNo).padStart(3, "0")}`,
          customerName: "Khách demo Ads",
          totalAmount: PRICE,
          itemCount: 1,
          createdAt,
          isSettled: true,
          fixedFee: 12_600, // 6% cố định
          paymentFee: 4_200, // 2% thanh toán
          serviceFee: 10_500, // 5% dịch vụ (Freeship Xtra)
          taxWithheld: 3_150, // 1,5% thuế sàn thu hộ
          items: {
            create: {
              channelSku: s.sku,
              productName: s.name,
              quantity: 1,
              price: PRICE,
              costPriceAtSale: s.cost,
            },
          },
        },
      });
    }
  }

  // ---- 4 campaign demo + 7 ngày hiệu suất ----
  const demos = [
    {
      campaignId: "DEMO-1",
      name: "Túi đeo chéo TC008 — từ khóa chủ lực",
      adType: "manual",
      status: "ongoing",
      placement: "search",
      biddingMethod: "manual",
      budget: 500_000,
      roasTarget: null as number | null,
      itemIds: "900001",
      spendBase: 320_000,
      roas: 6.2, // hòa vốn 3,5x → XANH
    },
    {
      campaignId: "DEMO-2",
      name: "Áo gió nam — quảng cáo tự động",
      adType: "auto",
      status: "ongoing",
      placement: "all",
      biddingMethod: "auto",
      budget: 0,
      roasTarget: 3.5, // chủ shop đặt mục tiêu DƯỚI hòa vốn 4,2x — chuyện thật ngoài đời
      itemIds: "900002",
      spendBase: 260_000,
      roas: 4.5, // hòa vốn 4,24x → VÀNG (sát ngưỡng ×1.1)
    },
    {
      campaignId: "DEMO-3",
      name: "Tất thể thao VDT_001 — khám phá",
      adType: "manual",
      status: "ongoing",
      placement: "discovery",
      biddingMethod: "manual",
      budget: 200_000,
      roasTarget: null,
      itemIds: "900003",
      spendBase: 180_000,
      roas: 1.4, // ROAS dương nhưng hòa vốn 46x → ĐỎ, lỗ nặng
    },
    {
      campaignId: "DEMO-4",
      name: "Balo du lịch — đã tạm dừng",
      adType: "manual",
      status: "paused",
      placement: "search",
      biddingMethod: "manual",
      budget: 150_000,
      roasTarget: null,
      itemIds: "",
      spendBase: 0,
      roas: 0,
    },
  ];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const d of demos) {
    const row = await prisma.adsCampaign.create({
      data: {
        channelId: channel.id,
        campaignId: d.campaignId,
        adType: d.adType,
        name: d.name,
        status: d.status,
        placement: d.placement,
        biddingMethod: d.biddingMethod,
        budget: d.budget,
        roasTarget: d.roasTarget,
        startTime: new Date(today.getTime() - 20 * 86_400_000),
        endTime: null,
        itemIds: d.itemIds,
      },
    });
    for (let i = 6; i >= 0; i--) {
      if (d.spendBase <= 0) continue;
      const date = new Date(
        Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() - i)
      );
      const wave = 1 + 0.25 * Math.sin((6 - i) * 1.3);
      const spend = Math.round((d.spendBase * wave) / 1000) * 1000;
      const broadGmv = Math.round((spend * d.roas * (1 + 0.1 * Math.cos(i))) / 1000) * 1000;
      const directGmv = Math.round(broadGmv * 0.72);
      const clicks = Math.round(spend / 1_400);
      await prisma.adsCampaignDailyPerf.create({
        data: {
          adsCampaignId: row.id,
          date,
          impression: clicks * 45,
          clicks,
          expense: spend,
          broadOrder: Math.max(Math.round(broadGmv / 210_000), 0),
          broadGmv,
          directOrder: Math.max(Math.round(directGmv / 210_000), 0),
          directGmv,
        },
      });
    }
  }

  console.log(
    `Đã dựng gian "${channel.shopName}" + ${skus.length} SKU + 18 đơn P&L + ${demos.length} campaign demo`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
