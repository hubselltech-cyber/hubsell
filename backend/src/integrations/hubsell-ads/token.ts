// ============================================================
// HUBSELL ADS — TOKEN + ĐIỂM CHỐT DUY NHẤT CẤP QUYỀN GỌI ADS API
//
// Mọi nơi gọi Ads API Shopee (ads-spend, ads-campaigns, ads-auto-execute, ví
// ads ở routes/ads.ts và ops-alerts) đều lấy quyền qua resolveShopeeAdsAccess():
//   · Hubsell Ads CHƯA cấu hình (chưa có env) → dùng token app chính trên
//     Channel như trước, cfg app chính. Production hôm nay đi nhánh này.
//   · Hubsell Ads ĐÃ cấu hình → bắt buộc gian đã ủy quyền Hubsell Ads
//     (ChannelAppAuth ACTIVE); chưa có thì ném HubsellAdsNotLinkedError để
//     tầng trên hiện màn mời kết nối thay vì lỗi chữ ký khó hiểu.
//
// Refresh token: cùng chiến lược 2 tầng với app chính (lazy trước mỗi call +
// cron lưới an toàn ở workers/token-refresh.ts gọi refreshExpiringHubsellAdsTokens),
// cùng mutex theo gian vì Shopee ROTATE refresh_token mỗi lần refresh.
// ============================================================

import { ChannelAppKind, type Channel, type ChannelAppAuth } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { withDbLock } from "../../lib/db-lock";
import { getShopeeConfig, type ShopeeConfig } from "../shopee/config";
import { refreshAccessToken } from "../shopee/client";
import { getValidShopeeAccessToken } from "../shopee/service";
import { HUBSELL_ADS_APP_LABEL, getHubsellAdsConfig, isHubsellAdsConfigured } from "./config";

/** Refresh khi access_token còn <5 phút (chừa biên cho call nối tiếp). */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;
/** refresh_token của Shopee sống 30 ngày — hết thì buộc ủy quyền lại. */
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Gian chưa ủy quyền Hubsell Ads (hoặc ủy quyền đã chết). Route bắt để trả mã riêng. */
export class HubsellAdsNotLinkedError extends Error {
  readonly code = "HUBSELL_ADS_NOT_LINKED";
  constructor(
    readonly channelId: string,
    readonly reason: "not_linked" | "expired"
  ) {
    super(
      reason === "expired"
        ? `Ủy quyền ${HUBSELL_ADS_APP_LABEL} của gian đã hết hạn — cần kết nối lại`
        : `Gian chưa ủy quyền ${HUBSELL_ADS_APP_LABEL} — cần kết nối trước khi dùng Trợ lý quảng cáo`
    );
  }
}

export function isHubsellAdsNotLinkedError(err: unknown): err is HubsellAdsNotLinkedError {
  return err instanceof HubsellAdsNotLinkedError;
}

/** Quyền gọi Ads API cho một gian: token + shop_id + cfg (app nào ký chữ ký). */
export interface ShopeeAdsAccess {
  accessToken: string;
  shopId: string;
  cfg: ShopeeConfig;
  /** Nguồn token — để log/hiển thị, không rẽ nhánh nghiệp vụ theo đây. */
  source: "hubsell-ads" | "main-app";
}

/**
 * ĐIỂM CHỐT DUY NHẤT: quyền gọi Ads API cho gian Shopee. Fallback app chính
 * khi Hubsell Ads chưa cấu hình (xem đầu file).
 */
export async function resolveShopeeAdsAccess(channel: Channel): Promise<ShopeeAdsAccess> {
  if (!isHubsellAdsConfigured()) {
    const { accessToken, shopId } = await getValidShopeeAccessToken(channel);
    return { accessToken, shopId, cfg: getShopeeConfig(), source: "main-app" };
  }
  const { accessToken, shopId } = await getValidHubsellAdsAccessToken(channel.id);
  return { accessToken, shopId, cfg: getHubsellAdsConfig(), source: "hubsell-ads" };
}

/**
 * Gian này có gọi được Ads API không — worker auto-sync hỏi TRƯỚC khi chạy
 * nhánh ads để gian chưa nối Hubsell Ads được bỏ qua lặng lẽ (không đẻ log lỗi
 * mỗi 10 phút). Chưa cấu hình Hubsell Ads = luôn true (đi app chính).
 */
