// ============================================================
// TRỢ LÝ QUẢNG CÁO — GĐ3: TỰ THỰC THI (EXECUTOR DÙNG CHUNG SHOPEE + LAZADA)
//
// Chạy kèm xung ads trong order-auto-sync, NGAY SAU sync campaign của sàn
// (đánh giá trên số vừa sync). Các hành động:
//   CUT_BUDGET (ĐỢT B 24/09) campaign lỗ (pause_now) lần đầu trong ván → HẠ
//          ngân sách ngày (change_budget) thay vì tắt: giữ campaign sống, khóa
//          trần tiền mất; hôm đó không tắt nữa. Ngày sau vẫn pause_now → PAUSE.
//          Chỉ Shopee (Lazada không có lệnh đổi ngân sách → tắt như cũ).
//          Tắt cờ autoExecute.cutBudgetFirst thì về hành vi cũ (tắt ngay).
//   PAUSE  campaign dính verdict spike (vọt chi — khẩn, tắt ngay) hoặc pause_now
//          đã qua nấc hạ ngân sách — cắt lỗ.
//   RESUME campaign CHÍNH HUBSELL đã dừng khi ROAS cửa sổ đã kích đạt lại
//          hòa vốn × hệ số an toàn (sự cố 14/09/2026: đơn broad về trễ nên
//          một lần dừng sai phải tự đảo được, seller không phải trực).
//   RESTORE_BUDGET khi máy/người bật lại campaign có cờ hạ ngân sách → trả về
//          số gốc (hubsellBudgetBefore). Người tự đổi ngân sách trên sàn → xóa
//          cờ (ads-pause-flag.reconcileHubsellBudgetFlags), máy không trả nữa.
// Không đụng bid/keyword.
//
// Cú gọi lên sàn (makeActor): Shopee edit_manual_product_ads edit_action
// "pause"/"resume" — enum ĐÃ XÁC MINH: "pause" chạy thật 21/08 + 14/09, "resume"
// có trong docs chính thức (start/pause/resume/stop/delete…); Lazada
// updateCampaign switchStatus 0/1 (docs chính thức, chưa bắn thật).
//
// BỐN CHỐT AN TOÀN (thứ tự kiểm):
//   1. Mode per-gian trong AdsAssistantConfig.autoExecute:
//      off (mặc định) | dry_run (DIỄN TẬP: ghi sổ, KHÔNG gọi sàn) | live.
//   2. Idempotency theo VÁN: referenceId "{pause|resume}-{rowId}-{ngày}-c{cycle}"
//      unique trong AdsActionLog. cycle tăng mỗi lần người/máy bật lại → người
//      bật lại trên Seller Center là ván mới, máy được xét lại từ đầu (anh Trung
//      chốt 14/09); trong một ván mỗi ngày tối đa 1 lệnh mỗi loại.
//   3. Quota maxActionsPerDay per-gian (đệm dưới giới hạn sàn ~10 thao tác/
//      item/ngày) — ưu tiên campaign ĐANG TIÊU NHIỀU nhất trước.
//   4. Máy tự bật lại hôm nào thì hôm đó KHÔNG tắt lại nữa (hubsellResumedOn)
//      — tối đa một vòng dừng/bật mỗi campaign mỗi ngày, tránh giằng co.
//
// Chủ shop đã tự quyết cảnh báo (decisionActive) thì executor KHÔNG đụng vào —
// người luôn thắng máy. Campaign KHÔNG có cờ Hubsell (người/sàn tắt) thì máy
// KHÔNG BAO GIỜ bật lại.
// ============================================================

import { ChannelName, Prisma, type Channel } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { editManualProductAdsRaw } from "./client";
import { resolveShopeeAdsAccess } from "../hubsell-ads";
import {
  lazAdsWriteOk,
  updateAdsCampaignSwitchRaw,
} from "../lazada/client";
import { getValidLazadaAccessToken } from "../lazada/service";
import {
  assistantDecisionActive,
  computeChannelAdsInsights,
  vnDateKey,
  type CampaignInsight,
} from "./ads-insights";
import {
  WINDOW_LABEL,
  planBudgetCut,
  type AssistantWindowKey,
  type BudgetCutPlan,
  type ShopeeAssistantConfig,
} from "./ads-assistant-rules";
import {
  clearHubsellBudgetFlag,
  clearHubsellPauseFlag,
  MARKETPLACE_LOG_MODE,
} from "./ads-pause-flag";

/** Verdict nào thì được phép hành động (v1: chỉ hai loại chắc tay nhất). */
const ACTIONABLE_VERDICTS = new Set(["pause_now", "spike"]);

/** Verdict ghi vào sổ cho lệnh bật lại (không phải verdict rule engine). */
export const RESUME_VERDICT = "roas_recovered";

