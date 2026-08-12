import { Router } from "express";
import { ChannelName } from "@prisma/client";
import { prisma } from "../prisma";
import { requirePermission, type AuthRequest } from "../auth";
import {
  editManualProductAdsRaw,
  getAdsTotalBalance,
} from "../integrations/shopee/client";
import { getValidShopeeAccessToken } from "../integrations/shopee/service";
import { normalizeAssistantConfig } from "../integrations/shopee/ads-assistant-rules";
import {
  MARGIN_WINDOW_DAYS,
  computeChannelAdsInsights,
  computeChannelProductBreakeven,
  dateKey,
  startOfDaysAgo,
} from "../integrations/shopee/ads-insights";

const router = Router();

// Siết quyền theo LÁ: mount app.ts chỉ kiểm "có lá ads.* bất kỳ", từng nhánh
// sàn bó đúng lá của nó. TikTok hiện là preview mock phía FE, có API thật thì
// thêm router.use tương ứng tại đây.
router.use("/shopee", requirePermission("ads.shopee"));
router.use("/lazada", requirePermission("ads.lazada"));

// ============================================================
// TRỢ LÝ QUẢNG CÁO — DASHBOARD DỮ LIỆU THẬT (READ-ONLY) + RULE ENGINE
//
// GET /api/ads/{shopee|lazada}?channelId=&days=7|30
//
// HAI SÀN DÙNG CHUNG toàn bộ handler (bảng AdsCampaign/DailyPerf trung lập
// sàn, lõi ads-insights nhận channelName) — chỉ khác: ví ads real-time hiện
// mới có nguồn Shopee (Lazada đọc cờ adAccountBalanceStatus, GĐ sau).
//
// Điểm khác biệt so với Seller Center: mỗi campaign được gắn thêm ROAS HÒA VỐN
// tính từ P&L THẬT của chính các SKU trong campaign (giá vốn + phí sàn đã đối
// soát/ước tính — computePnlRow là SSOT, không bịa %):
//
//   biên lãi ròng m = lợi nhuận (chưa trừ ads) / doanh thu thực tế
//   ROAS hòa vốn   = 1 / m   (ROAS ads dưới ngưỡng này là ĐỐT TIỀN dù ROAS dương)
//
// Phân bổ P&L đơn → campaign theo TỶ TRỌNG DOANH THU của các SKU thuộc campaign
// trong từng đơn (đơn ghép nhiều SP không bị tính trùng). Campaign quá ít đơn
// (<MIN_ORDERS_FOR_MARGIN) rơi về biên lãi TOÀN SHOP, đánh dấu marginSource để
// UI nói thật với người dùng số này lấy từ đâu.
//
// Chỉ ADMIN (mount adminOnly ở app.ts) — chi phí Ads là dữ liệu tài chính.
// ============================================================

/** Cấu hình từng sàn cho bộ handler dùng chung. */
const ADS_PLATFORMS = {
  shopee: { channelName: ChannelName.SHOPEE, label: "Shopee" },
  lazada: { channelName: ChannelName.LAZADA, label: "Lazada" },
} as const;
type AdsPlatformKey = keyof typeof ADS_PLATFORMS;

/** Quyết định của chủ shop còn hiệu lực khi verdict CHƯA đổi loại từ lúc quyết. */
function decisionActive(
  decision: string,
  decisionVerdict: string,
  currentVerdict: string | null
): boolean {
  return decision !== "" && currentVerdict !== null && decisionVerdict === currentVerdict;
}

/** Các quyết định hợp lệ của chủ shop với một cảnh báo (xem schema AdsCampaign). */
const VALID_DECISIONS = ["", "HANDLED", "WATCHING", "IGNORED"];