export async function hasShopeeAdsAccess(channelId: string): Promise<boolean> {
  if (!isHubsellAdsConfigured()) return true;
  const auth = await prisma.channelAppAuth.findUnique({
    where: { channelId_app: { channelId, app: ChannelAppKind.HUBSELL_ADS } },
    select: { status: true },
  });
  return auth?.status === "ACTIVE";
}

// ---------- Refresh có mutex theo gian ----------

interface AccessCtx {
  accessToken: string;
  shopId: string;
}

const refreshInFlight = new Map<string, Promise<AccessCtx>>();

/** Token Hubsell Ads còn hạn của gian; tự refresh + ghi DB khi sắp hết hạn. */
export async function getValidHubsellAdsAccessToken(
  channelId: string,
  minTtlMs: number = REFRESH_BUFFER_MS
): Promise<AccessCtx> {
  const auth = await prisma.channelAppAuth.findUnique({
    where: { channelId_app: { channelId, app: ChannelAppKind.HUBSELL_ADS } },
  });
  if (!auth) throw new HubsellAdsNotLinkedError(channelId, "not_linked");
  if (auth.status !== "ACTIVE") throw new HubsellAdsNotLinkedError(channelId, "expired");

  if (auth.accessTokenExpireAt.getTime() - Date.now() > minTtlMs) {
    return { accessToken: auth.accessToken, shopId: auth.externalShopId };
  }

  const inFlight = refreshInFlight.get(channelId);
  if (inFlight) return inFlight;
  const job = refreshLocked(auth.id, minTtlMs).finally(() => {
    refreshInFlight.delete(channelId);
  });
  refreshInFlight.set(channelId, job);
  return job;
}

/**
 * Thân refresh trong khóa: đọc lại DB (double-check) rồi mới gọi Shopee.
 * Chạy dưới khóa advisory Postgres theo gian (12/09) — tiến trình khác cùng
 * refresh phải xếp hàng, vào rồi thấy token đã mới thì dùng luôn.
 *
 * markDisconnected nằm ngoài transaction: hạ DISCONNECTED phải ĐƯỢC GHI cả khi
 * ta ném lỗi ngay sau đó (ném trong transaction là rollback mất luôn dấu hạ).
 */
async function refreshLocked(authId: string, minTtlMs: number): Promise<AccessCtx> {
  let disconnect: ChannelAppAuth | null = null;
  try {
    return await withDbLock(`hubsell-ads-token:${authId}`, async (tx) => {
      const auth = await tx.channelAppAuth.findUnique({ where: { id: authId } });
      if (!auth) throw new HubsellAdsNotLinkedError("", "not_linked");
      if (auth.status !== "ACTIVE") throw new HubsellAdsNotLinkedError(auth.channelId, "expired");

      const now = Date.now();
      if (auth.accessTokenExpireAt.getTime() - now > minTtlMs) {
        return { accessToken: auth.accessToken, shopId: auth.externalShopId };
      }
      if (auth.refreshTokenExpireAt.getTime() < now) {
        disconnect = auth;
        throw new HubsellAdsNotLinkedError(auth.channelId, "expired");
      }

      let t;
      try {
        t = await refreshAccessToken(auth.refreshToken, auth.externalShopId, getHubsellAdsConfig());
      } catch (err) {
        // refresh_token bị sàn từ chối (đã rotate mất / seller thu hồi) → refresh
        // lại cũng vô ích: đánh dấu cần ủy quyền lại để UI nhắc đúng chỗ.
        if (/invalid_refresh_token|error_auth|invalid_token/i.test((err as Error).message)) {
          disconnect = auth;
          throw new HubsellAdsNotLinkedError(auth.channelId, "expired");
        }
        throw err;
      }
      if (!t.access_token || !t.refresh_token) {
        throw new Error(`Shopee không trả token khi refresh ${HUBSELL_ADS_APP_LABEL}`);
      }
      await tx.channelAppAuth.update({
        where: { id: auth.id },
        data: {
          accessToken: t.access_token,
          refreshToken: t.refresh_token,
          accessTokenExpireAt: new Date(now + Number(t.expire_in ?? 0) * 1000),
          refreshTokenExpireAt: new Date(now + REFRESH_TOKEN_TTL_MS),
        },
      });
      return { accessToken: t.access_token, shopId: auth.externalShopId };
    });
  } finally {
    if (disconnect) await markDisconnected(disconnect);
  }
}

