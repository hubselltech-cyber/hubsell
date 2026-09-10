// ============================================================
// ROUTES HUBSELL ADS — ỦY QUYỀN APP ADS SERVICE RIÊNG CHO GIAN SHOPEE
//
// Hai router:
//   · hubsellAdsRouter          — /api/hubsell-ads/* (JWT + ADMIN): trạng thái
//                                 liên kết, xin URL ủy quyền, đổi code (dev
//                                 local), gỡ liên kết.
//   · hubsellAdsCallbackRouter  — /api/auth/hubsell-ads/callback (CÔNG KHAI):
//                                 Shopee redirect về sau khi seller đồng ý.
// Toàn bộ nghiệp vụ nằm ở integrations/hubsell-ads/ — file này chỉ là lớp HTTP.
// ============================================================

import { Router } from "express";
import { ChannelName } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAdmin, type AuthRequest } from "../middleware/auth";
import {
  HUBSELL_ADS_APP_LABEL,
  buildHubsellAdsAuthorizeUrl,
  decodeHubsellAdsStateOrigin,
  getHubsellAdsLinkStatus,
  handleHubsellAdsCallback,
  isHubsellAdsConfigured,
  signHubsellAdsState,
  unlinkHubsellAds,
  verifyHubsellAdsState,
} from "../integrations/hubsell-ads";

const FRONTEND_BASE_URL = process.env.APP_FRONTEND_URL ?? "http://localhost:3000";
/** Trang FE nhận kết quả ủy quyền — Trợ lý quảng cáo Shopee. */
const RETURN_PATH = "/ads/shopee";

// ---------- /api/hubsell-ads (JWT + ADMIN) ----------

export const hubsellAdsRouter = Router();

/** Gian Shopee của chủ shop, hoặc null — dùng chung cho các route dưới. */
async function ownedShopeeChannel(ownerId: string, channelId: string) {
  if (!channelId) return null;
  return prisma.channel.findFirst({
    where: { id: channelId, userId: ownerId, channelName: ChannelName.SHOPEE },
    select: { id: true, shopName: true, externalShopId: true },
  });
}

// GET /api/hubsell-ads/status?channelId= — trạng thái liên kết Hubsell Ads của gian.
hubsellAdsRouter.get("/status", requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const channelId = typeof req.query.channelId === "string" ? req.query.channelId : "";
    const channel = await ownedShopeeChannel(req.ownerId!, channelId);
    if (!channel) {
      res.status(404).json({ error: "Không tìm thấy gian Shopee" });
      return;
    }
    res.json(await getHubsellAdsLinkStatus(channel.id));
  } catch (err) {
    next(err);
  }
});

// GET /api/hubsell-ads/auth-url?channelId= — URL trang ủy quyền Shopee cho app
// Hubsell Ads. Link luồng cũ hết hạn ~5' → FE xin lúc bấm nút.
hubsellAdsRouter.get("/auth-url", requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    if (!isHubsellAdsConfigured()) {
      res.status(503).json({
        error: `Chưa cấu hình ${HUBSELL_ADS_APP_LABEL} (HUBSELL_ADS_PARTNER_ID / HUBSELL_ADS_PARTNER_KEY).`,
        code: "HUBSELL_ADS_NOT_CONFIGURED",
      });
      return;
    }
    const channelId = typeof req.query.channelId === "string" ? req.query.channelId : "";
    const channel = await ownedShopeeChannel(req.ownerId!, channelId);
    if (!channel) {
      res.status(404).json({ error: "Không tìm thấy gian Shopee cần kết nối Hubsell Ads" });
      return;
    }
    if (!channel.externalShopId) {
      res.status(409).json({
        error: `Gian "${channel.shopName}" chưa liên kết Shopee — kết nối ở trang Kênh bán trước.`,
      });
      return;
    }
    const state = signHubsellAdsState(req.ownerId!, channel.id);
    res.json({ url: buildHubsellAdsAuthorizeUrl(state) });
  } catch (err) {
    next(err);
  }
});

