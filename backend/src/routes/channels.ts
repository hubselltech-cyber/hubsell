import { Router, type Response } from "express";
import crypto from "crypto";
import { ChannelName } from "@prisma/client";
import { prisma } from "../prisma";
import { requireAdmin, type AuthRequest } from "../auth";
import {
  CHANNEL_LABEL,
  PLATFORM_FEE_RATE,
  TOKEN_PREFIX,
} from "../mockMarketplace";
import {
  buildAuthorizeUrl,
  expireToDate,
  isTikTokConfigured,
} from "../integrations/tiktok/config";
import {
  getAccessToken,
  getAuthorizedShops,
  type TikTokTokenData,
} from "../integrations/tiktok/client";
import {
  syncTiktokOrders,
  syncTiktokSettlements,
} from "../integrations/tiktok/service";
import {
  isLazadaConfigured,
  buildAuthorizeUrl as buildLazadaAuthorizeUrl,
} from "../integrations/lazada/config";
import {
  signOauthState as signLazadaState,
  handleLazadaCallback,
  syncLazadaOrders,
  syncLazadaSettlements,
} from "../integrations/lazada/service";
import { isShopeeConfigured, getShopeeConfig } from "../integrations/shopee/config";
import { buildAuthorizeUrl as buildShopeeAuthorizeUrl } from "../integrations/shopee/client";
import {
  handleShopeeCallback,
  signOauthState as signShopeeState,
  syncShopeeOrders,
} from "../integrations/shopee/service";
import {
  syncShopeePendingEscrowEstimates,
  syncShopeeSettlements,
} from "../integrations/shopee/settlements";
import { syncShopeeAdsSpend } from "../integrations/shopee/ads-spend";
import { syncShopeeAdsCampaigns } from "../integrations/shopee/ads-campaigns";
import { getEscrowDetail } from "../integrations/shopee/client";
import { getValidShopeeAccessToken } from "../integrations/shopee/service";

const router = Router();

const CONNECTABLE: ChannelName[] = [
  ChannelName.SHOPEE,
  ChannelName.LAZADA,
  ChannelName.TIKTOK,
  ChannelName.OFFLINE,
];

// GET /api/channels — kênh bán của shop (kèm số đơn + số sản phẩm đã liên kết).
// Staff cũng được xem (cần cho bộ lọc đơn hàng) nhưng KHÔNG thấy apiToken.
router.get("/", async (req: AuthRequest, res, next) => {
  try {
    const channels = await prisma.channel.findMany({
      where: {
        userId: req.ownerId!,
        // Nhân viên bị giới hạn kênh chỉ thấy các kênh được gán
        ...(req.allowedChannelIds ? { id: { in: req.allowedChannelIds } } : {}),
      },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { orders: true, channelProducts: true } } },
    });

    // Số sản phẩm sàn ĐÃ KHỚP mã SKU về kho gốc (productId != null) — khác với
    // tổng channelProducts (gồm cả sản phẩm sàn chưa liên kết).
    const matched = await prisma.channelProduct.groupBy({
      by: ["channelId"],
      where: {
        productId: { not: null },
        channel: {
          userId: req.ownerId!,
          ...(req.allowedChannelIds ? { id: { in: req.allowedChannelIds } } : {}),
        },
      },
      _count: { _all: true },
    });
    const matchedByChannel = new Map(
      matched.map((m) => [m.channelId, m._count._all])
    );

    const isAdmin = req.userRole === "ADMIN";
    res.json(
      channels.map((c) => {
        // KHÔNG bao giờ trả secret (refreshToken, shopCipher) ra ngoài. apiToken
        // chỉ Admin thấy (giữ hành vi cũ). Còn lại phơi cờ tiện cho giao diện.
        const {
          refreshToken: _rt,
          shopCipher: _sc,
          accessTokenExpireAt,
          refreshTokenExpireAt: _rte,
          apiToken,
          ...safe
        } = c;
        return {
          ...safe,
          apiToken: isAdmin ? apiToken : null,
          // Đã nối API thật (OAuth) hay chỉ là gian giả lập/thủ công. Dùng
          // refreshToken làm dấu hiệu chung cho MỌI sàn (TikTok có shop_cipher,
          // Shopee thì không — nhưng cả hai đều có refreshToken khi nối thật).
          apiConnected: Boolean(c.refreshToken),
          accessTokenExpireAt,
          matchedProductCount: matchedByChannel.get(c.id) ?? 0,
        };
      })
    );
  } catch (err) {
    next(err);
  }
});

