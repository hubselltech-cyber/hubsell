// ============================================================
// GHI DANH / RÚT gian khỏi "đọc bóng đơn" (Pha C lát 1, docs/CUNG-HOA-LOP-GOI-SAN.md 5c)
//
//   npx tsx scripts/shadow-enroll.ts list                       # gian đang ghi danh + độ trễ
//   npx tsx scripts/shadow-enroll.ts on  <channelId|shopName>   # bật: tạo dòng sync_cursors (orders-shadow)
//   npx tsx scripts/shadow-enroll.ts off <channelId|shopName>   # tắt: xóa dòng (bảng bóng giữ nguyên để so)
//   npx tsx scripts/shadow-enroll.ts compare <channelId|shopName> [ngày=3]   # so bóng ↔ Order
//
// Cùng việc bằng SQL (dán Supabase) ở docs 5c. Không gọi sàn — chỉ ghi DB.
// ============================================================

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { enrollStream } from "../src/services/sync-lanes";
import { SHADOW_STREAM } from "../src/integrations/order-read-adapters";
import { CURSOR_READ } from "../src/config/marketplace-read";

async function findChannel(key: string) {
  const ch =
    (await prisma.channel.findUnique({ where: { id: key } })) ??
    (await prisma.channel.findFirst({ where: { shopName: key, status: "ACTIVE" } }));
  if (!ch) throw new Error(`không thấy gian "${key}"`);
  if (!["SHOPEE", "TIKTOK", "LAZADA"].includes(ch.channelName)) throw new Error(`gian ${ch.shopName} sàn ${ch.channelName} không hỗ trợ`);
  return ch;
}

async function main() {
  const [cmd, key, daysArg] = process.argv.slice(2);
  if (cmd === "list") {
    const rows = await prisma.syncCursor.findMany({ where: { stream: SHADOW_STREAM }, include: { channel: { select: { channelName: true, shopName: true } } } });
    for (const r of rows) {
      const lagMin = Math.round((Date.now() - r.cursorAt.getTime()) / 60_000);
      console.log(
        `${r.channel.channelName.padEnd(7)} ${r.channel.shopName.padEnd(28)} trễ ${String(lagMin).padStart(5)}'  cửa sổ ${Math.round(r.windowMs / 60_000)}'  ` +
          `${r.lastStatus ?? "-"} ${r.lastPages ?? 0} trang  tới hạn ${r.dueAt.toISOString()}  thuê bao ${r.leaseOwner ?? "-"}`
      );
    }
    if (!rows.length) console.log("(chưa ghi danh gian nào)");
    return;
  }
  if (!key) throw new Error("thiếu channelId|shopName");
  const ch = await findChannel(key);
  if (cmd === "on") {
    await enrollStream(ch.id, SHADOW_STREAM, "orders", new Date(Date.now() - 30 * 60_000), CURSOR_READ.INITIAL_WINDOW_MS);
    console.log(`✅ ghi danh ${ch.channelName} "${ch.shopName}" (${ch.id}) — làn orders nhặt trong ≤ 5 s`);
    return;
  }
  if (cmd === "off") {
    const r = await prisma.syncCursor.deleteMany({ where: { channelId: ch.id, stream: SHADOW_STREAM } });
    console.log(`✅ rút ${ch.shopName}: xóa ${r.count} dòng con trỏ (bảng bóng giữ nguyên)`);
    return;
  }
  if (cmd === "compare") {
    // "Order" không có cột updatedAt (lộ 19/10 khi chạy thật) → "đường cũ thấy biến động" = sự kiện sàn gửi (webhook_events, H3 phủ 99,8–100 %).
    const days = Number(daysArg ?? 3);
    const since = new Date(Date.now() - days * 86_400_000);
    const cur = await prisma.syncCursor.findUnique({ where: { channelId_stream: { channelId: ch.id, stream: SHADOW_STREAM } } });
    // Chừa 30' sát con trỏ: đơn đổi tiếp sau con trỏ có update_time mới hơn → cửa sổ kế mới thấy (19/10 lượt 1 "sót" 2 đơn vì thế).
    const upto = new Date((cur?.cursorAt.getTime() ?? 0) - 30 * 60_000);
    const [ev, onlyNew] = await Promise.all([
      prisma.$queryRaw<{ n: bigint; seen: bigint; missed: string | null }[]>`
        WITH ev AS (
          SELECT w."entityId" AS code, min(w."createdAt") AS first_at FROM webhook_events w
           WHERE w.source = ${ch.channelName}::text AND w."shopId" = ${ch.externalShopId ?? ""}
             AND w."createdAt" >= ${since} AND w."createdAt" < ${upto}
           GROUP BY 1)
        SELECT count(*) AS n,
               count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "sync_shadow_orders" s WHERE s."channelId" = ${ch.id} AND s."orderCode" = ev.code)) AS seen,
               string_agg(code || '@' || to_char(first_at, 'DD HH24:MI'), ', ')
                 FILTER (WHERE NOT EXISTS (SELECT 1 FROM "sync_shadow_orders" s WHERE s."channelId" = ${ch.id} AND s."orderCode" = ev.code)) AS missed
          FROM ev`,
      prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM "sync_shadow_orders" s
         WHERE s."channelId" = ${ch.id} AND s."firstSeenAt" >= ${since}
           AND NOT EXISTS (SELECT 1 FROM "Order" o WHERE o."channelId" = s."channelId" AND o."orderCode" = s."orderCode")`,
    ]);
    console.log(
      `${ch.channelName} "${ch.shopName}" ${days} ngày: đơn có webhook ${ev[0].n} · bóng thấy ${ev[0].seen} · đường MỚI SÓT: ${ev[0].missed ?? "(không)"} · chỉ đường MỚI (Order không có) ${onlyNew[0].n}`
    );
    if (cur) console.log(`con trỏ ${cur.cursorAt.toISOString()} (trễ ${Math.round((Date.now() - cur.cursorAt.getTime()) / 60_000)}'), cửa sổ ${Math.round(cur.windowMs / 60_000)}'`);
    return;
  }
  throw new Error(`lệnh lạ "${cmd}" — list | on | off | compare`);
}

main()
  .catch((e) => {
    console.error("❌", (e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
