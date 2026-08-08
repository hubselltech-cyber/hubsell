// Khảo sát thực địa dữ liệu Lazada/Shopee phục vụ trang KOC theo sàn:
// có bao nhiêu đơn, bao nhiêu đã quyết toán, bao nhiêu có phí affiliate.
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

(async () => {
  const rows = await p.$queryRaw`
    SELECT c."channelName",
           COUNT(*)::int AS orders,
           COUNT(*) FILTER (WHERE o."isSettled")::int AS settled,
           COUNT(*) FILTER (WHERE o."affiliateFee" > 0)::int AS aff_orders,
           SUM(o."affiliateFee")::float AS aff_fee,
           MIN(o."createdAt") AS oldest,
           MAX(o."createdAt") AS newest
    FROM "Order" o JOIN "Channel" c ON c.id = o."channelId"
    GROUP BY 1 ORDER BY 1`;
  console.log("=== ORDERS BY CHANNEL ===");
  for (const r of rows)
    console.log(
      `${r.channelName}: ${r.orders} đơn, ${r.settled} settled, ${r.aff_orders} affiliate (${r.aff_fee ?? 0}đ) | ${r.oldest?.toISOString().slice(0, 10)} → ${r.newest?.toISOString().slice(0, 10)}`
    );

  // Lazada settlement chi tiết — bảng có thể CHƯA migrate ở local, bọc try
  // để script khảo sát không chết giữa chừng.
  try {
    const rows = await p.lazadaOrderSettlement.count();
    const withAff = await p.lazadaOrderSettlement.count({
      where: { feeAffiliate: { not: 0 } },
    });
    console.log(`=== LazadaOrderSettlement === ${rows} dòng, ${withAff} có phí affiliate`);
  } catch {
    console.log("=== LazadaOrderSettlement === bảng chưa migrate ở DB này (bỏ qua)");
  }

  // OrderItem của các đơn affiliate (thử lấy 3 dòng xem cấu trúc giá)
  const items = await p.orderItem.findMany({
    where: { order: { affiliateFee: { gt: 0 } } },
    take: 3,
  });
  console.log("=== SAMPLE AFFILIATE ORDER ITEMS ===");
  console.log(JSON.stringify(items, null, 1).slice(0, 1200));
  await p.$disconnect();
})();