// POST /api/channels — kết nối một gian hàng ảo (giả lập OAuth với sàn).
// Ở bản thật: bước này sẽ chuyển hướng người dùng sang trang uỷ quyền của
// Shopee/TikTok rồi nhận access token. Ở đây ta sinh token giả lập ngay.
router.post("/", requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const { channelName, shopName } = req.body ?? {};
    if (!CONNECTABLE.includes(channelName)) {
      res.status(400).json({
        error: "Kênh không hợp lệ. Chọn một trong: SHOPEE, LAZADA, TIKTOK, OFFLINE",
      });
      return;
    }
    const name = channelName as ChannelName;

    // Tên gian hàng là thứ phân biệt hai shop trên cùng một sàn. Không có tên
    // thì lấy tên sàn làm mặc định (trường hợp shop chỉ có một gian).
    const finalShopName =
      typeof shopName === "string" && shopName.trim()
        ? shopName.trim()
        : CHANNEL_LABEL[name];
    if (finalShopName.length > 60) {
      res.status(400).json({ error: "Tên gian hàng tối đa 60 ký tự" });
      return;
    }

    // MỘT SÀN CÓ THỂ CÓ NHIỀU GIAN HÀNG — chỉ chặn khi TRÙNG TÊN trong cùng
    // sàn, vì lúc đó chủ shop không phân biệt được hai gian trên giao diện.
    const existing = await prisma.channel.findFirst({
      where: {
        userId: req.ownerId!,
        channelName: name,
        shopName: finalShopName,
      },
    });

    const apiToken = `${TOKEN_PREFIX[name]}_${crypto.randomBytes(20).toString("hex")}`;

    if (existing) {
      if (existing.status === "ACTIVE") {
        res.status(409).json({
          error: `Đã có gian hàng "${finalShopName}" trên ${CHANNEL_LABEL[name]}. Đặt tên khác để kết nối thêm gian.`,
        });
        return;
      }
      // Đã từng ngắt kết nối → kết nối lại với token mới
      const reconnected = await prisma.channel.update({
        where: { id: existing.id },
        data: { status: "ACTIVE", apiToken, feeRate: PLATFORM_FEE_RATE[name] },
      });
      res.json(reconnected);
      return;
    }

    const channel = await prisma.channel.create({
      data: {
        userId: req.ownerId!,
        channelName: name,
        shopName: finalShopName,
        apiToken,
        status: "ACTIVE",
        feeRate: PLATFORM_FEE_RATE[name], // % phí sàn mặc định để tạm tính
      },
    });
    res.status(201).json(channel);
  } catch (err) {
    next(err);
  }
});

// ============================================================
// KẾT NỐI TIKTOK SHOP THẬT (OAuth2)
//
// Luồng: FE bấm Kết nối → GET auth-url (BE dựng URL uỷ quyền) → user duyệt trên
// TikTok → TikTok redirect về /channels/tiktok/callback?code=...&state=... →
// FE gửi code về POST callback → BE đổi token + lấy shop_cipher + lưu Channel.
// ============================================================

