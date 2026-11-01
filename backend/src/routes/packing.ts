// ============================================================
// ĐÓNG GÓI & BÀN GIAO — /api/orders/packing (01/11/2026)
//
// Bước NỘI BỘ sau khi in phiếu (khách dùng Ship Xanh đề nghị): seller gói xong
// cầm điện thoại / máy quét bắn lại từng kiện → Order.packingDoneAt; đơn ĐÃ HỦY
// bị chặn ngay lúc quét để bỏ kiện lại. Rồi "In biên bản bàn giao": mỗi hãng
// vận chuyển một tờ A4 có mã vạch từng đơn cho shipper ký. KHÔNG gọi sàn, KHÔNG
// đổi shippingStatus — sàn tự nhảy Đang giao khi shipper quét kiện.
//
// Mount TRƯỚC /api/orders trong app.ts (router đơn có /:id). Cùng chuỗi gác:
// requireAuth + requirePermission("orders") + requireChannel. App mobile nối sau,
// dùng đúng các endpoint này.
// ============================================================

import { Router } from "express";
import { randomBytes } from "node:crypto";
import { Prisma, ShippingStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middleware/auth";
import { channelScope } from "../lib/channel-filter";
import {
  PACKING_REJECT_TEXT,
  PACKING_WARNING_TEXT,
  decidePackingScan,
  groupByCarrier,
  handoverSheetCode,
} from "../lib/packing-scan";
import { CARRIER_LABEL, isExpressShipping } from "../services/shipping";
import {
  buildHandoverSheetsPdf,
  type HandoverSheetDoc,
  type HandoverSheetLine,
} from "../services/fulfillment/handover-sheet-pdf";

const router = Router();

/** Trường trả về cho màn quét / danh sách chờ — đủ hiện một dòng, không kéo items. */
const SCAN_SELECT = {
  id: true,
  orderCode: true,
  customerName: true,
  customerPhone: true,
  totalAmount: true,
  paymentStatus: true,
  shippingStatus: true,
  carrier: true,
  shippingCarrierName: true,
  trackingCode: true,
  labelPrintedAt: true,
  packingDoneAt: true,
  handoverSheetId: true,
  cancelRequestedAt: true,
  cancelRequestReason: true,
  itemCount: true,
  createdAt: true,
  channel: { select: { channelName: true, shopName: true } },
} satisfies Prisma.OrderSelect;

type ScanOrder = Prisma.OrderGetPayload<{ select: typeof SCAN_SELECT }>;

const UNKNOWN_CARRIER_LABEL = "Chưa rõ hãng";

function carrierLabelFor(o: {
  carrier: string | null;
  shippingCarrierName: string | null;
}): string {
  // Ưu tiên tên nguyên văn sàn trả ("SPX Instant", "GrabExpress") — shipper nhận
  // tờ nhìn đúng tên hãng mình; enum chỉ là nhãn gộp.
  const raw = o.shippingCarrierName?.trim();
  if (raw) return raw;
  if (o.carrier)
    return CARRIER_LABEL[o.carrier as keyof typeof CARRIER_LABEL] ?? o.carrier;
  return UNKNOWN_CARRIER_LABEL;
}

/**
 * Tra đơn theo mã máy quét bắn ra: khớp chính xác vận đơn / mã đơn trước, rồi
 * khớp lỏng (mã QR của sàn hay kèm URL / tiền tố). Cùng luật với GET /lookup
 * nhưng KHÔNG hỏi sàn khi trượt: đơn gói được thì đã PROCESSED ở Hubsell rồi,
 * trượt là tem lạ / đơn vị khác — báo ngay, không đốt quota.
 */
async function findOrderByScan(req: AuthRequest, code: string) {
  const scope: Prisma.OrderWhereInput = { channel: channelScope(req) };
  const exact = await prisma.order.findFirst({
    where: { ...scope, OR: [{ trackingCode: code }, { orderCode: code }] },
    select: SCAN_SELECT,
  });
  if (exact) return { order: exact, ambiguous: null as ScanOrder[] | null };
  if (code.length < 6) return { order: null, ambiguous: null };
  const loose = await prisma.order.findMany({
    where: {
      ...scope,
      OR: [
        { trackingCode: { contains: code, mode: "insensitive" } },
        { orderCode: { contains: code, mode: "insensitive" } },
      ],
    },
    select: SCAN_SELECT,
    take: 5,
  });
  if (loose.length > 1) return { order: null, ambiguous: loose };
  return { order: loose[0] ?? null, ambiguous: null };
}

/**
 * POST /scan { code } — quét một kiện.
 * 200 { result: "PACKED" | "ALREADY_PACKED" | "REJECTED", reason?, warnings[], messages, order }
 * 404 không thấy · 409 mã khớp nhiều đơn.
 */
router.post("/scan", async (req: AuthRequest, res, next) => {
  try {
    const raw = typeof req.body?.code === "string" ? req.body.code.trim() : "";
    if (!raw) {
      res.status(400).json({ error: "Chưa có mã để quét" });
      return;
    }
    const code = raw.replace(/\s+/g, "");
    const { order, ambiguous } = await findOrderByScan(req, code);
    if (ambiguous) {
      res.status(409).json({
        error: `Mã "${raw}" khớp ${ambiguous.length} đơn — quét lại đúng mã vận đơn`,
        candidates: ambiguous.map((o) => ({
          orderCode: o.orderCode,
          trackingCode: o.trackingCode,
        })),
      });
      return;
    }
    if (!order) {
      res.status(404).json({
        error: `Không thấy đơn nào có mã "${raw}" — tem của đơn vị khác, hoặc đơn chưa về Hubsell`,
      });
      return;
    }

    const decision = decidePackingScan(order);
    let result: "PACKED" | "ALREADY_PACKED" | "REJECTED" = "REJECTED";
    let packingDoneAt = order.packingDoneAt;
    if (decision.action === "mark") {
      const now = new Date();
      // WHERE packingDoneAt IS NULL: hai máy quét cùng kiện một lúc → một bên ghi,
      // bên kia nhận "đã quét" thay vì đè mốc.
      const r = await prisma.order.updateMany({
        where: { id: order.id, packingDoneAt: null },
        data: { packingDoneAt: now },
      });
      if (r.count === 1) {
        result = "PACKED";
        packingDoneAt = now;
      } else {
        result = "ALREADY_PACKED";
        const fresh = await prisma.order.findUnique({
          where: { id: order.id },
          select: { packingDoneAt: true },
        });
        packingDoneAt = fresh?.packingDoneAt ?? now;
      }
    } else if (decision.action === "already") {
      result = "ALREADY_PACKED";
    }

    res.json({
      result,
      reason: decision.reason ?? null,
      reasonText: decision.reason ? PACKING_REJECT_TEXT[decision.reason] : null,
      warnings: decision.warnings,
      warningTexts: decision.warnings.map((w) => PACKING_WARNING_TEXT[w]),
      order: { ...order, packingDoneAt, carrierLabel: carrierLabelFor(order) },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /unmark { orderId } — bỏ dấu đã đóng gói (quét nhầm, hoặc đơn bị hủy sau
 * khi gói đã lấy kiện ra). Chỉ khi chưa lên biên bản.
 */
router.post("/unmark", async (req: AuthRequest, res, next) => {
  try {
    const orderId =
      typeof req.body?.orderId === "string" ? req.body.orderId : "";
    if (!orderId) {
      res.status(400).json({ error: "Thiếu orderId" });
      return;
    }
    const r = await prisma.order.updateMany({
      where: {
        id: orderId,
        channel: channelScope(req),
        packingDoneAt: { not: null },
        handoverSheetId: null,
      },
      data: { packingDoneAt: null },
    });
    if (r.count === 0) {
      res.status(409).json({
        error:
          "Đơn chưa đóng gói, hoặc đã nằm trong biên bản bàn giao — không bỏ dấu được",
      });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

const PENDING_WHERE = (req: AuthRequest): Prisma.OrderWhereInput => ({
  channel: channelScope(req),
  packingDoneAt: { not: null },
  handoverSheetId: null,
});

function newSheetId(): string {
  // 24 ký tự hex — đủ duy nhất, 4 ký tự cuối lên số biên bản.
  return `hs${randomBytes(11).toString("hex")}`;
}

function snapshotLine(o: ScanOrder): HandoverSheetLine & { orderId: string } {
  return {
    orderId: o.id,
    orderCode: o.orderCode,
    trackingCode: o.trackingCode,
    channelName: o.channel.channelName,
    shopName: o.channel.shopName,
    customerName: o.customerName,
    customerPhone: o.customerPhone,
    isExpress: isExpressShipping(o.shippingCarrierName),
  };
}

/**
 * POST /handover-sheets { orderIds?: string[] } — lập biên bản từ đơn đã đóng
 * gói chưa lên biên bản (mặc định: TẤT CẢ trong phạm vi; truyền orderIds để chỉ
 * một phần). Mỗi hãng một biên bản. Đơn đã hủy bị loại dù có trong orderIds.
 *
 * Chống lập trùng khi hai người bấm cùng lúc: tạo dòng biên bản rỗng → updateMany
 * Order WHERE handoverSheetId IS NULL → đọc lại đúng các đơn mình "giành" được
 * → ghi ảnh chụp; không giành được đơn nào thì xóa dòng rỗng.
 */
router.post("/handover-sheets", async (req: AuthRequest, res, next) => {
  try {
    const orderIds: string[] | null = Array.isArray(req.body?.orderIds)
      ? (req.body.orderIds as unknown[])
          .filter((x): x is string => typeof x === "string")
          .slice(0, 500)
      : null;
    const candidates = await prisma.order.findMany({
      where: {
        ...PENDING_WHERE(req),
        shippingStatus: {
          in: [ShippingStatus.PROCESSED, ShippingStatus.SHIPPING],
        },
        ...(orderIds ? { id: { in: orderIds } } : {}),
      },
      select: SCAN_SELECT,
      orderBy: { packingDoneAt: "asc" },
      take: 500,
    });
    if (candidates.length === 0) {
      res.status(409).json({
        error:
          "Không có đơn đã đóng gói nào chờ bàn giao — quét kiện trước rồi mới in biên bản",
        code: "NO_PACKED_ORDERS",
      });
      return;
    }

    const groups = groupByCarrier(candidates);
    const created: Array<{
      id: string;
      code: string;
      carrierLabel: string;
      orderCount: number;
    }> = [];
    for (const [, group] of groups) {
      const first = group[0];
      const id = newSheetId();
      const now = new Date();
      const code = handoverSheetCode(id, now);
      const carrierLabel = carrierLabelFor(first);
      const result = await prisma.$transaction(async (tx) => {
        await tx.handoverSheet.create({
          data: {
            id,
            ownerId: req.ownerId!,
            code,
            carrier: first.carrier,
            carrierLabel,
            orderCount: 0,
            orders: [],
            createdById: req.userId ?? null,
            createdAt: now,
          },
        });
        await tx.order.updateMany({
          where: { id: { in: group.map((o) => o.id) }, handoverSheetId: null },
          data: { handoverSheetId: id },
        });
        const claimed = await tx.order.findMany({
          where: { handoverSheetId: id },
          select: SCAN_SELECT,
          orderBy: { packingDoneAt: "asc" },
        });
        if (claimed.length === 0) {
          await tx.handoverSheet.delete({ where: { id } });
          return null;
        }
        const lines = claimed.map(snapshotLine);
        await tx.handoverSheet.update({
          where: { id },
          data: {
            orderCount: lines.length,
            orders: lines as unknown as Prisma.InputJsonValue,
          },
        });
        return { id, code, carrierLabel, orderCount: lines.length };
      });
      if (result) created.push(result);
    }

    if (created.length === 0) {
      res.status(409).json({
        error: "Đơn vừa được người khác đưa vào biên bản — tải lại danh sách",
        code: "NO_PACKED_ORDERS",
      });
      return;
    }
    console.info(
      `[packing] lập ${created.length} biên bản bàn giao cho chủ ${req.ownerId}: ${created
        .map((s) => `${s.code} ${s.carrierLabel} ×${s.orderCount}`)
        .join("; ")}`,
    );
    res.status(201).json({ sheets: created });
  } catch (err) {
    next(err);
  }
});

/** GET /handover-sheets/pdf?ids=a,b — MỘT PDF gồm các biên bản (mỗi tờ trang mới). */
router.get("/handover-sheets/pdf", async (req: AuthRequest, res, next) => {
  try {
    const ids = String(req.query.ids ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 50);
    if (ids.length === 0) {
      res.status(400).json({ error: "Thiếu ids" });
      return;
    }
    const sheets = await prisma.handoverSheet.findMany({
      where: { id: { in: ids }, ownerId: req.ownerId! },
    });
    if (sheets.length === 0) {
      res.status(404).json({ error: "Không thấy biên bản" });
      return;
    }
    // Giữ thứ tự theo ids truyền lên
    const order = new Map(ids.map((id, i) => [id, i]));
    sheets.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

    const [owner, creators] = await Promise.all([
      prisma.user.findUnique({
        where: { id: req.ownerId! },
        select: { fullName: true },
      }),
      prisma.user.findMany({
        where: {
          id: {
            in: [
              ...new Set(
                sheets
                  .map((s) => s.createdById)
                  .filter((x): x is string => Boolean(x)),
              ),
            ],
          },
        },
        select: { id: true, fullName: true },
      }),
    ]);
    const nameOf = new Map(creators.map((u) => [u.id, u.fullName]));
    const docs: HandoverSheetDoc[] = sheets.map((s) => ({
      code: s.code,
      carrierLabel: s.carrierLabel,
      createdAt: s.createdAt,
      senderName: owner?.fullName ?? "Shop",
      createdByName: s.createdById ? (nameOf.get(s.createdById) ?? null) : null,
      lines: Array.isArray(s.orders)
        ? (s.orders as unknown as HandoverSheetLine[])
        : [],
    }));
    const pdf = await buildHandoverSheetsPdf(docs);
    const name =
      sheets.length === 1
        ? `bien-ban-ban-giao-${sheets[0].code}.pdf`
        : `bien-ban-ban-giao-${sheets.length}-to.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${name}"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(Buffer.from(pdf));
  } catch (err) {
    next(err);
  }
});

export default router;
