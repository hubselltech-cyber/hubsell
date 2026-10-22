// ============================================================
// SHOPEE — XUNG QUẢNG CÁO (tầng A, docs/ADS-NHIP-CANH-BAO.md) — 12/09/2026
//
// Mỗi ADS_CADENCE.PULSE_MIN cho gian đang tiêu tiền, 5 call (gian ≤100 campaign):
//   1. campaign_id_list          → bắt campaign MỚI TẠO (ca cắn tiền hay gặp)
//   2. campaign_setting_info     → trạng thái chạy/tạm dừng, ngân sách, ROAS mục
//                                  tiêu TƯƠI ≤30' (seller tạm dừng trên Seller
//                                  Center thì rule engine không báo nhầm nữa)
//   3. campaign_daily_performance start=end=HÔM NAY → dòng today của rule spike
//   4. all_cpc_ads_daily_performance HÔM NAY → AdSpend hôm nay (báo cáo dòng
//                                  tiền + detector ads-spike cũ cho gian ít campaign)
//   5. get_total_balance         → ví ads ghi DB (detector + trang Trợ lý đọc DB,
//                                  bỏ 2 call sống cũ)
//
// XUNG NHẸ (gian đã nối Ads API nhưng DB chưa có campaign nào chạy): chỉ call 1;
// thấy campaign mới → chạy luôn xung đủ ngay lượt này.
//
// 13.9 A2 (22/10/2026): mỗi bước là MỘT endpoint, cổng gọi sàn giữ trần GIAN × endpoint
// (1 lệnh/phút, get_all_cpc 1 lệnh/5'); bị hoãn ở bước k → lượt sau chạy tiếp từ k
// (resumeFrom), không hỏi lại 3 bước đã có số — trước đó mỗi lần thử lại là 3 lệnh phí
// rồi dính lại bước 4 (HPGear VN 4 lần liền, docs 13.9.5).
//
// Campaign "còn sống" = mọi trạng thái trừ ended/deleted/closed (paused vẫn
// phải theo dõi vì seller có thể bật lại). Lịch sử 7 ngày là việc của tầng B
// (syncShopeeAdsPerfWindow), không làm ở đây.
// ============================================================

import type { Channel } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { resolveShopeeAdsAccess } from "../hubsell-ads";
import { getAdsShopToggleInfo, getAdsTotalBalance } from "./client";
import {
  ADS_AD_TYPE_GROUP,
  fetchShopeeCampaignRefs,
  upsertShopeeCampaignPerf,
  upsertShopeeCampaignSettings,
} from "./ads-campaigns";
import { liveShopeeGroupCampaigns } from "./ads-group-campaigns";
import { syncShopeeAdsSpend } from "./ads-spend";
import { syncShopeeGms } from "./ads-gms";
import { vnDayWindow } from "../../lib/ads-dates";
import { isApiBudgetError } from "../../services/api-budget";

/** Trạng thái campaign không cần theo dõi nữa. */
export const ADS_DEAD_STATUSES = ["ended", "deleted", "closed"];

export interface ShopeeAdsPulseResult {
  /** Xung nhẹ (chỉ 1 call) hay xung đủ. */
  mode: "light" | "full";
  campaignsFound: number;
  newCampaigns: number;
  liveCampaigns: number;
  perfTodayUpserted: number;
  walletBalance: number | null;
  /** 13.9 A2: xung này chạy tiếp từ bước nào (1 = từ đầu). */
  resumedFrom: number;
}

/**
 * 13.9 A2 — các BƯỚC của một xung Shopee (mỗi bước một endpoint khác nhau). Cổng hoãn ở bước k → ApiBudgetError
 * mang `pulseStep = k` → làn ghi Channel.adsPulseStep, lượt sau `resumeFrom = k`: bước 1–(k−1) vừa có số thì không
 * hỏi lại (I7 "mỗi số hỏi sàn 1 lần"). Trước 22/10 mỗi lần thử lại chạy lại từ bước 1 → 3 lệnh phí + dính lại ở bước 4.
 */
export const SHOPEE_PULSE_STEP = {
  ID_LIST: 1,
  SETTINGS: 2,
  PERF_TODAY: 3,
  SPEND_TODAY: 4,
  BALANCE: 5,
  GMS: 6,
} as const;

/** Bước chạy tiếp hợp lệ: 2..6 (1 hoặc ngoài khoảng = từ đầu). Hàm thuần. */
export function normalizeResumeStep(step: number | null | undefined): number {
  return step != null && Number.isInteger(step) && step > SHOPEE_PULSE_STEP.ID_LIST && step <= SHOPEE_PULSE_STEP.GMS ? step : SHOPEE_PULSE_STEP.ID_LIST;
}