// GET /api/channels/tiktok/auth-url — trả URL trang uỷ quyền + state chống CSRF.
// FE lưu state (sessionStorage) rồi đối chiếu khi TikTok trả về.
router.get("/tiktok/auth-url", requireAdmin, (_req: AuthRequest, res, next) => {
  try {
    if (!isTikTokConfigured()) {
      res.status(503).json({
        error:
          "Chưa cấu hình TikTok Shop. Điền TIKTOK_APP_KEY / TIKTOK_APP_SECRET / TIKTOK_SERVICE_ID trong backend/.env.",
        code: "TIKTOK_NOT_CONFIGURED",
      });
      return;
    }
    const state = crypto.randomBytes(16).toString("hex");
    res.json({ url: buildAuthorizeUrl(state), state });
  } catch (err) {
    next(err);
  }
});

// POST /api/channels/tiktok/callback — đổi auth_code lấy token và lưu gian hàng.
// Body: { code: string; channelId?: string } — channelId là gian đích của luồng
// Kết nối lại (state đã được FE đối chiếu trước khi gọi).
router.post("/tiktok/callback", requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const { code, channelId } = req.body ?? {};
    if (typeof code !== "string" || !code.trim()) {
      res.status(400).json({ error: "Thiếu mã uỷ quyền (auth_code) từ TikTok" });
      return;
    }

    // 1) Đổi auth_code → access/refresh token
    let token: TikTokTokenData;
    try {
      token = await getAccessToken(code.trim());
    } catch (e) {
      res.status(502).json({
        error: `Không đổi được mã uỷ quyền: ${(e as Error).message}`,
      });
      return;
    }

    // 2) Lấy danh sách gian đã uỷ quyền + shop_cipher (bắt buộc cho API sau này)
    let shops;
    try {
      shops = await getAuthorizedShops(token.access_token);
    } catch (e) {
      res.status(502).json({
        error: `Lấy được token nhưng không đọc được gian hàng: ${(e as Error).message}`,
      });
      return;
    }
    if (!shops.length) {
      res.status(422).json({
        error: "Tài khoản này chưa uỷ quyền gian hàng nào cho ứng dụng.",
      });
      return;
    }

    // KẾT NỐI LẠI một gian cụ thể: tài khoản TikTok vừa uỷ quyền phải CHỨA đúng
    // gian đích — không thì báo rõ thay vì lặng lẽ ghi token cho gian khác
    // (trình duyệt có thể đang đăng nhập sẵn tài khoản TikTok khác).
    if (typeof channelId === "string" && channelId) {
      const target = await prisma.channel.findFirst({
        where: { id: channelId, userId: req.ownerId!, channelName: ChannelName.TIKTOK },
        select: { shopName: true, externalShopId: true },
      });
      if (!target) {
        res.status(404).json({ error: "Không tìm thấy gian TikTok cần kết nối lại" });
        return;
      }
      if (target.externalShopId && !shops.some((s) => s.id === target.externalShopId)) {
        res.status(409).json({
          error:
            `Tài khoản TikTok vừa uỷ quyền không chứa gian cần kết nối lại ` +
            `"${target.shopName}" (shop ID: ${target.externalShopId}). Hãy đăng xuất ` +
            "TikTok Seller Center trên trình duyệt, đăng nhập đúng tài khoản của gian " +
            "này rồi bấm Kết nối lại.",
        });
        return;
      }
    }

    const accessExpireAt = expireToDate(token.access_token_expire_in);
    const refreshExpireAt = expireToDate(token.refresh_token_expire_in);

    // 3) Với mỗi gian: tạo mới hoặc cập nhật token (định danh theo externalShopId).
    const saved = [];
    for (const shop of shops) {
      const existing = await prisma.channel.findFirst({
        where: {
          userId: req.ownerId!,
          channelName: ChannelName.TIKTOK,
          externalShopId: shop.id,
        },
      });

      const tokenData = {
        apiToken: token.access_token,
        refreshToken: token.refresh_token,
        accessTokenExpireAt: accessExpireAt,
        refreshTokenExpireAt: refreshExpireAt,
        shopCipher: shop.cipher,
        externalShopName: shop.name,
        status: "ACTIVE",
      };

      if (existing) {
        saved.push(
          await prisma.channel.update({ where: { id: existing.id }, data: tokenData })
        );
        continue;
      }

      // Tên gian mặc định = tên phía TikTok, tránh trùng tên gian đã có trong cùng sàn.
      let shopName = shop.name?.trim() || CHANNEL_LABEL[ChannelName.TIKTOK];
      const clash = await prisma.channel.findFirst({
        where: { userId: req.ownerId!, channelName: ChannelName.TIKTOK, shopName },
        select: { id: true },
      });
      if (clash) shopName = `${shopName} (${shop.id.slice(-4)})`;

      saved.push(
        await prisma.channel.create({
          data: {
            userId: req.ownerId!,
            channelName: ChannelName.TIKTOK,
            shopName,
            externalShopId: shop.id,
            feeRate: PLATFORM_FEE_RATE[ChannelName.TIKTOK],
            ...tokenData,
          },
        })
      );
    }

    // Không lộ token ra response — chỉ trả thông tin nhận diện gian.
    res.status(201).json({
      connected: saved.length,
      channels: saved.map((c) => ({
        id: c.id,
        channelName: c.channelName,
        shopName: c.shopName,
        externalShopId: c.externalShopId,
        status: c.status,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// KẾT NỐI SHOPEE THẬT (OAuth v2)
//
// Luồng: FE bấm Kết nối → GET auth-url (BE ký + dựng URL, nhét ownerId vào state)
// → user duyệt trên Shopee → Shopee redirect về /api/auth/shopee/callback?code=
// &shop_id=&state= → BE (routes/auth.ts) đổi token + lưu Channel + redirect về FE.
// ============================================================

// GET /api/channels/shopee/auth-url — trả URL uỷ quyền Shopee (đã ký).
// State mang ownerId (JWT ngắn hạn) để callback công khai biết kết nối cho ai.
router.get("/shopee/auth-url", requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    if (!isShopeeConfigured()) {
      res.status(503).json({
        error:
          "Chưa cấu hình Shopee. Điền SHOPEE_PARTNER_ID / SHOPEE_PARTNER_KEY trong backend/.env.",
        code: "SHOPEE_NOT_CONFIGURED",
      });
      return;
    }
    // ?channelId= (tuỳ chọn) = luồng KẾT NỐI LẠI một gian cụ thể: nhét gian đích
    // vào state để callback đối chiếu shop_id, tránh ghi token nhầm gian khác.
    const channelId =
      typeof req.query.channelId === "string" && req.query.channelId
        ? req.query.channelId
        : undefined;
    if (channelId) {
      const owned = await prisma.channel.findFirst({
        where: { id: channelId, userId: req.ownerId!, channelName: ChannelName.SHOPEE },
        select: { id: true },
      });
      if (!owned) {
        res.status(404).json({ error: "Không tìm thấy gian Shopee cần kết nối lại" });
        return;
      }
    }
    const cfg = getShopeeConfig();
    const state = signShopeeState(req.ownerId!, channelId);
    // State đi kèm redirect; Shopee gắn thêm &code=&shop_id= khi trả về.
    const sep = cfg.redirectUri.includes("?") ? "&" : "?";
    const redirect = `${cfg.redirectUri}${sep}state=${encodeURIComponent(state)}`;
    res.json({ url: buildShopeeAuthorizeUrl(redirect, cfg) });
  } catch (err) {
    next(err);
  }
});

// POST /api/channels/shopee/connect — đổi CODE + SHOP_ID lấy token + lưu Channel.
// Dành cho dev local: callback đăng ký trên Console là URL Render, Render nhận
// ra state ký từ localhost thì bật code+shop_id về FE local (?shopee=code) và FE
// gọi vào đây. Idempotent theo (userId, SHOPEE, shop_id) — như callback thật.
router.post("/shopee/connect", requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { code, shopId, channelId } = req.body ?? {};
    if (typeof code !== "string" || !code.trim() || typeof shopId !== "string" || !shopId.trim()) {
      res.status(400).json({ error: "Thiếu code hoặc shopId uỷ quyền Shopee" });
      return;
    }
    // channelId (tuỳ chọn) = gian đích của luồng Kết nối lại — service đối chiếu
    // shop_id trước khi ghi token.
    const saved = await handleShopeeCallback(
      req.ownerId!,
      code.trim(),
      shopId.trim(),
      typeof channelId === "string" && channelId ? channelId : undefined
    );
    res.json({ message: `Đã kết nối gian "${saved.shopName}"`, channel: saved });
  } catch (err) {
    // Lỗi phía Shopee (code hết hạn, chữ ký sai...) trả 502 kèm message gốc.
    res.status(502).json({ error: `Kết nối Shopee thất bại: ${(err as Error).message}` });
  }
});

// ============================================================
// KẾT NỐI LAZADA THẬT (OAuth2 Server-side)
//
// Luồng deploy: FE bấm Kết nối → GET auth-url (state mang ownerId) → user duyệt
// trên Lazada → Lazada redirect về callback Render (routes/auth.ts) → lưu Channel.
// Luồng LOCAL: callback đăng ký là URL Render (Lazada bắt https) nên local không
// nhận được redirect — user copy ?code=... từ URL callback rồi DÁN vào FE, FE
// gọi POST /lazada/connect bên dưới (ownerId lấy từ JWT đăng nhập, khỏi cần state).
// ============================================================

// GET /api/channels/lazada/auth-url — trả URL trang uỷ quyền Lazada.
router.get("/lazada/auth-url", requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    if (!isLazadaConfigured()) {
      res.status(503).json({
        error:
          "Chưa cấu hình Lazada. Điền LAZADA_APP_KEY / LAZADA_APP_SECRET trong backend/.env.",
        code: "LAZADA_NOT_CONFIGURED",
      });
      return;
    }
    // ?channelId= (tuỳ chọn) = luồng KẾT NỐI LẠI một gian cụ thể: nhét gian đích
    // vào state để callback đối chiếu seller_id, tránh ghi token nhầm gian khác.
    // (URL uỷ quyền đã kèm force_auth=true — Lazada buộc đăng nhập/đồng ý lại,
    // không tự nuốt session đang dở trên trình duyệt.)
    const channelId =
      typeof req.query.channelId === "string" && req.query.channelId
        ? req.query.channelId
        : undefined;
    if (channelId) {
      const owned = await prisma.channel.findFirst({
        where: { id: channelId, userId: req.ownerId!, channelName: ChannelName.LAZADA },
        select: { id: true },
      });
      if (!owned) {
        res.status(404).json({ error: "Không tìm thấy gian Lazada cần kết nối lại" });
        return;
      }
    }
    const state = signLazadaState(req.ownerId!, channelId);
    res.json({ url: buildLazadaAuthorizeUrl(state) });
  } catch (err) {
    next(err);
  }
});

