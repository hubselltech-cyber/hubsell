// ============================================================
// TRỢ LÝ QUẢNG CÁO SHOPEE — GMS = GMV MAX CẤP SHOP (đợt GMS, 24/09/2026)
//
// Vì sao phải làm: chi tiêu GMS KHÔNG nằm trong campaign sản phẩm (id list /
// setting_info / daily_performance chỉ có auto/manual) mà chỉ hiện trong tổng chi
// cấp shop (AdSpend) → seller thấy "tổng chi lớn hơn tổng campaign" mà không
// biết vì sao. Docs (đọc lại 24/09):
//   - check_create_gms_product_campaign_eligibility: reason "active_campaign" =
//     shop ĐANG có GMS — cách duy nhất biết qua API (không có endpoint đọc
//     cấu hình/trạng thái/ngân sách GMS).
//   - get_gms_campaign_performance / get_gms_item_performance: theo KHOẢNG ngày,
//     start ≠ end (KHÔNG có số theo ngày lẻ), ≤ 1 tháng, lùi ≤ 6 tháng;
//     campaign_id bỏ trống = GMS hiện có.
// Cách lưu (chốt từ docs): KHÔNG ép vào AdsCampaign/DailyPerf (không có số ngày
// → rule engine cửa sổ today/3d không áp được) — bảng riêng theo CỬA SỔ 7d / 30d
// ngày trọn (bỏ hôm nay, bài học 14/09), ghi đè ở lượt lịch sử ads (6h):
//   eligibility (1) → active: campaign 7d (1) + 30d (1) + items 7d (1–2) ≈ 4 call/6h.
// CHỈ ĐỌC: không có hành động tự động nào trên GMS (edit_gms_product_campaign
// có pause/change_budget/change_roas_target nhưng chưa bắn sống, chưa nối).
// Đánh giá lãi/lỗ: ROAS cửa sổ so với hòa vốn CẤP SHOP (GMS phủ mọi SP) và
// từng SP so với hòa vốn của chính SP (bảng hòa vốn SP) — nơi duy nhất tính
// được hòa vốn đúng rổ ads của GMV Max.
// ============================================================

