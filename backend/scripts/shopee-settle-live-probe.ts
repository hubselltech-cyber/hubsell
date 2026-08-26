// Thăm dò SỐNG endpoint escrow trên sandbox: gọi syncShopeeSettlements cho
// từng gian Shopee còn token — chỉ ĐỌC (escrow_list/detail), không ghi gì nếu
// sàn không báo đơn giải ngân. Mục đích: biết sandbox có hỗ trợ API này không
// TRƯỚC khi deploy production.
import { prisma } from "../src/lib/prisma";
import { syncShopeeSettlements } from "../src/integrations/shopee/settlements";

async function main() {
  const channels = await prisma.channel.findMany({
    where: { channelName: "SHOPEE", refreshToken: { not: null } },
  });
  console.log(`Có ${channels.length} gian Shopee còn token.`);
  for (const c of channels) {
    try {
      const r = await syncShopeeSettlements(c, { daysBack: 90 });
      console.log(`[${c.shopName}] OK:`, r);
    } catch (e) {
      console.log(`[${c.shopName}] LỖI:`, (e as Error).message);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
