// ============================================================
// SOI LỆCH QUẢNG CÁO TIKTOK CỦA MỘT GIAN SO VỚI SELLER CENTER (chỉ đọc, 20/10/2026)
//
// Bối cảnh: khách 69Minh Đương (nối gian 19/10, KHÔNG chạy LIVE) — Seller Center tab
// "Chiến dịch GMV Max" 01–20/10 26,9tr, Hubsell 9,7tr và chỉ có số từ 09/10 dù lần nối
// đầu kéo lùi 30 ngày. Hubsell lấy số từ báo cáo TẦNG CHIẾN DỊCH (campaign_id ×
// stat_time_day, lọc PRODUCT). Script này hỏi sàn cùng khoảng ngày ở NHIỀU tầng rồi
// in một bảng theo ngày để thấy hụt ở đâu:
//   · API tổng tài khoản (advertiser_id × ngày, KHÔNG lọc loại)  — mọi tiền sàn ghi cho gian
//   · API tổng tài khoản lọc PRODUCT / LIVE
//   · API tầng chiến dịch PRODUCT (đúng câu lệnh sync.ts dùng)
//   · DB: AdsCampaignDailyPerf (tổng chiến dịch) và AdSpend (dòng tiền)
// Kèm: thông tin link (ngày nối, tài khoản quảng cáo), danh sách chiến dịch còn tồn tại
// (Product + LIVE, kèm create_time) và Σ feeGmvMax trong sổ cái (luật chống trừ hai lần).
//
// Đọc bằng token đang lưu của gian — KHÔNG in token. Không ghi gì vào DB.
//
// Chạy (cd backend, DATABASE_URL + TIKTOK_ADS_* như prod):
//   npx tsx scripts/tiktok-ads-compare-seller-center.ts "<tên gian hoặc channelId>" [from=YYYY-MM-DD] [to=YYYY-MM-DD]
//   vd: npx tsx scripts/tiktok-ads-compare-seller-center.ts "Minh Đương" 2026-10-01 2026-10-20
// Khoảng ngày tối đa 30 (trần stat_time_day của sàn); mặc định 30 ngày tới hôm nay.
// ============================================================
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { vnDateKey } from "../src/lib/ads-dates";
import { getGmvMaxCampaigns, getGmvMaxReport, type GmvMaxReportRow } from "../src/integrations/tiktok-ads/client";
import { fetchGmvMaxCampaignDaily } from "../src/integrations/tiktok-ads/report";
import { getTiktokAdsScope } from "../src/integrations/tiktok-ads/sync";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const vnd = (n: number) => Math.round(n).toLocaleString("vi-VN");
const pad = (s: string, w: number) => s.padStart(w);

interface DayTotals {
  cost: number;
  orders: number;
  gmv: number;
}
type ByDay = Map<string, DayTotals>;

function addDay(m: ByDay, day: string, d: DayTotals) {
  const cur = m.get(day) ?? { cost: 0, orders: 0, gmv: 0 };
  m.set(day, { cost: cur.cost + d.cost, orders: cur.orders + d.orders, gmv: cur.gmv + d.gmv });
}

function totalsOf(rows: GmvMaxReportRow[]): ByDay {
  const m: ByDay = new Map();
  for (const r of rows) {
    const day = (r.dimensions.stat_time_day ?? "").slice(0, 10);
    if (!day) continue;
    addDay(m, day, { cost: num(r.metrics.cost), orders: num(r.metrics.orders), gmv: num(r.metrics.gross_revenue) });
  }
  return m;
}

async function tryStep<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    console.log(`  ❌ ${name}: ${(err as Error).message}`);
    return null;
  }
}

