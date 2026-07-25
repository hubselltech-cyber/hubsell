// ============================================================
// CHẠY TAY: đồng bộ lệnh rút ví Shopee → WalletWithdrawal (đối soát dòng tiền).
// READ-ONLY. Chạy:  cd backend && npx tsx scripts/shopee-sync-withdrawals.ts [shop_id]
// LƯU Ý: sandbox có thể chưa hỗ trợ get_wallet_transaction_list → sẽ báo lỗi API,
// đó là hạn chế môi trường test, không phải lỗi code.
// ============================================================

import "dotenv/config";
import { prisma } from "../src/prisma";
import { syncShopeeWithdrawals } from "../src/integrations/shopee/wallet";

(async () => {
  const wantShopId = process.argv[2]?.trim();
  const channel = await prisma.channel.findFirst({
    where: {
      channelName: "SHOPEE",
      status: "ACTIVE",
      refreshToken: { not: null },
      ...(wantShopId ? { externalShopId: wantShopId } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  if (!channel) {
    console.log("❌ Không thấy gian Shopee đã nối API trong DB.");
    await prisma.$disconnect();
    return;
  }
  console.log(`SHOP: ${channel.shopName} | shop_id=${channel.externalShopId}`);
  try {
    const r = await syncShopeeWithdrawals(channel);
    console.log("KẾT QUẢ:", r);
  } catch (e) {
    console.log("✗ Lỗi gọi API ví (nhiều khả năng sandbox chưa hỗ trợ):", (e as Error).message);
  }
  await prisma.$disconnect();
})();
