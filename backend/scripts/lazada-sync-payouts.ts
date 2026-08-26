// ============================================================
// CHẠY TAY: đồng bộ đợt payout Lazada → WalletWithdrawal (đối soát dòng tiền).
// READ-ONLY. Chạy:  cd backend && npx tsx scripts/lazada-sync-payouts.ts [days_back]
// Cron nhịp giờ đã tự chạy (order-auto-sync) — script này để backfill sâu.
// ============================================================

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { syncLazadaPayouts } from "../src/integrations/lazada/payouts";

(async () => {
  const daysBack = Number(process.argv[2]) || 180;
  const channels = await prisma.channel.findMany({
    where: { channelName: "LAZADA", status: "ACTIVE", refreshToken: { not: null } },
  });
  if (channels.length === 0) {
    console.log("❌ Không thấy gian Lazada đã nối API trong DB.");
    await prisma.$disconnect();
    return;
  }
  for (const channel of channels) {
    console.log(`\n===== ${channel.shopName} (${channel.externalShopId}) — ${daysBack} ngày =====`);
    try {
      const r = await syncLazadaPayouts(channel, { daysBack });
      console.log("KẾT QUẢ:", r);
    } catch (e) {
      console.log("✗ Lỗi:", (e as Error).message);
    }
  }
  await prisma.$disconnect();
})();
