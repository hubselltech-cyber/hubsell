// ============================================================
// SHOPEE — TẦNG NGHIỆP VỤ (có truy cập DB)
//
// client.ts là các hàm API THUẦN. File này ghép chúng với Prisma:
//   1) signOauthState/verifyOauthState — mang ownerId xuyên qua Shopee an toàn.
//   2) getValidShopeeAccessToken()     — tự refresh access_token khi sắp hết hạn.
//   3) handleShopeeCallback()          — đổi code → token → lưu/ cập nhật Channel.
// ============================================================

import jwt from "jsonwebtoken";
import type { Channel } from "@prisma/client";
import { ChannelName } from "@prisma/client";
import { prisma } from "../../prisma";
import { CHANNEL_LABEL, PLATFORM_FEE_RATE } from "../../mockMarketplace";
import { getAccessToken, getShopInfo, refreshAccessToken } from "./client";

// Refresh khi access_token còn <5 phút là hết hạn (chừa biên cho call nối tiếp).
const REFRESH_BUFFER_MS = 5 * 60 * 1000;
// Refresh_token của Shopee sống 30 ngày — hết thì buộc uỷ quyền lại.
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const STATE_SECRET = process.env.JWT_SECRET ?? "hubsell_dev_jwt_secret_change_me";

// ---------- State chống CSRF + mang ownerId ----------
//
// Callback Shopee là endpoint CÔNG KHAI (không JWT) nên không tự biết đang kết nối
// cho chủ shop nào. Ta ký ownerId vào `state` (JWT ngắn hạn) lúc sinh URL uỷ quyền,
// Shopee trả lại nguyên vẹn ở callback để khôi phục ownerId — vừa định danh vừa
// chống giả mạo.

export function signOauthState(ownerId: string): string {
  return jwt.sign({ ownerId, purpose: "shopee_oauth" }, STATE_SECRET, { expiresIn: "10m" });
}

export function verifyOauthState(token: string): string | null {
  try {
    const payload = jwt.verify(token, STATE_SECRET) as jwt.JwtPayload;
    if (payload.purpose !== "shopee_oauth" || !payload.ownerId) return null;
    return String(payload.ownerId);
  } catch {
    return null;
  }
}

// ---------- Tự refresh access_token ----------

export interface ShopeeAccessContext {
  accessToken: string;
  shopId: string;
}

/**
 * Trả access_token còn hạn cho một gian Shopee, TỰ refresh nếu sắp/đã hết hạn rồi
 * lưu token mới xuống DB. Gọi NGAY TRƯỚC mọi lượt gọi API nghiệp vụ Shopee.
 */
export async function getValidShopeeAccessToken(
  channel: Channel
): Promise<ShopeeAccessContext> {
  if (channel.channelName !== ChannelName.SHOPEE) {
    throw new Error("Gian hàng này không phải Shopee");
  }
  if (!channel.apiToken || !channel.refreshToken || !channel.externalShopId) {
    throw new Error("Gian hàng chưa uỷ quyền Shopee (thiếu token/shop_id)");
  }

  const now = Date.now();
  const accessExp = channel.accessTokenExpireAt?.getTime() ?? 0;
  if (accessExp - now > REFRESH_BUFFER_MS) {
    return { accessToken: channel.apiToken, shopId: channel.externalShopId };
  }

  const refreshExp = channel.refreshTokenExpireAt?.getTime() ?? 0;
  if (refreshExp && refreshExp < now) {
    throw new Error("Phiên uỷ quyền Shopee đã hết hạn (refresh_token). Vui lòng kết nối lại.");
  }

  const t = await refreshAccessToken(channel.refreshToken, channel.externalShopId);
  if (!t.access_token || !t.refresh_token) {
    throw new Error("Shopee không trả token khi refresh");
  }
  await prisma.channel.update({
    where: { id: channel.id },
    data: {
      apiToken: t.access_token,
      refreshToken: t.refresh_token,
      accessTokenExpireAt: new Date(now + (t.expire_in ?? 0) * 1000),
      refreshTokenExpireAt: new Date(now + REFRESH_TOKEN_TTL_MS),
    },
  });
  return { accessToken: t.access_token, shopId: channel.externalShopId };
}

// ---------- Xử lý callback: đổi token + lưu Channel ----------

export interface ShopeeConnectResult {
  id: string;
  channelName: ChannelName;
  shopName: string;
  externalShopId: string | null;
  status: string;
}

/**
 * Đổi `code`+`shop_id` (Shopee trả ở callback) lấy token, lấy tên gian rồi
 * tạo mới / cập nhật Channel cho chủ shop `ownerId`. Định danh gian theo
 * (userId, channelName=SHOPEE, externalShopId=shop_id) — idempotent khi kết nối lại.
 */
export async function handleShopeeCallback(
  ownerId: string,
  code: string,
  shopId: string
): Promise<ShopeeConnectResult> {
  const token = await getAccessToken(code, shopId);
  if (!token.access_token || !token.refresh_token) {
    throw new Error("Shopee không trả access_token/refresh_token");
  }

  // Lấy tên gian để hiển thị — lỗi ở bước này không được làm hỏng cả kết nối.
  let externalShopName: string | null = null;
  try {
    const info = await getShopInfo(token.access_token, shopId);
    externalShopName = info.shop_name?.trim() || null;
  } catch {
    externalShopName = null;
  }

  const now = Date.now();
  const tokenData = {
    apiToken: token.access_token,
    refreshToken: token.refresh_token,
    accessTokenExpireAt: new Date(now + (token.expire_in ?? 0) * 1000),
    refreshTokenExpireAt: new Date(now + REFRESH_TOKEN_TTL_MS),
    externalShopName,
    status: "ACTIVE",
  };

  const existing = await prisma.channel.findFirst({
    where: {
      userId: ownerId,
      channelName: ChannelName.SHOPEE,
      externalShopId: shopId,
    },
  });

  if (existing) {
    const updated = await prisma.channel.update({
      where: { id: existing.id },
      data: tokenData,
    });
    return toResult(updated);
  }

  // Tên gian mặc định = tên phía Shopee, tránh trùng tên gian đã có trong cùng sàn.
  let shopName = externalShopName || `${CHANNEL_LABEL[ChannelName.SHOPEE]} ${shopId}`;
  const clash = await prisma.channel.findFirst({
    where: { userId: ownerId, channelName: ChannelName.SHOPEE, shopName },
    select: { id: true },
  });
  if (clash) shopName = `${shopName} (${shopId.slice(-4)})`;

  const created = await prisma.channel.create({
    data: {
      userId: ownerId,
      channelName: ChannelName.SHOPEE,
      shopName,
      externalShopId: shopId,
      feeRate: PLATFORM_FEE_RATE[ChannelName.SHOPEE],
      ...tokenData,
    },
  });
  return toResult(created);
}

function toResult(c: Channel): ShopeeConnectResult {
  return {
    id: c.id,
    channelName: c.channelName,
    shopName: c.shopName,
    externalShopId: c.externalShopId,
    status: c.status,
  };
}