async function markDisconnected(auth: ChannelAppAuth): Promise<void> {
  await prisma.channelAppAuth.update({
    where: { id: auth.id },
    data: { status: "DISCONNECTED", disconnectedAt: new Date() },
  });
}

// ---------- Cron lưới an toàn (gọi từ workers/token-refresh.ts) ----------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Quét các ủy quyền Hubsell Ads ACTIVE có access_token sắp hết hạn mà không có
 * traffic kích lazy-refresh (Trợ lý tắt, shop vắng ads...) → refresh chủ động,
 * tuần tự + jitter như app chính. Trả số gian đã làm mới / đã hạ DISCONNECTED.
 */
export async function refreshExpiringHubsellAdsTokens(opts: {
  expiringSoonMs: number;
  staggerMs: () => number;
}): Promise<{ refreshed: number; disconnected: number; failed: number }> {
  const out = { refreshed: 0, disconnected: 0, failed: 0 };
  if (!isHubsellAdsConfigured()) return out;

  const soon = new Date(Date.now() + opts.expiringSoonMs);
  const auths = await prisma.channelAppAuth.findMany({
    where: {
      app: ChannelAppKind.HUBSELL_ADS,
      status: "ACTIVE",
      accessTokenExpireAt: { lt: soon },
    },
    orderBy: { accessTokenExpireAt: "asc" },
    include: { channel: { select: { shopName: true } } },
  });

  for (const auth of auths) {
    try {
      await getValidHubsellAdsAccessToken(auth.channelId, opts.expiringSoonMs);
      out.refreshed++;
      console.log(
        `[Token-refresh] ${HUBSELL_ADS_APP_LABEL}: đã làm mới token gian "${auth.channel.shopName}" (shop ${auth.externalShopId})`
      );
    } catch (err) {
      if (isHubsellAdsNotLinkedError(err)) {
        out.disconnected++;
        console.warn(
          `[Token-refresh] ${HUBSELL_ADS_APP_LABEL}: gian "${auth.channel.shopName}" hết hạn ủy quyền → cần kết nối lại`
        );
      } else {
        out.failed++;
        console.error(
          `[Token-refresh] ${HUBSELL_ADS_APP_LABEL}: lỗi refresh gian "${auth.channel.shopName}":`,
          (err as Error).message
        );
      }
    }
    await sleep(opts.staggerMs());
  }
  return out;
}

// ---------- Trạng thái cho UI ----------

export interface HubsellAdsLinkStatus {
  app: typeof HUBSELL_ADS_APP_LABEL;
  /**
   * false = Hubsell Ads chưa bật (chưa có env) → Trợ lý chạy bằng app chính,
   * UI không hiện gì. true = gian PHẢI ủy quyền Hubsell Ads mới có số liệu ads.
   */
  required: boolean;
  status: "ACTIVE" | "DISCONNECTED" | "NOT_LINKED";
  externalShopId: string | null;
  linkedAt: string | null;
  refreshTokenExpireAt: string | null;
}

export async function getHubsellAdsLinkStatus(channelId: string): Promise<HubsellAdsLinkStatus> {
  const base: HubsellAdsLinkStatus = {
    app: HUBSELL_ADS_APP_LABEL,
    required: isHubsellAdsConfigured(),
    status: "NOT_LINKED",
    externalShopId: null,
    linkedAt: null,
    refreshTokenExpireAt: null,
  };
  if (!base.required) return base;
  const auth = await prisma.channelAppAuth.findUnique({
    where: { channelId_app: { channelId, app: ChannelAppKind.HUBSELL_ADS } },
    select: {
      status: true,
      externalShopId: true,
      createdAt: true,
      refreshTokenExpireAt: true,
    },
  });
  if (!auth) return base;
  return {
    ...base,
    status: auth.status === "ACTIVE" ? "ACTIVE" : "DISCONNECTED",
    externalShopId: auth.externalShopId,
    linkedAt: auth.createdAt.toISOString(),
    refreshTokenExpireAt: auth.refreshTokenExpireAt.toISOString(),
  };
}