import { ChannelName, type Channel, type Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { isApiBudgetError } from "../../services/api-budget";
import { requestAdsRefresh } from "../../services/sync-schedule";
import { resolveShopeeAdsAccess, type ShopeeAdsAccess } from "../hubsell-ads";
import {
  checkGmsEligibility,
  createGmsProductCampaignRaw,
  editGmsItemProductCampaignRaw,
  editGmsProductCampaignRaw,
  getGmsCampaignPerformance,
  getGmsItemPerformance,
  listGmsUserDeletedItems,
  type ShopeeGmsReport,
} from "./client";
import { toShopeeDate } from "./ads-spend";
import { computeChannelProductBreakeven, dateKeyToDbDate, shiftDateKey, vnDateKey } from "./ads-insights";

export type GmsWindowKey = "7d" | "30d";
export const GMS_WINDOWS: Array<{ key: GmsWindowKey; days: number }> = [
  { key: "7d", days: 7 },
  { key: "30d", days: 30 },
];
export const GMS_STATUS_ACTIVE = "active";

/** "YYYY-MM-DD" (ngày VN) → "DD-MM-YYYY" của sàn. */
function toShopeeDay(key: string): string {
  return toShopeeDate(new Date(`${key}T00:00:00Z`));
}

/** Probe prod ANO 24/09: 4 call GMS liên tiếp → cú thứ 4 dính ads_rate_limit_shop_api → giãn giữa các call. */
const GMS_CALL_GAP_MS = 1500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Cửa sổ N ngày TRỌN kết thúc hôm qua (bỏ hôm nay). */
export function gmsWindowKeys(days: number, todayKey: string = vnDateKey(0)): { startKey: string; endKey: string } {
  const endKey = shiftDateKey(todayKey, -1);
  return { startKey: shiftDateKey(endKey, -(days - 1)), endKey };
}

export interface GmsReportNumbers {
  expense: number;
  impression: number;
  clicks: number;
  broadOrder: number;
  broadGmv: number;
  directOrder: number;
  directGmv: number;
  roasBroad: number | null;
}

/** Báo cáo sàn → số sạch (thiếu trường = 0) — THUẦN. */
export function gmsReportNumbers(r: ShopeeGmsReport | undefined | null): GmsReportNumbers {
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const expense = n(r?.expense);
  const broadGmv = n(r?.broad_gmv);
  return {
    expense,
    impression: Math.trunc(n(r?.impression)),
    clicks: Math.trunc(n(r?.clicks)),
    broadOrder: Math.trunc(n(r?.broad_order)),
    broadGmv,
    directOrder: Math.trunc(n(r?.direct_order)),
    directGmv: n(r?.direct_gmv),
    roasBroad: expense > 0 ? broadGmv / expense : null,
  };
}

/** Trạng thái GMS từ eligibility — THUẦN. */
export function gmsStatusFrom(resp: { is_eligible?: boolean; reason?: string } | undefined): string {
  if (!resp) return "error:empty";
  if (resp.reason === "active_campaign") return GMS_STATUS_ACTIVE;
  if (resp.is_eligible) return "eligible";
  return resp.reason || "unknown";
}

export interface SyncGmsResult {
  status: string;
  reports: number;
  items: number;
}

/**
 * Lượt lịch sử (6h): hỏi eligibility → shop đang chạy GMS thì kéo 2 cửa sổ + từng SP 7d.
 * Lỗi eligibility (chưa whitelist…) ghi status "error:<mã>" và dừng — không chặn lượt ads.
 */
export async function syncShopeeGms(channel: Channel, access?: ShopeeAdsAccess): Promise<SyncGmsResult> {
  if (channel.channelName !== ChannelName.SHOPEE) return { status: "n/a", reports: 0, items: 0 };
  const a = access ?? (await resolveShopeeAdsAccess(channel));
  const base = { accessToken: a.accessToken, shopId: a.shopId };
  const now = new Date();

  let status: string;
  try {
    const e = await checkGmsEligibility(base, a.cfg);
    status = gmsStatusFrom(e.response);
  } catch (err) {
    if (isApiBudgetError(err)) throw err;
    status = `error:${String((err as Error).message).slice(0, 80)}`;
  }
  await prisma.channel.update({
    where: { id: channel.id },
    data: { adsGmsStatus: status, adsGmsCheckedAt: now },
  });
  const result: SyncGmsResult = { status, reports: 0, items: 0 };
  if (status !== GMS_STATUS_ACTIVE) {
    // Không còn GMS → dọn báo cáo cũ để UI không hiện số chết.
    await prisma.adsGmsReport.deleteMany({ where: { channelId: channel.id } });
    await prisma.adsGmsItemReport.deleteMany({ where: { channelId: channel.id } });
    return result;
  }

  const todayKey = vnDateKey(0);
  for (const w of GMS_WINDOWS) {
    await sleep(GMS_CALL_GAP_MS);
    const { startKey, endKey } = gmsWindowKeys(w.days, todayKey);
    const r = await getGmsCampaignPerformance(
      { ...base, startDate: toShopeeDay(startKey), endDate: toShopeeDay(endKey) },
      a.cfg
    );
    const nums = gmsReportNumbers(r.response?.report);
    const campaignId = r.response?.campaign_id != null ? String(r.response.campaign_id) : null;
    const data = { campaignId, startKey, endKey, ...nums, roasBroad: undefined, syncedAt: now };
    delete (data as { roasBroad?: unknown }).roasBroad;
    await prisma.adsGmsReport.upsert({
      where: { channelId_windowKey: { channelId: channel.id, windowKey: w.key } },
      update: data,
      create: { channelId: channel.id, windowKey: w.key, ...data },
    });
    result.reports++;
  }

  // Từng SP cửa sổ 7d — phân trang ≤100, tối đa 3 trang (gian nhiều SP thì 300 SP có số là đủ soi).
  const { startKey, endKey } = gmsWindowKeys(7, todayKey);
  const seen = new Set<string>();
  for (let page = 0; page < 3; page++) {
    await sleep(GMS_CALL_GAP_MS);
    const r = await getGmsItemPerformance(
      { ...base, startDate: toShopeeDay(startKey), endDate: toShopeeDay(endKey), offset: page * 100, limit: 100 },
      a.cfg
    );
    for (const it of r.response?.result_list ?? []) {
      if (it.item_id == null) continue;
      const itemId = String(it.item_id);
      seen.add(itemId);
      const nums = gmsReportNumbers(it.report);
      const data = { ...nums, roasBroad: undefined, syncedAt: now };
      delete (data as { roasBroad?: unknown }).roasBroad;
      await prisma.adsGmsItemReport.upsert({
        where: { channelId_windowKey_itemId: { channelId: channel.id, windowKey: "7d", itemId } },
        update: data,
        create: { channelId: channel.id, windowKey: "7d", itemId, ...data },
      });
      result.items++;
    }
    if (!r.response?.has_next_page) break;
  }
  // SP không còn số ở cửa sổ mới → xóa dòng cũ.
  await prisma.adsGmsItemReport.deleteMany({
    where: { channelId: channel.id, windowKey: "7d", ...(seen.size ? { itemId: { notIn: [...seen] } } : {}) },
  });
  return result;
}

export interface GmsOverview {
  status: string;
  checkedAt: Date | null;
  reports: Array<{
    windowKey: string;
    startKey: string;
    endKey: string;
    campaignId: string | null;
    syncedAt: Date;
  } & GmsReportNumbers>;
  shopBreakevenRoas: number | null;
  /** Cấu hình GMS Hubsell ĐÃ ĐẶT / còn nhớ (25/09) — null khi chưa từng ghi từ Hubsell (sàn không có API đọc). */
  campaign: GmsCampaignMemory | null;
}

export interface GmsCampaignMemory {
  campaignId: string;
  state: string;
  dailyBudget: number | null;
  roasTarget: number | null;
  createdByHubsellAt: Date | null;
  lastAction: string | null;
  lastActionAt: Date | null;
  lastError: string | null;
  history: GmsHistoryEntry[];
}

/** Khối GMS cho dashboard — ĐỌC DB, không gọi sàn. null khi chưa hỏi sàn. */
export async function getShopeeGmsOverview(
  channel: Pick<Channel, "id" | "adsGmsStatus" | "adsGmsCheckedAt">,
  shopBreakevenRoas: number | null
): Promise<GmsOverview | null> {
  if (!channel.adsGmsStatus) return null;
  const rows = (await prisma.adsGmsReport.findMany({ where: { channelId: channel.id } })).sort(
    (a, b) => (GMS_WINDOWS.findIndex((w) => w.key === a.windowKey) - GMS_WINDOWS.findIndex((w) => w.key === b.windowKey))
  );
  const mem = await prisma.adsGmsCampaign.findUnique({ where: { channelId: channel.id } });
  return {
    status: channel.adsGmsStatus,
    checkedAt: channel.adsGmsCheckedAt ?? null,
    shopBreakevenRoas,
    campaign: mem
      ? {
          campaignId: mem.campaignId,
          state: mem.state,
          dailyBudget: mem.dailyBudget != null ? Number(mem.dailyBudget) : null,
          roasTarget: mem.roasTarget != null ? Number(mem.roasTarget) : null,
          createdByHubsellAt: mem.createdByHubsellAt,
          lastAction: mem.lastAction,
          lastActionAt: mem.lastActionAt,
          lastError: mem.lastError,
          history: (Array.isArray(mem.history) ? (mem.history as unknown as GmsHistoryEntry[]) : []).slice(-10),
        }
      : null,
    reports: rows.map((r) => {
      const expense = Number(r.expense);
      const broadGmv = Number(r.broadGmv);
      return {
        windowKey: r.windowKey,
        startKey: r.startKey,
        endKey: r.endKey,
        campaignId: r.campaignId,
        syncedAt: r.syncedAt,
        expense,
        impression: r.impression,
        clicks: r.clicks,
        broadOrder: r.broadOrder,
        broadGmv,
        directOrder: r.directOrder,
        directGmv: Number(r.directGmv),
        roasBroad: expense > 0 ? broadGmv / expense : null,
      };
    }),
  };
}

/** Từng SP trong GMS 7d kèm hòa vốn của chính SP — ĐỌC DB (P&L + bảng SP), không gọi sàn. */
export async function getShopeeGmsItems(channel: Channel) {
  const rows = await prisma.adsGmsItemReport.findMany({
    where: { channelId: channel.id, windowKey: "7d" },
    orderBy: { expense: "desc" },
  });
  const report = await prisma.adsGmsReport.findUnique({
    where: { channelId_windowKey: { channelId: channel.id, windowKey: "7d" } },
    select: { startKey: true, endKey: true, syncedAt: true },
  });
  if (rows.length === 0) {
    return { windowKey: "7d" as const, startKey: report?.startKey ?? null, endKey: report?.endKey ?? null, syncedAt: report?.syncedAt ?? null, rows: [] };
  }
  const breakeven = await computeChannelProductBreakeven({
    id: channel.id,
    userId: channel.userId,
    channelName: channel.channelName,
  });
  const beByItem = new Map(breakeven.rows.map((r) => [r.itemId, r] as const));
  const itemIds = rows.map((r) => r.itemId);
  const products = await prisma.channelProduct.findMany({
    where: { channelId: channel.id, OR: itemIds.flatMap((id) => [{ externalId: id }, { externalId: { startsWith: `${id}-` } }]) },
    select: { externalId: true, productName: true },
  });
  const nameByItem = new Map<string, string>();
  for (const p of products) {
    const id = (p.externalId ?? "").split("-")[0];
    if (id && !nameByItem.has(id)) nameByItem.set(id, p.productName);
  }
  return {
    windowKey: "7d" as const,
    startKey: report?.startKey ?? null,
    endKey: report?.endKey ?? null,
    syncedAt: report?.syncedAt ?? null,
    rows: rows.map((r) => {
      const expense = Number(r.expense);
      const broadGmv = Number(r.broadGmv);
      const be = beByItem.get(r.itemId);
      return {
        itemId: r.itemId,
        name: be?.productName || nameByItem.get(r.itemId) || "",
        expense,
        clicks: r.clicks,
        broadOrder: r.broadOrder,
        broadGmv,
        roasBroad: expense > 0 ? broadGmv / expense : null,
        breakevenRoas: be?.breakevenRoas ?? null,
        lossBeforeAds: be?.lossBeforeAds ?? false,
      };
    }),
  };
}

/**
 * PROBE đọc thuần (bước 0): eligibility + báo cáo GMS 7 ngày trọn + từng SP + khoảng 2 ngày
 * sát nhất + so với tổng chi cấp shop (AdSpend) và tổng chi campaign sản phẩm cùng khoảng.
 */
export async function probeShopeeGms(channel: Channel): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const safe = async (key: string, fn: () => Promise<unknown>) => {
    try {
      out[key] = await fn();
    } catch (err) {
      out[key] = { error: (err as Error).message };
    }
  };
  let access: ShopeeAdsAccess | null = null;
  await safe("ads_access", async () => {
    access = await resolveShopeeAdsAccess(channel);
    return { source: access.source };
  });
  if (!access) return out;
  const a = access as ShopeeAdsAccess;
  const base = { accessToken: a.accessToken, shopId: a.shopId };

  const { startKey, endKey } = gmsWindowKeys(7);
  const startDate = toShopeeDay(startKey);
  const endDate = toShopeeDay(endKey);
  out.window = { startKey, endKey, startDate, endDate };

  await safe("eligibility", () => checkGmsEligibility(base, a.cfg));
  await sleep(GMS_CALL_GAP_MS);
  await safe("campaign_perf_7d", () => getGmsCampaignPerformance({ ...base, startDate, endDate }, a.cfg));
  await sleep(GMS_CALL_GAP_MS);
  await safe("item_perf_7d", async () => {
    const r = await getGmsItemPerformance({ ...base, startDate, endDate, limit: 20 }, a.cfg);
    return {
      campaign_id: r.response?.campaign_id,
      total: r.response?.total,
      has_next_page: r.response?.has_next_page,
      sample: (r.response?.result_list ?? []).slice(0, 10),
    };
  });
  await sleep(GMS_CALL_GAP_MS);
  await safe("campaign_perf_2d", () =>
    getGmsCampaignPerformance({ ...base, startDate: toShopeeDay(vnDateKey(1)), endDate: toShopeeDay(vnDateKey(0)) }, a.cfg)
  );
  await safe("compare_7d", async () => {
    const gte = dateKeyToDbDate(startKey);
    const lte = dateKeyToDbDate(endKey);
    const shop = await prisma.adSpend.aggregate({ where: { channelId: channel.id, date: { gte, lte } }, _sum: { amount: true } });
    const camp = await prisma.adsCampaignDailyPerf.aggregate({
      where: { adsCampaign: { channelId: channel.id }, date: { gte, lte } },
      _sum: { expense: true },
    });
    const shopSpend = Number(shop._sum.amount ?? 0);
    const campSpend = Number(camp._sum.expense ?? 0);
    return { shopSpend, campaignSpend: campSpend, gap: shopSpend - campSpend };
  });
  return out;
}

