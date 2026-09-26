// ============================================================
// CHI PHÍ QUẢNG CÁO SÀN (bảng AdSpend) — nạp + gom cho Báo cáo dòng tiền.
//
// Ba sàn cùng ghi AdSpend theo NGÀY: Shopee/Lazada từ Ads API cấp shop, TikTok
// = Σ cost chiến dịch GMV Max của gian (tiktok-ads/sync.ts). Kiểm số thật
// 26/09/2026 (gian ANO, 692 đơn): TikTok KHÔNG trừ GMV Max trong đơn, tiền ads
// trả bằng số dư tài khoản quảng cáo → phải cộng vào cột Chi phí như Shopee.
//
// Chốt chặn tính chồng: gian TikTok nào trong kỳ có phí GMV Max ≠ 0 trên bản kê
// (TikTok thu theo đơn — khoản đó đã nằm trong "Phí nền tảng" cột Khấu trừ) thì
// AdSpend của gian đó CHỈ hiện tham chiếu, không cộng vào tổng.
// Gian TikTok chưa nối quảng cáo: một gạch đầu dòng ngắn trong tooltip dòng Ads
// (anh Trung 26/09: không nhắc nhở dài trong thẻ, seller tự hiểu).
// ============================================================

import type { Prisma } from "@prisma/client";
import { dateKeyToDbDate } from "../integrations/shopee/ads-insights";
import { toBusinessDateKey } from "../lib/date-range";
import { prisma } from "../lib/prisma";

export interface AdSpendRow {
  channelId: string;
  channelName: string;
  shopName: string;
  date: Date;
  amount: number;
}

export interface TiktokAdsChannel {
  id: string;
  shopName: string;
  /** Đã nối tài khoản quảng cáo TikTok (có tiktokAdsStoreLink). */
  adsLinked: boolean;
}

export interface AdsSpendSummary {
  /** Tổng CỘNG VÀO cột Chi phí (đã loại gian tham chiếu). */
  total: number;
  /** Theo ngày (khóa ngày nghiệp vụ) — chuỗi Doanh thu vs Chi phí. */
  byDay: Map<string, number>;
  /** Theo sàn (channelName) — bóc chi tiết dòng Ads. */
  byChannel: Map<string, number>;
  /** Gạch đầu dòng ngắn nối vào tooltip dòng Ads (gian chưa nối / khoản chỉ tham chiếu). */
  notes: string[];
}

/**
 * Gom AdSpend cho dòng "Chi phí quảng cáo sàn (Ads)" — thuần, có test.
 * gmvMaxChargedByChannel: Σ phí GMV Max trên bản kê theo channelId (số có
 * dấu, ≠ 0 nghĩa là sàn đã thu theo đơn trong kỳ).
 */
export function summarizeAdsSpend(input: {
  rows: AdSpendRow[];
  gmvMaxChargedByChannel: Map<string, number>;
  tiktokChannels: TiktokAdsChannel[];
  dateKey: (d: Date) => string;
}): AdsSpendSummary {
  const summary: AdsSpendSummary = { total: 0, byDay: new Map(), byChannel: new Map(), notes: [] };
  const referenceOnly = new Set(
    [...input.gmvMaxChargedByChannel].filter(([, fee]) => fee !== 0).map(([id]) => id)
  );

  for (const r of input.rows) {
    if (referenceOnly.has(r.channelId)) continue;
    summary.total += r.amount;
    const day = input.dateKey(r.date);
    summary.byDay.set(day, (summary.byDay.get(day) ?? 0) + r.amount);
    summary.byChannel.set(r.channelName, (summary.byChannel.get(r.channelName) ?? 0) + r.amount);
  }

  const hasReference = input.tiktokChannels.some((ch) => referenceOnly.has(ch.id));
  const hasUnlinked = input.tiktokChannels.some((ch) => !referenceOnly.has(ch.id) && !ch.adsLinked);
  if (hasReference) summary.notes.push("TikTok đã trừ tiền quảng cáo trong đơn, không cộng lại ở đây");
  if (hasUnlinked) summary.notes.push("TikTok cần kết nối tài khoản quảng cáo");
  return summary;
}

/**
 * Khoảng lọc cho cột AdSpend.date (@db.Date, 00:00 UTC theo ngày sàn) từ khoảng
 * GIỜ VN của bộ lọc trang. Không đưa thẳng mốc giờ vào: so với cột DATE thì giờ
 * bị cắt, "hôm nay" 00:00 VN (= 17:00 UTC hôm qua) kéo luôn cả ngày hôm qua
 * (26/09/2026: dòng tiền "Hôm nay" = AdSpend 25 + 26/09). Thuần, có test.
 */
export function adSpendDateRange(range: { gte: Date; lte: Date }): { gte: Date; lte: Date } {
  return {
    gte: dateKeyToDbDate(toBusinessDateKey(range.gte)),
    lte: dateKeyToDbDate(toBusinessDateKey(range.lte)),
  };
}

/** Dòng AdSpend trong phạm vi gian + khoảng ngày (undefined = toàn bộ). */
export async function loadAdSpendRows(
  scope: Prisma.ChannelWhereInput,
  range?: { gte: Date; lte: Date }
): Promise<AdSpendRow[]> {
  const rows = await prisma.adSpend.findMany({
    where: { channel: scope, ...(range ? { date: adSpendDateRange(range) } : {}) },
    select: {
      channelId: true,
      date: true,
      amount: true,
      channel: { select: { channelName: true, shopName: true } },
    },
  });
  return rows.map((r) => ({
    channelId: r.channelId,
    channelName: r.channel.channelName,
    shopName: r.channel.shopName,
    date: r.date,
    amount: Number(r.amount),
  }));
}

/** Gian TikTok trong phạm vi + đã nối quảng cáo hay chưa. */
export async function loadTiktokAdsChannels(scope: Prisma.ChannelWhereInput): Promise<TiktokAdsChannel[]> {
  const rows = await prisma.channel.findMany({
    where: { ...scope, channelName: "TIKTOK" },
    select: { id: true, shopName: true, tiktokAdsStoreLink: { select: { id: true } } },
  });
  return rows.map((c) => ({ id: c.id, shopName: c.shopName, adsLinked: c.tiktokAdsStoreLink !== null }));
}