// POST /api/hubsell-ads/connect — đổi CODE + SHOP_ID lấy token (dev local: Render
// bật code về FE local kèm channelId; danh tính chủ shop lấy từ JWT).
hubsellAdsRouter.post("/connect", requireAdmin, async (req: AuthRequest, res) => {
  const { code, shopId, channelId } = (req.body ?? {}) as Record<string, unknown>;
  if (
    typeof code !== "string" ||
    !code.trim() ||
    typeof shopId !== "string" ||
    !shopId.trim() ||
    typeof channelId !== "string" ||
    !channelId
  ) {
    res.status(400).json({ error: "Thiếu code, shopId hoặc channelId" });
    return;
  }
  try {
    const r = await handleHubsellAdsCallback(req.ownerId!, code.trim(), shopId.trim(), channelId);
    res.json({ message: `Đã kết nối ${HUBSELL_ADS_APP_LABEL} cho gian "${r.shopName}"`, link: r });
  } catch (err) {
    res.status(502).json({
      error: `Kết nối ${HUBSELL_ADS_APP_LABEL} thất bại: ${(err as Error).message}`,
    });
  }
});

// DELETE /api/hubsell-ads/link?channelId= — gỡ ủy quyền Hubsell Ads (app chính giữ nguyên).
hubsellAdsRouter.delete("/link", requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const channelId = typeof req.query.channelId === "string" ? req.query.channelId : "";
    const removed = await unlinkHubsellAds(req.ownerId!, channelId);
    if (!removed) {
      res.status(404).json({ error: "Gian này chưa liên kết Hubsell Ads" });
      return;
    }
    res.json({ message: `Đã gỡ liên kết ${HUBSELL_ADS_APP_LABEL}` });
  } catch (err) {
    next(err);
  }
});

// ---------- /api/auth/hubsell-ads/callback (CÔNG KHAI) ----------

export const hubsellAdsCallbackRouter = Router();

// Shopee mở bằng trình duyệt kèm ?code=&shop_id=&state=. Danh tính + gian đích
// nằm trong state đã ký; xong redirect về trang Trợ lý quảng cáo của FE.
hubsellAdsCallbackRouter.get("/callback", async (req, res) => {
  const done = (params: Record<string, string>) => {
    const qs = new URLSearchParams(params).toString();
    res.redirect(`${FRONTEND_BASE_URL}${RETURN_PATH}?${qs}`);
  };
  try {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const shopId = typeof req.query.shop_id === "string" ? req.query.shop_id : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";

    if (!shopId && typeof req.query.main_account_id === "string" && req.query.main_account_id) {
      done({
        hubsell_ads: "error",
        msg: "Vui lòng đăng nhập bằng tài khoản shop (không dùng tài khoản chính/main account) rồi uỷ quyền lại",
      });
      return;
    }
    if (!code || !shopId) {
      done({ hubsell_ads: "error", msg: "Thiếu code hoặc shop_id từ Shopee" });
      return;
    }

    // Trạm trung chuyển cho dev local (state ký bằng secret local → Render
    // không verify được; chỉ nhận origin localhost). channelId kèm theo để FE
    // local gọi /connect đúng gian.
    const devOrigin = state ? decodeHubsellAdsStateOrigin(state) : null;
    if (devOrigin && devOrigin !== FRONTEND_BASE_URL) {
      const params: Record<string, string> = { hubsell_ads: "code", code, shop_id: shopId };
      const decoded = state ? verifyHubsellAdsStateLoose(state) : null;
      if (decoded) params.channelId = decoded;
      res.redirect(`${devOrigin}${RETURN_PATH}?${new URLSearchParams(params).toString()}`);
      return;
    }

    const st = state ? verifyHubsellAdsState(state) : null;
    if (!st) {
      done({ hubsell_ads: "error", msg: "Phiên uỷ quyền hết hạn hoặc không hợp lệ" });
      return;
    }
    const r = await handleHubsellAdsCallback(st.ownerId, code, shopId, st.channelId);
    done({ hubsell_ads: "connected", shop: r.shopName, channelId: r.channelId });
  } catch (err) {
    console.error("[hubsell-ads/callback] Lỗi xử lý callback:", err);
    done({ hubsell_ads: "error", msg: (err as Error).message });
  }
});

/** channelId trong state KHÔNG kiểm chữ ký — chỉ để FE local biết gian đích (BE local đối chiếu lại). */
function verifyHubsellAdsStateLoose(state: string): string | null {
  try {
    const payload = JSON.parse(
      Buffer.from(state.split(".")[1] ?? "", "base64url").toString("utf8")
    ) as { channelId?: unknown };
    return typeof payload.channelId === "string" ? payload.channelId : null;
  } catch {
    return null;
  }
}
