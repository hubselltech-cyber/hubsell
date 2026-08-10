// ============================================================
// TRỢ LÝ QUẢNG CÁO SHOPEE — GĐ3: TỰ THỰC THI (EXECUTOR)
//
// Chạy kèm nhịp đối soát trong order-auto-sync, NGAY SAU syncShopeeAdsCampaigns
// (đánh giá trên số vừa sync). v1 chỉ có MỘT hành động: PAUSE campaign dính
// verdict pause_now / spike — cắt lỗ, không đụng budget/bid/keyword.
//
// BA CHỐT AN TOÀN (thứ tự kiểm):
//   1. Mode per-gian trong AdsAssistantConfig.autoExecute:
//      off (mặc định) | dry_run (DIỄN TẬP: ghi sổ, KHÔNG gọi sàn) | live.
//      Chỉ bật live sau khi probe xác minh enum edit_action (bài học MISA:
//      không đoán API) — về mặt code, live gọi editManualProductAdsRaw và ghi
//      NGUYÊN VĂN lỗi sàn vào sổ để có tư liệu chỉnh enum.
//   2. Idempotency: referenceId "pause-{campaignRowId}-{yyyy-mm-dd}" unique
//      trong AdsActionLog → mỗi campaign tối đa 1 hành động/ngày, sweep chạy
//      lặp mỗi giờ không bắn trùng (P2002 = đã hành động, bỏ qua êm).
//   3. Quota maxActionsPerDay per-gian (đệm dưới giới hạn sàn ~10 thao tác/
//      item/ngày) — ưu tiên campaign ĐANG TIÊU NHIỀU nhất trước (cắt chỗ chảy
//      máu to trước khi hết quota).
//
// Chủ shop đã tự quyết cảnh báo (decisionActive) thì executor KHÔNG đụng vào —
// người luôn thắng máy.
// ============================================================

import { Prisma, type Channel } from "@prisma/client";
import { prisma } from "../../prisma";
import { editManualProductAdsRaw } from "./client";
import { getValidShopeeAccessToken } from "./service";
import {
  computeChannelAdsInsights,
  vnDateKey,
  type CampaignInsight,
} from "./ads-insights";
import type { ShopeeAssistantConfig } from "./ads-assistant-rules";

/** Verdict nào thì được phép hành động (v1: chỉ hai loại chắc tay nhất). */
const ACTIONABLE_VERDICTS = new Set(["pause_now", "spike"]);

export interface AutoExecuteResult {
  mode: "off" | "dry_run" | "live";
  candidates: number; // campaign dính verdict đáng hành động
  planned: number; // dry_run: số hành động đã ghi sổ diễn tập
  executed: number; // live: gọi sàn thành công
  failed: number; // live: sàn từ chối (lỗi lưu nguyên văn trong sổ)
  skippedQuota: number; // bỏ qua vì chạm trần hành động/ngày
  skippedDone: number; // bỏ qua vì hôm nay đã hành động rồi (referenceId trùng)
}

/** Quyết định của chủ shop còn hiệu lực → executor nhường người. */
function decisionActive(insight: CampaignInsight): boolean {
  const c = insight.row;
  return (
    c.assistantDecision !== "" &&
    insight.assessment.verdict !== null &&
    c.assistantDecisionVerdict === insight.assessment.verdict
  );
}

/**
 * LỌC + XẾP HÀNG hành động — logic thuần tách riêng cho vitest:
 * chỉ campaign ongoing, verdict đáng hành động, chưa bị người quyết;
 * xếp theo chi tiêu 7 ngày giảm dần (cắt chỗ chảy máu to trước).
 */
export function selectAutoActionCandidates(
  items: CampaignInsight[]
): CampaignInsight[] {
  return items
    .filter(
      (it) =>
        it.row.status === "ongoing" &&
        it.assessment.verdict !== null &&
        ACTIONABLE_VERDICTS.has(it.assessment.verdict) &&
        !decisionActive(it)
    )
    .sort((a, b) => b.windows["7d"].spend - a.windows["7d"].spend);
}

export async function runShopeeAdsAutoExecute(
  channel: Channel
): Promise<AutoExecuteResult> {
  const insights = await computeChannelAdsInsights({
    id: channel.id,
    userId: channel.userId,
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
  };
  if (auto.mode === "off" || !insights.config.enabled) return result;

  const candidates = selectAutoActionCandidates(insights.items);
  result.candidates = candidates.length;
  if (candidates.length === 0) return result;

  // Quota: đếm hành động ĐÃ ghi sổ hôm nay (giờ VN) của gian — mọi status đều
  // tính (FAILED cũng là một lần thao tác về phía sàn ở mode live).
  const todayKey = vnDateKey(0);
  const startOfVnToday = new Date(`${todayKey}T00:00:00+07:00`);
  let usedToday = await prisma.adsActionLog.count({
    where: { channelId: channel.id, createdAt: { gte: startOfVnToday } },
  });

  // Token chỉ cần cho mode live — lấy MỘT lần ngoài vòng lặp.
  let live: { accessToken: string; shopId: string } | null = null;
  if (auto.mode === "live") {
    live = await getValidShopeeAccessToken(channel);
  }

  for (const it of candidates) {
    if (usedToday >= auto.maxActionsPerDay) {
      result.skippedQuota++;
      continue;
    }
    const referenceId = `pause-${it.row.id}-${todayKey}`;

    // Đã hành động hôm nay? Check trước cho êm log (Prisma in prisma:error ầm ĩ
    // khi create đụng unique dù mình catch); P2002 bên dưới vẫn là chốt cuối
    // chống race giữa hai sweep chạy sát nhau.
    const existed = await prisma.adsActionLog.findUnique({
      where: { referenceId },
      select: { id: true },
    });
    if (existed) {
      result.skippedDone++;
      continue;
    }

    // Ghi sổ bằng khóa unique — trùng nghĩa là hôm nay đã hành động.
    let logId: string;
    try {
      const log = await prisma.adsActionLog.create({
        data: {
          channelId: channel.id,
          adsCampaignId: it.row.id,
          action: "pause",
          mode: auto.mode,
          verdict: it.assessment.verdict ?? "",
          reasons: it.assessment.reasons.join("\n"),
          referenceId,
          status: auto.mode === "dry_run" ? "PLANNED" : "PENDING",
        },
      });
      logId = log.id;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        result.skippedDone++;
        continue;
      }
      throw err;
    }
    usedToday++;

    if (auto.mode === "dry_run") {
      result.planned++;
      continue;
    }

    // ---- MODE LIVE: gọi sàn, ghi nguyên văn kết quả vào sổ ----
    try {
      const raw = await editManualProductAdsRaw({
        accessToken: live!.accessToken,
        shopId: live!.shopId,
        campaignId: it.row.campaignId,
        editAction: "pause",
        referenceId,
      });
      const ok = !raw.error || raw.error === "";
      await prisma.adsActionLog.update({
        where: { id: logId },
        data: {
          status: ok ? "SUCCESS" : "FAILED",
          error: ok ? null : `${raw.error}: ${raw.message ?? ""}`.slice(0, 1000),
        },
      });
      if (ok) {
        result.executed++;
        // Phản chiếu ngay vào bảng campaign cho UI — sweep sau sync lại số thật.
        await prisma.adsCampaign.update({
          where: { id: it.row.id },
          data: { status: "paused" },
        });
      } else {
        result.failed++;
      }
    } catch (err) {
      result.failed++;
      await prisma.adsActionLog.update({
        where: { id: logId },
        data: {
          status: "FAILED",
          error: String((err as Error).message).slice(0, 1000),
        },
      });
    }
  }

  return result;
}
