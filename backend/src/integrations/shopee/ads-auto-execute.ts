// ============================================================
// TRỢ LÝ QUẢNG CÁO — GĐ3: TỰ THỰC THI (EXECUTOR DÙNG CHUNG SHOPEE + LAZADA)
//
// Chạy kèm nhịp đối soát trong order-auto-sync, NGAY SAU sync campaign của sàn
// (đánh giá trên số vừa sync). v1 chỉ có MỘT hành động: PAUSE campaign dính
// verdict pause_now / spike — cắt lỗ, không đụng budget/bid/keyword.
//
// 12/08/2026: dùng chung cho Lazada — toàn bộ vòng chọn/quota/sổ y hệt, chỉ
// khác CÚ GỌI PAUSE lên sàn (makePauser bên dưới): Shopee đi
// edit_manual_product_ads (enum edit_action CHƯA xác minh — chờ probe), Lazada
// đi updateCampaign switchStatus=0 (CÓ trong docs chính thức nhưng cũng chưa
// từng bắn thật — quy trình bật live của hai sàn giống nhau: dry_run vài ngày
// → write-probe trên campaign đã tắt sẵn → mới gạt live).
//
// BA CHỐT AN TOÀN (thứ tự kiểm):
//   1. Mode per-gian trong AdsAssistantConfig.autoExecute:
//      off (mặc định) | dry_run (DIỄN TẬP: ghi sổ, KHÔNG gọi sàn) | live.
//      Chỉ bật live sau khi probe xác minh lệnh ghi (bài học MISA: không đoán
//      API) — về mặt code, live ghi NGUYÊN VĂN lỗi sàn vào sổ làm tư liệu.
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

import { ChannelName, Prisma, type Channel } from "@prisma/client";
import { prisma } from "../../prisma";
import { editManualProductAdsRaw } from "./client";
import { getValidShopeeAccessToken } from "./service";
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
        !assistantDecisionActive(it)
    )
    .sort((a, b) => b.windows["7d"].spend - a.windows["7d"].spend);
}

/** Kết quả một cú pause lên sàn — error là NGUYÊN VĂN để ghi sổ. */
type PauseOutcome = { ok: boolean; error: string | null };

/**
 * Dựng hàm pause theo sàn của gian (chỉ gọi ở mode live; token lấy MỘT lần).
 * Shopee: edit_manual_product_ads editAction="pause" (kèm referenceId lên sàn).
 * Lazada: updateCampaign switchStatus=0 (idempotency chỉ nằm ở sổ phía mình —
 * API Lazada không nhận referenceId, nhưng tắt một campaign đã tắt là vô hại).
 */
async function makePauser(
  channel: Channel
): Promise<(campaignId: string, referenceId: string) => Promise<PauseOutcome>> {
  if (channel.channelName === ChannelName.LAZADA) {
    const accessToken = await getValidLazadaAccessToken(channel);
    return async (campaignId) => {
      const raw = await updateAdsCampaignSwitchRaw({
        accessToken,
        campaignId,
        switchStatus: 0,
      });
      const ok = lazAdsWriteOk(raw);
      return {
        ok,
        error: ok
          ? null
          : `${raw.code ?? ""} ${raw.errorMsg ?? raw.message ?? ""}`.trim() ||
            "Lazada từ chối, không kèm lý do",
      };
    };
  }
  const { accessToken, shopId } = await getValidShopeeAccessToken(channel);
  return async (campaignId, referenceId) => {
    const raw = await editManualProductAdsRaw({
      accessToken,
      shopId,
      campaignId,
      editAction: "pause",
      referenceId,
    });
    const ok = !raw.error || raw.error === "";
    return { ok, error: ok ? null : `${raw.error}: ${raw.message ?? ""}` };
  };
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

  // Token chỉ cần cho mode live — lấy MỘT lần ngoài vòng lặp (theo sàn).
  let pause: ((campaignId: string, referenceId: string) => Promise<PauseOutcome>) | null =
    null;
  if (auto.mode === "live") {
    pause = await makePauser(channel);
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

    // ---- MODE LIVE: gọi sàn (pauser theo sàn), ghi nguyên văn kết quả vào sổ ----
    try {
      const { ok, error } = await pause!(it.row.campaignId, referenceId);
      await prisma.adsActionLog.update({
        where: { id: logId },
        data: {
          status: ok ? "SUCCESS" : "FAILED",
          error: ok ? null : (error ?? "").slice(0, 1000),
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
