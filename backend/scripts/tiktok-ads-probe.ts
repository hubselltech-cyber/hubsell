// ============================================================
// PROBE T1 — TIKTOK MARKETING API (GMV Max) với tài khoản quảng cáo nhà.
// Trả lời 3 câu TRƯỚC KHI thiết kế bảng lưu ủy quyền:
//   1. /gmv_max/store/list/ có trả gian nhà khi gian CHƯA nằm trong Business Center?
//   2. store_id của Marketing API có trùng Channel.externalShopId (TikTok Shop API)?
//   3. Report 3 tầng campaign → sản phẩm → video có đủ số cho campaign tạo từ
//      Seller Center không (docs nói có — kiểm bằng số thật).
// Chỉ ĐỌC, không sửa gì trên tài khoản quảng cáo. Token dài hạn cất ở
// scripts/out/ (đã gitignore) — KHÔNG in ra màn hình, KHÔNG commit.
//
// Chạy (cd backend):
//   npx tsx scripts/tiktok-ads-probe.ts auth-url
//   npx tsx scripts/tiktok-ads-probe.ts exchange "<auth_code hoặc cả URL callback>"
//   npx tsx scripts/tiktok-ads-probe.ts run [số_ngày=7]
// ============================================================

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/prisma";
import {
  buildTiktokAdsAuthorizeUrl,
  exchangeTiktokAdsAuthCode,
  getGmvMaxReport,
  getGmvMaxStores,
  getTiktokAdsAdvertisers,
  type GmvMaxReportRow,
} from "../src/integrations/tiktok-ads";

const OUT_DIR = path.join(__dirname, "out");
const TOKEN_FILE = path.join(OUT_DIR, "tiktok-ads-token.json");

const CAMPAIGN_METRICS = [
  "campaign_id", "campaign_name", "operation_status", "bid_type", "roas_bid",
  "target_roi_budget", "cost", "net_cost", "orders", "cost_per_order", "gross_revenue", "roi",
];
const PRODUCT_METRICS = [
  "product_name", "item_group_id", "product_status", "cost", "orders",
  "cost_per_order", "gross_revenue", "roi",
];
const VIDEO_METRICS = [
  "title", "item_id", "tt_account_name", "shop_content_type", "creative_delivery_status",
  "cost", "orders", "cost_per_order", "gross_revenue", "roi",
  "product_impressions", "product_clicks", "ad_click_rate", "ad_conversion_rate",
];

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const byCost = (a: GmvMaxReportRow, b: GmvMaxReportRow) =>
  Number(b.metrics.cost ?? 0) - Number(a.metrics.cost ?? 0);

/** Gọi một bước, lỗi thì ghi lại rồi đi tiếp — probe cần thấy HẾT chỗ nào hỏng. */
async function step<T>(log: Record<string, unknown>, name: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    const r = await fn();
    log[name] = r;
    return r;
  } catch (err) {
    log[name] = { error: (err as Error).message };
    console.log(`  ❌ ${name}: ${(err as Error).message}`);
    return null;
  }
}

async function cmdExchange(raw: string) {
  // Nhận cả URL callback dán nguyên từ thanh địa chỉ.
  let authCode = raw.trim();
  if (/^https?:\/\//.test(authCode)) {
    const u = new URL(authCode);
    authCode = u.searchParams.get("auth_code") ?? u.searchParams.get("code") ?? "";
  }
  if (!authCode) throw new Error("Không tìm thấy auth_code");
  const token = await exchangeTiktokAdsAuthCode(authCode);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({ ...token, savedAt: new Date().toISOString() }, null, 2));
  console.log(`✅ Đã đổi token. advertiser_ids: ${token.advertiser_ids.join(", ")} · scope: ${JSON.stringify(token.scope)}`);
  console.log(`   Token cất ở ${TOKEN_FILE} (gitignore). Chạy tiếp: npx tsx scripts/tiktok-ads-probe.ts run`);
}