// POST /api/channels/lazada/connect — đổi CODE dán tay lấy token + lưu Channel.
// Dành cho test local (callback nằm trên Render). Idempotent theo seller_id.
router.post("/lazada/connect", requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { code, channelId } = req.body ?? {};
    if (typeof code !== "string" || !code.trim()) {
      res.status(400).json({ error: "Thiếu code uỷ quyền Lazada" });
      return;
    }
    // channelId (tuỳ chọn) = gian đích của luồng Kết nối lại — service đối chiếu
    // seller_id trước khi ghi token.
    const saved = await handleLazadaCallback(
      req.ownerId!,
      code.trim(),
      typeof channelId === "string" && channelId ? channelId : undefined
    );
    res.json({ message: `Đã kết nối gian "${saved.shopName}"`, channel: saved });
  } catch (err) {
    // Lỗi phía Lazada (code hết hạn, chữ ký sai...) trả 502 kèm message gốc.
    res.status(502).json({ error: `Kết nối Lazada thất bại: ${(err as Error).message}` });
  }
});

/**
 * Lấy một gian TikTok đã uỷ quyền của shop hoặc trả lỗi phù hợp. Dùng chung cho
 * 2 route đồng bộ bên dưới để không lặp phần kiểm tra.
 */
async function requireTiktokChannel(req: AuthRequest, res: Response) {
  const channel = await prisma.channel.findFirst({
    where: { id: req.params.id, userId: req.ownerId! },
  });
  if (!channel) {
    res.status(404).json({ error: "Không tìm thấy gian hàng" });
    return null;
  }
  if (channel.channelName !== ChannelName.TIKTOK) {
    res.status(400).json({ error: "Đồng bộ API hiện chỉ hỗ trợ gian TikTok Shop" });
    return null;
  }
  if (!channel.shopCipher) {
    res.status(409).json({
      error: "Gian hàng chưa uỷ quyền TikTok. Hãy kết nối lại để cấp quyền API.",
      code: "TIKTOK_NOT_AUTHORIZED",
    });
    return null;
  }
  return channel;
}

