// ============================================================
// DỌN SHOP TEST/SANDBOX + ĐƠN TEST — chuẩn bị giai đoạn theo dõi số thật.
//
// 2 CHẾ ĐỘ:
//   A. Tự nhận diện (mặc định) — chỉ quét gian SHOPEE/LAZADA:
//      1. GIAN TEST = Channel KHÔNG có refreshToken (gian giả lập — mọi gian
//         OAuth thật đều có refreshToken, kể cả khi đang DISCONNECTED), HOẶC tên
//         gian chứa "SANDBOX"/"TEST" (shop sandbox Shopee đặt tên "OpenSANDBOX…").
//      2. ĐƠN TEST trên gian GIỮ LẠI = orderCode dạng "<SÀN>-<timestamp>" do nút
//         "Giả lập đơn" sinh (webhooks.ts: `${channelName}-${Date.now()}`).
//   B. Đích danh (--only) — KHÔNG tự nhận diện, chỉ xoá đúng gian truyền qua
//      --ids / --name, bất kể sàn (dùng cho gian mock TikTok "Hubsell TikTok
//      Sandbox" 16/09/2026). Không đụng đơn trên các gian khác.
//
// XOÁ TƯỜNG MINH TỪ DƯỚI LÊN (không dựa cascade DB — schema Supabase áp tay):
//   đơn: invoiceLog/inventoryLog (gỡ liên kết) → settlement Lazada/TikTok →
//        deliveryTrackingTask/deliveryFailNotice/kocOrderAttribution → orderItem → order
//   gian: channelProduct → ads (dailyPerf/actionLog → campaign → config, adSpend) →
//         walletWithdrawal/staffChannel/invoiceConfig/inventorySync*/stockPushJob/
//         deliveryTrackingTask/channelAppAuth → operatingExpense (gỡ fundChannelId) → channel.
//
// Chạy (mặc định DRY-RUN, chỉ in ra không xoá):
//   cd backend && npx tsx scripts/cleanup-test-shops.ts
//   npx tsx scripts/cleanup-test-shops.ts --ids <id1>,<id2>        # thêm gian sandbox OAuth
//   npx tsx scripts/cleanup-test-shops.ts --only --name "Hubsell TikTok Sandbox"
//   npx tsx scripts/cleanup-test-shops.ts --only --ids <id>
//   … --apply                                                       # XOÁ THẬT
// Trỏ DB production:  DATABASE_URL="postgresql://..." npx tsx scripts/cleanup-test-shops.ts …
// ============================================================

import "dotenv/config";
import { ChannelName } from "@prisma/client";
import { prisma } from "../src/lib/prisma";

const argv = process.argv;
const APPLY = argv.includes("--apply");
const ONLY = argv.includes("--only");
const argAfter = (flag: string): string | undefined =>
  argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined;
