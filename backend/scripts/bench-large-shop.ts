// ============================================================
// GIAN THỬ CỠ SHOP LỚN — dựng dữ liệu đo tải trên DATABASE DEV
// (docs/QUANG-CAO-GOM-TRONG-DATABASE.md mục 11.3, 11.8)
//
// Dựng một chủ shop TEST + một gian Shopee đã ngắt với N đơn rải trong 29 ngày:
// đơn, dòng hàng, sổ đơn và sổ dòng hàng (ghi thẳng số giả lập, không qua
// worker), sản phẩm sàn, chiến dịch quảng cáo. Dùng để đo câu đọc sổ cái, câu
// gom biên lãi quảng cáo và việc xóa gian ở quy mô mà dữ liệu dev không có.
// --platform TIKTOK: gian TikTok, đơn rải 59 ngày (cửa sổ hòa vốn 60 ngày), kèm
// bản kê TikTok — đơn tạo trước 14 ngày đã đối soát thật, đơn 7–14 ngày mới có
// số ước tính của sàn, đơn mới hơn chưa có bản kê — phí GMV Max 5% giá trị dòng
// và số quảng cáo theo ngày của từng chiến dịch (để có khoảng tự kiểm mẫu số).
//
//   npx tsx scripts/bench-large-shop.ts build [--orders 300000] [--products 2000] [--campaigns 100] [--platform SHOPEE|TIKTOK]
//   npx tsx scripts/bench-large-shop.ts status
//   npx tsx scripts/bench-large-shop.ts cleanup
//
// Đo sau khi dựng (mã chủ shop / mã gian do lệnh build in ra):
//   npx tsx scripts/ledger-backfill.ts params-compare --owner <userId>
//   npx tsx scripts/ledger-backfill.ts ads-compare --channel <channelId> --explain
//
// CHỈ chạy trên database máy mình: script từ chối mọi DATABASE_URL không trỏ
// localhost. Khi gian thử còn tồn tại thì ĐỪNG chạy cả bộ test (nhiều test
// duyệt mọi chủ shop / mọi gian) — dọn bằng `cleanup` trước.
// Số đo 30/09/2026 (300.000 đơn, 405.000 dòng hàng): dựng khoảng 5,5 phút, dọn
// khoảng 3,5 phút.
// ============================================================

import { ChannelName, Prisma } from "@prisma/client";
import { LEDGER_FORMULA_VERSION } from "../src/lib/order-ledger";
import { prisma } from "../src/lib/prisma";
import { startChannelDelete } from "../src/services/channel-delete";

const EMAIL_PREFIX = "test-scale-";
/** SKU phân loại mỗi sản phẩm sàn, số sản phẩm mỗi chiến dịch. */
const VARIANTS = 3;
const ITEMS_PER_CAMPAIGN = 20;

function numberArg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const n = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function platformArg(): ChannelName {
  const i = process.argv.indexOf("--platform");
  const v = i >= 0 ? String(process.argv[i + 1]).toUpperCase() : "SHOPEE";
  if (v !== "SHOPEE" && v !== "TIKTOK") throw new Error(`--platform chỉ nhận SHOPEE hoặc TIKTOK (đang là "${v}")`);
  return v as ChannelName;
}

function assertLocalDatabase(): void {
  let host = "";
  try {
    host = new URL(process.env.DATABASE_URL ?? "").hostname;
  } catch {
    // để trống → từ chối bên dưới
  }
  if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") {
    throw new Error(`bench-large-shop chỉ chạy trên database máy mình — DATABASE_URL đang trỏ "${host || "không rõ"}"`);
  }
}