export interface AutoExecuteResult {
  mode: "off" | "dry_run" | "live";
  candidates: number; // campaign dính verdict đáng hành động
  planned: number; // dry_run: số hành động đã ghi sổ diễn tập
  executed: number; // live: gọi sàn thành công (pause)
  failed: number; // live: sàn từ chối (lỗi lưu nguyên văn trong sổ)
  skippedQuota: number; // bỏ qua vì chạm trần hành động/ngày
  skippedDone: number; // bỏ qua vì ván này hôm nay đã hành động rồi (referenceId trùng)
  resumed: number; // live: bật lại thành công
  resumeFailed: number; // live: bật lại bị sàn từ chối
  budgetCut: number; // ĐỢT B live: hạ ngân sách thành công
  budgetCutFailed: number; // ĐỢT B live: hạ ngân sách bị sàn từ chối
  budgetRestored: number; // ĐỢT B live: trả ngân sách gốc khi bật lại
}

/** ĐỢT B — trạng thái nấc hạ ngân sách của campaign trong VÁN hiện tại. */
export type BudgetCutState = "none" | "today" | "earlier";

export type AutoActionKind = "pause" | "cut_budget";

export interface PlannedAutoAction {
  it: CampaignInsight;
  kind: AutoActionKind;
  /** Có với cut_budget. */
  cut: BudgetCutPlan | null;
}

/**
 * ĐỢT B — QUYẾT NẤC hành động cho một ứng viên đã qua lọc — THUẦN, vitest đánh thẳng.
 *   spike           → pause (vọt chi là khẩn, không nấc trung gian).
 *   pause_now, cờ cutBudgetFirst bật, sàn có lệnh đổi ngân sách:
 *     chưa hạ trong ván → cut_budget (không có căn cứ đặt trần → pause như cũ);
 *     đã hạ HÔM NAY     → null (một nấc mỗi ngày, đợi đơn về);
 *     đã hạ hôm trước   → pause (hạ rồi vẫn lỗ).
 *   còn lại           → pause.
 */
export function planAutoAction(
  it: CampaignInsight,
  config: ShopeeAssistantConfig,
  opts: { budgetWriteSupported: boolean; cutState: BudgetCutState }
): PlannedAutoAction | null {
  const verdict = it.assessment.verdict;
  if (verdict === "pause_now" && config.autoExecute.cutBudgetFirst && opts.budgetWriteSupported) {
    if (opts.cutState === "today") return null;
    if (opts.cutState === "none") {
      const cut = planBudgetCut({ budget: Number(it.row.budget), avgDailySpend7d: it.avgDailySpend7d });
      if (cut) return { it, kind: "cut_budget", cut };
    }
  }
  return { it, kind: "pause", cut: null };
}

const roasTxt = (n: number) => `${n.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}x`;

/**
 * LỌC + XẾP HÀNG hành động PAUSE — logic thuần tách riêng cho vitest:
 * chỉ campaign ongoing, verdict đáng hành động, chưa bị người quyết, và hôm
 * nay máy CHƯA tự bật lại (một vòng dừng/bật mỗi ngày);
 * xếp theo chi tiêu 7 ngày giảm dần (cắt chỗ chảy máu to trước).
 */
export function selectAutoActionCandidates(
  items: CampaignInsight[],
  todayKey: string = vnDateKey(0)
): CampaignInsight[] {
  return items
    .filter(
      (it) =>
        it.row.status === "ongoing" &&
        it.assessment.verdict !== null &&
        ACTIONABLE_VERDICTS.has(it.assessment.verdict) &&
        !assistantDecisionActive(it) &&
        it.row.hubsellResumedOn !== todayKey
    )
    .sort((a, b) => b.windows["7d"].spend - a.windows["7d"].spend);
}

export interface ResumeCheck {
  ok: boolean;
  window: AssistantWindowKey;
  roas: number | null;
  breakevenRoas: number | null;
  /** hòa vốn × dangerFactor — phải vượt mức này mới bật lại (tránh bật rồi tắt). */
  threshold: number | null;
  reason: string;
}

/**
 * Có nên TỰ BẬT LẠI campaign do Hubsell dừng? — THUẦN, vitest đánh thẳng.
 * Xét đúng cửa sổ luật đã kích lệnh dừng (campaign tắt thì tiền đứng yên, đơn
 * trễ vẫn về → ROAS chỉ có thể đi lên); vượt hòa vốn × dangerFactor mới bật.
 * Chỉ campaign CÓ CỜ Hubsell (người tắt thì máy không bao giờ bật).
 */
