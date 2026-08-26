// ============================================================
// DỌN SHOP TEST/SANDBOX + ĐƠN TEST (Shopee & Lazada) — chuẩn bị giai đoạn theo dõi số thật.
//
// Nhận diện:
//   1. GIAN TEST  = Channel SHOPEE/LAZADA KHÔNG có refreshToken (gian giả lập —
//      mọi gian OAuth thật đều có refreshToken, kể cả khi đang DISCONNECTED),
//      HOẶC tên gian chứa "SANDBOX"/"TEST" (shop sandbox Shopee đặt tên
//      "OpenSANDBOX…"). Gian sandbox khác không khớp luật — truyền qua --ids.
//   2. ĐƠN TEST trên gian GIỮ LẠI = orderCode dạng "<SÀN>-<timestamp>" do nút
//      "Giả lập đơn" sinh (webhooks.ts: `${channelName}-${Date.now()}`).
//
// XOÁ TƯỜNG MINH TỪ DƯỚI LÊN (không dựa cascade DB — schema Supabase áp tay):
//   settlement/invoiceLog/orderItem → order → channelProduct → adSpend/
//   walletWithdrawal/staffChannel/invoiceConfig/inventorySyncLog+Alert → channel.
//
// Chạy (mặc định DRY-RUN, chỉ in ra không xoá):
//   cd backend && npx tsx scripts/cleanup-test-shops.ts
//   npx tsx scripts/cleanup-test-shops.ts --ids <id1>,<id2>   # thêm gian sandbox OAuth
//   npx tsx scripts/cleanup-test-shops.ts --apply             # XOÁ THẬT
// Trỏ DB production:  DATABASE_URL="postgresql://..." npx tsx scripts/cleanup-test-shops.ts
// ============================================================

import "dotenv/config";
import { ChannelName } from "@prisma/client";
import { prisma } from "../src/lib/prisma";

const APPLY = process.argv.includes("--apply");
const extraIdsArg = process.argv[process.argv.indexOf("--ids") + 1];
const EXTRA_IDS =
  process.argv.includes("--ids") && extraIdsArg
    ? extraIdsArg.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

/** Mã đơn do nút "Giả lập đơn" sinh: SHOPEE-1721..., LAZADA-1721... */
const MOCK_ORDER_CODE = /^(SHOPEE|LAZADA|TIKTOK|OFFLINE)-\d{10,}$/;

(async () => {
  const channels = await prisma.channel.findMany({
    where: { channelName: { in: [ChannelName.SHOPEE, ChannelName.LAZADA] } },
    include: { _count: { select: { orders: true, channelProducts: true } } },
    orderBy: [{ channelName: "asc" }, { createdAt: "asc" }],
  });

  const targets = channels.filter(
    (c) =>
      !c.refreshToken ||
      /sandbox|(^|\W)test(\W|$)/i.test(c.shopName) ||
      EXTRA_IDS.includes(c.id)
  );
  const kept = channels.filter((c) => !targets.includes(c));

  console.log(`\n===== GIAN HÀNG SHOPEE/LAZADA (${channels.length}) =====`);
  for (const c of channels) {
    const mark = targets.includes(c) ? "[XOÁ]" : "[GIỮ]";
    console.log(
      `${mark} ${c.channelName.padEnd(6)} "${c.shopName}" — id=${c.id}` +
        ` | externalShopId=${c.externalShopId ?? "(không)"} | status=${c.status}` +
        ` | OAuth=${c.refreshToken ? "THẬT" : "giả lập"}` +
        ` | ${c._count.orders} đơn, ${c._count.channelProducts} SP sàn`
    );
  }

  // Đơn test (mã giả lập) nằm trên các gian GIỮ LẠI.
  const mockOrdersOnKept = (
    await prisma.order.findMany({
      where: { channelId: { in: kept.map((c) => c.id) } },
      select: { id: true, orderCode: true, totalAmount: true, channelId: true },
    })
  ).filter((o) => MOCK_ORDER_CODE.test(o.orderCode));

  console.log(`\n===== ĐƠN GIẢ LẬP TRÊN GIAN GIỮ LẠI (${mockOrdersOnKept.length}) =====`);
  const keptById = new Map(kept.map((c) => [c.id, c.shopName]));
  for (const o of mockOrdersOnKept) {
    console.log(
      `[XOÁ] ${o.orderCode} — ${Number(o.totalAmount).toLocaleString("vi-VN")}đ` +
        ` (gian "${keptById.get(o.channelId)}")`
    );
  }

  if (!APPLY) {
    console.log(
      "\nDRY-RUN — chưa xoá gì. Kiểm tra danh sách [XOÁ]/[GIỮ] ở trên;" +
        " đúng rồi thì chạy lại kèm --apply. Thêm gian sandbox OAuth (nếu có) bằng --ids id1,id2."
    );
    await prisma.$disconnect();
    return;
  }

  const channelIds = targets.map((c) => c.id);
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
    await prisma.invoiceLog.updateMany({
      where: { orderId: { in: ids } },
      data: { orderId: null },
    });
    await prisma.lazadaOrderSettlement.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.order.deleteMany({ where: { id: { in: ids } } });
  }
  console.log(`✓ Đã xoá ${orderIds.length} đơn (kèm dòng hàng + sao kê + gỡ liên kết hoá đơn).`);

  if (channelIds.length > 0) {
    await prisma.channelProduct.deleteMany({ where: { channelId: { in: channelIds } } });
    await prisma.adSpend.deleteMany({ where: { channelId: { in: channelIds } } });
    await prisma.walletWithdrawal.deleteMany({ where: { channelId: { in: channelIds } } });
    await prisma.staffChannel.deleteMany({ where: { channelId: { in: channelIds } } });
    await prisma.invoiceConfig.deleteMany({ where: { channelId: { in: channelIds } } });
    await prisma.inventorySyncLog.deleteMany({ where: { channelId: { in: channelIds } } });
    await prisma.inventorySyncAlert.deleteMany({ where: { channelId: { in: channelIds } } });
    const del = await prisma.channel.deleteMany({ where: { id: { in: channelIds } } });
    console.log(`✓ Đã xoá ${del.count} gian test cùng toàn bộ dữ liệu liên quan.`);
  }

  console.log("\nXONG. Các gian OAuth thật và đơn thật không bị đụng tới.");
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