// ============================================================
// LỆNH GHI GMS (25/09/2026) — task Shopee Open Platform "Integrate Shop GMV Max Ads API"
// (Auto Check: ≥1 call create_gms_product_campaign thành công). Docs đọc 25/09 (config.ts).
//
// Nguyên tắc:
//   · Mọi lệnh là do CHỦ SHOP bấm (không executor tự động) — GMS không có số theo ngày nên rule
//     engine cửa sổ today/3d không áp được; Trợ lý chỉ gợi ý SP lỗ để loại.
//   · Shopee KHÔNG có API đọc cấu hình GMS → Hubsell nhớ vào AdsGmsCampaign những gì đã đặt; đặt
//     trên Seller Center thì số nhớ có thể lệch, UI nói rõ "số Hubsell nhớ".
//   · Không hẹn ngày tắt → start_date PHẢI là hôm nay (ads.campaign.invalid_start_date).
//   · roas_target: bỏ/0 = Auto Bidding, >0 = Custom ROAS, sàn LẤY 1 số lẻ (10,19 → 10,1: cắt, không làm tròn).
//   · Ngân sách: sàn tự chặn mức sai (ads.campaign.error_daily_budget_range) — không đoán tối thiểu.
// ============================================================

export type GmsEditAction = "pause" | "resume" | "change_budget" | "change_roas_target";
export const GMS_EDIT_ACTIONS: GmsEditAction[] = ["pause", "resume", "change_budget", "change_roas_target"];
const GMS_HISTORY_MAX = 50;

