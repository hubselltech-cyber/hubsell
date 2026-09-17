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
// Chạy: npx tsx scripts/seed-ads-demo.ts            (gian Shopee demo)
//       npx tsx scripts/seed-ads-demo.ts --platform lazada   (gian Lazada demo
//         — 12/08/2026: trang /ads/lazada dùng chung lõi, cùng bộ ca kiểm thử)
// Xóa:  npx tsx scripts/seed-ads-demo.ts [--platform lazada] --clean
// ============================================================

import { prisma } from "../src/lib/prisma";

async function main() {
  const clean = process.argv.includes("--clean");
  const platformIdx = process.argv.indexOf("--platform");
  const platform =
    platformIdx !== -1 && process.argv[platformIdx + 1] === "lazada"
      ? ("LAZADA" as const)
      : ("SHOPEE" as const);
  const shopExternalId =
    platform === "LAZADA" ? "DEMO-ADS-LZD" : "DEMO-ADS-SHOP";

  const owner = await prisma.user.findUnique({
    where: { email: "admin@hubsell.vn" },
  });
  if (!owner) throw new Error("Không thấy tài khoản admin@hubsell.vn trên DB dev");

  const existing = await prisma.channel.findFirst({
    where: {
      userId: owner.id,
      channelName: platform,
      externalShopId: shopExternalId,
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
      channelName: platform,
      shopName: platform === "LAZADA" ? "Lazada Demo Ads" : "Shopee Demo Ads",
      externalShopId: shopExternalId,
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
        // Đúng khuôn externalId từng sàn: Shopee "item", Lazada "itemId-skuId"
        // (mọi chỗ đọc đều split("-")[0] nên map campaign.itemIds vẫn khớp).
        externalId: platform === "LAZADA" ? `${s.itemId}-1` : s.itemId,
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
      ordersPerDay: 3, // 21 đơn/7 ngày < ngưỡng công thần 30 → Q2 review sạch
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
    // ---- Ca GĐ2: rule engine Trợ lý ----
    {
      campaignId: "DEMO-5",
      name: "Mũ lưỡi trai — VỌT CHI hôm nay",
      adType: "manual",
      status: "ongoing",
      placement: "search",
      biddingMethod: "manual",
      budget: 0,
      roasTarget: null,
      itemIds: "900001", // hòa vốn ~3,5x
      spendBase: 100_000,
      roas: 5, // các ngày trước vẫn ổn
      todaySpend: 420_000, // hôm nay gấp ~4 lần trung bình
      todayRoas: 1, // và đang lỗ → Q3 spike
    },
    {
      campaignId: "DEMO-6",
      name: "Túi tote canvas — công thần đang hụt hơi",
      adType: "auto",
      status: "ongoing",
      placement: "all",
      biddingMethod: "auto",
      budget: 0,
      roasTarget: null,
      itemIds: "900001", // hòa vốn ~3,5x; roas 2 → vi phạm Q1
      spendBase: 80_000,
      roas: 2,
      ordersPerDay: 6, // 42 đơn/7 ngày ≥ ngưỡng 30 → Q4 grace đánh chặn
    },
    {
      campaignId: "DEMO-7",
      name: "Ví da mini — mới chạy, chưa đủ mẫu",
      adType: "manual",
      status: "ongoing",
      placement: "search",
      biddingMethod: "manual",
      budget: 50_000,
      roasTarget: null,
      itemIds: "900002",
      spendBase: 8_000, // 56k/7 ngày < sàn 100k → insufficient_data
      roas: 3,
    },
  ] as Array<{
    campaignId: string;
    name: string;
    adType: string;
    status: string;
    placement: string;
    biddingMethod: string;
    budget: number;
    roasTarget: number | null;
    itemIds: string;
    spendBase: number;
    roas: number;
    todaySpend?: number;
    todayRoas?: number;
    ordersPerDay?: number;
  }>;

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
      // Ngày hôm nay (i=0) cho phép ghi đè riêng — dựng ca spike Q3.
      const isToday = i === 0;
      const wave = 1 + 0.25 * Math.sin((6 - i) * 1.3);
      const spend =
        isToday && d.todaySpend != null
          ? d.todaySpend
          : Math.round((d.spendBase * wave) / 1000) * 1000;
      const roas = isToday && d.todayRoas != null ? d.todayRoas : d.roas;
      const broadGmv = Math.round((spend * roas * (1 + 0.1 * Math.cos(i))) / 1000) * 1000;
      const directGmv = Math.round(broadGmv * 0.72);
      const clicks = Math.round(spend / 1_400);
      await prisma.adsCampaignDailyPerf.create({
        data: {
          adsCampaignId: row.id,
          date,
          impression: clicks * 45,
          clicks,
          expense: spend,
          broadOrder: d.ordersPerDay ?? Math.max(Math.round(broadGmv / 210_000), 0),
          broadGmv,
          directOrder: Math.max(Math.round(directGmv / 210_000), 0),
          directGmv,
        },
      });
    }
  }

  // --many: cắm thêm 26 campaign nền (đã kết thúc, chi tiêu nhỏ) để test PHÂN TRANG
  let extra = 0;
  if (process.argv.includes("--many")) {
    for (let n = 1; n <= 26; n++) {
      const row = await prisma.adsCampaign.create({
        data: {
          channelId: channel.id,
          campaignId: `DEMO-BG-${n}`,
          adType: n % 2 === 0 ? "auto" : "manual",
          name: `Campaign nền #${n} (demo phân trang)`,
          status: "ended",
          placement: "all",
          biddingMethod: "auto",
          budget: 100_000,
          itemIds: "",
          startTime: new Date(today.getTime() - 60 * 86_400_000),
          endTime: new Date(today.getTime() - 10 * 86_400_000),
        },
      });
      await prisma.adsCampaignDailyPerf.create({
        data: {
          adsCampaignId: row.id,
          date: new Date(
            Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() - 5)
          ),
          impression: 900,
          clicks: 20,
          expense: 30_000 + n * 1_000,
          broadOrder: 1,
          broadGmv: 120_000,
          directOrder: 1,
          directGmv: 90_000,
        },
      });
      extra++;
    }
  }

  // ---- ĐỢT D (17/09/2026): SP CHƯA chạy ads + tín hiệu thị trường cho tab "Gợi ý chạy ads" ----
  // Mỗi SP một kịch bản của bộ chấm (ads-recommend.ts): nên chạy / thử nhỏ / 4 kiểu chưa nên.
  if (platform === "SHOPEE") {
    const rec = [
      // Nên chạy ngay: biên 33%, dư địa gấp 3, chuyển đổi cao, cầu lớn
      { itemId: "900011", sku: "DEMO-BALO", name: "Balo laptop chống nước (demo)", price: 320_000, cost: 165_000, orders: 14, stock: 260,
        sig: { sale: 1850, views: 42_000, rating: 4.9, comments: 612, tags: "best selling,top search", lower: 5.5, exact: 9.2, upper: 14, bMin: 30_000, bRec: 180_000, bMax: 500_000, vol: 86_000, bid: 1100 } },
      // Nên chạy ngay: biên 29%
      { itemId: "900012", sku: "DEMO-VIDA", name: "Ví da nam cầm tay (demo)", price: 260_000, cost: 140_000, orders: 11, stock: 180,
        sig: { sale: 960, views: 26_000, rating: 4.8, comments: 301, tags: "best ROI", lower: 5, exact: 8.4, upper: 13, bMin: 30_000, bRec: 120_000, bMax: 350_000, vol: 31_000, bid: 850 } },
      // Thử nhỏ: dư địa mỏng, chuyển đổi dưới mặt bằng, cầu vừa
      { itemId: "900013", sku: "DEMO-BUCKET", name: "Mũ bucket hai mặt (demo)", price: 150_000, cost: 85_000, orders: 8, stock: 140,
        sig: { sale: 210, views: 19_000, rating: 4.6, comments: 48, tags: "", lower: 4.2, exact: 6, upper: 9.5, bMin: 20_000, bRec: 90_000, bMax: 250_000, vol: 9_000, bid: 700 } },
      // Chưa nên: hòa vốn an toàn cao hơn cả nhóm khắt khe nhất của sàn
      { itemId: "900014", sku: "DEMO-DEP", name: "Dép quai ngang đế êm (demo)", price: 120_000, cost: 92_000, orders: 9, stock: 300,
        sig: { sale: 700, views: 25_000, rating: 4.7, comments: 190, tags: "best selling", lower: 4.5, exact: 7, upper: 11, bMin: 20_000, bRec: 100_000, bMax: 300_000, vol: 40_000, bid: 600 } },
      // Chưa nên: SP mới, 3 đánh giá
      { itemId: "900015", sku: "DEMO-AOTHUN", name: "Áo thun oversize mẫu mới (demo)", price: 190_000, cost: 95_000, orders: 6, stock: 120,
        sig: { sale: 9, views: 640, rating: 5, comments: 3, tags: "", lower: 4.8, exact: 7.5, upper: 12, bMin: 20_000, bRec: 100_000, bMax: 300_000, vol: 55_000, bid: 950 } },
      // Chưa nên: tồn không đủ 14 ngày
      { itemId: "900016", sku: "DEMO-TOTE", name: "Túi tote canvas in hình (demo)", price: 140_000, cost: 70_000, orders: 18, stock: 9,
        sig: { sale: 1400, views: 30_000, rating: 4.8, comments: 420, tags: "best selling", lower: 4.6, exact: 7.8, upper: 12, bMin: 20_000, bRec: 110_000, bMax: 300_000, vol: 47_000, bid: 800 } },
    ];
    let recOrderNo = 500;
    for (const r of rec) {
      await prisma.channelProduct.create({
        data: {
          channelId: channel.id,
          channelSku: r.sku,
          productName: r.name,
          price: r.price,
          externalId: r.itemId,
          channelStock: r.stock,
          status: "ACTIVE",
        },
      });
      for (let i = 0; i < r.orders; i++) {
        recOrderNo++;
        await prisma.order.create({
          data: {
            channelId: channel.id,
            orderCode: `DEMO-ADS-${recOrderNo}`,
            customerName: "Khách demo Ads",
            totalAmount: r.price,
            itemCount: 1,
            createdAt: new Date(Date.now() - (1 + ((i * 29) / r.orders)) * 86_400_000),
            isSettled: true,
            fixedFee: Math.round(r.price * 0.06),
            paymentFee: Math.round(r.price * 0.02),
            serviceFee: Math.round(r.price * 0.05),
            taxWithheld: Math.round(r.price * 0.015),
            items: {
              create: { channelSku: r.sku, productName: r.name, quantity: 1, price: r.price, costPriceAtSale: r.cost },
            },
          },
        });
      }
      await prisma.adsItemSignal.create({
        data: {
          channelId: channel.id,
          itemId: r.itemId,
          sale: r.sig.sale,
          views: r.sig.views,
          ratingStar: r.sig.rating,
          commentCount: r.sig.comments,
          shopeeTags: r.sig.tags,
          roiLower: r.sig.lower,
          roiExact: r.sig.exact,
          roiUpper: r.sig.upper,
          budgetMin: r.sig.bMin,
          budgetRecommended: r.sig.bRec,
          budgetMax: r.sig.bMax,
          kwSearchVolume: r.sig.vol,
          kwAvgBid: r.sig.bid,
          kwCount: 12,
          baseSyncedAt: new Date(),
          proposalSyncedAt: new Date(),
        },
      });
    }
  }

  console.log(
    `Đã dựng gian "${channel.shopName}" + ${skus.length} SKU + 18 đơn P&L + ${demos.length + extra} campaign demo`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