async function cmdRun(days: number) {
  if (!fs.existsSync(TOKEN_FILE)) throw new Error("Chưa có token — chạy lệnh exchange trước");
  const { access_token: accessToken } = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8")) as {
    access_token: string;
  };
  const end = new Date();
  const start = new Date(end.getTime() - (days - 1) * 86_400_000);
  const range = { startDate: ymd(start), endDate: ymd(end) };
  const log: Record<string, unknown> = { range };

  // Gian TikTok đang nối trong DB (local) — đối chiếu store_id. DB không có cũng không sao.
  const channels = await prisma.channel
    .findMany({
      where: { channelName: "TIKTOK", externalShopId: { not: null } },
      select: { shopName: true, externalShopId: true },
    })
    .catch(() => [] as { shopName: string; externalShopId: string | null }[]);
  const known = new Map(channels.map((c) => [c.externalShopId ?? "", c.shopName] as const));
  console.log(`Gian TikTok trong DB: ${channels.map((c) => `${c.shopName}=${c.externalShopId}`).join(" · ") || "(không có)"}`);

  const advertisers = (await step(log, "advertisers", () => getTiktokAdsAdvertisers(accessToken))) ?? [];
  for (const adv of advertisers) {
    console.log(`\n■ TKQC ${adv.advertiser_name} (${adv.advertiser_id})`);
    const advLog: Record<string, unknown> = {};
    log[`advertiser_${adv.advertiser_id}`] = advLog;

    const stores = await step(advLog, "stores", () => getGmvMaxStores(accessToken, adv.advertiser_id));
    const storeList = ((stores?.store_list ?? stores?.list ?? []) as Record<string, unknown>[]) || [];
    if (storeList.length === 0) console.log("  (store/list không trả gian nào)");

    for (const s of storeList) {
      const storeId = String(s.store_id ?? "");
      const match = known.get(storeId);
      console.log(
        `  ▸ store_id ${storeId} ${s.store_name ?? ""} · GMV Max khả dụng: ${s.is_gmv_max_available} · ` +
          (match ? `TRÙNG gian "${match}" trong DB ✅` : "không trùng externalShopId nào trong DB")
      );
      const sLog: Record<string, unknown> = {};
      advLog[`store_${storeId}`] = sLog;

      const overview = await step(sLog, "overview_by_day", () =>
        getGmvMaxReport(accessToken, {
          advertiserId: adv.advertiser_id, storeId, ...range,
          dimensions: ["advertiser_id", "stat_time_day"],
          metrics: ["cost", "net_cost", "orders", "cost_per_order", "gross_revenue", "roi"],
        })
      );
      for (const r of overview?.list ?? []) {
        const m = r.metrics;
        console.log(`    ${r.dimensions.stat_time_day?.slice(0, 10)}  chi ${m.cost}  đơn ${m.orders}  GMV ${m.gross_revenue}  ROI ${m.roi}`);
      }

      const campaigns = await step(sLog, "campaigns", () =>
        getGmvMaxReport(accessToken, {
          advertiserId: adv.advertiser_id, storeId, ...range,
          dimensions: ["campaign_id"], metrics: CAMPAIGN_METRICS,
          filtering: { gmv_max_promotion_types: ["PRODUCT"] },
        })
      );
      const camps = [...(campaigns?.list ?? [])].sort(byCost);
      console.log(`    Campaign Product GMV Max: ${camps.length}`);
      for (const c of camps.slice(0, 10)) {
        const m = c.metrics;
        console.log(`      ${m.campaign_id} "${m.campaign_name}" ${m.operation_status} · ROI mục tiêu ${m.roas_bid} · chi ${m.cost} · đơn ${m.orders} · ROI ${m.roi}`);
      }
      const top = camps[0];
      if (!top) continue;
      const campaignId = top.dimensions.campaign_id;

      const products = await step(sLog, "products_top_campaign", () =>
        getGmvMaxReport(accessToken, {
          advertiserId: adv.advertiser_id, storeId, ...range,
          // Metric thuộc tính (product_name...) chỉ đi được khi có MỘT chiều ID (lỗi 40002 nếu 2).
          dimensions: ["item_group_id"], metrics: PRODUCT_METRICS,
          filtering: { campaign_ids: [campaignId] },
        })
      );
      const prods = [...(products?.list ?? [])].sort(byCost);
      console.log(`    Sản phẩm trong campaign ${campaignId}: ${prods.length}`);
      const spuIds = prods.slice(0, 5).map((p) => p.dimensions.item_group_id);
      if (spuIds.length === 0) continue;

      for (const p of prods.slice(0, 5)) {
        const m = p.metrics;
        console.log(`      SPU ${p.dimensions.item_group_id} "${(m.product_name ?? "").slice(0, 40)}" chi ${m.cost} · đơn ${m.orders} · ROI ${m.roi}`);
      }
      // Thử A: 1 campaign + 1 SPU, xin kèm thuộc tính (title, tài khoản) — xem sàn có cho không.
      const single = await step(sLog, "videos_single_spu_with_attrs", () =>
        getGmvMaxReport(accessToken, {
          advertiserId: adv.advertiser_id, storeId, ...range,
          dimensions: ["campaign_id", "item_group_id", "item_id"], metrics: VIDEO_METRICS,
          filtering: { campaign_ids: [campaignId], item_group_ids: [spuIds[0]] },
        })
      );
      console.log(`    Thử A (1 SPU + thuộc tính): ${single ? `${single.list.length} dòng, mẫu: ${JSON.stringify(single.list[0]?.metrics ?? {}).slice(0, 300)}` : "hỏng"}`);
      // Thử B: nhiều SPU một lượt, chỉ số đo (không thuộc tính).
      const videos = await step(sLog, "videos_top_products", () =>
        getGmvMaxReport(accessToken, {
          advertiserId: adv.advertiser_id, storeId, ...range,
          dimensions: ["campaign_id", "item_group_id", "item_id"],
          metrics: VIDEO_METRICS.filter((x) => !["title", "item_id", "tt_account_name", "shop_content_type"].includes(x)),
          filtering: { campaign_ids: [campaignId], item_group_ids: spuIds },
        })
      );
      const vids = [...(videos?.list ?? [])].sort(byCost);
      console.log(`    Video của ${spuIds.length} SP tốn nhất: ${vids.length} dòng (trang 1/${videos?.page_info?.total_page ?? "?"})`);
      for (const v of vids.slice(0, 10)) {
        const m = v.metrics;
        console.log(`      video ${v.dimensions.item_id} [${m.creative_delivery_status}] chi ${m.cost} · đơn ${m.orders} · GMV ${m.gross_revenue} · ROI ${m.roi}`);
      }
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `tiktok-ads-probe-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(log, null, 2));
  console.log(`\nToàn bộ phản hồi thô: ${file}`);
}

(async () => {
  const [cmd, arg] = process.argv.slice(2);
  try {
    if (cmd === "auth-url") {
      console.log(buildTiktokAdsAuthorizeUrl("hubsell_t1_probe"));
    } else if (cmd === "exchange" && arg) {
      await cmdExchange(arg);
    } else if (cmd === "run") {
      await cmdRun(Math.min(30, Math.max(1, Number(arg) || 7)));
    } else {
      console.log("Dùng: auth-url | exchange <auth_code|url> | run [số_ngày]");
    }
  } catch (err) {
    console.error(`❌ ${(err as Error).message}`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