async function main() {
  const [needle, fromArg, toArg] = process.argv.slice(2);
  if (!needle) throw new Error('Thiếu tham số: "<tên gian hoặc channelId>"');
  const to = toArg && DATE_KEY.test(toArg) ? toArg : vnDateKey(0);
  const from = fromArg && DATE_KEY.test(fromArg) ? fromArg : vnDateKey(29);
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  if (days < 1 || days > 30) throw new Error(`Khoảng ngày ${from} → ${to} phải từ 1 tới 30 ngày`);

  const channel = await prisma.channel.findFirst({
    where: { channelName: "TIKTOK", OR: [{ id: needle }, { shopName: { contains: needle, mode: "insensitive" } }] },
    select: {
      id: true,
      shopName: true,
      externalShopId: true,
      createdAt: true,
      lastAdsSyncAt: true,
      adsBackfillPending: true,
      tiktokAdsStoreLink: {
        select: { createdAt: true, status: true, advertiserId: true, advertiserName: true, storeId: true, lastSyncedAt: true, lastSyncError: true },
      },
    },
  });
  if (!channel) {
    // Nói rõ đang nối DB nào (chỉ host, không in mật khẩu) + gian TikTok có trong đó — chạy nhầm .env dev là thấy ngay.
    let host = "?";
    try {
      host = new URL(process.env.DATABASE_URL ?? "").host;
    } catch {
      /* DATABASE_URL thiếu / sai dạng */
    }
    const shops = await prisma.channel.findMany({
      where: { channelName: "TIKTOK" },
      select: { id: true, shopName: true, createdAt: true, tiktokAdsStoreLink: { select: { id: true } } },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    console.log(`DB đang nối: ${host} · gian TikTok trong DB (20 mới nhất): ${shops.length}`);
    for (const x of shops) console.log(`  ${x.id}  "${x.shopName}"  tạo ${x.createdAt.toISOString().slice(0, 10)}${x.tiktokAdsStoreLink ? " · đã nối ads" : ""}`);
    throw new Error(`Không thấy gian TikTok khớp "${needle}" — kiểm DATABASE_URL trong backend/.env có trỏ prod không`);
  }
  const link = channel.tiktokAdsStoreLink;
  console.log(`Gian "${channel.shopName}" (${channel.id}) · shop ${channel.externalShopId} · tạo ${channel.createdAt.toISOString()}`);
  console.log(`  lastAdsSyncAt ${channel.lastAdsSyncAt?.toISOString() ?? "—"} · adsBackfillPending ${channel.adsBackfillPending}`);
  if (!link) throw new Error("Gian chưa nối tài khoản quảng cáo");
  console.log(
    `  Link ads: nối ${link.createdAt.toISOString()} · ${link.status} · tài khoản "${link.advertiserName}" (${link.advertiserId}) · store ${link.storeId}` +
      ` · lastSyncedAt ${link.lastSyncedAt?.toISOString() ?? "—"}${link.lastSyncError ? ` · lỗi: ${link.lastSyncError}` : ""}`
  );
  const scope = await getTiktokAdsScope(channel.id);
  if (!scope) throw new Error("Link không còn dùng được (token chết / NO_ACCESS)");
  const s = { accessToken: scope.accessToken, advertiserId: scope.advertiserId, storeId: scope.storeId, startDate: from, endDate: to };
  console.log(`Khoảng ${from} → ${to} (${days} ngày)\n`);

  // ---- API tổng tài khoản (3 biến thể lọc)
  const accountQuery = (filtering?: Record<string, unknown>) =>
    getGmvMaxReport(s.accessToken, {
      advertiserId: s.advertiserId,
      storeId: s.storeId,
      startDate: from,
      endDate: to,
      dimensions: ["advertiser_id", "stat_time_day"],
      metrics: ["cost", "orders", "gross_revenue"],
      filtering,
      pageSize: 1000,
    }).then((r) => r.list);
  const apiAll = totalsOf((await tryStep("API tổng tài khoản (không lọc)", () => accountQuery())) ?? []);
  const apiProduct = totalsOf((await tryStep("API tổng tài khoản PRODUCT", () => accountQuery({ gmv_max_promotion_types: ["PRODUCT"] }))) ?? []);
  const apiLive = totalsOf((await tryStep("API tổng tài khoản LIVE", () => accountQuery({ gmv_max_promotion_types: ["LIVE"] }))) ?? []);

  // ---- API tầng chiến dịch (đúng câu sync.ts)
  const campRows = (await tryStep("API tầng chiến dịch PRODUCT", () => fetchGmvMaxCampaignDaily(s, "PRODUCT"))) ?? [];
  const apiCamp: ByDay = new Map();
  const campSeen = new Map<string, { name: string; status: string; cost: number; first: string; last: string }>();
  for (const r of campRows) {
    if (!r.date) continue;
    addDay(apiCamp, r.date, { cost: r.cost, orders: r.orders, gmv: r.gmv });
    const c = campSeen.get(r.campaignId) ?? { name: r.name, status: r.operationStatus, cost: 0, first: r.date, last: r.date };
    c.cost += r.cost;
    if (r.date < c.first) c.first = r.date;
    if (r.date > c.last) c.last = r.date;
    campSeen.set(r.campaignId, c);
  }

  // ---- DB
  const perf = await prisma.adsCampaignDailyPerf.findMany({
    where: { adsCampaign: { channelId: channel.id }, date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } },
    select: { date: true, expense: true, broadOrder: true, broadGmv: true },
  });
  const dbPerf: ByDay = new Map();
  for (const p of perf) addDay(dbPerf, p.date.toISOString().slice(0, 10), { cost: Number(p.expense), orders: p.broadOrder, gmv: Number(p.broadGmv) });
  const spend = await prisma.adSpend.findMany({
    where: { channelId: channel.id, date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } },
    select: { date: true, amount: true },
  });
  const dbSpend = new Map(spend.map((x) => [x.date.toISOString().slice(0, 10), Number(x.amount)]));

  // ---- Bảng theo ngày
  const allDays = new Set<string>([...apiAll.keys(), ...apiProduct.keys(), ...apiLive.keys(), ...apiCamp.keys(), ...dbPerf.keys(), ...dbSpend.keys()]);
  const head = `${pad("Ngày", 10)} | ${pad("API tất cả", 14)} | ${pad("API PRODUCT", 14)} | ${pad("API LIVE", 12)} | ${pad("API c.dịch", 14)} | ${pad("DB c.dịch", 14)} | ${pad("DB AdSpend", 14)} | ${pad("Đơn API", 8)} | ${pad("Đơn DB", 7)}`;
  console.log(head);
  console.log("-".repeat(head.length));
  const sum = { all: 0, product: 0, live: 0, camp: 0, dbPerf: 0, dbSpend: 0, ordersApi: 0, ordersDb: 0 };
  for (const day of [...allDays].sort()) {
    const a = apiAll.get(day)?.cost ?? 0;
    const p = apiProduct.get(day)?.cost ?? 0;
    const l = apiLive.get(day)?.cost ?? 0;
    const c = apiCamp.get(day)?.cost ?? 0;
    const dp = dbPerf.get(day)?.cost ?? 0;
    const ds = dbSpend.get(day) ?? 0;
    const oa = apiAll.get(day)?.orders ?? 0;
    const od = dbPerf.get(day)?.orders ?? 0;
    sum.all += a; sum.product += p; sum.live += l; sum.camp += c; sum.dbPerf += dp; sum.dbSpend += ds; sum.ordersApi += oa; sum.ordersDb += od;
    console.log(`${pad(day, 10)} | ${pad(vnd(a), 14)} | ${pad(vnd(p), 14)} | ${pad(vnd(l), 12)} | ${pad(vnd(c), 14)} | ${pad(vnd(dp), 14)} | ${pad(vnd(ds), 14)} | ${pad(String(oa), 8)} | ${pad(String(od), 7)}`);
  }
  console.log("-".repeat(head.length));
  console.log(`${pad("TỔNG", 10)} | ${pad(vnd(sum.all), 14)} | ${pad(vnd(sum.product), 14)} | ${pad(vnd(sum.live), 12)} | ${pad(vnd(sum.camp), 14)} | ${pad(vnd(sum.dbPerf), 14)} | ${pad(vnd(sum.dbSpend), 14)} | ${pad(String(sum.ordersApi), 8)} | ${pad(String(sum.ordersDb), 7)}`);
  console.log(`\nCách đọc: Seller Center ≈ "API tất cả" mà "API c.dịch" nhỏ hơn → tầng chiến dịch thiếu (chiến dịch đã xóa / loại khác).`);
  console.log(`"API tất cả" cũng nhỏ hơn Seller Center → tiền đó không thuộc tài khoản quảng cáo đang nối (tài khoản khác chạy trước đó).`);
  console.log(`"DB c.dịch" < "API c.dịch" → sync chưa ghi đủ (chờ lượt lịch sử / backfill).`);

  // ---- Chiến dịch trong báo cáo + danh sách còn tồn tại
  console.log(`\nChiến dịch PRODUCT có chi tiêu trong khoảng (theo báo cáo): ${campSeen.size}`);
  for (const [id, c] of [...campSeen].sort((x, y) => y[1].cost - x[1].cost)) {
    console.log(`  ${id} "${c.name}" ${c.status} · ${vnd(c.cost)}₫ · ${c.first} → ${c.last}`);
  }
  for (const type of ["PRODUCT_GMV_MAX", "LIVE_GMV_MAX"] as const) {
    const list = await tryStep(`Danh sách ${type}`, () => getGmvMaxCampaigns(s.accessToken, s.advertiserId, s.storeId, type));
    if (!list) continue;
    console.log(`Danh sách ${type} còn tồn tại: ${list.length}`);
    for (const l of list) {
      const extra = l as unknown as Record<string, unknown>;
      console.log(`  ${l.campaign_id} "${l.campaign_name ?? ""}" ${l.operation_status ?? ""} ${l.secondary_status ?? ""} · tạo ${String(extra.create_time ?? "?")}${campSeen.has(String(l.campaign_id)) ? "" : " · KHÔNG có trong báo cáo khoảng này"}`);
    }
  }

  // ---- Sổ cái: phí GMV Max trong đơn (luật chống trừ hai lần của dòng tiền)
  const fee = await prisma.$queryRaw<{ n: unknown; v: unknown }[]>`
    SELECT count(*) AS n, COALESCE(sum("feeGmvMax"), 0) AS v FROM "order_ledger"
    WHERE "channelId" = ${channel.id} AND "feeGmvMax" <> 0 AND "createdDate" >= ${from}::date AND "createdDate" <= ${to}::date`;
  console.log(`\nSổ cái đơn trong khoảng: ${Number(fee[0]?.n ?? 0)} đơn có feeGmvMax ≠ 0, Σ = ${vnd(Number(fee[0]?.v ?? 0))}₫ (≠ 0 → dòng tiền chỉ cộng phần AdSpend vượt khoản này)`);
}

main()
  .catch((err) => {
    console.error("❌", (err as Error).message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
