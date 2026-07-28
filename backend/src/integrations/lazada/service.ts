// ============================================================
// LAZADA — TẦNG NGHIỆP VỤ (có truy cập DB)
//
// client.ts là các hàm API THUẦN. File này ghép chúng với Prisma:
//   1) signOauthState/verifyOauthState — mang ownerId xuyên qua Lazada an toàn.
//   2) getValidLazadaAccessToken()     — tự refresh access_token khi sắp hết hạn.
//   3) handleLazadaCallback()          — đổi code → token → lưu/cập nhật Channel.
//
// CHƯA có đồng bộ đơn/sản phẩm — bước này chỉ lo KẾT NỐI gian hàng. Đồng bộ
// nghiệp vụ làm sau khi luồng OAuth đã kiểm chứng chạy thật (như trình tự Shopee).
// ============================================================

import jwt from "jsonwebtoken";
import type { Channel } from "@prisma/client";
import { ChannelName } from "@prisma/client";
import { prisma } from "../../prisma";
import { CHANNEL_LABEL, PLATFORM_FEE_RATE } from "../../mockMarketplace";
import {
  createToken,
  getSellerInfo,
  refreshToken,
  type LazadaTokenData,
} from "./client";

// Refresh khi access_token còn <30 phút là hết hạn. Token Lazada sống 7 ngày
// nên biên rộng hơn Shopee (4h) một chút cũng không tốn thêm lượt refresh nào.
const REFRESH_BUFFER_MS = 30 * 60 * 1000;
// Phòng hờ khi Lazada không trả expires: access 7 ngày / refresh 30 ngày (theo
// cấu hình app trên Console).
const FALLBACK_ACCESS_TTL_S = 7 * 24 * 60 * 60;
const FALLBACK_REFRESH_TTL_S = 30 * 24 * 60 * 60;

const STATE_SECRET = process.env.JWT_SECRET ?? "hubsell_dev_jwt_secret_change_me";

// ---------- State chống CSRF + mang ownerId ----------
//
// Callback Lazada là endpoint CÔNG KHAI (không JWT) nên không tự biết đang kết
// nối cho chủ shop nào. Ta ký ownerId vào `state` (JWT ngắn hạn) lúc sinh URL
// uỷ quyền, Lazada trả lại nguyên vẹn ở callback — vừa định danh vừa chống giả mạo.

export function signOauthState(ownerId: string): string {
  return jwt.sign({ ownerId, purpose: "lazada_oauth" }, STATE_SECRET, { expiresIn: "10m" });
}

export function verifyOauthState(token: string): string | null {
  try {
    const payload = jwt.verify(token, STATE_SECRET) as jwt.JwtPayload;
    if (payload.purpose !== "lazada_oauth" || !payload.ownerId) return null;
    return String(payload.ownerId);
  } catch {
    return null;
  }
}

// ---------- Tự refresh access_token ----------

/**
 * Trả access_token còn hạn cho một gian Lazada, TỰ refresh nếu sắp/đã hết hạn
 * rồi lưu token mới xuống DB. Gọi NGAY TRƯỚC mọi lượt gọi API nghiệp vụ Lazada.
 */
export async function getValidLazadaAccessToken(channel: Channel): Promise<string> {
  if (channel.channelName !== ChannelName.LAZADA) {
    throw new Error("Gian hàng này không phải Lazada");
  }
  if (!channel.apiToken || !channel.refreshToken) {
    throw new Error("Gian hàng chưa uỷ quyền Lazada (thiếu token)");
  }

  const now = Date.now();
  const accessExp = channel.accessTokenExpireAt?.getTime() ?? 0;
  if (accessExp - now > REFRESH_BUFFER_MS) {
    return channel.apiToken;
  }

  const refreshExp = channel.refreshTokenExpireAt?.getTime() ?? 0;
  if (refreshExp && refreshExp < now) {
    throw new Error("Phiên uỷ quyền Lazada đã hết hạn (refresh_token). Vui lòng kết nối lại.");
  }

  const t = await refreshToken(channel.refreshToken);
  if (!t.access_token || !t.refresh_token) {
    throw new Error("Lazada không trả token khi refresh");
  }
  await prisma.channel.update({
    where: { id: channel.id },
    data: tokenFields(t, now),
  });
  return t.access_token;
}

