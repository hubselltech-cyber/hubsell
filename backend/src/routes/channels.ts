import { Router } from "express";
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
  isTikTokConfigured,
} from "../integrations/tiktok/config";
import {
  getAccessToken,
  getAuthorizedShops,
  type TikTokTokenData,
} from "../integrations/tiktok/client";

const router = Router();

/**
 * TikTok trả thời hạn token dưới dạng SỐ GIÂY. Field có thể là mốc tuyệt đối
 * (epoch) hoặc khoảng thời gian tính từ hiện tại tuỳ phiên bản — phân biệt bằng
 * ngưỡng 10^9 (mọi epoch hợp lệ đều lớn hơn, mọi khoảng ~ vài ngày đều nhỏ hơn).
 */
function expireToDate(seconds: number): Date {
  const epochSeconds = seconds > 1_000_000_000 ? seconds : Math.floor(Date.now() / 1000) + seconds;
  return new Date(epochSeconds * 1000);
}

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
          // Đã nối API thật (OAuth) hay chỉ là gian giả lập/thủ công.
          apiConnected: Boolean(c.shopCipher),
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
// Body: { code: string }  (state đã được FE đối chiếu trước khi gọi).
router.post("/tiktok/callback", requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const { code } = req.body ?? {};
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
