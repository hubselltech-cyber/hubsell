// ============================================================
// PROBE QUYỀN CAMPAIGN — TikTok duyệt 19/09/2026 (docs/TIKTOK-ADS-XIN-QUYEN-CAMPAIGN.md mục 6).
// Trả lời: (1) token cấp TRƯỚC khi duyệt có tự có quyền mới không; (2) shape thật của 3 endpoint ĐỌC
// (/gmv_max/campaign/get/, /campaign/gmv_max/info/, /gmv_max/bid/recommend/) trước khi thiết kế.
// Chỉ ĐỌC (toàn GET), không sửa gì trên tài khoản quảng cáo. Dùng token ở scripts/out/ (gitignore) —
// KHÔNG in token ra màn hình.
//
// Chạy (cd backend):
//   npx tsx scripts/tiktok-ads-campaign-probe.ts <advertiser_id> <store_id> [campaign_id] [item_group_id]
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { TIKTOK_ADS_API_BASE } from "../src/integrations/tiktok-ads";

const OUT_DIR = path.join(__dirname, "out");
const TOKEN_FILE = path.join(OUT_DIR, "tiktok-ads-token.json");

type Params = Record<string, string | number | string[] | Record<string, unknown> | undefined>;

async function get(accessToken: string, apiPath: string, params: Params): Promise<unknown> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    qs.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  const res = await fetch(`${TIKTOK_ADS_API_BASE}${apiPath}?${qs}`, { headers: { "Access-Token": accessToken } });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { http: res.status, raw: text.slice(0, 500) };
  }
}

(async () => {
  const [advertiserId, storeId, campaignId, itemGroupId] = process.argv.slice(2);
  if (!advertiserId || !storeId) {
    console.log("Dùng: <advertiser_id> <store_id> [campaign_id] [item_group_id]");
    return;
  }
  const token = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8")) as { access_token: string; scope: number[]; savedAt: string };
  console.log(`Token cấp lúc ${token.savedAt} · scope ${JSON.stringify(token.scope)}`);
  const log: Record<string, unknown> = { tokenSavedAt: token.savedAt, tokenScope: token.scope };

  const calls: [string, string, Params][] = [
    ["campaign_get_product", "/gmv_max/campaign/get/", {
      advertiser_id: advertiserId,
      filtering: { gmv_max_promotion_types: ["PRODUCT_GMV_MAX"], store_ids: [storeId] },
      page: 1, page_size: 50,
    }],
    ["campaign_get_live", "/gmv_max/campaign/get/", {
      advertiser_id: advertiserId,
      filtering: { gmv_max_promotion_types: ["LIVE_GMV_MAX"], store_ids: [storeId] },
      page: 1, page_size: 50,
    }],
  ];
  if (campaignId) {
    calls.push(["campaign_info", "/campaign/gmv_max/info/", { advertiser_id: advertiserId, campaign_id: campaignId }]);
  }
  if (itemGroupId) {
    calls.push(["bid_recommend", "/gmv_max/bid/recommend/", {
      advertiser_id: advertiserId, store_id: storeId,
      shopping_ads_type: "PRODUCT", optimization_goal: "VALUE",
      item_group_ids: [itemGroupId],
    }]);
  }

  for (const [name, apiPath, params] of calls) {
    const body = (await get(token.access_token, apiPath, params)) as { code?: number; message?: string };
    log[name] = body;
    console.log(`\n■ ${name} ${apiPath} → code ${body.code} · ${body.message}`);
    console.log(JSON.stringify(body, null, 1).slice(0, 2500));
    await new Promise((r) => setTimeout(r, 500));
  }

  const file = path.join(OUT_DIR, `tiktok-ads-campaign-probe-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(log, null, 2));
  console.log(`\nPhản hồi thô: ${file}`);
})().catch((err) => {
  console.error(`❌ ${(err as Error).message}`);
  process.exitCode = 1;
});