async function build(): Promise<void> {
  const orders = numberArg("orders", 300_000);
  const products = numberArg("products", 2_000);
  const campaigns = numberArg("campaigns", 100);
  const platform = platformArg();
  const tiktok = platform === ChannelName.TIKTOK;
  /** Số ngày rải đơn: nằm trọn trong cửa sổ của sàn (biên lãi 30 ngày, hòa vốn TikTok 60 ngày). */
  const spreadDays = tiktok ? 59 : 29;
  // Đã đối soát: Shopee mọi đơn; TikTok chỉ đơn không hủy tạo trước 14 ngày (đối soát TikTok mất hàng tuần).
  const settledSql = tiktok
    ? Prisma.sql`(o."shippingStatus" <> 'CANCELLED' AND o."createdAt" < (now() AT TIME ZONE 'UTC') - INTERVAL '14 days')`
    : Prisma.sql`true`;
  // Phí GMV Max sàn trừ trong đơn (số có dấu, âm = bị trừ): TikTok 5% giá trị dòng, sàn khác không có.
  const gmvMaxRate = tiktok ? -0.05 : 0;
  const stamp = Date.now();
  const user = await prisma.user.create({
    data: { email: `${EMAIL_PREFIX}${stamp}@hubsell.test`, passwordHash: "x", fullName: `TEST scale ${stamp}`, role: "ADMIN" },
  });
  const channel = await prisma.channel.create({
    data: { userId: user.id, channelName: platform, shopName: `TEST-scale-${stamp}`, status: "DISCONNECTED" },
  });
  const pre = `T${stamp}`;
  const t0 = Date.now();
  await prisma.$transaction(
    async (tx) => {
      // 5% đơn hủy; ngày tạo rải đều `spreadDays` ngày gần nhất.
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "Order" ("id", "channelId", "orderCode", "customerName", "createdAt", "deliveredAt", "shippingStatus", "itemCount")
        SELECT ${pre} || '-o' || g, ${channel.id}, ${pre} || '-' || g, 'Khach test',
               t.at, t.at + INTERVAL '2 days',
               (CASE WHEN g % 20 = 0 THEN 'CANCELLED' ELSE 'DELIVERED' END)::"ShippingStatus", 1
        FROM generate_series(1, ${orders}::int) g
        CROSS JOIN LATERAL (SELECT (now() AT TIME ZONE 'UTC') - (random() * ${spreadDays}::int * INTERVAL '1 day') - (g * INTERVAL '0 second') AS at) t
      `);
      // Dòng 1 cho mọi đơn, dòng 2 cho 30% đơn, dòng 3 cho 5% đơn; SKU lệch về nhóm bán chạy; 3% dòng chưa có giá vốn.
      // Giá vốn = 20% giá bán ở MỌI dòng: lợi nhuận của đơn đủ giá vốn nhờ vậy tỷ lệ thuận với giá trị dòng, nên số ghi ở
      // sổ dòng hàng bên dưới đúng bằng phần sổ thật sẽ phân bổ — hai đường cộng quảng cáo so được với nhau trên gian thử.
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "OrderItem" ("id", "orderId", "channelSku", "productName", "quantity", "price", "costPriceAtSale")
        SELECT ${pre} || '-i' || g || '-' || k, ${pre} || '-o' || g,
               ${pre} || '-S' || (1 + floor(power(random(), 2) * ${products * VARIANTS}::int))::int,
               'Dong hang test', 1 + floor(random() * 3)::int, p.price,
               CASE WHEN random() < 0.03 THEN 0 ELSE p.price * 0.2 END
        FROM generate_series(1, ${orders}::int) g
        CROSS JOIN generate_series(1, 3) k
        CROSS JOIN LATERAL (SELECT (20 + floor(random() * 480)::int) * 1000 + (g + k) * 0 AS price) p
        WHERE k = 1 OR (k = 2 AND g % 10 < 3) OR (k = 3 AND g % 20 = 1)
      `);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "order_line_ledger" (
          "orderItemId", "createdDate", "orderId", "channelId", "ownerId", "channelName", "channelSku", "productName",
          "createdAt", "shippingStatus", "returnStatus", "isSettled", "countsAsRevenue", "missingCostPrice",
          "quantity", "price", "costPriceAtSale", "lineGross", "lineCost", "share", "revenueGross", "actualRevenue", "profit", "feeGmvMax", "formulaVersion"
        )
        SELECT i."id", (o."createdAt" + INTERVAL '7 hours')::date, o."id", o."channelId", ${user.id}, ${platform}::"ChannelName", i."channelSku", i."productName",
               o."createdAt", o."shippingStatus", 'NONE'::"ReturnStatus", ${settledSql}, o."shippingStatus" <> 'CANCELLED',
               bool_or(i."costPriceAtSale" <= 0) OVER (PARTITION BY o."id"),
               i."quantity", i."price", i."costPriceAtSale", i."quantity" * i."price", i."quantity" * i."costPriceAtSale",
               round(i."quantity" * i."price" / sum(i."quantity" * i."price") OVER (PARTITION BY o."id"), 10),
               i."quantity" * i."price", round(i."quantity" * i."price" * 0.97, 2),
               round(i."quantity" * i."price" * 0.85, 2) - i."quantity" * i."costPriceAtSale",
               CASE WHEN ${settledSql} THEN round(i."quantity" * i."price" * ${gmvMaxRate}::numeric, 2) ELSE 0 END, ${LEDGER_FORMULA_VERSION}::int
        FROM "OrderItem" i JOIN "Order" o ON o."id" = i."orderId"
        WHERE o."channelId" = ${channel.id}
      `);
      if (tiktok) {
        // Bản kê TikTok. Trigger của bảng bản kê đánh dấu sổ đơn bẩn cho TỪNG dòng — vô ích ở đây (câu UPDATE bên dưới ghi
        // đè cả sổ đơn) và tốn vài phút với nửa triệu bản kê → tắt trigger đó trong giao dịch này rồi bật lại; giao dịch
        // hỏng thì Postgres tự trả trigger về trạng thái bật.
        await tx.$executeRawUnsafe(`ALTER TABLE "tiktok_order_settlements" DISABLE TRIGGER "order_ledger_on_tiktok_settlement"`);
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "tiktok_order_settlements" ("id", "orderId", "estimated", "feeGmvMax", "updatedAt")
          SELECT o."id" || '-st', o."id", NOT ${settledSql}, round(sum(i."quantity" * i."price") * ${gmvMaxRate}::numeric, 2), now()
          FROM "Order" o JOIN "OrderItem" i ON i."orderId" = o."id"
          WHERE o."channelId" = ${channel.id} AND o."shippingStatus" <> 'CANCELLED'
            AND o."createdAt" < (now() AT TIME ZONE 'UTC') - INTERVAL '7 days'
          GROUP BY o."id"
        `);
        await tx.$executeRawUnsafe(`ALTER TABLE "tiktok_order_settlements" ENABLE TRIGGER "order_ledger_on_tiktok_settlement"`);
      }
      // Sổ đơn: trigger đã tạo dòng nháp bẩn khi ghi đơn → điền số giả lập + đánh dấu đã tính.
      await tx.$executeRaw(Prisma.sql`
        UPDATE "order_ledger" l SET
          "formulaVersion" = ${LEDGER_FORMULA_VERSION}::int, "dirtyAt" = NULL, "dirtyReason" = NULL, "computedAt" = now(),
          "deliveredAt" = l."createdAt" + INTERVAL '2 days', "deliveredDate" = (l."createdAt" + INTERVAL '2 days 7 hours')::date,
          "settledAt" = l."createdAt" + INTERVAL '5 days', "settledDate" = (l."createdAt" + INTERVAL '5 days 7 hours')::date,
          "isSettled" = s.settled, "feeGmvMax" = CASE WHEN s.settled THEN round(s.g * ${gmvMaxRate}::numeric, 2) ELSE 0 END,
          "countsAsRevenue" = (l."shippingStatus" <> 'CANCELLED'), "isLoss" = (s.g < 60000),
          "missingCostPrice" = s.missing, "itemCount" = s.n, "totalQuantity" = s.q,
          "revenueGross" = s.g, "actualRevenue" = round(s.g * 0.97, 2), "platformRevenue" = round(s.g * 0.85, 2),
          "platformDeduction" = round(s.g * 0.15, 2), "netRevenue" = round(s.g * 0.85, 2), "actualPayout" = round(s.g * 0.85, 2),
          "costSnapshot" = s.c, "profit" = round(s.g * 0.85, 2) - s.c, "profitAfterTax" = round(s.g * 0.835, 2) - s.c,
          "platformTax" = round(s.g * 0.015, 2), "feeService" = round(s.g * 0.06, 2), "feeFixedPayment" = round(s.g * 0.09, 2)
        FROM (
          SELECT i."orderId", sum(i."quantity" * i."price") AS g, sum(i."quantity" * i."costPriceAtSale") AS c,
                 count(*)::int AS n, sum(i."quantity")::int AS q, bool_or(i."costPriceAtSale" <= 0) AS missing,
                 bool_and(${settledSql}) AS settled
          FROM "OrderItem" i JOIN "Order" o ON o."id" = i."orderId"
          WHERE o."channelId" = ${channel.id}
          GROUP BY i."orderId"
        ) s
        WHERE l."orderId" = s."orderId" AND l."channelId" = ${channel.id}
      `);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "ChannelProduct" ("id", "channelId", "channelSku", "productName", "externalId")
        SELECT ${pre} || '-cp' || s, ${channel.id}, ${pre} || '-S' || s, 'SP san test',
               (1 + (s - 1) / ${VARIANTS}::int)::text || '-' || s
        FROM generate_series(1, ${products * VARIANTS}::int) s
      `);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "AdsCampaign" ("id", "channelId", "campaignId", "status", "itemIds", "lastSyncedAt")
        SELECT ${pre} || '-c' || c, ${channel.id}, ${pre} || '-' || c, 'ongoing',
               (SELECT string_agg((1 + ((c * 37 + j * 101) % ${products}::int))::text, ',') FROM generate_series(1, ${ITEMS_PER_CAMPAIGN}::int) j),
               now()
        FROM generate_series(1, ${campaigns}::int) c
      `);
      if (tiktok) {
        // Số quảng cáo theo ngày của từng chiến dịch, đủ cửa sổ — để mỗi chiến dịch có khoảng ngày tự kiểm mẫu số.
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "AdsCampaignDailyPerf" ("id", "adsCampaignId", "date", "expense", "broadGmv", "updatedAt")
          SELECT ${pre} || '-c' || c || '-d' || d, ${pre} || '-c' || c, ((now() AT TIME ZONE 'UTC') + INTERVAL '7 hours')::date - d,
                 100000, 1000000, now()
          FROM generate_series(1, ${campaigns}::int) c
          CROSS JOIN generate_series(0, ${spreadDays}::int) d
        `);
      }
    },
    { timeout: 1_800_000, maxWait: 30_000 }
  );
  await refreshStatistics();
  console.log(`Dựng xong trong ${Math.round((Date.now() - t0) / 1000)} giây.`);
  await status();
}

async function status(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: EMAIL_PREFIX } },
    select: { id: true, email: true, channels: { select: { id: true } } },
  });
  if (users.length === 0) {
    console.log("Không có gian thử nào.");
    return;
  }
  for (const u of users) {
    for (const ch of u.channels) {
      const c = await prisma.$queryRaw<Record<string, number>[]>(Prisma.sql`
        SELECT (SELECT count(*)::int FROM "Order" WHERE "channelId" = ${ch.id}) AS orders,
               (SELECT count(*)::int FROM "order_ledger" WHERE "channelId" = ${ch.id}) AS ledger,
               (SELECT count(*)::int FROM "order_line_ledger" WHERE "channelId" = ${ch.id}) AS lines
      `);
      console.log(`${u.email}: userId=${u.id} channelId=${ch.id} — ${c[0].orders} đơn, ${c[0].ledger} dòng sổ đơn, ${c[0].lines} dòng sổ hàng`);
    }
    if (u.channels.length === 0) console.log(`${u.email}: userId=${u.id} (không còn gian)`);
  }
}

/** Xóa mọi gian thử bằng đúng đường xóa gian của app (theo lô), rồi xóa chủ shop thử. */
async function cleanup(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: EMAIL_PREFIX } },
    select: { id: true, email: true, channels: { select: { id: true } } },
  });
  for (const u of users) {
    const t0 = Date.now();
    let deletedOrders = 0;
    for (const ch of u.channels) {
      await prisma.channel.updateMany({ where: { id: ch.id, status: "ACTIVE" }, data: { status: "DISCONNECTED" } });
      deletedOrders += (await startChannelDelete(ch.id)).deletedOrders;
    }
    await prisma.user.delete({ where: { id: u.id } });
    console.log(`Đã xóa ${u.email}: ${deletedOrders} đơn trong ${Math.round((Date.now() - t0) / 1000)} giây.`);
  }
  if (users.length === 0) console.log("Không có gian thử nào.");
  else await refreshStatistics();
}

/** Dọn dòng chết + cập nhật thống kê để Postgres lập kế hoạch đúng sau khi thêm / xóa hàng trăm nghìn dòng. */
async function refreshStatistics(): Promise<void> {
  const tables = [
    '"Order"', '"OrderItem"', '"order_ledger"', '"order_line_ledger"', '"ChannelProduct"',
    '"AdsCampaign"', '"AdsCampaignDailyPerf"', '"tiktok_order_settlements"',
  ];
  for (const table of tables) {
    await prisma.$executeRawUnsafe(`VACUUM (ANALYZE) ${table}`);
  }
}

const COMMANDS: Record<string, () => Promise<void>> = { build, status, cleanup };

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? "status";
  const run = COMMANDS[cmd];
  if (!run) throw new Error(`Lệnh lạ: ${cmd} (build | status | cleanup)`);
  assertLocalDatabase();
  await run();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
