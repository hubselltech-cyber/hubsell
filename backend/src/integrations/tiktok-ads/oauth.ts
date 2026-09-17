// ============================================================
// TIKTOK ADS — ỦY QUYỀN TÀI KHOẢN QUẢNG CÁO + TỰ DÒ GIAN
//
// Thực tế (probe 17/09/2026 + anh Trung lưu ý): một tài khoản quảng cáo chạy
// cho RẤT NHIỀU shop, kể cả shop của nhiều seller khác nhau (người chạy quảng
// cáo thuê). Một lần ủy quyền trả token thấy N tài khoản quảng cáo × M shop.
//
// Nguyên tắc cách ly:
//   1. Token chỉ là chìa khóa. Hubsell CHỈ đọc số của shop mà chính chủ shop
//      này đã nối app chính (store_id = Channel.externalShopId của họ) — việc
//      nối gian bằng TikTok Shop API là bằng chứng sở hữu. Shop của seller
//      khác trong cùng token: không lưu, không hiển thị, không gọi report.
//   2. Không dò ra gian nào của chủ shop → KHÔNG lưu token.
//   3. Người chạy thuê ủy quyền cho nhiều chủ shop trên Hubsell = nhiều dòng
//      TiktokAdsAuth độc lập; gỡ ở chủ shop này không đụng chủ shop khác.
//   4. Người giữ tài khoản quảng cáo có thể KHÔNG phải chủ shop → link ủy quyền
//      gửi đi được (state ký 7 ngày), callback công khai nhận diện bằng state.
//
// Mỗi shop TikTok chỉ có MỘT tài khoản quảng cáo độc quyền GMV Max
// (exclusive_authorized_advertiser_info) — đó là tài khoản duy nhất có số, nên
// Hubsell tự chọn, chủ shop không phải chọn gì.
// ============================================================

import jwt from "jsonwebtoken";
import { ChannelName } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { markAdsBackfill } from "../../services/sync-schedule";
import {
  exchangeTiktokAdsAuthCode,
  getGmvMaxStores,
  getTiktokAdsAdvertisers,
  type TiktokAdsAdvertiser,
} from "./client";

const STATE_SECRET = process.env.JWT_SECRET ?? "hubsell_dev_jwt_secret_change_me";
const STATE_FRONTEND_URL = process.env.APP_FRONTEND_URL ?? "http://localhost:3000";
const STATE_PURPOSE = "tiktok_ads_oauth";

/** Trần số tài khoản quảng cáo dò mỗi lần ủy quyền (người chạy thuê có thể có hàng trăm). */
const MAX_ADVERTISERS_SCANNED = 300;
/** Gọi song song tối đa — hạn mức app 8 QPS, chừa phần cho worker. */
const SCAN_CONCURRENCY = 4;

export type TiktokAdsStateKind = "self" | "invite";

/**
 * Ký state mang ownerId + GIAN ĐÍCH (dòng mà chủ shop bấm nút Kết nối — mỗi
 * gian có thể dùng một tài khoản quảng cáo khác nhau nên kết quả phải nói về
 * đúng gian đó). "self" = chủ shop tự bấm (30 phút); "invite" = link gửi cho
 * người giữ tài khoản quảng cáo (7 ngày).
 */
export function signTiktokAdsState(ownerId: string, kind: TiktokAdsStateKind, channelId?: string): string {
  return jwt.sign(
    { ownerId, kind, channelId: channelId || undefined, purpose: STATE_PURPOSE, fe: STATE_FRONTEND_URL },
    STATE_SECRET,
    { expiresIn: kind === "invite" ? "7d" : "30m" }
  );
}

export function verifyTiktokAdsState(
  token: string
): { ownerId: string; kind: TiktokAdsStateKind; channelId: string | null } | null {
  try {
    const p = jwt.verify(token, STATE_SECRET) as jwt.JwtPayload;
    if (p.purpose !== STATE_PURPOSE || !p.ownerId) return null;
    return {
      ownerId: String(p.ownerId),
      kind: p.kind === "invite" ? "invite" : "self",
      channelId: typeof p.channelId === "string" ? p.channelId : null,
    };
  } catch {
    return null;
  }
}

interface StoreRow {
  store_id?: string;
  store_name?: string;
  is_gmv_max_available?: boolean;
  exclusive_authorized_advertiser_info?: { advertiser_id?: string; advertiser_name?: string };
}

export interface TiktokAdsLinkedStore {
  channelId: string;
  shopName: string;
  advertiserId: string;
  advertiserName: string;
}

export interface TiktokAdsConnectResult {
  linked: TiktokAdsLinkedStore[];
  /**
   * Gian TikTok CHƯA có kết nối quảng cáo mà lần ủy quyền này cũng không phủ
   * được, kèm lý do. Gian đang nối khỏe bằng tài khoản quảng cáo khác thì không
   * nằm ở đây — nhắc tới chỉ làm chủ shop rối.
   */
  skipped: { shopName: string; reason: string }[];
  /** Gian đích (dòng chủ shop bấm nút) — null khi link không mang gian đích. */
  target: { shopName: string; linked: boolean; reason: string | null } | null;
}