// POST /api/channels/:id/sync-orders — kéo đơn thật → upsert vào DB.
// Dispatch theo sàn: TikTok (cần shopCipher) hoặc Shopee (cần refreshToken).
router.post("/:id/sync-orders", requireAdmin, async (req: AuthRequest, res) => {
  try {
    const channel = await prisma.channel.findFirst({
      where: { id: req.params.id, userId: req.ownerId! },
    });
    if (!channel) {
      res.status(404).json({ error: "Không tìm thấy gian hàng" });
      return;
    }

    if (channel.channelName === ChannelName.TIKTOK) {
      if (!channel.shopCipher) {
        res.status(409).json({
          error: "Gian TikTok chưa uỷ quyền. Hãy kết nối lại để cấp quyền API.",
          code: "TIKTOK_NOT_AUTHORIZED",
        });
        return;
      }
      const summary = await syncTiktokOrders(channel);
      res.json({ message: "Đồng bộ đơn hàng TikTok xong", ...summary });
      return;
    }

    if (channel.channelName === ChannelName.SHOPEE) {
      if (!channel.refreshToken) {
        res.status(409).json({
          error: "Gian Shopee chưa uỷ quyền. Hãy kết nối lại để cấp quyền API.",
          code: "SHOPEE_NOT_AUTHORIZED",
        });
        return;
      }
      const summary = await syncShopeeOrders(channel);
      res.json({ message: "Đồng bộ đơn hàng Shopee xong", ...summary });
      return;
    }

    if (channel.channelName === ChannelName.LAZADA) {
      if (!channel.refreshToken) {
        res.status(409).json({
          error: "Gian Lazada chưa uỷ quyền. Hãy kết nối lại để cấp quyền API.",
          code: "LAZADA_NOT_AUTHORIZED",
        });
        return;
      }
      const summary = await syncLazadaOrders(channel);
      res.json({ message: "Đồng bộ đơn hàng Lazada xong", ...summary });
      return;
    }

    res.status(400).json({ error: "Đồng bộ đơn hiện chỉ hỗ trợ TikTok, Shopee và Lazada" });
  } catch (err) {
    res.status(502).json({ error: `Đồng bộ đơn thất bại: ${(err as Error).message}` });
  }
});

