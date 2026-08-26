// ============================================================
// PROBE (READ-ONLY): gọi thật /finance/payout/status/get trên shop Lazada đã
// liên kết để xem HÌNH DẠNG RESPONSE THẬT — docs open.lazada.com chặn đọc tự
// động nên không tin tên trường trên giấy (bài học MISA: đừng đoán endpoint).
// Chạy:  cd backend && npx tsx scripts/lazada-payout-probe.ts [external_shop_id]
// ============================================================

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { getPayoutStatus } from "../src/integrations/lazada/client";
import { getValidLazadaAccessToken } from "../src/integrations/lazada/service";

(async () => {
  const wantShopId = process.argv[2]?.trim();
  const channels = await prisma.channel.findMany({
    where: {
      channelName: "LAZADA",
      status: "ACTIVE",
      refreshToken: { not: null },
      ...(wantShopId ? { externalShopId: wantShopId } : {}),
    },
  });
  if (channels.length === 0) {
    console.log("❌ Không thấy gian Lazada đã nối API trong DB.");
    await prisma.$disconnect();
    return;
  }

  // Mốc 180 ngày để chắc chắn quét trúng vài kỳ sao kê (Lazada chốt theo tuần).
  const createdAfter = new Date(Date.now() - 180 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  for (const channel of channels) {
    console.log(`\n===== ${channel.shopName} (${channel.externalShopId}) — created_after=${createdAfter} =====`);
    try {
      const accessToken = await getValidLazadaAccessToken(channel);
      const payouts = await getPayoutStatus({ accessToken, createdAfter });
      console.log(`Số đợt payout: ${payouts.length}`);
      // In NGUYÊN VĂN 3 bản ghi đầu để đối chiếu tên trường thật.
      console.log(JSON.stringify(payouts.slice(0, 3), null, 2));
    } catch (e) {
      console.log("✗ Lỗi gọi API:", (e as Error).message);
    }
  }
  await prisma.$disconnect();
})();
