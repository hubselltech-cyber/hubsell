// ============================================================
// TRỢ LÝ QUẢNG CÁO — GĐ3: TỰ THỰC THI (EXECUTOR DÙNG CHUNG SHOPEE + LAZADA)
//
// Chạy kèm xung ads trong order-auto-sync, NGAY SAU sync campaign của sàn
// (đánh giá trên số vừa sync). Hai hành động:
//   PAUSE  campaign dính verdict pause_now / spike — cắt lỗ.
//   RESUME campaign CHÍNH HUBSELL đã dừng khi ROAS cửa sổ đã kích đạt lại
//          hòa vốn × hệ số an toàn (sự cố 14/09/2026: đơn broad về trễ nên
//          một lần dừng sai phải tự đảo được, seller không phải trực).
// Không đụng budget/bid/keyword.
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
  type AssistantWindowKey,
  type ShopeeAssistantConfig,
} from "./ads-assistant-rules";
import { clearHubsellPauseFlag } from "./ads-pause-flag";

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
}

const vnd = (n: number) => `${Math.round(n).toLocaleString("vi-VN")}₫`;
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
    };
  }
  // Ghi lên sàn cũng đi qua điểm chốt Hubsell Ads (cùng partner với luồng đọc).
  const { accessToken, shopId, cfg } = await resolveShopeeAdsAccess(channel);
  const call = async (
    campaignId: string,
    editAction: "pause" | "resume",
    referenceId: string
  ): Promise<ActOutcome> => {
    const raw = await editManualProductAdsRaw(
      { accessToken, shopId, campaignId, editAction, referenceId },
      cfg
    );
    const ok = !raw.error || raw.error === "";
    return { ok, error: ok ? null : `${raw.error}: ${raw.message ?? ""}` };
  };
  return {
    pause: (campaignId, ref) => call(campaignId, "pause", ref),
    resume: (campaignId, ref) => call(campaignId, "resume", ref),
  };
}

/**
 * SELLER BẤM "BẬT LẠI" TRONG HUBSELL (thẻ Trung tâm điều hành / bảng chiến
 * dịch) cho campaign Trợ lý đã dừng: gọi lệnh thật ngay, không qua luật, không
 * phụ thuộc mode. Ghi sổ mode "manual" để phân biệt với máy.
 */
export async function resumeCampaignByOwner(
  channel: Channel,
  rowId: string
): Promise<ActOutcome & { status: string }> {
  const row = await prisma.adsCampaign.findFirst({
    where: { id: rowId, channelId: channel.id },
  });
  if (!row) return { ok: false, error: "Không tìm thấy chiến dịch", status: "" };
  if (row.hubsellPausedAt == null) {
    return {
      ok: false,
      error: "Chiến dịch này không do Trợ lý tạm dừng — bật lại trên Seller Center.",
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
    await clearHubsellPauseFlag(row.id, row.hubsellPauseCycle, { status: "ongoing" });
    await prisma.opsActivity.create({
      data: {
        ownerId: channel.userId,
        tag: "ads",
        message: `▶️ Chủ shop bật lại chiến dịch "${row.name || `#${row.campaignId}`}" (gian "${channel.shopName}") ngay trong Hubsell.`,
      },
    });
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
  };
  if (auto.mode === "off" || !insights.config.enabled) return result;

  const todayKey = vnDateKey(0);
  const pauseCandidates = selectAutoActionCandidates(insights.items, todayKey);
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
  const startOfVnToday = new Date(`${todayKey}T00:00:00+07:00`);
  let usedToday = await prisma.adsActionLog.count({
    where: { channelId: channel.id, createdAt: { gte: startOfVnToday } },
  });

  // Token chỉ cần cho mode live — lấy MỘT lần ngoài vòng lặp (theo sàn).
  let actor: AdsActor | null = null;
  if (auto.mode === "live") {
    actor = await makeActor(channel);
  }

  /** Ghi sổ bằng khóa unique — trùng nghĩa là ván này hôm nay đã hành động. */
  const openLog = async (input: {
    rowId: string;
    action: "pause" | "resume";
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
      await clearHubsellPauseFlag(it.row.id, it.row.hubsellPauseCycle, {
        status: "ongoing",
        hubsellResumedOn: todayKey,
      });
    } else {
      result.resumeFailed++;
    }
  }

  // ---- TẠM DỪNG ----
  for (const it of pauseCandidates) {
    if (usedToday >= auto.maxActionsPerDay) {
      result.skippedQuota++;
      continue;
    }
    const referenceId = `pause-${it.row.id}-${todayKey}-c${it.row.hubsellPauseCycle}`;
    const logId = await openLog({
      rowId: it.row.id,
      action: "pause",
      verdict: it.assessment.verdict ?? "",
      reasons: it.assessment.reasons,
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
  return r.planned + r.executed + r.failed + r.resumed + r.resumeFailed > 0;
}

export { vnd as formatVndForAds };