// POST /api/channels/:id/sync-ads-spend — kéo CHI PHÍ QUẢNG CÁO theo ngày từ
// Ads API (read-only) → bảng AdSpend. Lỗi permission trả 502 kèm message gốc
// để chẩn đoán (app có thể chưa được Shopee bật module Ads).
router.post(
  "/:id/sync-ads-spend",
  requireAdmin,
  async (req: AuthRequest, res) => {
    try {
      const channel = await prisma.channel.findFirst({
        where: {
          id: req.params.id,
          userId: req.ownerId!,
          channelName: ChannelName.SHOPEE,
        },
      });
      if (!channel) {
        res.status(404).json({ error: "Không tìm thấy gian Shopee" });
        return;
      }
      const summary = await syncShopeeAdsSpend(channel, { daysBack: 30 });
      res.json({ message: "Đồng bộ chi phí quảng cáo Shopee xong", ...summary });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  }
);

// POST /api/channels/:id/sync-ads-campaigns — kéo CHIẾN DỊCH QUẢNG CÁO + hiệu
// suất ngày từ Ads API (read-only) → AdsCampaign/AdsCampaignDailyPerf. Nút
// "Đồng bộ" trên trang Trợ lý quảng cáo Shopee gọi vào đây.
router.post(
  "/:id/sync-ads-campaigns",
  requireAdmin,
  async (req: AuthRequest, res) => {
    try {
      const channel = await prisma.channel.findFirst({
        where: {
          id: req.params.id,
          userId: req.ownerId!,
          channelName: ChannelName.SHOPEE,
        },
      });
      if (!channel) {
        res.status(404).json({ error: "Không tìm thấy gian Shopee" });
        return;
      }
      const summary = await syncShopeeAdsCampaigns(channel, { daysBack: 30 });
      res.json({ message: "Đồng bộ chiến dịch quảng cáo Shopee xong", ...summary });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  }
);

// GET /api/channels/:id/escrow-debug/:orderSn — SOI PAYLOAD ĐỐI SOÁT THÔ.
// Chỉ Admin, READ-ONLY (không ghi DB): trả nguyên văn order_income từ
// get_escrow_detail để đối chiếu từng field khi số P&L lệch với sàn.
router.get(
  "/:id/escrow-debug/:orderSn",
  requireAdmin,
  async (req: AuthRequest, res) => {
    try {
      const channel = await prisma.channel.findFirst({
        where: {
          id: req.params.id,
          userId: req.ownerId!,
          channelName: ChannelName.SHOPEE,
        },
      });
      if (!channel) {
        res.status(404).json({ error: "Không tìm thấy gian Shopee" });
        return;
      }
      const { accessToken, shopId } = await getValidShopeeAccessToken(channel);
      const detail = await getEscrowDetail({
        accessToken,
        shopId,
        orderSn: req.params.orderSn,
      });
      res.json({ orderIncome: detail.response?.order_income ?? null });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  }
);

// POST /api/channels/:id/sync-settlements — kéo đối soát thật → cập nhật số
// quyết toán (GĐ2) của từng đơn. Dispatch theo sàn: TikTok, Shopee hoặc Lazada.
router.post("/:id/sync-settlements", requireAdmin, async (req: AuthRequest, res) => {
  try {
    const channel = await prisma.channel.findFirst({
      where: { id: req.params.id, userId: req.ownerId! },
    });
    if (!channel) {
      res.status(404).json({ error: "Không tìm thấy gian hàng" });
      return;
    }

    if (channel.channelName === ChannelName.SHOPEE) {
      if (!channel.refreshToken) {
        res.status(409).json({
          error: "Gian Shopee chưa uỷ quyền. Hãy kết nối lại để cấp quyền API.",
          code: "SHOPEE_NOT_AUTHORIZED",
        });
        return;
      }
      const summary = await syncShopeeSettlements(channel);
      // Kèm lượt ước tính phí cho đơn chưa giải ngân (P&L real-time).
      const estimates = await syncShopeePendingEscrowEstimates(channel);
      res.json({ message: "Đồng bộ đối soát Shopee xong", ...summary, estimates });
      return;
    }

    if (channel.channelName === ChannelName.LAZADA) {
      if (!channel.refreshToken) {
        res.status(409).json({
          error: "Gian Lazada chưa uỷ quyền. Hãy kết nối lại để cấp quyền API.",
          code: "LAZADA_NOT_AUTHORIZED",
        });
        return;
      }
      const summary = await syncLazadaSettlements(channel);
      res.json({ message: "Đồng bộ đối soát Lazada xong", ...summary });
      return;
    }

    if (channel.channelName === ChannelName.TIKTOK) {
      const tiktok = await requireTiktokChannel(req, res);
      if (!tiktok) return;
      const summary = await syncTiktokSettlements(tiktok);
      res.json({ message: "Đồng bộ đối soát TikTok xong", ...summary });
      return;
    }

    res.status(400).json({ error: "Đồng bộ đối soát hiện hỗ trợ TikTok, Shopee và Lazada" });
  } catch (err) {
    res.status(502).json({ error: `Đồng bộ đối soát thất bại: ${(err as Error).message}` });
  }
});

/**
 * PATCH /api/channels/:id — sửa thông tin một gian hàng.
 * Body: { shopName?: string, feeRate?: number }
 *
 * feeRate nhận dạng THẬP PHÂN (0.12 = 12%), không phải phần trăm. Mỗi gian
 * hàng thương lượng được mức phí khác nhau nên để chỉnh riêng từng gian.
 */
router.patch("/:id", requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const { shopName, feeRate } = req.body ?? {};

    const channel = await prisma.channel.findFirst({
      where: { id: req.params.id, userId: req.ownerId! },
    });
    if (!channel) {
      res.status(404).json({ error: "Không tìm thấy gian hàng" });
      return;
    }

    const data: { shopName?: string; feeRate?: number } = {};

    if (shopName !== undefined) {
      if (typeof shopName !== "string" || !shopName.trim()) {
        res.status(400).json({ error: "Tên gian hàng không được để trống" });
        return;
      }
      const name = shopName.trim();
      if (name.length > 60) {
        res.status(400).json({ error: "Tên gian hàng tối đa 60 ký tự" });
        return;
      }
      // Trùng tên trong cùng sàn thì không phân biệt được trên giao diện.
      // Loại chính nó ra để đổi tên thành chính nó vẫn hợp lệ.
      const duplicated = await prisma.channel.findFirst({
        where: {
          userId: req.ownerId!,
          channelName: channel.channelName,
          shopName: name,
          id: { not: channel.id },
        },
        select: { id: true },
      });
      if (duplicated) {
        res.status(409).json({
          error: `Đã có gian hàng tên "${name}" trên ${CHANNEL_LABEL[channel.channelName]}`,
        });
        return;
      }
      data.shopName = name;
    }

    if (feeRate !== undefined) {
      const rate = typeof feeRate === "string" ? Number(feeRate) : feeRate;
      if (typeof rate !== "number" || Number.isNaN(rate) || rate < 0 || rate > 1) {
        res.status(400).json({
          error: "Phí sàn phải nằm trong khoảng 0% đến 100%",
        });
        return;
      }
      data.feeRate = rate;
    }

    if (Object.keys(data).length === 0) {
      res.status(400).json({ error: "Không có thông tin nào để cập nhật" });
      return;
    }

    const updated = await prisma.channel.update({
      where: { id: channel.id },
      data,
      include: { _count: { select: { orders: true, channelProducts: true } } },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// POST /api/channels/:id/disconnect — ngắt kết nối gian hàng
router.post("/:id/disconnect", requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const channel = await prisma.channel.findFirst({
      where: { id: req.params.id, userId: req.ownerId! },
    });
    if (!channel) {
      res.status(404).json({ error: "Không tìm thấy kênh" });
      return;
    }
    const updated = await prisma.channel.update({
      where: { id: channel.id },
      data: { status: "DISCONNECTED" },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});


export default router;
