import { Router } from "express";
import { Prisma, ReturnStatus, ShippingStatus } from "@prisma/client";
import { prisma } from "../prisma";
import type { AuthRequest } from "../auth";

const router = Router();

/**
 * ĐỐI SOÁT ĐƠN HOÀN (RTS Reconciliation) — góc nhìn của KHO.
 *
 * Trang /orders theo dõi vòng đời từng đơn; ở đây kho đối chiếu danh sách SÀN
 * BÁO HOÀN với hàng thực nhận, để lòi ra kiện đi lạc.
 *
 * ⚠️ Route này CỐ Ý KHÔNG có endpoint cộng tồn kho. Việc nhận hàng hoàn vẫn gọi
 * `POST /api/orders/:id/return` — nơi duy nhất được phép cộng kho, có chốt chặn
 * `Order.stockRestoredAt` chống cộng trùng. Mở đường cộng kho thứ hai ở đây là
 * mở lại đúng lỗ hổng làm kho phình ảo.
 */

/** Quá bao nhiêu ngày thì cảnh báo / coi như chưa về tay. */
export const RETURN_WARNING_DAYS = 7;
export const RETURN_OVERDUE_DAYS = 14;

type AgingLevel = "unknown" | "ok" | "warning" | "overdue";

/**
 * Số ngày kiện hàng đã đi đường kể từ lúc sàn báo hoàn.
 * Không biết mốc bắt đầu thì trả null — thà nói "chưa rõ" còn hơn đưa ra một
 * con số mà chủ shop mang đi khiếu nại bưu cục.
 */
function agingOf(requestedAt: Date | null): {
  daysWaiting: number | null;
  agingLevel: AgingLevel;
} {
  if (!requestedAt) return { daysWaiting: null, agingLevel: "unknown" };
  const days = Math.floor(
    (Date.now() - requestedAt.getTime()) / (24 * 60 * 60 * 1000)
  );
  const agingLevel: AgingLevel =
    days >= RETURN_OVERDUE_DAYS
      ? "overdue"
      : days >= RETURN_WARNING_DAYS
        ? "warning"
        : "ok";
  return { daysWaiting: days, agingLevel };
}

/**
 * GET /api/warehouse/returns?status=&search=&page=&pageSize=
 * Danh sách đơn hoàn kèm số ngày chờ và mức cảnh báo.
 */
router.get("/returns", async (req: AuthRequest, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const statusQ = typeof req.query.status === "string" ? req.query.status : "";
    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : "";

    const scope: Prisma.OrderWhereInput = {
      channel: { userId: req.ownerId! },
      ...(req.allowedChannelIds
        ? { channelId: { in: req.allowedChannelIds } }
        : {}),
      // Chỉ những đơn thật sự có phát sinh hoàn
      returnStatus: { not: ReturnStatus.NONE },
    };

    const where: Prisma.OrderWhereInput = {
      ...scope,
      ...((Object.values(ReturnStatus) as string[]).includes(statusQ)
        ? { returnStatus: statusQ as ReturnStatus }
        : {}),
      ...(search
        ? {
            OR: [
              { orderCode: { contains: search, mode: "insensitive" as const } },
              { trackingCode: { contains: search, mode: "insensitive" as const } },
              { customerName: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const include = {
      channel: { select: { channelName: true } },
      items: {
        select: {
          id: true,
          productName: true,
          channelSku: true,
          quantity: true,
          price: true,
          product: { select: { imageUrl: true } },
        },
      },
    };

    const [total, rows, byStatus, awaiting] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        // Đơn chờ lâu nhất lên đầu — đó là thứ cần đi đòi trước
        orderBy: [{ returnRequestedAt: "asc" }, { createdAt: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include,
      }),
      // Đếm theo trạng thái, KHÔNG áp bộ lọc trạng thái để mọi thẻ đều có số
      prisma.order.groupBy({
        by: ["returnStatus"],
        _count: { _all: true },
        where: { ...where, returnStatus: { not: ReturnStatus.NONE } },
      }),
      // Riêng nhóm chờ nhận: cần biết bao nhiêu đơn đã quá hạn
      prisma.order.findMany({
        where: { ...scope, returnStatus: ReturnStatus.AWAITING },
        select: { returnRequestedAt: true },
      }),
    ]);

    const summary: Record<string, number> = {
      AWAITING: 0,
      RECEIVED_INTACT: 0,
      DAMAGED: 0,
      CLAIM_SETTLED: 0,
      warning: 0,
      overdue: 0,
      unknown: 0,
    };
    for (const g of byStatus) summary[g.returnStatus] = g._count._all;
    for (const a of awaiting) {
      const { agingLevel } = agingOf(a.returnRequestedAt);
      if (agingLevel === "overdue") summary.overdue++;
      else if (agingLevel === "warning") summary.warning++;
      else if (agingLevel === "unknown") summary.unknown++;
    }

    res.json({
      items: rows.map((o) => ({ ...o, ...agingOf(o.returnRequestedAt) })),
      total,
      page,
      pageSize,
      pageCount: Math.ceil(total / pageSize),
      summary,
      thresholds: {
        warningDays: RETURN_WARNING_DAYS,
        overdueDays: RETURN_OVERDUE_DAYS,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/warehouse/returns/sync — kéo về các đơn sàn báo "Đang hoàn".
 *
 * ⚠️ BẢN GIẢ LẬP. Hubsell chưa có tích hợp API thật với Shopee/TikTok/Lazada
 * nên không có nguồn nào báo đơn nào đang hoàn. Endpoint này bốc ngẫu nhiên
 * vài đơn đang giao để tạo dữ liệu cho kho thao tác. Khi có API thật, thay
 * ruột hàm này bằng lời gọi ra sàn — phần còn lại của trang giữ nguyên.
 */
router.post("/returns/sync", async (req: AuthRequest, res, next) => {
  try {
    const candidates = await prisma.order.findMany({
      where: {
        channel: { userId: req.ownerId! },
        ...(req.allowedChannelIds
          ? { channelId: { in: req.allowedChannelIds } }
          : {}),
        shippingStatus: { in: [ShippingStatus.SHIPPING, ShippingStatus.DELIVERED] },
        returnStatus: ReturnStatus.NONE,
      },
      select: { id: true, orderCode: true },
      take: 3,
    });

    if (candidates.length === 0) {
      res.json({ synced: 0, orderCodes: [] });
      return;
    }

    // Sàn thường báo hoàn sau khi đơn đã đi vài ngày; rải mốc để danh sách đối
    // soát có cả đơn mới, đơn sắp quá hạn và đơn đã quá hạn.
    const daysAgo = [2, 9, 17];
    await prisma.$transaction(
      candidates.map((o, i) =>
        prisma.order.update({
          where: { id: o.id },
          data: {
            returnStatus: ReturnStatus.AWAITING,
            returnRequestedAt: new Date(
              Date.now() - daysAgo[i % daysAgo.length] * 24 * 60 * 60 * 1000
            ),
          },
        })
      )
    );

    res.json({
      synced: candidates.length,
      orderCodes: candidates.map((o) => o.orderCode),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
