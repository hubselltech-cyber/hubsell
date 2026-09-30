// ============================================================
// GIAN THỬ CỠ SHOP LỚN — dựng dữ liệu đo tải trên DATABASE DEV
// (docs/QUANG-CAO-GOM-TRONG-DATABASE.md mục 11.3, 11.8)
//
// Dựng một chủ shop TEST + một gian Shopee đã ngắt với N đơn rải trong 29 ngày:
// đơn, dòng hàng, sổ đơn và sổ dòng hàng (ghi thẳng số giả lập, không qua
// worker), sản phẩm sàn, chiến dịch quảng cáo. Dùng để đo câu đọc sổ cái, câu
// gom biên lãi quảng cáo và việc xóa gian ở quy mô mà dữ liệu dev không có.
//
//   npx tsx scripts/bench-large-shop.ts build [--orders 300000] [--products 2000] [--campaigns 100]
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
  const stamp = Date.now();
  const user = await prisma.user.create({
    data: { email: `${EMAIL_PREFIX}${stamp}@hubsell.test`, passwordHash: "x", fullName: `TEST scale ${stamp}`, role: "ADMIN" },
  });
  const channel = await prisma.channel.create({
    data: { userId: user.id, channelName: ChannelName.SHOPEE, shopName: `TEST-scale-${stamp}`, status: "DISCONNECTED" },
  });
  const pre = `T${stamp}`;
  const t0 = Date.now();
  await prisma.$transaction(
    async (tx) => {
      // 5% đơn hủy; ngày tạo rải đều 29 ngày gần nhất.
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "Order" ("id", "channelId", "orderCode", "customerName", "createdAt", "deliveredAt", "shippingStatus", "itemCount")
        SELECT ${pre} || '-o' || g, ${channel.id}, ${pre} || '-' || g, 'Khach test',
               t.at, t.at + INTERVAL '2 days',
               (CASE WHEN g % 20 = 0 THEN 'CANCELLED' ELSE 'DELIVERED' END)::"ShippingStatus", 1
        FROM generate_series(1, ${orders}::int) g
        CROSS JOIN LATERAL (SELECT (now() AT TIME ZONE 'UTC') - (random() * INTERVAL '29 days') - (g * INTERVAL '0 second') AS at) t
      `);
      // Dòng 1 cho mọi đơn, dòng 2 cho 30% đơn, dòng 3 cho 5% đơn; SKU lệch về nhóm bán chạy; 3% dòng chưa có giá vốn.
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "OrderItem" ("id", "orderId", "channelSku", "productName", "quantity", "price", "costPriceAtSale")
        SELECT ${pre} || '-i' || g || '-' || k, ${pre} || '-o' || g,
               ${pre} || '-S' || (1 + floor(power(random(), 2) * ${products * VARIANTS}::int))::int,
               'Dong hang test', 1 + floor(random() * 3)::int, (20 + floor(random() * 480)::int) * 1000,
               CASE WHEN random() < 0.03 THEN 0 ELSE 10000 END
        FROM generate_series(1, ${orders}::int) g
        CROSS JOIN generate_series(1, 3) k
        WHERE k = 1 OR (k = 2 AND g % 10 < 3) OR (k = 3 AND g % 20 = 1)
      `);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "order_line_ledger" (
          "orderItemId", "createdDate", "orderId", "channelId", "ownerId", "channelName", "channelSku", "productName",
          "createdAt", "shippingStatus", "returnStatus", "isSettled", "countsAsRevenue", "missingCostPrice",
          "quantity", "price", "costPriceAtSale", "lineGross", "lineCost", "share", "revenueGross", "actualRevenue", "profit", "formulaVersion"
        )
        SELECT i."id", (o."createdAt" + INTERVAL '7 hours')::date, o."id", o."channelId", ${user.id}, 'SHOPEE'::"ChannelName", i."channelSku", i."productName",
               o."createdAt", o."shippingStatus", 'NONE'::"ReturnStatus", true, o."shippingStatus" <> 'CANCELLED',
               bool_or(i."costPriceAtSale" <= 0) OVER (PARTITION BY o."id"),
               i."quantity", i."price", i."costPriceAtSale", i."quantity" * i."price", i."quantity" * i."costPriceAtSale", 0,
               i."quantity" * i."price", round(i."quantity" * i."price" * 0.97, 2), round(i."quantity" * i."price" * 0.18, 2), ${LEDGER_FORMULA_VERSION}::int
        FROM "OrderItem" i JOIN "Order" o ON o."id" = i."orderId"
        WHERE o."channelId" = ${channel.id}
      `);
      // Sổ đơn: trigger đã tạo dòng nháp bẩn khi ghi đơn → điền số giả lập + đánh dấu đã tính.
      await tx.$executeRaw(Prisma.sql`
        UPDATE "order_ledger" l SET
          "formulaVersion" = ${LEDGER_FORMULA_VERSION}::int, "dirtyAt" = NULL, "dirtyReason" = NULL, "computedAt" = now(),
          "deliveredAt" = l."createdAt" + INTERVAL '2 days', "deliveredDate" = (l."createdAt" + INTERVAL '2 days 7 hours')::date,
          "settledAt" = l."createdAt" + INTERVAL '5 days', "settledDate" = (l."createdAt" + INTERVAL '5 days 7 hours')::date,
          "isSettled" = true, "countsAsRevenue" = (l."shippingStatus" <> 'CANCELLED'), "isLoss" = (s.g < 60000),
          "missingCostPrice" = s.missing, "itemCount" = s.n, "totalQuantity" = s.q,
          "revenueGross" = s.g, "actualRevenue" = round(s.g * 0.97, 2), "platformRevenue" = round(s.g * 0.85, 2),
          "platformDeduction" = round(s.g * 0.15, 2), "netRevenue" = round(s.g * 0.85, 2), "actualPayout" = round(s.g * 0.85, 2),
          "costSnapshot" = s.c, "profit" = round(s.g * 0.85, 2) - s.c, "profitAfterTax" = round(s.g * 0.835, 2) - s.c,
          "platformTax" = round(s.g * 0.015, 2), "feeService" = round(s.g * 0.06, 2), "feeFixedPayment" = round(s.g * 0.09, 2)
        FROM (
          SELECT i."orderId", sum(i."quantity" * i."price") AS g, sum(i."quantity" * i."costPriceAtSale") AS c,
                 count(*)::int AS n, sum(i."quantity")::int AS q, bool_or(i."costPriceAtSale" <= 0) AS missing
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
  for (const table of ['"Order"', '"OrderItem"', '"order_ledger"', '"order_line_ledger"', '"ChannelProduct"', '"AdsCampaign"']) {
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
