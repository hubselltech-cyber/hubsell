// ============================================================
// CHẠY TAY MỘT LẦN: sửa MỐC GIAO THÀNH CÔNG của đơn cũ Shopee + Lazada.
//
// Vì sao: trước 30/09/2026 mốc giao ghi bằng GIỜ ĐỒNG BỘ. Đơn nạp lịch sử lúc
// nối gian mang ngày nạp, có thể lệch cả quý. Tờ khai thuế cắt kỳ theo mốc giao
// (anh Trung chốt 30/09/2026) nên phải sửa đơn cũ TRƯỚC khi bật tờ khai mới.
//
// Cách làm: đồng bộ lại đơn theo ngày tạo (đúng việc nút "Đồng bộ đơn" vẫn làm);
// luồng upsert tự kéo mốc giao về thời điểm sàn cập nhật đơn (lib/delivered-at.ts).
// TikTok không cần: đã dùng delivery_time của sàn từ đầu.
//
// Chạy (trên máy có DATABASE_URL prod, vd Render Shell của worker):
//   cd backend && npx tsx scripts/fix-delivered-at.ts            # mọi gian, 200 ngày
//   cd backend && npx tsx scripts/fix-delivered-at.ts 120        # mọi gian, 120 ngày
//   cd backend && npx tsx scripts/fix-delivered-at.ts 200 <channelId>
// Chạy lại nhiều lần vô hại (idempotent). Gian chạy TUẦN TỰ để không dồn API sàn.
// ============================================================

import "dotenv/config";
import { ChannelName, ShippingStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { syncShopeeOrders } from "../src/integrations/shopee/service";
import { syncLazadaOrders } from "../src/integrations/lazada/service";

/** Đủ rộng để một lượt chạy tay đọc hết đơn của gian lớn; chạm trần thì báo ra. */
const MAX_PAGES = 2000;
/** Mốc giao muộn hơn ngày tạo đơn quá ngưỡng này = nghi ghi bằng giờ đồng bộ (chỉ để ĐẾM, không sửa). */
const SUSPECT_DAYS = 30;

async function countSuspects(channelId: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n FROM "Order"
    WHERE "channelId" = ${channelId}
      AND "shippingStatus"::text = ${ShippingStatus.DELIVERED}
      AND "deliveredAt" IS NOT NULL
      AND "deliveredAt" - "createdAt" > make_interval(days => ${SUSPECT_DAYS})`;
  return Number(rows[0]?.n ?? 0);
}

(async () => {
  const daysBack = Number(process.argv[2]) || 200;
  const onlyChannelId = process.argv[3]?.trim();
  const channels = await prisma.channel.findMany({
    where: {
      channelName: { in: [ChannelName.SHOPEE, ChannelName.LAZADA] },
      status: "ACTIVE",
      refreshToken: { not: null },
      ...(onlyChannelId ? { id: onlyChannelId } : {}),
    },
    orderBy: { createdAt: "asc" },
  });
  console.log(`Sửa mốc giao: ${channels.length} gian, ${daysBack} ngày gần nhất theo ngày tạo đơn.`);

  let failed = 0;
  for (const channel of channels) {
    const label = `${channel.channelName} "${channel.shopName}" (${channel.id})`;
    try {
      const before = await countSuspects(channel.id);
      const r =
        channel.channelName === ChannelName.SHOPEE
          ? await syncShopeeOrders(channel, { daysBack, maxPages: MAX_PAGES })
          : await syncLazadaOrders(channel, { daysBack, maxPages: MAX_PAGES });
      const after = await countSuspects(channel.id);
      console.log(
        `✓ ${label}: đọc ${r.fetched} đơn / ${r.pages} trang${r.truncated ? " — CHƯA ĐỦ, chạm trần trang" : ""}; ` +
          `đơn nghi sai mốc giao (muộn hơn ngày tạo > ${SUSPECT_DAYS} ngày): ${before} → ${after}`
      );
    } catch (e) {
      failed += 1;
      console.log(`✗ ${label}: ${(e as Error).message}`);
    }
  }
  console.log(failed === 0 ? "XONG, không gian nào lỗi." : `XONG, ${failed} gian lỗi — chạy lại cho các gian đó.`);
  await prisma.$disconnect();
})();
