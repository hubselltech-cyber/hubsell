// ============================================================
// TÙY CHỈNH PHIẾU IN — /api/orders/label-template (19/11/2026,
// docs/MOBILE-CHUAN-BI-HANG-IN-PHIEU.md mục 5)
//
// Mẫu chèn thông tin lên vận đơn của sàn, mỗi chủ shop một mẫu cho mỗi sàn
// (User.labelTemplates). Mẫu áp ở route in POST /api/orders/bulk/labels nên in từ web hay
// từ app đều ra cùng một phiếu.
//
//   GET  /            mẫu hiện tại của từng sàn + sàn nào đã hỗ trợ + giới hạn
//   PUT  /            { platform, template } — CHỈ CHỦ SHOP (nhân viên chỉ xem)
//   POST /preview     { platform, template, lines? } → PDF phiếu MẪU đã chèn (không gọi sàn)
//
// Mount TRƯỚC /api/orders trong app.ts (router đơn có /:id). Cùng chuỗi gác:
// requireAuth + requirePermission("orders").
// ============================================================

import { Router } from "express";
import { ChannelName, Prisma, Role } from "@prisma/client";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middleware/auth";
import { buildFakeLabelPdf } from "../services/fulfillment/fake-label-pdf";
import {
  autoDetectEnabled,
  MANUAL_ZONE_MAX_MM,
  MANUAL_ZONE_MIN_MM,
  NOTE_MAX,
  OVERLAY_PLATFORMS,
  overlayLabels,
  overlaySupported,
  parseLabelTemplate,
  readLabelTemplates,
  DEFAULT_LABEL_TEMPLATE,
} from "../services/label-overlay";

const router = Router();

/** Thứ tự hiện trên màn cài đặt. */
const PLATFORMS: ChannelName[] = [ChannelName.TIKTOK, ChannelName.SHOPEE, ChannelName.LAZADA];

function readPlatform(raw: unknown): ChannelName | null {
  return typeof raw === "string" && (PLATFORMS as string[]).includes(raw) ? (raw as ChannelName) : null;
}