/** Chạy một bước; cổng hoãn / ngân sách → gắn số bước vào lỗi rồi ném tiếp. */
async function pulseStep<T>(step: number, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isApiBudgetError(err) && err.pulseStep == null) err.pulseStep = step;
    throw err;
  }
}

export async function pulseShopeeAds(
  channel: Channel,
  opts: {
    light?: boolean;
    /** Bước B 13.9 (gộp lệnh): lượt lịch sử vừa kéo 30 ngày (có hôm nay) ngay trước → bỏ bước 3 + 4 "hôm nay". */
    skipToday?: boolean;
    /** 13.9 A2: chạy tiếp từ bước này (SHOPEE_PULSE_STEP), bỏ qua các bước trước đã có số ở lượt dở. */
    resumeFrom?: number;
  } = {}
): Promise<ShopeeAdsPulseResult> {
  const access = await resolveShopeeAdsAccess(channel);
  const from = normalizeResumeStep(opts.resumeFrom);

  const result: ShopeeAdsPulseResult = {
    mode: "full",
    campaignsFound: 0,
    newCampaigns: 0,
    liveCampaigns: 0,
    perfTodayUpserted: 0,
    walletBalance: null,
    resumedFrom: from,
  };
  let rowIdByCampaignId: Map<string, string>;

  if (from <= SHOPEE_PULSE_STEP.SETTINGS) {
    const known = await prisma.adsCampaign.findMany({
      where: { channelId: channel.id },
      select: { id: true, campaignId: true, status: true, adType: true },
    });
    const knownById = new Map(known.map((r) => [r.campaignId, r] as const));
    const liveKnown = known.filter((r) => !ADS_DEAD_STATUSES.includes(r.status));
    // 1. Toàn bộ id trên sàn (1 call/100) — so với DB để biết campaign mới. Chạy tiếp từ bước 2: id_list vừa có ở
    // lượt dở → tập trên sàn = chiến dịch sống trong DB (trừ Nhóm — không có trong id_list, không hỏi setting_info).
    const fresh = from <= SHOPEE_PULSE_STEP.ID_LIST;
    const idToAdType = fresh
      ? await pulseStep(SHOPEE_PULSE_STEP.ID_LIST, () => fetchShopeeCampaignRefs(access))
      : new Map(liveKnown.filter((r) => r.adType !== ADS_AD_TYPE_GROUP).map((r) => [r.campaignId, r.adType] as const));
    const newIds = fresh ? [...idToAdType.keys()].filter((id) => !knownById.has(id)) : [];
    result.campaignsFound = idToAdType.size;
    result.newCampaigns = newIds.length;
    // Xung nhẹ và không có gì mới → xong (1 call). Có campaign mới → xung đủ ngay. Chạy tiếp thì không còn "nhẹ".
    if (fresh && opts.light && newIds.length === 0) {
      result.mode = "light";
      return result;
    }

    // 2. Cấu hình cho campaign còn sống trong DB + campaign mới (1 call/100).
    const liveIds = [...newIds, ...liveKnown.map((r) => r.campaignId)].filter((id) => idToAdType.has(id));
    rowIdByCampaignId = await pulseStep(SHOPEE_PULSE_STEP.SETTINGS, () =>
      upsertShopeeCampaignSettings(channel, access, idToAdType, liveIds)
    );
  } else {
    // Chạy tiếp từ bước ≥ 3: id_list + cấu hình đã có ở lượt dở (≤ PULSE_RESUME_TTL_MIN) → lấy dòng sống từ DB.
    const rows = await prisma.adsCampaign.findMany({
      where: { channelId: channel.id, status: { notIn: ADS_DEAD_STATUSES } },
      select: { id: true, campaignId: true },
    });
    rowIdByCampaignId = new Map(rows.map((r) => [r.campaignId, r.id] as const));
    result.campaignsFound = rows.length;
  }
  result.liveCampaigns = rowIdByCampaignId.size;

  // 3. Hiệu suất HÔM NAY (ngày sàn, giờ VN) của các campaign đó (1 call/100). Xung chỉ kéo
  // đúng hôm nay; số hôm qua sàn chỉnh muộn là việc của tầng lịch sử 6 giờ.
  // 3b. Chiến dịch Nhóm nhiều SP (mục 15.7): id không có trong id_list nên bước 1–2 bỏ qua; dòng Nhóm còn
  // sống trong DB vẫn kéo số hôm nay — mỗi id một call riêng (splitPerfBatches), không chạm setting_info.
  // Bước B 13.9 (gộp lệnh, I6): lượt lịch sử vừa kéo cửa sổ 30 ngày — có hôm nay, cả Nhóm — ngay trước xung này
  // thì bước 3 + 4 chỉ hỏi lại đúng số vừa có → bỏ (bớt 2 lệnh, trong đó có get_all_cpc là khóa chặt nhất).
  if (!opts.skipToday) {
    if (from <= SHOPEE_PULSE_STEP.PERF_TODAY) {
      const groupRows = await liveShopeeGroupCampaigns(channel.id);
      for (const [cid, rowId] of groupRows) rowIdByCampaignId.set(cid, rowId);
      if (rowIdByCampaignId.size > 0) {
        result.perfTodayUpserted = await pulseStep(SHOPEE_PULSE_STEP.PERF_TODAY, () =>
          upsertShopeeCampaignPerf(access, rowIdByCampaignId, vnDayWindow(1), { groupIds: new Set(groupRows.keys()) })
        );
      }
    }

    // 4. Chi tiêu cấp shop hôm nay — cùng ngày sàn với bước 3 (1 call).
    if (from <= SHOPEE_PULSE_STEP.SPEND_TODAY) {
      await pulseStep(SHOPEE_PULSE_STEP.SPEND_TODAY, () => syncShopeeAdsSpend(channel, { daysBack: 1 }));
    }
  }

  // 5. Ví ads → DB (1 call). Lỗi quyền ví không được chặn 4 bước trên.
  if (from <= SHOPEE_PULSE_STEP.BALANCE) {
    try {
      const bal = await pulseStep(SHOPEE_PULSE_STEP.BALANCE, () =>
        getAdsTotalBalance({ accessToken: access.accessToken, shopId: access.shopId }, access.cfg)
      );
      const balance = Number(bal.response?.total_balance);
      if (Number.isFinite(balance)) {
        result.walletBalance = balance;
        await prisma.channel.update({
          where: { id: channel.id },
          data: { adsWalletBalance: balance, adsWalletSyncedAt: new Date() },
        });
      }
    } catch (err) {
      // ★ 16/10/2026: gian đã bị sàn chặn (429 tầng shop) thì DỪNG xung ngay — gọi
      // tiếp các bước sau chỉ thêm 429 từ cùng một gian (từng làm cầu dao đóng cả app).
      if (isApiBudgetError(err)) throw err;
      console.warn(
        `[Ads-pulse] Ví ads Shopee "${channel.shopName}" không đọc được:`,
        (err as Error).message
      );
    }
  }

  // 6. GMS — gian CHƯA hỏi sàn lần nào (adsGmsStatus null, vd vừa deploy / vừa nối) thì hỏi ngay ở
  // xung (1 call eligibility; chỉ khi đang chạy GMS mới thêm 3–4 call) để tab GMV Max có trạng thái
  // trong 30' thay vì đợi lượt lịch sử 6h (anh Trung 24/09 "chưa thấy GMS ở đâu"). Lỗi không chặn gì.
  if (channel.adsGmsStatus == null) {
    try {
      await pulseStep(SHOPEE_PULSE_STEP.GMS, () => syncShopeeGms(channel, access));
    } catch (err) {
      if (isApiBudgetError(err)) throw err;
      console.warn(`[Ads-pulse] GMS lần đầu "${channel.shopName}" không đọc được:`, (err as Error).message);
    }
  }

  return result;
}