/** Chạy fn trên từng phần tử, tối đa `limit` lượt cùng lúc; `stop()` true thì thôi nhận việc mới. */
async function scanPool<T>(items: T[], limit: number, stop: () => boolean, fn: (item: T) => Promise<void>) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length && !stop()) {
      const item = items[i++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/**
 * Đổi auth_code → token, dò cặp (tài khoản quảng cáo độc quyền, shop) khớp gian
 * TikTok của chủ shop rồi ghi link. Gian chưa nối app chính thì chặn TRƯỚC khi
 * đổi code (code dùng một lần).
 */
export async function connectTiktokAds(
  ownerId: string,
  authCode: string,
  targetChannelId: string | null = null
): Promise<TiktokAdsConnectResult> {
  const channels = await prisma.channel.findMany({
    where: { userId: ownerId, channelName: ChannelName.TIKTOK, externalShopId: { not: null } },
    select: { id: true, shopName: true, externalShopId: true },
  });
  if (channels.length === 0) {
    throw new Error(
      "Chưa có gian TikTok Shop nào được kết nối. Hãy kết nối gian ở trang Kênh bán trước, rồi mới kết nối quảng cáo."
    );
  }
  const token = await exchangeTiktokAdsAuthCode(authCode).catch((err) => {
    console.error("[tiktok-ads] đổi auth_code lỗi:", (err as Error).message);
    throw new Error(
      "Mã ủy quyền của TikTok không hợp lệ hoặc đã hết hạn (mỗi mã chỉ dùng được một lần trong 1 giờ). Hãy bấm Kết nối lại từ Hubsell."
    );
  });
  if (!token.access_token) throw new Error("TikTok không trả access_token");
  return linkTiktokAdsStores(ownerId, channels, token.access_token, token.advertiser_ids ?? [], targetChannelId);
}

/**
 * Phần sau khi đã có token: dò cặp (tài khoản quảng cáo độc quyền, shop) rồi ghi
 * link. Tách riêng để script dev thử bằng token có sẵn (auth_code dùng một lần).
 */
export async function linkTiktokAdsStores(
  ownerId: string,
  channels: { id: string; shopName: string; externalShopId: string | null }[],
  accessToken: string,
  advertiserIds: string[],
  targetChannelId: string | null = null
): Promise<TiktokAdsConnectResult> {
  const byStoreId = new Map(channels.map((c) => [c.externalShopId as string, c]));

  const advertisers: TiktokAdsAdvertiser[] = (await getTiktokAdsAdvertisers(accessToken)).slice(
    0,
    MAX_ADVERTISERS_SCANNED
  );
  const nameOf = new Map(advertisers.map((a) => [a.advertiser_id, a.advertiser_name]));

  // store_id của chủ shop → tài khoản quảng cáo độc quyền (theo lời sàn).
  const exclusiveOf = new Map<string, { advertiserId: string; advertiserName: string }>();
  // store_id của chủ shop mà token có nhìn thấy (dù chưa rõ tài khoản độc quyền).
  const seen = new Set<string>();

  await scanPool(
    advertisers,
    SCAN_CONCURRENCY,
    () => exclusiveOf.size === byStoreId.size,
    async (adv) => {
      const data = await getGmvMaxStores(accessToken, adv.advertiser_id).catch(() => null);
      for (const s of ((data?.store_list ?? []) as StoreRow[])) {
        const storeId = String(s.store_id ?? "");
        if (!byStoreId.has(storeId)) continue; // shop của seller khác → bỏ qua hoàn toàn
        seen.add(storeId);
        const ex = s.exclusive_authorized_advertiser_info;
        if (ex?.advertiser_id && !exclusiveOf.has(storeId)) {
          exclusiveOf.set(storeId, {
            advertiserId: String(ex.advertiser_id),
            advertiserName: ex.advertiser_name ?? "",
          });
        }
      }
    }
  );

  const linkable: { channel: (typeof channels)[number]; advertiserId: string; advertiserName: string }[] = [];
  const skipped: { channelId: string; shopName: string; reason: string }[] = [];
  for (const c of channels) {
    const storeId = c.externalShopId as string;
    const ex = exclusiveOf.get(storeId);
    if (ex && nameOf.has(ex.advertiserId)) {
      linkable.push({ channel: c, advertiserId: ex.advertiserId, advertiserName: nameOf.get(ex.advertiserId) || ex.advertiserName });
    } else if (ex) {
      skipped.push({
        channelId: c.id,
        shopName: c.shopName,
        reason: `GMV Max của gian đang do tài khoản quảng cáo "${ex.advertiserName || ex.advertiserId}" chạy, nhưng tài khoản TikTok vừa ủy quyền không có quyền trên tài khoản quảng cáo đó.`,
      });
    } else if (seen.has(storeId)) {
      skipped.push({ channelId: c.id, shopName: c.shopName, reason: "Gian chưa có tài khoản quảng cáo nào được cấp quyền chạy GMV Max." });
    } else {
      skipped.push({ channelId: c.id, shopName: c.shopName, reason: "Tài khoản TikTok vừa ủy quyền không quản lý quảng cáo của gian này." });
    }
  }

  const targetSkip = targetChannelId ? skipped.find((x) => x.channelId === targetChannelId) : undefined;
  if (linkable.length === 0) {
    // Nguyên tắc 2: không phủ gian nào của chủ shop → không giữ token.
    const only = targetSkip ?? (skipped.length === 1 ? skipped[0] : undefined);
    throw new Error(
      only
        ? `Gian "${only.shopName}": ${only.reason}`
        : "Tài khoản TikTok vừa ủy quyền không chạy GMV Max cho gian TikTok nào của anh/chị trên Hubsell. " +
            "Hãy ủy quyền bằng đúng tài khoản đang chạy quảng cáo cho shop."
    );
  }

  // Gian đang nối khỏe bằng tài khoản quảng cáo KHÁC → không coi là "bỏ sót".
  const healthy = await prisma.tiktokAdsStoreLink.findMany({
    where: { channelId: { in: skipped.map((x) => x.channelId) }, status: "ACTIVE", auth: { status: "ACTIVE" } },
    select: { channelId: true },
  });
  const healthyIds = new Set(healthy.map((h) => h.channelId));

  const linked = await prisma.$transaction(async (tx) => {
    const auth = await tx.tiktokAdsAuth.create({
      data: { userId: ownerId, accessToken, advertiserIds: advertiserIds.join(",") },
    });
    for (const l of linkable) {
      const data = {
        authId: auth.id,
        advertiserId: l.advertiserId,
        advertiserName: l.advertiserName,
        storeId: l.channel.externalShopId as string,
        status: "ACTIVE",
        lastSyncError: "",
      };
      await tx.tiktokAdsStoreLink.upsert({
        where: { channelId: l.channel.id },
        update: data,
        create: { channelId: l.channel.id, ...data },
      });
    }
    // Lần ủy quyền cũ của chủ shop không còn gian nào dùng → xóa, không giữ token thừa.
    await tx.tiktokAdsAuth.deleteMany({ where: { userId: ownerId, id: { not: auth.id }, links: { none: {} } } });
    return linkable.map((l) => ({
      channelId: l.channel.id,
      shopName: l.channel.shopName,
      advertiserId: l.advertiserId,
      advertiserName: l.advertiserName,
    }));
  });

  await Promise.all(linked.map((l) => markAdsBackfill(l.channelId)));
  const targetChannel = targetChannelId ? channels.find((c) => c.id === targetChannelId) : undefined;
  return {
    linked,
    skipped: skipped
      .filter((x) => !healthyIds.has(x.channelId) && x.channelId !== targetChannelId)
      .map(({ shopName, reason }) => ({ shopName, reason })),
    target: targetChannel
      ? { shopName: targetChannel.shopName, linked: !targetSkip, reason: targetSkip?.reason ?? null }
      : null,
  };
}

/** Gỡ kết nối quảng cáo của MỘT gian; token không còn gian nào dùng thì xóa luôn. */
export async function unlinkTiktokAds(ownerId: string, channelId: string): Promise<boolean> {
  const link = await prisma.tiktokAdsStoreLink.findFirst({
    where: { channelId, channel: { userId: ownerId } },
    select: { id: true, authId: true },
  });
  if (!link) return false;
  await prisma.tiktokAdsStoreLink.delete({ where: { id: link.id } });
  await prisma.tiktokAdsAuth.deleteMany({ where: { id: link.authId, links: { none: {} } } });
  return true;
}

export interface TiktokAdsLinkStatus {
  linked: boolean;
  /** ACTIVE | NO_ACCESS | REVOKED — REVOKED = token chết, cần ủy quyền lại. */
  status: string | null;
  advertiserName: string | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
}

export async function getTiktokAdsLinkStatus(channelId: string): Promise<TiktokAdsLinkStatus> {
  const link = await prisma.tiktokAdsStoreLink.findUnique({
    where: { channelId },
    select: { status: true, advertiserName: true, lastSyncedAt: true, lastSyncError: true, auth: { select: { status: true } } },
  });
  if (!link) return { linked: false, status: null, advertiserName: null, lastSyncedAt: null, lastSyncError: null };
  return {
    linked: true,
    status: link.auth.status === "ACTIVE" ? link.status : "REVOKED",
    advertiserName: link.advertiserName,
    lastSyncedAt: link.lastSyncedAt?.toISOString() ?? null,
    lastSyncError: link.lastSyncError || null,
  };
}
