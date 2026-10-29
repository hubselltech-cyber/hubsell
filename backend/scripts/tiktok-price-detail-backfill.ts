// ============================================================
// Bu nen voucher shop TikTok (Get Order Price Details 202407) cho don da co ban ke
// — lat 3 (29/10/2026). Worker gio tu chay 200 don/gian/luot; script nay de chay
// NGAY cho mot gian/tat ca gian voi so lon hon (Shell worker, in khong dau):
//   npx tsx scripts/tiktok-price-detail-backfill.ts [shopName|all] [limit=2000] [daysBack=90]
// Chi doc API + ghi Order.tiktokVoucherSeller/tiktokPriceDetailAt; moi call qua lan
// gioi han nhip cua gian.
// ============================================================
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { backfillTiktokPriceDetails } from "../src/integrations/tiktok/price-detail";

async function main() {
  const want = (process.argv[2] ?? "all").trim();
  const limit = Math.max(1, Math.min(2000, Number(process.argv[3] ?? 2000) || 2000));
  const daysBack = Math.max(1, Math.min(365, Number(process.argv[4] ?? 90) || 90));
  const channels = await prisma.channel.findMany({
    where: {
      channelName: "TIKTOK",
      status: "ACTIVE",
      refreshToken: { not: null },
      ...(want && want !== "all" ? { shopName: want } : {}),
    },
    orderBy: { shopName: "asc" },
  });
  if (channels.length === 0) {
    console.log("Khong co gian TikTok ACTIVE" + (want !== "all" ? ` ten "${want}"` : ""));
    await prisma.$disconnect();
    return;
  }
  let totalWritten = 0;
  for (const channel of channels) {
    const started = Date.now();
    try {
      const r = await backfillTiktokPriceDetails(channel, { limit, daysBack });
      totalWritten += r.written;
      console.log(
        `${channel.shopName}: doc ${r.scanned}, ghi ${r.written}, thieu truong ${r.noField}, loi ${r.errors} (${Math.round((Date.now() - started) / 1000)}s)`
      );
    } catch (err) {
      console.log(`${channel.shopName}: LOI ${(err as Error).message}`);
    }
  }
  const left = await prisma.order.count({
    where: {
      channel: { channelName: "TIKTOK", status: "ACTIVE" },
      createdAt: { gte: new Date(Date.now() - daysBack * 86_400_000) },
      tiktokPriceDetailAt: null,
      tiktokSettlement: { isNot: null },
    },
  });
  console.log(`TONG: ghi ${totalWritten} don; con ${left} don (${daysBack} ngay) chua doc tren toan he thong`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Backfill loi:", (err as Error).message);
  await prisma.$disconnect();
  process.exit(1);
});