/**
 * ĐỢT B — cờ ví TỰ NẠP (1 call): ví cạn mà không tự nạp → cảnh báo cao; đã bật tự nạp → hạ mức (cắt cảnh báo ví
 * cạn giả). Bước B 13.9 (gộp lệnh): cờ này đổi hiếm → đọc ở LƯỢT LỊCH SỬ 6 h (workers/ads-tiers.ts) thay vì mỗi
 * xung 30' như trước 21/10. Lỗi sàn thường không chặn gì; lỗi ngân sách / cổng ném lên để lượt lùi lịch.
 */
export async function syncShopeeAutoTopUpFlag(channel: Channel): Promise<boolean | null> {
  const access = await resolveShopeeAdsAccess(channel);
  try {
    const tg = await getAdsShopToggleInfo({ accessToken: access.accessToken, shopId: access.shopId }, access.cfg);
    const autoTopUp = tg.response?.auto_top_up;
    if (typeof autoTopUp === "boolean") {
      await prisma.channel.update({ where: { id: channel.id }, data: { adsAutoTopUp: autoTopUp } });
      return autoTopUp;
    }
    return null;
  } catch (err) {
    if (isApiBudgetError(err)) throw err;
    console.warn(`[Ads-pulse] Cờ ví tự nạp Shopee "${channel.shopName}" không đọc được:`, (err as Error).message);
    return null;
  }
}