export function shouldAutoResume(
  it: CampaignInsight,
  config: ShopeeAssistantConfig
): ResumeCheck {
  const raw = it.row.hubsellPauseWindow;
  const window: AssistantWindowKey =
    raw === "3d" || raw === "7d" || raw === "30d" ? raw : "today";
  const w = it.windows[window];
  const roas = w.spend > 0 ? w.broadGmv / w.spend : null;
  const breakevenRoas = it.breakevenRoas;
  const threshold =
    breakevenRoas != null ? breakevenRoas * config.review.dangerFactor : null;
  const flagged = it.row.hubsellPausedAt != null && it.row.status === "paused";
  if (!flagged) return { ok: false, window, roas, breakevenRoas, threshold, reason: "" };
  if (roas == null || threshold == null) {
    return {
      ok: false,
      window,
      roas,
      breakevenRoas,
      threshold,
      reason: "chưa có ROAS/hòa vốn để xét bật lại",
    };
  }
  const ok = roas >= threshold;
  return {
    ok,
    window,
    roas,
    breakevenRoas,
    threshold,
    reason: ok
      ? `Cửa sổ ${WINDOW_LABEL[window]}: ROAS ${roasTxt(roas)} đã vượt hòa vốn ${roasTxt(breakevenRoas!)} × ${config.review.dangerFactor} = ${roasTxt(threshold)} (đơn từ quảng cáo đã về đủ) — Trợ lý bật lại chiến dịch.`
      : `Cửa sổ ${WINDOW_LABEL[window]}: ROAS ${roasTxt(roas)} chưa vượt ${roasTxt(threshold)} — giữ tạm dừng.`,
  };
}

/** Kết quả một cú ghi lên sàn — error là NGUYÊN VĂN để ghi sổ. */
export type ActOutcome = { ok: boolean; error: string | null };

export interface AdsActor {
  pause: (campaignId: string, referenceId: string) => Promise<ActOutcome>;
  resume: (campaignId: string, referenceId: string) => Promise<ActOutcome>;
  /** ĐỢT B — đổi ngân sách ngày (Shopee change_budget). Lazada: từ chối ngay, không gọi sàn. */
  changeBudget: (campaignId: string, budget: number, referenceId: string) => Promise<ActOutcome>;
  /** Sàn có lệnh đổi ngân sách qua API không (Shopee có, Lazada chưa). */
  budgetWriteSupported: boolean;
}

/**
 * Dựng hàm pause/resume theo sàn của gian (token lấy MỘT lần).
 * Shopee: edit_manual_product_ads edit_action pause|resume (kèm referenceId lên
 * sàn — sàn từ chối reference trùng, nên mỗi lệnh một mã). Lazada: updateCampaign
 * switchStatus 0|1 (idempotency chỉ nằm ở sổ phía mình — tắt một campaign đã
 * tắt là vô hại).
 */
export async function makeActor(channel: Channel): Promise<AdsActor> {
  if (channel.channelName === ChannelName.LAZADA) {
    const accessToken = await getValidLazadaAccessToken(channel);
    const call = async (campaignId: string, switchStatus: 0 | 1): Promise<ActOutcome> => {
      const raw = await updateAdsCampaignSwitchRaw({ accessToken, campaignId, switchStatus });
      const ok = lazAdsWriteOk(raw);
      return {
        ok,
        error: ok
          ? null
          : `${raw.code ?? ""} ${raw.errorMsg ?? raw.message ?? ""}`.trim() ||
            "Lazada từ chối, không kèm lý do",
      };
    };
    return {
      pause: (campaignId) => call(campaignId, 0),
      resume: (campaignId) => call(campaignId, 1),
      changeBudget: async () => ({
        ok: false,
        error: "Lazada: Hubsell chưa có lệnh đổi ngân sách qua API — chỉnh trên Seller Center.",
      }),
      budgetWriteSupported: false,
    };
  }
  // Ghi lên sàn cũng đi qua điểm chốt Hubsell Ads (cùng partner với luồng đọc).
  const { accessToken, shopId, cfg } = await resolveShopeeAdsAccess(channel);
  const call = async (
    campaignId: string,
    editAction: "pause" | "resume" | "change_budget",
    referenceId: string,
    budget?: number
  ): Promise<ActOutcome> => {
    const raw = await editManualProductAdsRaw(
      { accessToken, shopId, campaignId, editAction, referenceId, budget },
      cfg
    );
    const ok = !raw.error || raw.error === "";
    return { ok, error: ok ? null : `${raw.error}: ${raw.message ?? ""}` };
  };
  return {
    pause: (campaignId, ref) => call(campaignId, "pause", ref),
    resume: (campaignId, ref) => call(campaignId, "resume", ref),
    changeBudget: (campaignId, budget, ref) => call(campaignId, "change_budget", ref, budget),
    budgetWriteSupported: true,
  };
}

/** Sàn nào có lệnh đổi ngân sách qua API (không cần token để biết). */
export function budgetWriteSupportedFor(channel: Pick<Channel, "channelName">): boolean {
  return channel.channelName === ChannelName.SHOPEE;
}

const vndTxt = (n: number) => `${Math.round(n).toLocaleString("vi-VN")}₫`;

/**
 * ĐỢT B — TRẢ NGÂN SÁCH GỐC cho campaign có cờ hạ (sau khi bật lại thành công,
 * hoặc chủ shop bấm "Trả lại ngân sách"). Ghi sổ riêng action restore_budget;
 * sàn từ chối thì GIỮ cờ (lần bật lại sau / người bấm lại vẫn trả được).
 */