/** Các cột token của Channel tính từ payload token Lazada. */
function tokenFields(t: LazadaTokenData, nowMs: number) {
  return {
    apiToken: t.access_token,
    refreshToken: t.refresh_token,
    accessTokenExpireAt: new Date(nowMs + (t.expires_in ?? FALLBACK_ACCESS_TTL_S) * 1000),
    refreshTokenExpireAt: new Date(
      nowMs + (t.refresh_expires_in ?? FALLBACK_REFRESH_TTL_S) * 1000
    ),
  };
}

// ---------- Xử lý callback: đổi token + lưu Channel ----------

export interface LazadaConnectResult {
  id: string;
  channelName: ChannelName;
  shopName: string;
  externalShopId: string | null;
  status: string;
}

/**
 * Đổi `code` (Lazada trả ở callback) lấy token, lấy seller_id + tên gian rồi
 * tạo mới / cập nhật Channel cho chủ shop `ownerId`. Định danh gian theo
 * (userId, channelName=LAZADA, externalShopId=seller_id) — idempotent khi kết
 * nối lại. Lazada KHÔNG kiểm redirect_uri ở bước đổi token nên hàm này dùng
 * được cho cả callback tự động (Render) lẫn luồng dán code thủ công (local).
 */
export async function handleLazadaCallback(
  ownerId: string,
  code: string
): Promise<LazadaConnectResult> {
  const token = await createToken(code);
  if (!token.access_token || !token.refresh_token) {
    throw new Error("Lazada không trả access_token/refresh_token");
  }

  // seller_id ưu tiên lấy từ payload token (thị trường VN); thiếu thì hỏi
  // /seller/get. Tên gian lấy từ /seller/get — lỗi ở bước lấy tên không được
  // làm hỏng cả kết nối.
  let sellerId =
    token.country_user_info?.find((c) => (c.country ?? "").toLowerCase() === "vn")
      ?.seller_id ??
    token.country_user_info?.[0]?.seller_id ??
    null;
  let externalShopName: string | null = null;
  try {
    const info = await getSellerInfo(token.access_token);
    externalShopName = info.name?.trim() || null;
    if (!sellerId && info.seller_id != null) sellerId = String(info.seller_id);
  } catch {
    externalShopName = null;
  }
  if (!sellerId) {
    throw new Error("Lazada không trả seller_id — không định danh được gian hàng");
  }
  const shopId = String(sellerId);

  const now = Date.now();
  const tokenData = {
    ...tokenFields(token, now),
    externalShopName,
    status: "ACTIVE",
  };

  const existing = await prisma.channel.findFirst({
    where: {
      userId: ownerId,
      channelName: ChannelName.LAZADA,
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

  // Tên gian mặc định = tên phía Lazada, tránh trùng tên gian đã có trong cùng sàn.
  let shopName = externalShopName || `${CHANNEL_LABEL[ChannelName.LAZADA]} ${shopId}`;
  const clash = await prisma.channel.findFirst({
    where: { userId: ownerId, channelName: ChannelName.LAZADA, shopName },
    select: { id: true },
  });
  if (clash) shopName = `${shopName} (${shopId.slice(-4)})`;

  const created = await prisma.channel.create({
    data: {
      userId: ownerId,
      channelName: ChannelName.LAZADA,
      shopName,
      externalShopId: shopId,
      feeRate: PLATFORM_FEE_RATE[ChannelName.LAZADA],
      ...tokenData,
    },
  });
  return toResult(created);
}

function toResult(c: Channel): LazadaConnectResult {
  return {
    id: c.id,
    channelName: c.channelName,
    shopName: c.shopName,
    externalShopId: c.externalShopId,
    status: c.status,
  };
}