router.get("/", async (req: AuthRequest, res, next) => {
  try {
    const owner = await prisma.user.findUnique({
      where: { id: req.ownerId! },
      select: { labelTemplates: true },
    });
    const saved = readLabelTemplates(owner?.labelTemplates);
    res.json({
      canEdit: req.userRole === Role.ADMIN,
      // Máy chủ có tự dò vùng bảng sản phẩm không. Không thì mẫu PHẢI có chiều cao vùng chèn
      // (manualZoneMm) mới chèn được — màn cài đặt đưa ô đó lên phần chính.
      autoDetect: autoDetectEnabled(),
      limits: { noteMax: NOTE_MAX, zoneMinMm: MANUAL_ZONE_MIN_MM, zoneMaxMm: MANUAL_ZONE_MAX_MM },
      platforms: PLATFORMS.map((platform) => ({
        platform,
        supported: overlaySupported(platform),
        template: saved[platform] ?? DEFAULT_LABEL_TEMPLATE,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.put("/", async (req: AuthRequest, res, next) => {
  try {
    if (req.userRole !== Role.ADMIN) {
      res.status(403).json({ error: "Chỉ chủ shop đổi được mẫu phiếu in" });
      return;
    }
    const platform = readPlatform(req.body?.platform);
    if (!platform || !overlaySupported(platform)) {
      res.status(400).json({ error: "Sàn này chưa hỗ trợ tùy chỉnh phiếu in" });
      return;
    }
    const template = parseLabelTemplate(req.body?.template);
    const owner = await prisma.user.findUnique({
      where: { id: req.ownerId! },
      select: { labelTemplates: true },
    });
    const current =
      owner?.labelTemplates && typeof owner.labelTemplates === "object" && !Array.isArray(owner.labelTemplates)
        ? (owner.labelTemplates as Record<string, unknown>)
        : {};
    // Chỉ giữ khóa của sàn đã hỗ trợ — không để rác tích trong cột JSON.
    const nextValue: Record<string, unknown> = {};
    for (const p of OVERLAY_PLATFORMS) {
      if (p === platform) nextValue[p] = template;
      else if (current[p]) nextValue[p] = parseLabelTemplate(current[p]);
    }
    await prisma.user.update({
      where: { id: req.ownerId! },
      data: { labelTemplates: nextValue as Prisma.InputJsonObject },
    });
    console.log(
      `[label-overlay] chủ shop ${req.ownerId} ${template.enabled ? "BẬT" : "TẮT"} mẫu phiếu ${platform}` +
        ` (sku=${template.showSku} phanLoai=${template.showVariant} ten=${template.showName}` +
        ` nhan=${template.note ? "có" : "không"} motTo=${template.onePage} vung=${template.manualZoneMm ?? "tự dò"})`
    );
    res.json({ platform, template });
  } catch (err) {
    next(err);
  }
});

/** Dòng hàng mẫu cho phiếu xem thử — tên chung chung, không lấy dữ liệu của shop. */
const SAMPLE_LINES = [
  { productName: "Áo thun nam cổ tròn cotton 100% form rộng", variantName: "Đen, L", channelSku: "AT01-DEN-L", quantity: 2 },
  { productName: "Áo thun nam cổ tròn cotton 100% form rộng", variantName: "Trắng, M", channelSku: "AT01-TRANG-M", quantity: 1 },
  { productName: "Quần short kaki túi hộp ống rộng", variantName: "Be, 30", channelSku: "QS07-BE-30", quantity: 1 },
  { productName: "Tất cổ ngắn khử mùi (combo 5 đôi)", variantName: null, channelSku: "TAT-C5", quantity: 3 },
  { productName: "Thắt lưng da khóa tự động", variantName: "Nâu", channelSku: "TL02-NAU", quantity: 1 },
  { productName: "Mũ lưỡi trai thêu chữ", variantName: "Xanh rêu", channelSku: "MU11-XR", quantity: 1 },
  { productName: "Ví da nam dáng ngang", variantName: "Đen", channelSku: "VI03-DEN", quantity: 1 },
  { productName: "Túi đeo chéo dáng hộp chống nước", variantName: "Xám", channelSku: "TC088-XAM", quantity: 1 },
];

router.post("/preview", async (req: AuthRequest, res, next) => {
  try {
    const platform = readPlatform(req.body?.platform);
    if (!platform || !overlaySupported(platform)) {
      res.status(400).json({ error: "Sàn này chưa hỗ trợ tùy chỉnh phiếu in" });
      return;
    }
    const template = { ...parseLabelTemplate(req.body?.template), enabled: true };
    const want = Number(req.body?.lines);
    const count = Number.isFinite(want) ? Math.min(40, Math.max(1, Math.round(want))) : 6;
    const items = Array.from({ length: count }, (_, i) => {
      const base = SAMPLE_LINES[i % SAMPLE_LINES.length];
      const round = Math.floor(i / SAMPLE_LINES.length);
      return round === 0 ? base : { ...base, channelSku: `${base.channelSku}-${round + 1}` };
    });
    const label = await buildFakeLabelPdf({
      platform,
      shopName: "Gian hàng mẫu",
      orderCode: "580000000000000001",
      trackingCode: "860000000001",
      carrierName: "J&T Express",
      items: items.map((i) => ({ name: i.productName, variant: i.variantName, sku: i.channelSku, quantity: i.quantity })),
    });
    const done = await overlayLabels({
      platform,
      template,
      pdfs: new Map([["sample", Buffer.from(label)]]),
      itemsByOrder: new Map([["sample", items]]),
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'inline; filename="hubsell-phieu-mau.pdf"');
    res.send(done.pdfs.get("sample"));
  } catch (err) {
    next(err);
  }
});

export default router;