const EXTRA_IDS = (argAfter("--ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const NAME = argAfter("--name")?.trim();

if (ONLY && EXTRA_IDS.length === 0 && !NAME) {
  console.error('--only cần kèm --ids <id1,id2> hoặc --name "<tên gian>".');
  process.exit(1);
}

/** Mã đơn do nút "Giả lập đơn" sinh: SHOPEE-1721..., LAZADA-1721... */
const MOCK_ORDER_CODE = /^(SHOPEE|LAZADA|TIKTOK|OFFLINE)-\d{10,}$/;

(async () => {
  const channels = await prisma.channel.findMany({
    where: ONLY ? {} : { channelName: { in: [ChannelName.SHOPEE, ChannelName.LAZADA] } },
    include: { _count: { select: { orders: true, channelProducts: true } } },
    orderBy: [{ channelName: "asc" }, { createdAt: "asc" }],
  });

  const targets = channels.filter((c) =>
    ONLY
      ? EXTRA_IDS.includes(c.id) ||
        (!!NAME && c.shopName.trim().toLowerCase() === NAME.toLowerCase())
      : !c.refreshToken ||
        /sandbox|(^|\W)test(\W|$)/i.test(c.shopName) ||
        EXTRA_IDS.includes(c.id)
  );
  const kept = channels.filter((c) => !targets.includes(c));

  console.log(`\n===== GIAN HÀNG ${ONLY ? "TẤT CẢ SÀN" : "SHOPEE/LAZADA"} (${channels.length}) =====`);
  for (const c of channels) {
    const mark = targets.includes(c) ? "[XOÁ]" : "[GIỮ]";
    console.log(
      `${mark} ${c.channelName.padEnd(6)} "${c.shopName}" — id=${c.id}` +
        ` | externalShopId=${c.externalShopId ?? "(không)"} | status=${c.status}` +
        ` | OAuth=${c.refreshToken ? "THẬT" : "giả lập"}` +
        ` | ${c._count.orders} đơn, ${c._count.channelProducts} SP sàn`
    );
  }

  if (ONLY && targets.length === 0) {
    console.log("\nKhông gian nào khớp --ids/--name. Không làm gì.");
    await prisma.$disconnect();
    return;
  }

  // Đơn test (mã giả lập) nằm trên các gian GIỮ LẠI — chỉ ở chế độ tự nhận diện.
  const mockOrdersOnKept = ONLY
    ? []
    : (
        await prisma.order.findMany({
          where: { channelId: { in: kept.map((c) => c.id) } },
          select: { id: true, orderCode: true, totalAmount: true, channelId: true },
        })
      ).filter((o) => MOCK_ORDER_CODE.test(o.orderCode));

  if (!ONLY) {
    console.log(`\n===== ĐƠN GIẢ LẬP TRÊN GIAN GIỮ LẠI (${mockOrdersOnKept.length}) =====`);
    const keptById = new Map(kept.map((c) => [c.id, c.shopName]));
    for (const o of mockOrdersOnKept) {
      console.log(
        `[XOÁ] ${o.orderCode} — ${Number(o.totalAmount).toLocaleString("vi-VN")}đ` +
          ` (gian "${keptById.get(o.channelId)}")`
      );
    }
  }

  // Thống kê dữ liệu phụ thuộc của các gian sắp xoá (để đối chiếu trước --apply).
  const channelIds = targets.map((c) => c.id);
  if (channelIds.length > 0) {
    const orderIdsPreview = (
      await prisma.order.findMany({ where: { channelId: { in: channelIds } }, select: { id: true } })
    ).map((o) => o.id);
    const [
      items, ttkSettle, lzdSettle, tracking, failNotice, koc, invLogs, invoiceLogs,
      campaigns, adSpend, wallet, staff, invCfg, syncLog, syncAlert, pushJob, appAuth, opex,
    ] = await Promise.all([
      prisma.orderItem.count({ where: { orderId: { in: orderIdsPreview } } }),
      prisma.tiktokOrderSettlement.count({ where: { orderId: { in: orderIdsPreview } } }),
      prisma.lazadaOrderSettlement.count({ where: { orderId: { in: orderIdsPreview } } }),
      prisma.deliveryTrackingTask.count({
        where: { OR: [{ orderId: { in: orderIdsPreview } }, { channelId: { in: channelIds } }] },
      }),
      prisma.deliveryFailNotice.count({ where: { orderId: { in: orderIdsPreview } } }),
      prisma.kocOrderAttribution.count({ where: { orderId: { in: orderIdsPreview } } }),
      prisma.inventoryLog.count({ where: { orderId: { in: orderIdsPreview } } }),
      prisma.invoiceLog.count({ where: { orderId: { in: orderIdsPreview } } }),
      prisma.adsCampaign.count({ where: { channelId: { in: channelIds } } }),
      prisma.adSpend.count({ where: { channelId: { in: channelIds } } }),
      prisma.walletWithdrawal.count({ where: { channelId: { in: channelIds } } }),
      prisma.staffChannel.count({ where: { channelId: { in: channelIds } } }),
      prisma.invoiceConfig.count({ where: { channelId: { in: channelIds } } }),
      prisma.inventorySyncLog.count({ where: { channelId: { in: channelIds } } }),
      prisma.inventorySyncAlert.count({ where: { channelId: { in: channelIds } } }),
      prisma.stockPushJob.count({ where: { channelId: { in: channelIds } } }),
      prisma.channelAppAuth.count({ where: { channelId: { in: channelIds } } }),
      prisma.operatingExpense.count({ where: { fundChannelId: { in: channelIds } } }),
    ]);
    console.log(
      `\n===== DỮ LIỆU PHỤ THUỘC SẼ XOÁ CÙNG ${channelIds.length} GIAN =====\n` +
        `  đơn ${orderIdsPreview.length} | dòng hàng ${items} | bản kê TikTok ${ttkSettle} | sao kê Lazada ${lzdSettle}\n` +
        `  vé tracking ${tracking} | thông báo giao hỏng ${failNotice} | KOC attribution ${koc}\n` +
        `  nhật ký kho gỡ liên kết ${invLogs} | hoá đơn gỡ liên kết ${invoiceLogs} (giữ log)\n` +
        `  chiến dịch ads ${campaigns} | chi ads ${adSpend} | lệnh rút ví ${wallet} | phân quyền NV ${staff}\n` +
        `  cấu hình HĐ ${invCfg} | sync log ${syncLog} | cảnh báo lệch tồn ${syncAlert} | job đẩy tồn ${pushJob}\n` +
        `  ủy quyền app phụ ${appAuth} | thu chi vận hành gỡ nguồn tiền ${opex} (giữ khoản)`
    );
  }

  if (!APPLY) {
    console.log(
      "\nDRY-RUN — chưa xoá gì. Kiểm tra danh sách [XOÁ]/[GIỮ] ở trên;" +
        " đúng rồi thì chạy lại kèm --apply."
    );
    await prisma.$disconnect();
    return;
  }

  const orderIdsOfTargets = (
    await prisma.order.findMany({
      where: { channelId: { in: channelIds } },
      select: { id: true },
    })
  ).map((o) => o.id);
  const orderIds = [...orderIdsOfTargets, ...mockOrdersOnKept.map((o) => o.id)];

  console.log(
    `\nBẮT ĐẦU XOÁ: ${channelIds.length} gian, ${orderIds.length} đơn` +
      ` (${orderIdsOfTargets.length} thuộc gian test + ${mockOrdersOnKept.length} đơn giả lập trên gian thật)…`
  );

  // Xoá theo lô 500 id để câu `IN (...)` không phình quá giới hạn.
  const chunks = <T,>(arr: T[], n = 500) =>
    Array.from({ length: Math.ceil(arr.length / n) }, (_, i) =>
      arr.slice(i * n, i * n + n)
    );

  for (const ids of chunks(orderIds)) {
    await prisma.invoiceLog.updateMany({ where: { orderId: { in: ids } }, data: { orderId: null } });
    await prisma.inventoryLog.updateMany({ where: { orderId: { in: ids } }, data: { orderId: null } });
    await prisma.lazadaOrderSettlement.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.tiktokOrderSettlement.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.deliveryTrackingTask.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.deliveryFailNotice.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.kocOrderAttribution.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.order.deleteMany({ where: { id: { in: ids } } });
  }
  console.log(
    `✓ Đã xoá ${orderIds.length} đơn (kèm dòng hàng + bản kê/sao kê + vé giao + gỡ liên kết hoá đơn/nhật ký kho).`
  );

  if (channelIds.length > 0) {
    await prisma.channelProduct.deleteMany({ where: { channelId: { in: channelIds } } });
    // Ads: bảng con của chiến dịch trước, rồi chiến dịch, rồi cấu hình trợ lý.
    const campaignIds = (
      await prisma.adsCampaign.findMany({ where: { channelId: { in: channelIds } }, select: { id: true } })
    ).map((c) => c.id);
    await prisma.adsCampaignDailyPerf.deleteMany({ where: { adsCampaignId: { in: campaignIds } } });
    await prisma.adsActionLog.deleteMany({
      where: { OR: [{ channelId: { in: channelIds } }, { adsCampaignId: { in: campaignIds } }] },
    });
    await prisma.adsCampaign.deleteMany({ where: { id: { in: campaignIds } } });
    await prisma.adsAssistantConfig.deleteMany({ where: { channelId: { in: channelIds } } });
    await prisma.adSpend.deleteMany({ where: { channelId: { in: channelIds } } });
    await prisma.walletWithdrawal.deleteMany({ where: { channelId: { in: channelIds } } });
    await prisma.staffChannel.deleteMany({ where: { channelId: { in: channelIds } } });
    await prisma.invoiceConfig.deleteMany({ where: { channelId: { in: channelIds } } });
    await prisma.inventorySyncLog.deleteMany({ where: { channelId: { in: channelIds } } });
    await prisma.inventorySyncAlert.deleteMany({ where: { channelId: { in: channelIds } } });
    await prisma.stockPushJob.deleteMany({ where: { channelId: { in: channelIds } } });
    await prisma.deliveryTrackingTask.deleteMany({ where: { channelId: { in: channelIds } } });
    await prisma.channelAppAuth.deleteMany({ where: { channelId: { in: channelIds } } });
    // Thu chi vận hành gắn nguồn tiền vào gian: giữ khoản, gỡ liên kết (SetNull).
    await prisma.operatingExpense.updateMany({
      where: { fundChannelId: { in: channelIds } },
      data: { fundChannelId: null },
    });
    const del = await prisma.channel.deleteMany({ where: { id: { in: channelIds } } });
    console.log(`✓ Đã xoá ${del.count} gian cùng toàn bộ dữ liệu liên quan.`);
  }

  console.log("\nXONG. Các gian OAuth thật và đơn thật không bị đụng tới.");
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
