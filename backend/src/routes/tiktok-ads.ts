// ============================================================
// ROUTES TIKTOK ADS — ỦY QUYỀN TÀI KHOẢN QUẢNG CÁO (TikTok Marketing API)
//
// Hai router:
//   · tiktokAdsRouter        — /api/tiktok-ads/* (JWT + ADMIN): trạng thái, xin
//                              URL ủy quyền (tự bấm / link gửi người chạy quảng
//                              cáo), gỡ kết nối.
//   · tiktokAdsPublicRouter  — /api/auth/tiktok-ads/connect (CÔNG KHAI): trang
//                              FE /ads/tiktok/callback gọi sau khi TikTok trả
//                              auth_code. Công khai vì người bấm ủy quyền có
//                              thể là người chạy quảng cáo thuê, KHÔNG có tài
//                              khoản Hubsell — danh tính chủ shop nằm trong
//                              state đã ký.
// Nghiệp vụ ở integrations/tiktok-ads/ — file này chỉ là lớp HTTP.
// ============================================================

import { Router } from "express";
import { ChannelName } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAdmin, type AuthRequest } from "../middleware/auth";
import {
  buildTiktokAdsAuthorizeUrl,
  connectTiktokAds,
  getTiktokAdsLinkStatus,
  isTiktokAdsConfigured,
  signTiktokAdsState,
  unlinkTiktokAds,
  verifyTiktokAdsState,
} from "../integrations/tiktok-ads";

// ---------- /api/tiktok-ads (JWT + ADMIN) ----------

export const tiktokAdsRouter = Router();

// GET /api/tiktok-ads/status?channelId= — trạng thái kết nối quảng cáo của gian.
tiktokAdsRouter.get("/status", requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const channelId = typeof req.query.channelId === "string" ? req.query.channelId : "";
    const channel = await prisma.channel.findFirst({
      where: { id: channelId, userId: req.ownerId!, channelName: ChannelName.TIKTOK },
      select: { id: true },
    });
    if (!channel) {
      res.status(404).json({ error: "Không tìm thấy gian TikTok" });
      return;
    }
    res.json({ configured: isTiktokAdsConfigured(), ...(await getTiktokAdsLinkStatus(channel.id)) });
  } catch (err) {
    next(err);
  }
});

// GET /api/tiktok-ads/auth-url?invite=1 — URL trang ủy quyền TikTok for Business.
// invite=1: link sống 7 ngày để chủ shop gửi cho người giữ tài khoản quảng cáo.
tiktokAdsRouter.get("/auth-url", requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    if (!isTiktokAdsConfigured()) {
      res.status(503).json({
        error: "Chưa cấu hình TikTok Ads (TIKTOK_ADS_APP_ID / TIKTOK_ADS_SECRET).",
        code: "TIKTOK_ADS_NOT_CONFIGURED",
      });
      return;
    }
    const hasShop = await prisma.channel.count({
      where: { userId: req.ownerId!, channelName: ChannelName.TIKTOK, externalShopId: { not: null } },
    });
    if (hasShop === 0) {
      res.status(409).json({ error: "Hãy kết nối gian TikTok Shop ở trang Kênh bán trước." });
      return;
    }
    // channelId = dòng chủ shop bấm nút (mỗi gian có thể một tài khoản quảng cáo riêng).
    const channelId = typeof req.query.channelId === "string" ? req.query.channelId : "";
    const target = channelId
      ? await prisma.channel.findFirst({
          where: { id: channelId, userId: req.ownerId!, channelName: ChannelName.TIKTOK },
          select: { id: true },
        })
      : null;
    const state = signTiktokAdsState(req.ownerId!, req.query.invite === "1" ? "invite" : "self", target?.id);
    res.json({ url: buildTiktokAdsAuthorizeUrl(state) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/tiktok-ads/link?channelId= — gỡ kết nối quảng cáo của một gian.
tiktokAdsRouter.delete("/link", requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const channelId = typeof req.query.channelId === "string" ? req.query.channelId : "";
    if (!(await unlinkTiktokAds(req.ownerId!, channelId))) {
      res.status(404).json({ error: "Gian này chưa kết nối quảng cáo TikTok" });
      return;
    }
    res.json({ message: "Đã gỡ kết nối quảng cáo TikTok" });
  } catch (err) {
    next(err);
  }
});

// ---------- /api/auth/tiktok-ads (CÔNG KHAI) ----------

export const tiktokAdsPublicRouter = Router();

// POST /api/auth/tiktok-ads/connect { authCode, state } — đổi code, dò gian, ghi link.
// Trả về tên gian đã nối (không trả token, không trả shop của seller khác).
tiktokAdsPublicRouter.post("/connect", async (req, res) => {
  const { authCode, state } = (req.body ?? {}) as Record<string, unknown>;
  if (typeof authCode !== "string" || !authCode.trim() || typeof state !== "string" || !state) {
    res.status(400).json({ error: "Thiếu mã ủy quyền" });
    return;
  }
  const st = verifyTiktokAdsState(state);
  if (!st) {
    res.status(400).json({ error: "Link ủy quyền đã hết hạn hoặc không hợp lệ. Hãy bấm Kết nối lại từ Hubsell." });
    return;
  }
  try {
    const r = await connectTiktokAds(st.ownerId, authCode.trim(), st.channelId);
    res.json({
      kind: st.kind,
      target: r.target,
      linked: r.linked.map((l) => ({ channelId: l.channelId, shopName: l.shopName, advertiserName: l.advertiserName })),
      skipped: r.skipped,
    });
  } catch (err) {
    console.error("[tiktok-ads/connect]", err);
    res.status(502).json({ error: (err as Error).message });
  }
});
