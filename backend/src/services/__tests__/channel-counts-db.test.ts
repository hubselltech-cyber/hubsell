// ============================================================
// countByChannel (28/10/2026): đếm đơn / SP sàn / SP đã khớp theo DANH SÁCH gian
// trên DB dev — phải bằng số đếm trực tiếp từng gian, gian không có dòng → 0,
// gian không đưa vào → không có trong kết quả (không gom cả bảng như _count cũ).
// ============================================================

import "../../integrations/__tests__/load-env";
import { describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { countByChannel } from "../channel-counts";

const dbReady: boolean = await (async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
})();
if (!dbReady) console.log("[channel-counts-db.test] BỎ QUA: không nối được DB dev");

describe.skipIf(!dbReady)("countByChannel", () => {
  it("rỗng → Map rỗng, không chạm DB", async () => {
    expect((await countByChannel([])).size).toBe(0);
  });

  it("bằng count() từng gian; gian lạ → 0; gian ngoài danh sách không xuất hiện", async () => {
    const channels = await prisma.channel.findMany({ select: { id: true }, orderBy: { id: "asc" }, take: 5 });
    const ids = channels.map((c) => c.id);
    const ghost = "khong-co-gian-nay";
    const counts = await countByChannel([...ids, ghost]);
    expect(counts.size).toBe(ids.length + 1);
    expect(counts.get(ghost)).toEqual({ orders: 0, channelProducts: 0, matchedProducts: 0 });
    for (const id of ids) {
      const [orders, channelProducts, matchedProducts] = await Promise.all([
        prisma.order.count({ where: { channelId: id } }),
        prisma.channelProduct.count({ where: { channelId: id } }),
        prisma.channelProduct.count({ where: { channelId: id, productId: { not: null } } }),
      ]);
      expect(counts.get(id), id).toEqual({ orders, channelProducts, matchedProducts });
    }
  });
});