export interface GmsHistoryEntry {
  at: string;
  action: string;
  payload: Record<string, unknown>;
  status: "SUCCESS" | "FAILED";
  error?: string;
  referenceId?: string;
}

/** ROAS mục tiêu theo luật sàn — THUẦN: rỗng/0/âm/NaN → 0 (Auto Bidding); >0 → CẮT còn 1 số lẻ. */
export function normalizeGmsRoasTarget(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n * 10 + 1e-9) / 10;
}

/** Ngân sách ngày — THUẦN: số nguyên đồng > 0, sai → null. */
export function normalizeGmsBudget(v: unknown): number | null {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export interface GmsCreatePayload {
  start_date: string;
  daily_budget: number;
  roas_target?: number;
}

/**
 * Payload create — THUẦN. Không hẹn ngày tắt → start_date = hôm nay (giờ VN, "DD-MM-YYYY").
 * roas 0 (auto) thì KHÔNG gửi trường (docs: no input = Auto Bidding) để tránh lệ thuộc cách sàn hiểu số 0.
 */
export function buildGmsCreatePayload(
  input: { dailyBudget: unknown; roasTarget?: unknown },
  todayKey: string = vnDateKey(0)
): { ok: true; payload: GmsCreatePayload; roasTarget: number; dailyBudget: number } | { ok: false; error: string } {
  const dailyBudget = normalizeGmsBudget(input.dailyBudget);
  if (dailyBudget == null) return { ok: false, error: "Ngân sách ngày phải là số dương." };
  const roasTarget = normalizeGmsRoasTarget(input.roasTarget);
  return {
    ok: true,
    dailyBudget,
    roasTarget,
    payload: {
      start_date: toShopeeDay(todayKey),
      daily_budget: dailyBudget,
      ...(roasTarget > 0 ? { roas_target: roasTarget } : {}),
    },
  };
}

/** Kế hoạch edit — THUẦN: hành động + trường bắt buộc kèm theo. */
export function buildGmsEditPlan(
  action: unknown,
  input: { dailyBudget?: unknown; roasTarget?: unknown }
): { ok: true; editAction: GmsEditAction; dailyBudget?: number; roasTarget?: number } | { ok: false; error: string } {
  if (!GMS_EDIT_ACTIONS.includes(action as GmsEditAction)) return { ok: false, error: "Hành động không hợp lệ." };
  const editAction = action as GmsEditAction;
  if (editAction === "change_budget") {
    const dailyBudget = normalizeGmsBudget(input.dailyBudget);
    if (dailyBudget == null) return { ok: false, error: "Ngân sách ngày phải là số dương." };
    return { ok: true, editAction, dailyBudget };
  }
  if (editAction === "change_roas_target") {
    // 0 = chuyển về Auto Bidding — docs cho phép gửi 0 ở change_roas_target ("Input 0 for Auto Bidding").
    return { ok: true, editAction, roasTarget: normalizeGmsRoasTarget(input.roasTarget) };
  }
  return { ok: true, editAction };
}

/** Nối sổ, giữ ≤ 50 dòng mới nhất — THUẦN. */
export function appendGmsHistory(history: unknown, entry: GmsHistoryEntry): GmsHistoryEntry[] {
  const prev = Array.isArray(history) ? (history as GmsHistoryEntry[]) : [];
  return [...prev, entry].slice(-GMS_HISTORY_MAX);
}

function envelopeError(raw: { error?: string; message?: string }): string | null {
  if (raw.error && raw.error !== "" && raw.error !== "-") {
    return raw.message && raw.message !== "-" ? `${raw.error}: ${raw.message}` : raw.error;
  }
  return null;
}

async function rememberGms(
  channelId: string,
  patch: Omit<Prisma.AdsGmsCampaignUncheckedCreateInput, "channelId" | "history">,
  entry: GmsHistoryEntry
) {
  const cur = await prisma.adsGmsCampaign.findUnique({ where: { channelId } });
  const history = appendGmsHistory(cur?.history, entry) as unknown as Prisma.InputJsonValue;
  return prisma.adsGmsCampaign.upsert({
    where: { channelId },
    update: { ...patch, history },
    create: { channelId, ...patch, history },
  });
}

export interface GmsWriteResult {
  ok: boolean;
  error: string | null;
  campaignId: string | null;
}

/** Chủ shop BẬT GMV Max cấp shop từ Hubsell — lệnh GHI THẬT (tiền bắt đầu tiêu từ hôm nay). */
export async function createShopeeGmsCampaign(
  channel: Channel,
  input: { dailyBudget: unknown; roasTarget?: unknown }
): Promise<GmsWriteResult> {
  if (channel.adsGmsStatus === GMS_STATUS_ACTIVE) {
    return { ok: false, error: "Gian đang chạy GMV Max cấp shop rồi — mỗi gian chỉ có một.", campaignId: null };
  }
  const plan = buildGmsCreatePayload(input);
  if (!plan.ok) return { ok: false, error: plan.error, campaignId: null };
  const referenceId = `gms-create-${channel.id}-${Date.now()}`;
  const now = new Date();
  let raw;
  try {
    const { accessToken, shopId, cfg } = await resolveShopeeAdsAccess(channel);
    raw = await createGmsProductCampaignRaw(
      {
        accessToken,
        shopId,
        referenceId,
        startDate: plan.payload.start_date,
        dailyBudget: plan.payload.daily_budget,
        roasTarget: plan.payload.roas_target,
      },
      cfg
    );
  } catch (err) {
    return { ok: false, error: String((err as Error).message).slice(0, 1000), campaignId: null };
  }
  const err = envelopeError(raw);
  const cid = raw.response?.campaign_id;
  if (err || cid == null) {
    const error = err ?? "Sàn báo thành công nhưng không trả campaign_id.";
    // Ghi sổ lỗi để học mã lỗi sàn (không tạo bản ghi "đang chạy").
    const cur = await prisma.adsGmsCampaign.findUnique({ where: { channelId: channel.id } });
    if (cur) {
      await prisma.adsGmsCampaign.update({
        where: { channelId: channel.id },
        data: {
          lastError: error,
          history: appendGmsHistory(cur.history, {
            at: now.toISOString(),
            action: "create",
            payload: plan.payload as unknown as Record<string, unknown>,
            status: "FAILED",
            error,
            referenceId,
          }) as unknown as Prisma.InputJsonValue,
        },
      });
    }
    return { ok: false, error, campaignId: null };
  }
  const campaignId = String(cid);
  await rememberGms(
    channel.id,
    {
      campaignId,
      state: "ongoing",
      dailyBudget: plan.dailyBudget,
      roasTarget: plan.roasTarget,
      createdByHubsellAt: now,
      lastAction: "create",
      lastActionAt: now,
      lastError: null,
    },
    { at: now.toISOString(), action: "create", payload: plan.payload as unknown as Record<string, unknown>, status: "SUCCESS", referenceId }
  );
  await prisma.channel.update({
    where: { id: channel.id },
    data: { adsGmsStatus: GMS_STATUS_ACTIVE, adsGmsCheckedAt: now },
  });
  await prisma.opsActivity.create({
    data: {
      ownerId: channel.userId,
      tag: "ads",
      message: `🚀 Bật GMV Max cấp shop cho gian "${channel.shopName}" từ Hubsell — ${plan.dailyBudget.toLocaleString("vi-VN")}₫/ngày, ${
        plan.roasTarget > 0 ? `mục tiêu ROAS ${plan.roasTarget}x` : "Shopee tự đấu thầu"
      } (campaign ${campaignId}).`,
    },
  });
  await requestAdsRefresh(channel.id).catch(() => undefined);
  return { ok: true, error: null, campaignId };
}

/** Chủ shop tạm dừng / bật lại / đổi ngân sách / đổi mục tiêu ROAS của GMS — lệnh GHI THẬT. */
export async function editShopeeGmsCampaign(
  channel: Channel,
  input: { action: unknown; dailyBudget?: unknown; roasTarget?: unknown }
): Promise<GmsWriteResult> {
  const plan = buildGmsEditPlan(input.action, input);
  if (!plan.ok) return { ok: false, error: plan.error, campaignId: null };
  const mem = await prisma.adsGmsCampaign.findUnique({ where: { channelId: channel.id } });
  const referenceId = `gms-${plan.editAction}-${channel.id}-${Date.now()}`;
  const now = new Date();
  const payload: Record<string, unknown> = {
    edit_action: plan.editAction,
    ...(plan.dailyBudget != null ? { daily_budget: plan.dailyBudget } : {}),
    ...(plan.roasTarget != null ? { roas_target: plan.roasTarget } : {}),
  };
  let raw;
  try {
    const { accessToken, shopId, cfg } = await resolveShopeeAdsAccess(channel);
    raw = await editGmsProductCampaignRaw(
      {
        accessToken,
        shopId,
        referenceId,
        campaignId: mem?.campaignId ?? null,
        editAction: plan.editAction,
        dailyBudget: plan.dailyBudget,
        roasTarget: plan.roasTarget,
      },
      cfg
    );
  } catch (err) {
    return { ok: false, error: String((err as Error).message).slice(0, 1000), campaignId: mem?.campaignId ?? null };
  }
  const err = envelopeError(raw);
  const entry: GmsHistoryEntry = {
    at: now.toISOString(),
    action: plan.editAction,
    payload,
    status: err ? "FAILED" : "SUCCESS",
    ...(err ? { error: err } : {}),
    referenceId,
  };
  const campaignId =
    mem?.campaignId ??
    (await prisma.adsGmsReport.findFirst({ where: { channelId: channel.id, campaignId: { not: null } }, select: { campaignId: true } }))
      ?.campaignId ??
    "";
  await rememberGms(
    channel.id,
    {
      campaignId,
      ...(err
        ? { lastError: err }
        : {
            state: plan.editAction === "pause" ? "paused" : plan.editAction === "resume" ? "ongoing" : (mem?.state ?? "ongoing"),
            ...(plan.dailyBudget != null ? { dailyBudget: plan.dailyBudget } : {}),
            ...(plan.roasTarget != null ? { roasTarget: plan.roasTarget } : {}),
            lastAction: plan.editAction,
            lastActionAt: now,
            lastError: null,
          }),
    },
    entry
  );
  if (err) return { ok: false, error: err, campaignId: campaignId || null };
  const what =
    plan.editAction === "pause"
      ? "tạm dừng GMV Max cấp shop"
      : plan.editAction === "resume"
        ? "bật lại GMV Max cấp shop"
        : plan.editAction === "change_budget"
          ? `đổi ngân sách GMV Max cấp shop → ${plan.dailyBudget!.toLocaleString("vi-VN")}₫/ngày`
          : `đổi mục tiêu ROAS GMV Max cấp shop → ${plan.roasTarget! > 0 ? `${plan.roasTarget}x` : "Shopee tự đấu thầu"}`;
  await prisma.opsActivity.create({
    data: { ownerId: channel.userId, tag: "ads", message: `Chủ shop ${what} (gian "${channel.shopName}").` },
  });
  return { ok: true, error: null, campaignId: campaignId || null };
}

/** Loại SP khỏi GMS (remove) / đưa lại (add) — theo lô ≤30, lệnh GHI THẬT. */
export async function editShopeeGmsItems(
  channel: Channel,
  input: { action: unknown; itemIds: unknown }
): Promise<GmsWriteResult & { done: number }> {
  const action = input.action === "add" ? "add" : input.action === "remove" ? "remove" : null;
  const ids = Array.isArray(input.itemIds)
    ? [...new Set(input.itemIds.map((x) => String(x)).filter((x) => /^\d+$/.test(x)))]
    : [];
  if (!action || ids.length === 0) return { ok: false, error: "Thiếu hành động hoặc danh sách sản phẩm.", campaignId: null, done: 0 };
  const mem = await prisma.adsGmsCampaign.findUnique({ where: { channelId: channel.id } });
  const now = new Date();
  let done = 0;
  let error: string | null = null;
  try {
    const { accessToken, shopId, cfg } = await resolveShopeeAdsAccess(channel);
    for (let i = 0; i < ids.length; i += 30) {
      if (i > 0) await sleep(GMS_CALL_GAP_MS);
      const chunk = ids.slice(i, i + 30);
      const raw = await editGmsItemProductCampaignRaw(
        { accessToken, shopId, campaignId: mem?.campaignId ?? null, editAction: action, itemIds: chunk },
        cfg
      );
      const err = envelopeError(raw);
      if (err) {
        error = err;
        break;
      }
      done += chunk.length;
    }
  } catch (err) {
    error = String((err as Error).message).slice(0, 1000);
  }
  if (mem) {
    await rememberGms(
      channel.id,
      {
        campaignId: mem.campaignId,
        ...(error ? { lastError: error } : { lastAction: `${action}_items`, lastActionAt: now, lastError: null }),
      },
      {
        at: now.toISOString(),
        action: `${action}_items`,
        payload: { item_id_list: ids },
        status: error ? "FAILED" : "SUCCESS",
        ...(error ? { error } : {}),
      }
    );
  }
  if (done > 0) {
    await prisma.opsActivity.create({
      data: {
        ownerId: channel.userId,
        tag: "ads",
        message: `Chủ shop ${action === "remove" ? "loại" : "đưa lại"} ${done} sản phẩm ${
          action === "remove" ? "khỏi" : "vào"
        } GMV Max cấp shop (gian "${channel.shopName}").`,
      },
    });
  }
  return { ok: !error, error, campaignId: mem?.campaignId ?? null, done };
}

/** SP đã bị loại khỏi GMS — đọc SỐNG từ sàn (≤3 trang × 100), ghép tên từ bảng SP. */
export async function listShopeeGmsExcludedItems(channel: Channel): Promise<{
  campaignId: string | null;
  total: number;
  rows: Array<{ itemId: string; name: string }>;
}> {
  const { accessToken, shopId, cfg } = await resolveShopeeAdsAccess(channel);
  const ids: string[] = [];
  let total = 0;
  let campaignId: string | null = null;
  for (let page = 0; page < 3; page++) {
    if (page > 0) await sleep(GMS_CALL_GAP_MS);
    const r = await listGmsUserDeletedItems({ accessToken, shopId, offset: page * 100, limit: 100 }, cfg);
    for (const id of r.response?.item_id_list ?? []) ids.push(String(id));
    total = Number(r.response?.total ?? ids.length);
    if (r.response?.campaign_id != null) campaignId = String(r.response.campaign_id);
    if (!r.response?.has_next_page) break;
  }
  const nameByItem = new Map<string, string>();
  if (ids.length) {
    const products = await prisma.channelProduct.findMany({
      where: { channelId: channel.id, OR: ids.flatMap((id) => [{ externalId: id }, { externalId: { startsWith: `${id}-` } }]) },
      select: { externalId: true, productName: true },
    });
    for (const p of products) {
      const id = (p.externalId ?? "").split("-")[0];
      if (id && !nameByItem.has(id)) nameByItem.set(id, p.productName);
    }
  }
  return { campaignId, total, rows: ids.map((itemId) => ({ itemId, name: nameByItem.get(itemId) ?? "" })) };
}
