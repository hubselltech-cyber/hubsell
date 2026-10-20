// ============================================================
// CHI PHÍ QUẢNG CÁO SÀN (bảng AdSpend) — nạp + gom cho Báo cáo dòng tiền.
//
// Ba sàn cùng ghi AdSpend theo NGÀY: Shopee/Lazada từ Ads API cấp shop, TikTok
// = Σ cost chiến dịch GMV Max của gian (tiktok-ads/sync.ts). Kiểm số thật
// 26/09/2026 (gian ANO, 692 đơn): TikTok KHÔNG trừ GMV Max trong đơn, tiền ads
// trả bằng số dư tài khoản quảng cáo → phải cộng vào cột Chi phí như Shopee.
//
// Chốt chặn tính chồng (sửa 20/10/2026): gian TikTok nào trong kỳ có phí GMV Max
// ≠ 0 trên bản kê (TikTok thu theo đơn — khoản đó đã nằm trong "Phí nền tảng" cột
// Khấu trừ) thì cột Chi phí chỉ cộng PHẦN AdSpend VƯỢT khoản đã thu trong đơn:
// max(0, Σ AdSpend − |Σ feeGmvMax|). Trước đây chỉ cần MỘT đơn có phí GMV Max là
// bỏ cả gian khỏi tổng — mà feeGmvMax gộp cả gmv_max_coupon_fee (phí coupon GMV
// Max, có ở gian trả ads bằng tài khoản quảng cáo) → khách 69Minh Đương trả ads
// bằng hóa đơn tài khoản quảng cáo (9,7tr) mà dòng tiền chỉ thấy 3tr. Gian trả
// TRỌN ads qua đơn: |feeGmvMax| ≈ AdSpend → phần cộng thêm ≈ 0, vẫn không trừ hai lần.
// Gian TikTok chưa nối quảng cáo: một gạch đầu dòng ngắn trong tooltip dòng Ads
// (anh Trung 26/09: không nhắc nhở dài trong thẻ, seller tự hiểu).
// ============================================================

import type { Prisma } from "@prisma/client";
import { dateKeyToDbDate } from "../lib/ads-dates";
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
 * dấu, ≠ 0 nghĩa là sàn đã thu theo đơn trong kỳ). Gian có khoản này chỉ cộng
 * phần AdSpend vượt khoản đã thu, chia đều theo tỷ lệ lên từng ngày (chuỗi
 * Doanh thu vs Chi phí vẫn khớp tổng).
 */
export function summarizeAdsSpend(input: {
  rows: AdSpendRow[];
  gmvMaxChargedByChannel: Map<string, number>;
  tiktokChannels: TiktokAdsChannel[];
  dateKey: (d: Date) => string;
}): AdsSpendSummary {
  const summary: AdsSpendSummary = { total: 0, byDay: new Map(), byChannel: new Map(), notes: [] };

  // Hệ số cộng của từng gian: 1 = cộng đủ; gian bị thu trong đơn = phần vượt / Σ AdSpend (0 khi thu trọn).
  const spendByChannel = new Map<string, number>();
  for (const r of input.rows) spendByChannel.set(r.channelId, (spendByChannel.get(r.channelId) ?? 0) + r.amount);
  const factorOf = new Map<string, number>();
  const offsetChannels = new Set<string>();
  for (const [channelId, fee] of input.gmvMaxChargedByChannel) {
    if (fee === 0) continue;
    offsetChannels.add(channelId);
    const spend = spendByChannel.get(channelId) ?? 0;
    const extra = Math.max(0, spend - Math.abs(fee));
    factorOf.set(channelId, spend > 0 ? extra / spend : 0);
  }

  for (const r of input.rows) {
    const amount = r.amount * (factorOf.get(r.channelId) ?? 1);
    if (amount === 0) continue;
    summary.total += amount;
    const day = input.dateKey(r.date);
    summary.byDay.set(day, (summary.byDay.get(day) ?? 0) + amount);
    summary.byChannel.set(r.channelName, (summary.byChannel.get(r.channelName) ?? 0) + amount);
  }

  const hasOffset = input.tiktokChannels.some((ch) => offsetChannels.has(ch.id));
  const hasUnlinked = input.tiktokChannels.some((ch) => !offsetChannels.has(ch.id) && !ch.adsLinked);
  if (hasOffset) summary.notes.push("TikTok đã trừ một phần tiền quảng cáo trong đơn, ở đây chỉ cộng phần còn lại");
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

/**
 * Tiền quảng cáo sàn của kỳ trên ĐÚNG tập đơn tính doanh thu — MỘT cách gom cho
 * Tổng quan và Trợ lý hỏi đáp, cùng luật với Báo cáo dòng tiền: gian bị sàn thu
 * GMV Max ngay trong đơn thì khoản đó đã nằm trong phí sàn, không cộng lần nữa.
 */
export async function platformAdsSpend(
  scope: Prisma.ChannelWhereInput,
  range: { gte: Date; lte: Date } | undefined,
  revenueRows: { channelId: string; feeGmvMax: number }[]
): Promise<AdsSpendSummary> {
  const [rows, tiktokChannels] = await Promise.all([
    loadAdSpendRows(scope, range),
    loadTiktokAdsChannels(scope),
  ]);
  const gmvMaxChargedByChannel = new Map<string, number>();
  for (const r of revenueRows) {
    if (r.feeGmvMax === 0) continue;
    gmvMaxChargedByChannel.set(
      r.channelId,
      (gmvMaxChargedByChannel.get(r.channelId) ?? 0) + r.feeGmvMax
    );
  }
  return summarizeAdsSpend({
    rows,
    gmvMaxChargedByChannel,
    tiktokChannels,
    dateKey: toBusinessDateKey,
  });
}

/** Gian TikTok trong phạm vi + đã nối quảng cáo hay chưa. */
export async function loadTiktokAdsChannels(scope: Prisma.ChannelWhereInput): Promise<TiktokAdsChannel[]> {
  const rows = await prisma.channel.findMany({
    where: { ...scope, channelName: "TIKTOK" },
    select: { id: true, shopName: true, tiktokAdsStoreLink: { select: { id: true } } },
  });
  return rows.map((c) => ({ id: c.id, shopName: c.shopName, adsLinked: c.tiktokAdsStoreLink !== null }));
}