async function restoreBudgetWithActor(input: {
  channel: Channel;
  actor: AdsActor;
  row: { id: string; campaignId: string; name: string; hubsellBudgetBefore: Prisma.Decimal | null; hubsellBudgetCut: Prisma.Decimal | null };
  mode: string;
  referenceId: string;
  reason: string;
}): Promise<ActOutcome> {
  const { channel, actor, row } = input;
  if (row.hubsellBudgetBefore == null) return { ok: true, error: null };
  const before = Number(row.hubsellBudgetBefore);
  const cut = row.hubsellBudgetCut != null ? Number(row.hubsellBudgetCut) : null;
  const log = await prisma.adsActionLog.create({
    data: {
      channelId: channel.id,
      adsCampaignId: row.id,
      action: "restore_budget",
      mode: input.mode,
      verdict: "",
      reasons: `${input.reason} Trả ngân sách ngày ${cut != null ? vndTxt(cut) : "—"} → ${before > 0 ? vndTxt(before) : "không giới hạn"} (số trước khi Trợ lý hạ).`,
      referenceId: input.referenceId,
      status: "PENDING",
    },
  });
  let outcome: ActOutcome;
  try {
    // Shopee: ngân sách 0 = không giới hạn theo docs (campaign_budget 0) — gửi đúng số gốc.
    outcome = await actor.changeBudget(row.campaignId, before, input.referenceId);
  } catch (err) {
    outcome = { ok: false, error: String((err as Error).message).slice(0, 1000) };
  }
  await prisma.adsActionLog.update({
    where: { id: log.id },
    data: { status: outcome.ok ? "SUCCESS" : "FAILED", error: outcome.error?.slice(0, 1000) ?? null },
  });
  if (outcome.ok) await clearHubsellBudgetFlag(row.id, { budget: before });
  return outcome;
}

/**
 * ĐỢT B — CHỦ SHOP BẤM "TRẢ LẠI NGÂN SÁCH" trong Hubsell cho campaign Trợ lý đã
 * hạ (campaign vẫn chạy, chỉ trả số gốc). Lệnh thật, ghi sổ mode manual, chỉ Shopee.
 */
export async function restoreBudgetByOwner(
  channel: Channel,
  rowId: string
): Promise<ActOutcome & { budget: number | null }> {
  const row = await prisma.adsCampaign.findFirst({ where: { id: rowId, channelId: channel.id } });
  if (!row) return { ok: false, error: "Không tìm thấy chiến dịch", budget: null };
  if (row.hubsellBudgetCutAt == null || row.hubsellBudgetBefore == null) {
    return { ok: false, error: "Chiến dịch này không do Trợ lý hạ ngân sách — chỉnh trên Seller Center.", budget: null };
  }
  if (!budgetWriteSupportedFor(channel)) {
    return { ok: false, error: "Đổi ngân sách trong Hubsell mới hỗ trợ Shopee.", budget: null };
  }
  let outcome: ActOutcome;
  try {
    const actor = await makeActor(channel);
    outcome = await restoreBudgetWithActor({
      channel,
      actor,
      row,
      mode: "manual",
      referenceId: `restore-${row.id}-manual-${Date.now()}`,
      reason: "Chủ shop bấm Trả lại ngân sách trong Hubsell.",
    });
  } catch (err) {
    outcome = { ok: false, error: String((err as Error).message).slice(0, 1000) };
  }
  if (outcome.ok) {
    await prisma.opsActivity.create({
      data: {
        ownerId: channel.userId,
        tag: "ads",
        message: `💰 Chủ shop trả lại ngân sách chiến dịch "${row.name || `#${row.campaignId}`}" (gian "${channel.shopName}") về ${Number(row.hubsellBudgetBefore) > 0 ? vndTxt(Number(row.hubsellBudgetBefore)) : "không giới hạn"} ngay trong Hubsell.`,
      },
    });
  }
  return { ...outcome, budget: outcome.ok ? Number(row.hubsellBudgetBefore) : null };
}

/**
 * SELLER BẤM "TẠM DỪNG" TRONG HUBSELL (25/09, anh Trung: "bất tiện khi phải mở Seller Center
 * mới dừng được"). Lệnh thật ngay, không qua luật, không phụ thuộc mode; ghi sổ mode "manual".
 * KHÔNG cắm cờ hubsellPausedAt: theo máy trạng thái 14/09, người dừng → máy KHÔNG BAO GIỜ tự bật lại.
 * Shopee: edit_manual_product_ads pause (đã bắn sống 14/09); Lazada: switch 0.
 */
