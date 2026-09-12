// ============================================================
// HUBSELL ADS — ỦY QUYỀN (OAuth) CHO APP ADS SERVICE
//
// Khác luồng kết nối gian Shopee ở integrations/shopee/service.ts một điểm
// bản chất: Hubsell Ads KHÔNG tạo gian mới. Gian đã nối app chính rồi, seller
// chỉ "ủy quyền thêm" cùng gian đó cho app Ads → token ghi vào ChannelAppAuth
// (channelId, HUBSELL_ADS), không đụng token app chính trên Channel.
//
// Luồng: FE (trang Trợ lý quảng cáo) bấm "Kết nối Hubsell Ads" → GET
// /api/hubsell-ads/auth-url?channelId= → seller duyệt trên Shopee → Shopee
// redirect về /api/auth/hubsell-ads/callback?code=&shop_id=&state= → đổi token,
// đối chiếu shop_id với gian đích → redirect về /ads/shopee?hubsell_ads=connected.
// Dev local: callback đăng ký là domain Render → Render bật code về FE local
// (?hubsell_ads=code) → FE gọi POST /api/hubsell-ads/connect (cùng cơ chế
// "trạm trung chuyển" với app chính và Lazada).
// ============================================================

import jwt from "jsonwebtoken";
import { ChannelAppKind, ChannelName } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { markAdsBackfill } from "../../services/sync-schedule";
import { getShopeeAuthFlow } from "../shopee/config";
import { buildAuthorizeUrl, buildLegacyAuthorizeUrl, getAccessToken } from "../shopee/client";
import { HUBSELL_ADS_APP_LABEL, getHubsellAdsConfig } from "./config";
import { REFRESH_TOKEN_TTL_MS } from "./token";

const STATE_SECRET = process.env.JWT_SECRET ?? "hubsell_dev_jwt_secret_change_me";
const STATE_FRONTEND_URL = process.env.APP_FRONTEND_URL ?? "http://localhost:3000";
const STATE_PURPOSE = "hubsell_ads_oauth";

export interface HubsellAdsOauthState {
  ownerId: string;
  /** Gian Shopee đích — Hubsell Ads luôn gắn vào một gian đã có. */
  channelId: string;
}

/** Ký state mang ownerId + gian đích (JWT 10 phút) — callback công khai khôi phục từ đây. */
export function signHubsellAdsState(ownerId: string, channelId: string): string {
  return jwt.sign(
    { ownerId, channelId, purpose: STATE_PURPOSE, fe: STATE_FRONTEND_URL },
    STATE_SECRET,
    { expiresIn: "10m" }
  );
}

export function verifyHubsellAdsState(token: string): HubsellAdsOauthState | null {
  try {
    const p = jwt.verify(token, STATE_SECRET) as jwt.JwtPayload;
    if (p.purpose !== STATE_PURPOSE || !p.ownerId || typeof p.channelId !== "string") {
      return null;
    }
    return { ownerId: String(p.ownerId), channelId: p.channelId };
  } catch {
    return null;
  }
}

/**
 * Đọc origin FE trong state KHÔNG kiểm chữ ký (state do dev local ký bằng
 * secret khác). Chỉ chấp nhận localhost — chặn open-redirect.
 */
export function decodeHubsellAdsStateOrigin(token: string): string | null {
  try {
    const p = jwt.decode(token) as jwt.JwtPayload | null;
    if (!p || p.purpose !== STATE_PURPOSE) return null;
    const fe = typeof p.fe === "string" ? p.fe : "";
    return /^https?:\/\/localhost(:\d+)?$/.test(fe) ? fe : null;
  } catch {
    return null;
  }
}

/** URL trang ủy quyền Shopee cho app Hubsell Ads (cùng luồng legacy/new với app chính). */
export function buildHubsellAdsAuthorizeUrl(state: string): string {
  const cfg = getHubsellAdsConfig();
  return getShopeeAuthFlow() === "new"
    ? buildAuthorizeUrl(cfg.redirectUri, state, cfg)
    : buildLegacyAuthorizeUrl(cfg.redirectUri, state, cfg);
}

export interface HubsellAdsLinkResult {
  channelId: string;
  shopName: string;
  externalShopId: string;
}

/**
 * Đổi code → token của app Hubsell Ads rồi ghi vào ChannelAppAuth của gian đích.
 * Đối chiếu shop_id TRƯỚC khi đổi code (code chỉ dùng được một lần): trình
 * duyệt có thể đang đăng nhập sẵn tài khoản Shopee của gian khác.
 */
export async function handleHubsellAdsCallback(
  ownerId: string,
  code: string,
  shopId: string,
  channelId: string
): Promise<HubsellAdsLinkResult> {
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, userId: ownerId, channelName: ChannelName.SHOPEE },
    select: { id: true, shopName: true, externalShopId: true },
  });
  if (!channel) {
    throw new Error("Không tìm thấy gian Shopee cần kết nối Hubsell Ads (có thể đã bị xoá)");
  }
  if (!channel.externalShopId) {
    throw new Error(
      `Gian "${channel.shopName}" chưa liên kết Shopee bằng app chính — hãy kết nối gian ở ` +
        `trang Kênh bán trước, rồi mới ủy quyền ${HUBSELL_ADS_APP_LABEL}.`
    );
  }
  if (channel.externalShopId !== shopId) {
    throw new Error(
      `Tài khoản Shopee vừa uỷ quyền (shop ID: ${shopId}) không trùng với gian ` +
        `"${channel.shopName}" (shop ID: ${channel.externalShopId}). Hãy đăng xuất Shopee ` +
        `trên trình duyệt, đăng nhập đúng tài khoản của gian này rồi bấm Kết nối ` +
        `${HUBSELL_ADS_APP_LABEL} lại.`
    );
  }

  const token = await getAccessToken(code, shopId, getHubsellAdsConfig());
  if (!token.access_token || !token.refresh_token) {
    throw new Error(`Shopee không trả access_token/refresh_token cho ${HUBSELL_ADS_APP_LABEL}`);
  }

  const now = Date.now();
  const data = {
    externalShopId: shopId,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    // Number(): expire_in là GIÂY, phòng API trả chuỗi.
    accessTokenExpireAt: new Date(now + Number(token.expire_in ?? 0) * 1000),
    refreshTokenExpireAt: new Date(now + REFRESH_TOKEN_TTL_MS),
    status: "ACTIVE",
    disconnectedAt: null,
  };
  await prisma.channelAppAuth.upsert({
    where: { channelId_app: { channelId: channel.id, app: ChannelAppKind.HUBSELL_ADS } },
    update: data,
    create: { channelId: channel.id, app: ChannelAppKind.HUBSELL_ADS, ...data },
  });
  // Vừa nối (lại) → worker kéo lùi 30 ngày ads ngay lượt kế (12/09), seller
  // không phải chờ nhịp ngày hay bấm tay.
  await markAdsBackfill(channel.id);
  return { channelId: channel.id, shopName: channel.shopName, externalShopId: shopId };
}

/** Gỡ ủy quyền Hubsell Ads khỏi một gian (xoá token; app chính không bị ảnh hưởng). */
export async function unlinkHubsellAds(ownerId: string, channelId: string): Promise<boolean> {
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, userId: ownerId, channelName: ChannelName.SHOPEE },
    select: { id: true },
  });
  if (!channel) return false;
  const r = await prisma.channelAppAuth.deleteMany({
    where: { channelId: channel.id, app: ChannelAppKind.HUBSELL_ADS },
  });
  return r.count > 0;
}
