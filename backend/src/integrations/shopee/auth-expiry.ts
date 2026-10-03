// ============================================================
// NGÀY HẾT HẠN ỦY QUYỀN SHOPEE — hỏi Shopee mỗi ngày một lần cho từng gian đang nối
// (03/10/2026, anh Trung duyệt).
//
// Bối cảnh: quyền của shop với một app có THỜI HẠN do chủ shop đặt trên trang ủy
// quyền của Shopee. Tới hạn, Shopee từ chối làm mới token (shop_access_expired) dù
// refresh_token còn hạn — gian "The White Active" hết đúng 7 ngày sau khi nối, ủy
// quyền Hubsell Ads của gian "Farm Nuts" hết sau khoảng 1 ngày (prod 03/10/2026).
// Hubsell đọc ngày đó (expire_time của get_shop_info) để hiện trên thẻ gian: chủ shop
// biết trước, và khi gian ngắt thì biết là do hết hạn ủy quyền.
//
// Gọi từ workers/token-refresh.ts sau lượt làm mới token. CHỈ ĐỌC phía Shopee, một
// lệnh get_shop_info cho mỗi gian mỗi ngày (mỗi app một lệnh). Hỏi không được thì vẫn
// ghi mốc đã hỏi để hôm sau mới hỏi lại — không dội lệnh vào gian đang lỗi.
// ============================================================

import { ChannelAppKind, ChannelName } from "@prisma/client";

import { prisma } from "../../lib/prisma";
import { getHubsellAdsConfig, getValidHubsellAdsAccessToken, isHubsellAdsConfigured } from "../hubsell-ads";
import { getShopInfo, shopAuthExpireAt } from "./client";
import { isShopeeConfigured } from "./config";
import { getValidShopeeAccessToken } from "./service";

/** Hỏi lại ngày hết hạn của một gian sau bấy lâu. Chủ shop gia hạn trên Shopee thì ngày đổi, nên phải hỏi lại. */
export const AUTH_EXPIRY_RECHECK_MS = 24 * 60 * 60 * 1000;
/**
 * Số gian tối đa mỗi lượt cho mỗi app. MẶC ĐỊNH TỰ CHỌN 300: lượt chạy 30 phút một
 * lần nên một ngày phủ được 14.400 gian mỗi app. Lượt nào chạm trần thì in "CÒN TỒN".
 */
const PER_RUN = 300;
/** Nghỉ giữa hai gian — lệnh chỉ đọc, không cần giãn như làm mới token. */
const STAGGER_MS = 300;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface AuthExpiryStats {
  mainChecked: number;
  mainWithDate: number;
  adsChecked: number;
  adsWithDate: number;
  failed: number;
  leftover: boolean;
}

/** Một lượt. `opts.channelIds` giới hạn vào vài gian (test); `staggerMs` cho test đặt 0. */
export async function refreshShopeeAuthExpiry(
  now: Date = new Date(),
  opts: { channelIds?: string[]; staggerMs?: number } = {}
): Promise<AuthExpiryStats> {
  const stats: AuthExpiryStats = { mainChecked: 0, mainWithDate: 0, adsChecked: 0, adsWithDate: 0, failed: 0, leftover: false };
  if (!isShopeeConfigured()) return stats;
  const stagger = opts.staggerMs ?? STAGGER_MS;
  const stale = new Date(now.getTime() - AUTH_EXPIRY_RECHECK_MS);
  const due = { OR: [{ authExpireCheckedAt: null }, { authExpireCheckedAt: { lt: stale } }] };
  const only = opts.channelIds ? { in: opts.channelIds } : undefined;

  // ---- App chính ----
  const channels = await prisma.channel.findMany({
    where: {
      channelName: ChannelName.SHOPEE,
      status: "ACTIVE",
      refreshToken: { not: null },
      externalShopId: { not: null },
      ...(only ? { id: only } : {}),
      ...due,
    },
    orderBy: { authExpireCheckedAt: { sort: "asc", nulls: "first" } },
    take: PER_RUN,
  });
  if (channels.length === PER_RUN) stats.leftover = true;
  for (const channel of channels) {
    let expireAt: Date | null | undefined;
    try {
      const { accessToken, shopId } = await getValidShopeeAccessToken(channel);
      expireAt = shopAuthExpireAt(await getShopInfo(accessToken, shopId));
    } catch (err) {
      stats.failed += 1;
      console.warn(`[Auth-expiry] Gian "${channel.shopName}": chưa hỏi được ngày hết hạn ủy quyền — ${(err as Error).message}`);
    }
    // Hỏi không được (expireAt undefined) thì giữ ngày cũ, chỉ ghi mốc đã hỏi.
    await prisma.channel.updateMany({
      where: { id: channel.id },
      data: { authExpireCheckedAt: now, ...(expireAt !== undefined ? { authExpireAt: expireAt } : {}) },
    });
    stats.mainChecked += 1;
    if (expireAt) stats.mainWithDate += 1;
    if (stagger > 0) await sleep(stagger);
  }

  // ---- App Hubsell Ads ----
  if (isHubsellAdsConfigured()) {
    const auths = await prisma.channelAppAuth.findMany({
      where: {
        app: ChannelAppKind.HUBSELL_ADS,
        status: "ACTIVE",
        ...(only ? { channelId: only } : {}),
        ...due,
      },
      orderBy: { authExpireCheckedAt: { sort: "asc", nulls: "first" } },
      take: PER_RUN,
      select: { id: true, channelId: true },
    });
    if (auths.length === PER_RUN) stats.leftover = true;
    for (const auth of auths) {
      let expireAt: Date | null | undefined;
      try {
        const { accessToken, shopId } = await getValidHubsellAdsAccessToken(auth.channelId);
        expireAt = shopAuthExpireAt(await getShopInfo(accessToken, shopId, getHubsellAdsConfig()));
      } catch (err) {
        stats.failed += 1;
        console.warn(`[Auth-expiry] Hubsell Ads gian ${auth.channelId}: chưa hỏi được ngày hết hạn ủy quyền — ${(err as Error).message}`);
      }
      await prisma.channelAppAuth.updateMany({
        where: { id: auth.id },
        data: { authExpireCheckedAt: now, ...(expireAt !== undefined ? { authExpireAt: expireAt } : {}) },
      });
      stats.adsChecked += 1;
      if (expireAt) stats.adsWithDate += 1;
      if (stagger > 0) await sleep(stagger);
    }
  }

  if (stats.mainChecked + stats.adsChecked > 0) {
    console.log(
      `[Auth-expiry] Hỏi ngày hết hạn ủy quyền Shopee: app chính ${stats.mainChecked} gian (${stats.mainWithDate} có ngày), ` +
        `Hubsell Ads ${stats.adsChecked} gian (${stats.adsWithDate} có ngày)` +
        (stats.failed ? `, ${stats.failed} gian hỏi không được` : "") +
        (stats.leftover ? " — CÒN TỒN, lượt sau hỏi tiếp" : "")
    );
  }
  return stats;
}