export async function pauseCampaignByOwner(
  channel: Channel,
  rowId: string
): Promise<ActOutcome & { status: string }> {
  const row = await prisma.adsCampaign.findFirst({ where: { id: rowId, channelId: channel.id } });
  if (!row) return { ok: false, error: "Không tìm thấy chiến dịch", status: "" };
  if (row.status !== "ongoing") {
    return { ok: false, error: "Chiến dịch không đang chạy — không có gì để tạm dừng.", status: row.status };
  }
  const referenceId = `pause-${row.id}-manual-${Date.now()}`;
  const log = await prisma.adsActionLog.create({
    data: {
      channelId: channel.id,
      adsCampaignId: row.id,
      action: "pause",
      mode: "manual",
      verdict: "",
      reasons: "Chủ shop bấm Tạm dừng trong Hubsell.",
      referenceId,
      status: "PENDING",
    },
  });
  let outcome: ActOutcome;
  try {
    const actor = await makeActor(channel);
    outcome = await actor.pause(row.campaignId, referenceId);
  } catch (err) {
    outcome = { ok: false, error: String((err as Error).message).slice(0, 1000) };
  }
  await prisma.adsActionLog.update({
    where: { id: log.id },
    data: { status: outcome.ok ? "SUCCESS" : "FAILED", error: outcome.error?.slice(0, 1000) ?? null },
  });
  if (outcome.ok) {
    await prisma.adsCampaign.update({ where: { id: row.id }, data: { status: "paused" } });
    await prisma.opsActivity.create({
      data: {
        ownerId: channel.userId,
        tag: "ads",
        message: `⏸️ Chủ shop tạm dừng chiến dịch "${row.name || `#${row.campaignId}`}" (gian "${channel.shopName}") ngay trong Hubsell.`,
      },
    });
  }
  return { ...outcome, status: outcome.ok ? "paused" : row.status };
}

/**
 * SELLER BẤM "BẬT LẠI" TRONG HUBSELL (thẻ Trung tâm điều hành / bảng chiến
 * dịch) cho campaign đã tạm dừng (Trợ lý hoặc người dừng): gọi lệnh thật ngay,
 * không qua luật, không phụ thuộc mode. Ghi sổ mode "manual" để phân biệt với máy.
 */
export async function resumeCampaignByOwner(
  channel: Channel,
  rowId: string
): Promise<ActOutcome & { status: string }> {
  const row = await prisma.adsCampaign.findFirst({
    where: { id: rowId, channelId: channel.id },
  });
  if (!row) return { ok: false, error: "Không tìm thấy chiến dịch", status: "" };
  // 25/09: bật lại được cả campaign do người tạm dừng (nút Tạm dừng trong Hubsell / Seller Center),
  // không chỉ campaign Trợ lý dừng — API resume của sàn không phân biệt ai đã dừng.
  if (row.hubsellPausedAt == null && row.status !== "paused") {
    return {
      ok: false,
      error: "Chiến dịch không ở trạng thái tạm dừng — không có gì để bật lại.",
      status: row.status,
    };
  }
  const referenceId = `resume-${row.id}-manual-${Date.now()}`;
  const log = await prisma.adsActionLog.create({
    data: {
      channelId: channel.id,
      adsCampaignId: row.id,
      action: "resume",
      mode: "manual",
      verdict: "",
      reasons: "Chủ shop bấm Bật lại trong Hubsell.",
      referenceId,
      status: "PENDING",
    },
  });
  let outcome: ActOutcome;
  try {
    const actor = await makeActor(channel);
    outcome = await actor.resume(row.campaignId, referenceId);
  } catch (err) {
    outcome = { ok: false, error: String((err as Error).message).slice(0, 1000) };
  }
  await prisma.adsActionLog.update({
    where: { id: log.id },
    data: { status: outcome.ok ? "SUCCESS" : "FAILED", error: outcome.error?.slice(0, 1000) ?? null },
  });
  if (outcome.ok) {
    // Người bật lại = ván mới (cycle+1) dù trước đó ai dừng — máy đủ quyền như campaign mới.
    await clearHubsellPauseFlag(row.id, row.hubsellPauseCycle, { status: "ongoing" });
    await prisma.opsActivity.create({
      data: {
        ownerId: channel.userId,
        tag: "ads",
        message: `▶️ Chủ shop bật lại chiến dịch "${row.name || `#${row.campaignId}`}" (gian "${channel.shopName}") ngay trong Hubsell.`,
      },
    });
    // ĐỢT B: bật lại thì trả ngân sách gốc (nếu Trợ lý từng hạ). Lỗi giữ cờ, sổ có dòng FAILED.
    if (row.hubsellBudgetBefore != null) {
      try {
        const actor = await makeActor(channel);
        await restoreBudgetWithActor({
          channel,
          actor,
          row,
          mode: "manual",
          referenceId: `restore-${row.id}-manual-${Date.now()}`,
          reason: "Chủ shop bật lại chiến dịch trong Hubsell.",
        });
      } catch (err) {
        console.warn(`[Ads] Trả ngân sách sau khi bật lại lỗi "${row.name}":`, (err as Error).message);
      }
    }
  }
  return { ...outcome, status: outcome.ok ? "ongoing" : row.status };
}