function registerAdsPlatform(platform: AdsPlatformKey) {
  const { channelName, label } = ADS_PLATFORMS[platform];

  router.get(`/${platform}`, async (req: AuthRequest, res, next) => {
    try {
      // ---- Gian của sàn thuộc shop (ADMIN thấy hết — không cần allowedChannelIds) ----
      const channels = await prisma.channel.findMany({
        where: {
          userId: req.ownerId!,
          channelName,
          status: "ACTIVE",
        },
        orderBy: { createdAt: "asc" },
        select: { id: true, shopName: true, externalShopId: true },
      });
      if (channels.length === 0) {
        res.json({ channels: [], selectedChannelId: null, days: 7, wallet: null, summary: null, campaigns: [], series: [] });
        return;
      }

      const requestedId =
        typeof req.query.channelId === "string" ? req.query.channelId : "";
      const selected =
        channels.find((c) => c.id === requestedId) ?? channels[0];
      // Cửa sổ hiển thị tự chọn 1–30 ngày (dữ liệu sync tối đa 30 ngày về trước).
      const daysRaw = Number(req.query.days);
      const days = Number.isFinite(daysRaw)
        ? Math.min(30, Math.max(1, Math.trunc(daysRaw)))
        : 7;
      const perfStart = startOfDaysAgo(days);

      // ---- Lõi tính toán dùng chung với executor GĐ3 (ads-insights.ts):
      // perf 30 ngày + windows + biên lãi/hòa vốn + verdict rule engine ----
      const insights = await computeChannelAdsInsights({
        id: selected.id,
        userId: req.ownerId!,
        channelName,
      });
      const assistantConfig = insights.config;
      const shopMargin = insights.shop.margin;
      const shopBreakeven = insights.shop.breakevenRoas;

      // ---- Lớp HIỂN THỊ: cắt cửa sổ ?days + trải phẳng cho FE ----
      const campaigns = insights.items.map((it) => {
        const c = it.row;
        // Hiển thị: chỉ cộng các ngày thuộc cửa sổ ?days đang xem.
        const perf = c.dailyPerf.reduce(
          (acc, p) => {
            if (p.date < perfStart) return acc;
            acc.spend += Number(p.expense);
            acc.impression += p.impression;
            acc.clicks += p.clicks;
            acc.broadOrder += p.broadOrder;
            acc.broadGmv += Number(p.broadGmv);
            acc.directOrder += p.directOrder;
            acc.directGmv += Number(p.directGmv);
            return acc;
          },
          { spend: 0, impression: 0, clicks: 0, broadOrder: 0, broadGmv: 0, directOrder: 0, directGmv: 0 }
        );

        // Lãi/lỗ ước tính của campaign trong cửa sổ: lãi ròng của GMV broad trừ
        // tiền ads. Dùng broad — CÙNG rổ đơn với ROAS hiển thị và rule engine
        // Trợ lý, để dấu của cột tiền luôn lật đúng tại điểm ROAS cắt hòa vốn
        // (chốt với anh Trung 11/08: hết cảnh "Ổn" đứng cạnh số âm, khách đỡ hỏi;
        // direct từng dùng trước đây bi quan quá — campaign toàn đơn broad bị
        // phán "mất trắng" dù ROAS gấp mấy lần hòa vốn).
        const estProfit =
          it.margin != null ? perf.broadGmv * it.margin - perf.spend : null;

        const assessment = it.assessment;
        return {
          assistant: {
            verdict: assessment.verdict,
            reasons: assessment.reasons,
            window: assessment.window ?? null,
            decision: c.assistantDecision,
            // Quyết định cũ hết hiệu lực khi verdict ĐỔI LOẠI → cảnh báo hiện lại.
            decisionActive: decisionActive(
              c.assistantDecision,
              c.assistantDecisionVerdict,
              assessment.verdict
            ),
          },
          id: c.id,
          campaignId: c.campaignId,
          name: c.name,
          adType: c.adType,
          status: c.status,
          placement: c.placement,
          biddingMethod: c.biddingMethod,
          budget: Number(c.budget),
          roasTarget: c.roasTarget != null ? Number(c.roasTarget) : null,
          startTime: c.startTime,
          endTime: c.endTime,
          itemCount: it.itemIds.length,
          ...perf,
          roasBroad: perf.spend > 0 ? perf.broadGmv / perf.spend : null,
          roasDirect: perf.spend > 0 ? perf.directGmv / perf.spend : null,
          margin: it.margin,
          marginSource: it.marginSource,
          marginOrders: it.marginOrders,
          breakevenRoas: it.breakevenRoas,
          estProfit,
          // margin ≤ 0: SKU này đang LỖ ngay cả trước ads — cảnh báo riêng.
          lossBeforeAds: it.margin != null && it.margin <= 0,
        };
      });
      campaigns.sort((a, b) => b.spend - a.spend);

      // ---- Chuỗi ngày cho biểu đồ (gộp mọi campaign) ----
      const seriesMap = new Map<string, { spend: number; broadGmv: number; directGmv: number }>();
      for (const it of insights.items) {
        for (const p of it.row.dailyPerf) {
          if (p.date < perfStart) continue; // chart cũng theo cửa sổ ?days
          const key = dateKey(p.date);
          const point = seriesMap.get(key) ?? { spend: 0, broadGmv: 0, directGmv: 0 };
          point.spend += Number(p.expense);
          point.broadGmv += Number(p.broadGmv);
          point.directGmv += Number(p.directGmv);
          seriesMap.set(key, point);
        }
      }
      const series = [...seriesMap.entries()]
        .map(([date, v]) => ({ date, ...v }))
        .sort((a, b) => a.date.localeCompare(b.date));

      // ---- Chi tiêu ads TOÀN SHOP từ AdSpend (nguồn đối chiếu — gồm cả loại
      // quảng cáo không nằm trong campaign sản phẩm; hiện chỉ Shopee có nguồn) ----
      const adSpendAgg = await prisma.adSpend.aggregate({
        where: { channelId: selected.id, date: { gte: perfStart } },
        _sum: { amount: true },
      });

      const totals = campaigns.reduce(
        (acc, c) => {
          acc.spend += c.spend;
          acc.broadOrder += c.broadOrder;
          acc.broadGmv += c.broadGmv;
          acc.directOrder += c.directOrder;
          acc.directGmv += c.directGmv;
          if (c.estProfit != null) acc.estProfit += c.estProfit;
          return acc;
        },
        { spend: 0, broadOrder: 0, broadGmv: 0, directOrder: 0, directGmv: 0, estProfit: 0 }
      );

      // ---- Số dư ví ads real-time — mới có nguồn Shopee (gọi sống, lỗi không
      // làm hỏng dashboard). Lazada GĐ sau: cờ adAccountBalanceStatus từ
      // searchCampaignList sẽ thành cảnh báo "ví cạn" thay số dư tuyệt đối. ----
      let wallet: { balance: number } | null = null;
      if (platform === "shopee") {
        try {
          const channel = await prisma.channel.findUnique({ where: { id: selected.id } });
          if (channel) {
            const { accessToken, shopId } = await getValidShopeeAccessToken(channel);
            const bal = await getAdsTotalBalance({ accessToken, shopId });
            const balance = Number(bal.response?.total_balance);
            if (Number.isFinite(balance)) wallet = { balance };
          }
        } catch {
          wallet = null; // app chưa có quyền / token lỗi — dashboard vẫn hiển thị
        }
      }

      // ---- Tổng hợp Trợ lý cho banner: chỉ đếm cảnh báo CHƯA được chủ shop quyết ----
      const counts = { spike: 0, pauseNow: 0, grace: 0, review: 0 };
      for (const c of campaigns) {
        if (c.assistant.decisionActive) continue;
        if (c.assistant.verdict === "spike") counts.spike++;
        else if (c.assistant.verdict === "pause_now") counts.pauseNow++;
        else if (c.assistant.verdict === "grace") counts.grace++;
        else if (c.assistant.verdict === "review") counts.review++;
      }

      res.json({
        channels,
        selectedChannelId: selected.id,
        days,
        wallet,
        assistant: {
          config: assistantConfig,
          counts,
          needsAction: counts.spike + counts.pauseNow + counts.review,
        },
        summary: {
          ...totals,
          roasBroad: totals.spend > 0 ? totals.broadGmv / totals.spend : null,
          roasDirect: totals.spend > 0 ? totals.directGmv / totals.spend : null,
          adSpendTotal: Number(adSpendAgg._sum.amount ?? 0),
          shopMargin,
          shopBreakevenRoas: shopBreakeven,
          marginWindowDays: MARGIN_WINDOW_DAYS,
          pnlOrders: insights.shop.pnlOrders,
          missingCostOrders: insights.shop.missingCostOrders,
        },
        campaigns,
        series,
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/ads/{sàn}/product-breakeven?channelId= — BẢNG ROAS HÒA VỐN THEO
  // SẢN PHẨM: tra cứu TRƯỚC khi tạo campaign (SP này đặt ROAS mục tiêu bao nhiêu
  // thì không lỗ). Nhóm theo item_id sàn, biên lãi từ P&L 30 ngày cùng SSOT với
  // hòa vốn campaign — hai bảng không bao giờ lệch số.
  router.get(`/${platform}/product-breakeven`, async (req: AuthRequest, res, next) => {
    try {
      const channelId =
        typeof req.query.channelId === "string" ? req.query.channelId : "";
      const channel = await prisma.channel.findFirst({
        where: { id: channelId, userId: req.ownerId!, channelName },
      });
      if (!channel) {
        res.status(404).json({ error: `Không tìm thấy gian ${label}` });
        return;
      }
      const data = await computeChannelProductBreakeven({
        id: channel.id,
        userId: req.ownerId!,
        channelName,
      });
      res.json({ ...data, marginWindowDays: MARGIN_WINDOW_DAYS });
    } catch (err) {
      next(err);
    }
  });

  // PUT /api/ads/{sàn}/assistant-config — lưu luật Trợ lý riêng của một gian.
  // Body: { channelId, config } — config được normalize trước khi lưu (giá trị
  // rác/âm tự về default từng trường, schema cũ không vỡ khi thêm luật mới).
  router.put(`/${platform}/assistant-config`, async (req: AuthRequest, res, next) => {
    try {
      const { channelId, config } = req.body as { channelId?: string; config?: unknown };
      const channel = await prisma.channel.findFirst({
        where: {
          id: channelId ?? "",
          userId: req.ownerId!,
          channelName,
        },
      });
      if (!channel) {
        res.status(404).json({ error: `Không tìm thấy gian ${label}` });
        return;
      }
      const normalized = normalizeAssistantConfig(config);
      // Prisma Json input đòi index signature — config là object phẳng thuần nên
      // structuredClone qua JSON là đủ (không hàm, không Date).
      const jsonConfig = JSON.parse(JSON.stringify(normalized)) as object;
      await prisma.adsAssistantConfig.upsert({
        where: { channelId: channel.id },
        update: { config: jsonConfig },
        create: { channelId: channel.id, config: jsonConfig },
      });
      res.json({ message: "Đã lưu cấu hình Trợ lý", config: normalized });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/ads/{sàn}/campaigns/:id/decision — chủ shop quyết một cảnh báo.
  // Body: { decision, verdict } — verdict là loại cảnh báo ĐANG hiển thị lúc bấm;
  // lưu kèm để verdict đổi loại thì cảnh báo tự hiện lại ("" = gỡ quyết định).
  router.post(
    `/${platform}/campaigns/:id/decision`,
    async (req: AuthRequest, res, next) => {
      try {
        const { decision, verdict } = req.body as {
          decision?: string;
          verdict?: string;
        };
        if (!VALID_DECISIONS.includes(decision ?? "_")) {
          res.status(400).json({ error: "Quyết định không hợp lệ" });
          return;
        }
        const campaign = await prisma.adsCampaign.findFirst({
          where: {
            id: req.params.id,
            channel: { userId: req.ownerId!, channelName },
          },
        });
        if (!campaign) {
          res.status(404).json({ error: "Không tìm thấy chiến dịch" });
          return;
        }
        const cleared = decision === "";
        await prisma.adsCampaign.update({
          where: { id: campaign.id },
          data: {
            assistantDecision: decision ?? "",
            assistantDecisionVerdict: cleared ? "" : (verdict ?? ""),
            assistantDecisionAt: cleared ? null : new Date(),
          },
        });
        res.json({ message: cleared ? "Đã gỡ quyết định" : "Đã ghi nhận quyết định" });
      } catch (err) {
        next(err);
      }
    }
  );
}

registerAdsPlatform("shopee");
registerAdsPlatform("lazada");

// GET /api/ads/shopee/action-log?channelId=&limit= — SỔ HÀNH ĐỘNG của Trợ lý
// (GĐ3): mọi lần diễn tập/thực thi, kèm căn cứ + lỗi sàn nguyên văn.
// CHỈ SHOPEE — executor tự thực thi Lazada chưa bật (GĐ3 Lazada làm sau).
router.get("/shopee/action-log", async (req: AuthRequest, res, next) => {
  try {
    const channelId =
      typeof req.query.channelId === "string" ? req.query.channelId : "";
    const channel = await prisma.channel.findFirst({
      where: { id: channelId, userId: req.ownerId!, channelName: ChannelName.SHOPEE },
    });
    if (!channel) {
      res.status(404).json({ error: "Không tìm thấy gian Shopee" });
      return;
    }
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(100, Math.max(1, Math.trunc(limitRaw)))
      : 50;
    const rows = await prisma.adsActionLog.findMany({
      where: { channelId: channel.id },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { adsCampaign: { select: { name: true, campaignId: true } } },
    });
    res.json({
      logs: rows.map((r) => ({
        id: r.id,
        campaignName:
          r.adsCampaign.name || `Chiến dịch #${r.adsCampaign.campaignId}`,
        action: r.action,
        mode: r.mode,
        verdict: r.verdict,
        reasons: r.reasons ? r.reasons.split("\n").filter(Boolean) : [],
        status: r.status,
        error: r.error,
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/ads/shopee/write-probe — DỤNG CỤ XÁC MINH GĐ3 (chỉ ADMIN, dùng tay).
//
// Bắn MỘT lệnh edit_manual_product_ads lên MỘT campaign chỉ định và trả về
// NGUYÊN VĂN envelope của Shopee (kể cả lỗi) — để xác minh enum edit_action +
// quyền write trước khi bật autoExecute mode live. Đây là thao tác GHI THẬT
// lên gian hàng: đòi confirm=true tường minh; khuyến nghị chạy trên campaign
// test/đã tạm dừng, làm cùng chủ shop.
router.post("/shopee/write-probe", async (req: AuthRequest, res, next) => {
  try {
    const { channelId, campaignId, editAction, confirm } = req.body as {
      channelId?: string;
      campaignId?: string | number;
      editAction?: string;
      confirm?: boolean;
    };
    if (confirm !== true || !campaignId || !editAction) {
      res.status(400).json({
        error:
          "Cần đủ: channelId, campaignId, editAction và confirm=true (đây là lệnh GHI THẬT lên sàn)",
      });
      return;
    }
    const channel = await prisma.channel.findFirst({
      where: { id: channelId ?? "", userId: req.ownerId!, channelName: ChannelName.SHOPEE },
    });
    if (!channel) {
      res.status(404).json({ error: "Không tìm thấy gian Shopee" });
      return;
    }
    const { accessToken, shopId } = await getValidShopeeAccessToken(channel);
    const raw = await editManualProductAdsRaw({
      accessToken,
      shopId,
      campaignId,
      editAction,
      referenceId: `probe-${campaignId}-${Date.now()}`,
    });
    res.json({ probe: { campaignId, editAction }, shopeeResponse: raw });
  } catch (err) {
    next(err);
  }
});

export default router;
