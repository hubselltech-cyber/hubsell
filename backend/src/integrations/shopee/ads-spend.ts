// ============================================================
// SHOPEE — ĐỒNG BỘ CHI PHÍ QUẢNG CÁO THEO NGÀY (Ads API, READ-ONLY)
//
// get_all_cpc_ads_daily_performance trả expense (tiền ads đã tiêu) từng ngày
// của TOÀN shop → upsert bảng AdSpend theo (channelId, date). Idempotent: sàn
// cập nhật lại số trong ngày thì chạy lặp ghi đè. Báo cáo dòng tiền cộng
// AdSpend vào cột Chi phí (tách khỏi Thu chi vận hành nhập tay).
//
// LƯU Ý QUYỀN: Ads API có thể chưa được bật cho app — lỗi permission ném lên
// cho caller log; KHÔNG làm hỏng các luồng sync khác (caller phải try-catch).
// ============================================================

import type { Channel } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import {
  getAdsDailyPerformance,
  type ShopeeAdsDailyPerformance,
} from "./client";
import { resolveShopeeAdsAccess } from "../hubsell-ads";
import { shopeeDateParam, vnDayWindow } from "../../lib/ads-dates";

export interface SyncShopeeAdsSpendOptions {
  /** Lấy chi tiêu N ngày gần nhất. Mặc định 30. */
  daysBack?: number;
}

export interface SyncShopeeAdsSpendResult {
  daysReturned: number; // số ngày sàn trả về
  daysUpserted: number; // số ngày ghi được vào DB
}

/** Parse "DD-MM-YYYY" của sàn → Date (00:00 UTC, cột @db.Date chỉ giữ ngày). */
export function fromShopeeDate(s: string): Date | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s.trim());
  if (!m) return null;
  return new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
}

export async function syncShopeeAdsSpend(
  channel: Channel,
  opts: SyncShopeeAdsSpendOptions = {}
): Promise<SyncShopeeAdsSpendResult> {
  // Quyền Ads API đi qua điểm chốt Hubsell Ads (app Ads riêng; fallback app
  // chính khi chưa cấu hình) — cfg quyết định partner nào ký chữ ký.
  const { accessToken, shopId, cfg } = await resolveShopeeAdsAccess(channel);
  // Khoảng ngày theo NGÀY SÀN (giờ VN), không theo giờ máy chủ — xem vnDayWindow.
  const { startKey, endKey } = vnDayWindow(opts.daysBack ?? 30);

  const data = await getAdsDailyPerformance(
    {
      accessToken,
      shopId,
      startDate: shopeeDateParam(startKey),
      endDate: shopeeDateParam(endKey),
    },
    cfg
  );

  // Parse phòng thủ: response có thể là mảng thẳng hoặc bọc performance_list.
  const raw = data.response;
  const list: ShopeeAdsDailyPerformance[] = Array.isArray(raw)
    ? raw
    : (raw?.performance_list ?? []);

  const result: SyncShopeeAdsSpendResult = {
    daysReturned: list.length,
    daysUpserted: 0,
  };

  for (const day of list) {
    const date = day.date ? fromShopeeDate(day.date) : null;
    if (!date) continue;
    const amount = Number(day.expense ?? 0) || 0;

    await prisma.adSpend.upsert({
      where: { channelId_date: { channelId: channel.id, date } },
      update: { amount },
      create: { channelId: channel.id, date, amount },
    });
    result.daysUpserted++;
  }

  return result;
}