export async function runAdsAutoExecute(
  channel: Channel
): Promise<AutoExecuteResult> {
  const insights = await computeChannelAdsInsights({
    id: channel.id,
    userId: channel.userId,
    channelName: channel.channelName,
  });
  const auto: ShopeeAssistantConfig["autoExecute"] = insights.config.autoExecute;

  const result: AutoExecuteResult = {
    mode: auto.mode,
    candidates: 0,
    planned: 0,
    executed: 0,
    failed: 0,
    skippedQuota: 0,
    skippedDone: 0,
    resumed: 0,
    resumeFailed: 0,
    budgetCut: 0,
    budgetCutFailed: 0,
    budgetRestored: 0,
  };
  if (auto.mode === "off" || !insights.config.enabled) return result;

  const todayKey = vnDateKey(0);
  const budgetWriteSupported = budgetWriteSupportedFor(channel);
  const startOfVnToday = new Date(`${todayKey}T00:00:00+07:00`);

  /**
   * ĐỢT B — nấc hạ ngân sách đã qua chưa trong ván này? Live: đọc cờ trên campaign
   * (số thật đã đổi trên sàn). Diễn tập: không đổi gì trên sàn nên đọc SỔ — có dòng
   * cut_budget PLANNED cùng ván (referenceId đuôi -c{cycle}) là đã "diễn" nấc đó.
   */
  const cutStateOf = async (it: CampaignInsight): Promise<BudgetCutState> => {
    if (auto.mode === "live") {
      if (it.row.hubsellBudgetCutAt == null) return "none";
      return it.row.hubsellBudgetCutOn === todayKey ? "today" : "earlier";
    }
    const prior = await prisma.adsActionLog.findFirst({
      where: {
        adsCampaignId: it.row.id,
        action: "cut_budget",
        mode: "dry_run",
        referenceId: { endsWith: `-c${it.row.hubsellPauseCycle}` },
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (!prior) return "none";
    return prior.createdAt >= startOfVnToday ? "today" : "earlier";
  };

  const pauseCandidates: PlannedAutoAction[] = [];
  for (const it of selectAutoActionCandidates(insights.items, todayKey)) {
    const planned = planAutoAction(it, insights.config, {
      budgetWriteSupported,
      cutState: await cutStateOf(it),
    });
    if (planned) pauseCandidates.push(planned);
  }
  // Bật lại chỉ có nghĩa ở mode live (diễn tập không dừng thật nên không có gì để bật).
  const resumeCandidates =
    auto.mode === "live"
      ? insights.items
          .map((it) => ({ it, check: shouldAutoResume(it, insights.config) }))
          .filter((x) => x.check.ok)
      : [];
  result.candidates = pauseCandidates.length + resumeCandidates.length;
  if (result.candidates === 0) return result;

  // Quota: đếm hành động ĐÃ ghi sổ hôm nay (giờ VN) của gian — mọi status đều
  // tính (FAILED cũng là một lần thao tác về phía sàn ở mode live).
  let usedToday = await prisma.adsActionLog.count({
    where: { channelId: channel.id, createdAt: { gte: startOfVnToday }, mode: { not: MARKETPLACE_LOG_MODE } },
  });

  // Token chỉ cần cho mode live — lấy MỘT lần ngoài vòng lặp (theo sàn).
  let actor: AdsActor | null = null;
  if (auto.mode === "live") {
    actor = await makeActor(channel);
  }

  /** Ghi sổ bằng khóa unique — trùng nghĩa là ván này hôm nay đã hành động. */
  const openLog = async (input: {
    rowId: string;
    action: "pause" | "resume" | "cut_budget";
    verdict: string;
    reasons: string[];
    referenceId: string;
  }): Promise<string | null> => {
    const existed = await prisma.adsActionLog.findUnique({
      where: { referenceId: input.referenceId },
      select: { id: true },
    });
    if (existed) return null;
    try {
      const log = await prisma.adsActionLog.create({
        data: {
          channelId: channel.id,
          adsCampaignId: input.rowId,
          action: input.action,
          mode: auto.mode,
          verdict: input.verdict,
          reasons: input.reasons.join("\n"),
          referenceId: input.referenceId,
          status: auto.mode === "dry_run" ? "PLANNED" : "PENDING",
        },
      });
      return log.id;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return null; // race giữa hai sweep sát nhau — coi như đã làm
      }
      throw err;
    }
  };

  const closeLog = async (logId: string, outcome: ActOutcome) => {
    await prisma.adsActionLog.update({
      where: { id: logId },
      data: {
        status: outcome.ok ? "SUCCESS" : "FAILED",
        error: outcome.ok ? null : (outcome.error ?? "").slice(0, 1000),
      },
    });
  };

  // ---- BẬT LẠI TRƯỚC (rẻ, đang mất doanh thu từng giờ) ----
  for (const { it, check } of resumeCandidates) {
    if (usedToday >= auto.maxActionsPerDay) {
      result.skippedQuota++;
      continue;
    }
    const referenceId = `resume-${it.row.id}-${todayKey}-c${it.row.hubsellPauseCycle}`;
    const logId = await openLog({
      rowId: it.row.id,
      action: "resume",
      verdict: RESUME_VERDICT,
      reasons: [check.reason],
      referenceId,
    });
    if (!logId) {
      result.skippedDone++;
      continue;
    }
    usedToday++;
    let outcome: ActOutcome;
    try {
      outcome = await actor!.resume(it.row.campaignId, referenceId);
    } catch (err) {
      outcome = { ok: false, error: String((err as Error).message) };
    }
    await closeLog(logId, outcome);
    if (outcome.ok) {
      result.resumed++;
      // ĐỢT B: máy tự bật lại → trả ngân sách gốc nếu chính máy đã hạ (cùng ván, trước khi cycle+1).
      if (it.row.hubsellBudgetBefore != null && usedToday < auto.maxActionsPerDay) {
        usedToday++;
        const restored = await restoreBudgetWithActor({
          channel,
          actor: actor!,
          row: it.row,
          mode: auto.mode,
          referenceId: `restore-${it.row.id}-${todayKey}-c${it.row.hubsellPauseCycle}`,
          reason: "Trợ lý bật lại chiến dịch (ROAS đã đạt lại).",
        });
        if (restored.ok) result.budgetRestored++;
      }
      await clearHubsellPauseFlag(it.row.id, it.row.hubsellPauseCycle, {
        status: "ongoing",
        hubsellResumedOn: todayKey,
      });
    } else {
      result.resumeFailed++;
    }
  }

  // ---- HẠ NGÂN SÁCH (đợt B) / TẠM DỪNG ----
  for (const planned of pauseCandidates) {
    const it = planned.it;
    if (usedToday >= auto.maxActionsPerDay) {
      result.skippedQuota++;
      continue;
    }
    const isCut = planned.kind === "cut_budget" && planned.cut != null;
    const referenceId = `${isCut ? "cut" : "pause"}-${it.row.id}-${todayKey}-c${it.row.hubsellPauseCycle}`;
    const reasons = isCut
      ? [
          ...it.assessment.reasons,
          `${planned.cut!.basis} Hạ ngân sách trước, ngày mai vẫn lỗ mới tạm dừng (giữ campaign sống để không mất học máy).`,
        ]
      : it.row.hubsellBudgetCutAt != null
        ? [
            ...it.assessment.reasons,
            `Đã hạ ngân sách ngày ${it.row.hubsellBudgetCutOn ? `hôm ${it.row.hubsellBudgetCutOn.slice(8, 10)}/${it.row.hubsellBudgetCutOn.slice(5, 7)}` : "trước đó"} mà vẫn lỗ — tạm dừng.`,
          ]
        : it.assessment.reasons;
    const logId = await openLog({
      rowId: it.row.id,
      action: isCut ? "cut_budget" : "pause",
      verdict: it.assessment.verdict ?? "",
      reasons,
      referenceId,
    });
    if (!logId) {
      result.skippedDone++;
      continue;
    }
    usedToday++;

    if (auto.mode === "dry_run") {
      result.planned++;
      continue;
    }

    // ---- MODE LIVE: gọi sàn, ghi nguyên văn kết quả vào sổ, cắm cờ Hubsell ----
    let outcome: ActOutcome;
    if (isCut) {
      try {
        outcome = await actor!.changeBudget(it.row.campaignId, planned.cut!.newBudget, referenceId);
      } catch (err) {
        outcome = { ok: false, error: String((err as Error).message) };
      }
      await closeLog(logId, outcome);
      if (outcome.ok) {
        result.budgetCut++;
        await prisma.adsCampaign.update({
          where: { id: it.row.id },
          data: {
            budget: planned.cut!.newBudget,
            hubsellBudgetCutAt: new Date(),
            hubsellBudgetBefore: Number(it.row.budget),
            hubsellBudgetCut: planned.cut!.newBudget,
            hubsellBudgetCutLogId: logId,
            hubsellBudgetCutOn: todayKey,
          },
        });
        // Máy làm gì cũng phải nói (14/09): nhật ký vận hành ngay, chuông qua scanOpsAlerts.
        await prisma.opsActivity.create({
          data: {
            ownerId: channel.userId,
            tag: "ads",
            message: `✂️ Trợ lý hạ ngân sách ngày chiến dịch "${it.row.name || `#${it.row.campaignId}`}" (gian "${channel.shopName}") ${Number(it.row.budget) > 0 ? vndTxt(Number(it.row.budget)) : "không giới hạn"} → ${vndTxt(planned.cut!.newBudget)} vì đang lỗ — ngày mai vẫn lỗ mới tạm dừng; bật lại sẽ trả số cũ.`,
          },
        });
      } else {
        result.budgetCutFailed++;
      }
      continue;
    }
    try {
      outcome = await actor!.pause(it.row.campaignId, referenceId);
    } catch (err) {
      outcome = { ok: false, error: String((err as Error).message) };
    }
    await closeLog(logId, outcome);
    if (outcome.ok) {
      result.executed++;
      // Phản chiếu ngay vào bảng campaign cho UI + CỜ NGUỒN DỪNG — sweep sau
      // sync lại trạng thái thật; thấy "ongoing" trong khi cờ còn = người bật lại.
      await prisma.adsCampaign.update({
        where: { id: it.row.id },
        data: {
          status: "paused",
          hubsellPausedAt: new Date(),
          hubsellPauseLogId: logId,
          hubsellPauseWindow: it.assessment.window ?? "today",
        },
      });
    } else {
      result.failed++;
    }
  }

  return result;
}

/** Tổng hành động có thật trong một lượt — worker dùng để ép quét cảnh báo ngay. */
export function autoExecuteTouched(r: AutoExecuteResult): boolean {
  return (
    r.planned + r.executed + r.failed + r.resumed + r.resumeFailed + r.budgetCut + r.budgetCutFailed + r.budgetRestored >
    0
  );
}


/**
 * ĐỢT A (17/09) — CHỦ SHOP NÂNG MỤC TIÊU ROAS ngay trong Hubsell cho campaign
 * đấu thầu tự động đang đặt mục tiêu dưới hòa vốn. Lệnh thật lên sàn
 * (edit_manual_product_ads change_roas_target — enum có trong docs, xác minh
 * sống bằng chính lần bấm đầu), ghi sổ mode "manual" như Bật lại. Chỉ Shopee.
 */
export async function setRoasTargetByOwner(
  channel: Channel,
  rowId: string,
  roasTarget: number
): Promise<ActOutcome & { roasTarget: number }> {
  const target = Math.round(roasTarget * 10) / 10; // Shopee lấy 1 số lẻ
  if (channel.channelName !== ChannelName.SHOPEE) {
    return { ok: false, error: "Đổi mục tiêu ROAS trong Hubsell mới hỗ trợ Shopee.", roasTarget: target };
  }
  if (!(target > 0) || target > 999) {
    return { ok: false, error: "Mục tiêu ROAS phải là số dương (ví dụ 7,3).", roasTarget: target };
  }
  const row = await prisma.adsCampaign.findFirst({ where: { id: rowId, channelId: channel.id } });
  if (!row) return { ok: false, error: "Không tìm thấy chiến dịch", roasTarget: target };
  if (row.biddingMethod !== "auto") {
    return {
      ok: false,
      error: "Chiến dịch này đấu thầu thủ công (không có mục tiêu ROAS) — chỉnh giá thầu trên Seller Center.",
      roasTarget: target,
    };
  }
  const prev = row.roasTarget != null ? Number(row.roasTarget) : null;
  const referenceId = `roas-${row.id}-manual-${Date.now()}`;
  const log = await prisma.adsActionLog.create({
    data: {
      channelId: channel.id,
      adsCampaignId: row.id,
      action: "change_roas_target",
      mode: "manual",
      verdict: "",
      reasons: `Chủ shop đổi mục tiêu ROAS ${prev != null ? `${prev}x` : "(chưa đặt)"} → ${target}x trong Hubsell.`,
      referenceId,
      status: "PENDING",
    },
  });
  let outcome: ActOutcome;
  try {
    const { accessToken, shopId, cfg } = await resolveShopeeAdsAccess(channel);
    const raw = await editManualProductAdsRaw(
      { accessToken, shopId, campaignId: row.campaignId, editAction: "change_roas_target", referenceId, roasTarget: target },
      cfg
    );
    const ok = !raw.error || raw.error === "";
    outcome = { ok, error: ok ? null : `${raw.error}: ${raw.message ?? ""}` };
  } catch (err) {
    outcome = { ok: false, error: String((err as Error).message).slice(0, 1000) };
  }
  await prisma.adsActionLog.update({
    where: { id: log.id },
    data: { status: outcome.ok ? "SUCCESS" : "FAILED", error: outcome.error?.slice(0, 1000) ?? null },
  });
  if (outcome.ok) {
    // Ghi ngay để bảng đổi màu tức thì; xung 30' kế sẽ đọc lại từ sàn xác nhận.
    await prisma.adsCampaign.update({ where: { id: row.id }, data: { roasTarget: target } });
    await prisma.opsActivity.create({
      data: {
        ownerId: channel.userId,
        tag: "ads",
        message: `🎯 Chủ shop nâng mục tiêu ROAS chiến dịch "${row.name || `#${row.campaignId}`}" (gian "${channel.shopName}") ${prev != null ? `${prev}x` : "—"} → ${target}x ngay trong Hubsell.`,
      },
    });
  }
  return { ...outcome, roasTarget: target };
}
