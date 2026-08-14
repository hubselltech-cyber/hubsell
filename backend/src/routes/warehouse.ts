import { Router } from "express";
import { ChannelName, Prisma, ReturnStatus, ShippingStatus } from "@prisma/client";
import { prisma } from "../prisma";
import type { AuthRequest } from "../auth";
import { channelScope } from "../channel-filter";
import { attachItemImages } from "../item-images";
import { isShopeeConfigured } from "../integrations/shopee/config";
import { syncShopeeOrders } from "../integrations/shopee/service";
import { syncShopeeReturns } from "../integrations/shopee/returns-sync";
import { isLazadaConfigured } from "../integrations/lazada/config";
import { syncLazadaOrders } from "../integrations/lazada/service";

const router = Router();

/**
 * ĐỐI SOÁT ĐƠN HOÀN (RTS Reconciliation) — góc nhìn của KHO.
 *
 * Trang /orders theo dõi vòng đời từng đơn; ở đây kho đối chiếu danh sách SÀN
 * BÁO HOÀN với hàng thực nhận, để lòi ra kiện đi lạc.
 *
 * Luồng 2 CÔNG ĐOẠN (tối ưu thao tác điện thoại):
 *   1. QUÉT NHẬN  — POST /returns/:id/receive (ở đây): AWAITING → RECEIVED,
 *      chỉ ghi nhận "hàng đã về tay", KHÔNG đụng tồn kho.
 *   2. NHẬP KHO   — POST /api/orders/:id/return (lẻ) hoặc
 *      POST /api/orders/returns/bulk-inbound (tất cả): RECEIVED → RECEIVED_INTACT,
 *      cộng ngược tồn kho.
 *
 * ⚠️ Route này CỐ Ý KHÔNG có endpoint cộng tồn kho. Mọi đường cộng kho đều nằm
 * ở /api/orders/* — nơi duy nhất được phép cộng kho, có chốt chặn
 * `Order.stockRestoredAt` chống cộng trùng. Mở đường cộng kho thứ hai ở đây là
 * mở lại đúng lỗ hổng làm kho phình ảo.
 */

/** Quá bao nhiêu ngày thì cảnh báo / coi như chưa về tay. */
export const RETURN_WARNING_DAYS = 7;
export const RETURN_OVERDUE_DAYS = 14;

/**
 * Nhóm trạng thái cho filter gộp (?status=) — định nghĩa cố định nên đặt
 * module scope, và summary trả kèm số đếm CÙNG định nghĩa để client khỏi tự
 * cộng rồi lệch khi thêm trạng thái mới (web /returns đã từng dính lỗi này).
 *
 * ISSUES  — tab Hao hụt/Khiếu nại: hư hỏng đang khiếu nại + đã đền bù + đã
 *           xoá sổ, gom một tab cho gọn thanh tab trên màn điện thoại.
 * SCANNED — tab "Đã nhận hoàn" mobile: hàng ĐÃ VỀ TAY, tức mọi trạng thái
 *           trừ NONE/AWAITING — viết dạng phần bù để trạng thái sau-quét
 *           thêm về sau tự vào nhóm thay vì âm thầm rơi ra.
 */
const ISSUE_STATUSES = [
  ReturnStatus.DAMAGED,
  ReturnStatus.CLAIM_SETTLED,
  ReturnStatus.WRITTEN_OFF,
];
const SCANNED_STATUSES = Object.values(ReturnStatus).filter(
  (s) => s !== ReturnStatus.NONE && s !== ReturnStatus.AWAITING
);

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
    // Lọc theo gian hàng: shop đối soát với bưu cục của từng gian riêng
    const scope: Prisma.OrderWhereInput = {
      channel: channelScope(req),
      // Chỉ những đơn thật sự có phát sinh hoàn
      returnStatus: { not: ReturnStatus.NONE },
    };

    const where: Prisma.OrderWhereInput = {
      ...scope,
      ...(statusQ === "ISSUES"
        ? { returnStatus: { in: ISSUE_STATUSES } }
        : statusQ === "SCANNED"
          ? { returnStatus: { in: SCANNED_STATUSES } }
          : (Object.values(ReturnStatus) as string[]).includes(statusQ)
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
      channel: { select: { channelName: true, shopName: true } },
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
        // Tổng tiền đền bù để module Tài chính hạch toán dòng tiền thu về
        _sum: { compensationAmount: true },
        where: { ...where, returnStatus: { not: ReturnStatus.NONE } },
      }),
      // Riêng nhóm chờ nhận: cần biết bao nhiêu đơn đã quá hạn
      prisma.order.findMany({
        where: { ...scope, returnStatus: ReturnStatus.AWAITING },
        select: { returnRequestedAt: true },
      }),
    ]);

    const totalCompensated = byStatus.reduce(
      (sum, g) => sum + Number(g._sum?.compensationAmount ?? 0),
      0
    );

    const summary: Record<string, number> = {
      AWAITING: 0,
      RECEIVED: 0,
      RECEIVED_INTACT: 0,
      DAMAGED: 0,
      CLAIM_SETTLED: 0,
      WRITTEN_OFF: 0,
      warning: 0,
      overdue: 0,
      unknown: 0,
    };
    for (const g of byStatus) summary[g.returnStatus] = g._count._all;
    // Số đếm nhóm dùng chung định nghĩa với bộ lọc ?status=SCANNED
    summary.SCANNED = SCANNED_STATUSES.reduce(
      (n, s) => n + (summary[s] ?? 0),
      0
    );
    for (const a of awaiting) {
      const { agingLevel } = agingOf(a.returnRequestedAt);
      if (agingLevel === "overdue") summary.overdue++;
      else if (agingLevel === "warning") summary.warning++;
      else if (agingLevel === "unknown") summary.unknown++;
    }

    // Gắn ảnh dòng hàng: SP kho gốc → fallback ảnh ChannelProduct
    const rowsWithImages = await attachItemImages(rows);
    res.json({
      items: rowsWithImages.map((o) => ({ ...o, ...agingOf(o.returnRequestedAt) })),
      total,
      page,
      pageSize,
      pageCount: Math.ceil(total / pageSize),
      summary,
      totalCompensated,
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
 * Từ 09/08: user có gian THẬT thì gọi API sàn THẬT — đồng bộ đơn theo trục
 * BIẾN ĐỘNG (update) 2 ngày gần nhất, upsert sẽ tự gắn cờ AWAITING cho đơn sàn
 * báo hoàn (Shopee TO_RETURN / Lazada *return*). Worker nền 10'/lần cũng quét
 * đúng trục này nên nút chỉ là "quét ngay khỏi đợi nhịp".
 *
 * User CHƯA có gian thật (demo/dev) giữ bản giả lập cũ: bốc vài đơn đang giao
 * gắn cờ hoàn để kho có dữ liệu thao tác thử luồng 2 công đoạn.
 */
const SYNC_RETURNS_DAYS_BACK = 2;

router.post("/returns/sync", async (req: AuthRequest, res, next) => {
  try {
    const realChannels = await prisma.channel.findMany({
      where: {
        userId: req.ownerId!,
        ...(req.allowedChannelIds ? { id: { in: req.allowedChannelIds } } : {}),
        channelName: { in: [ChannelName.SHOPEE, ChannelName.LAZADA] },
        status: "ACTIVE",
        refreshToken: { not: null },
      },
    });

    if (realChannels.length > 0) {
      // Cờ AWAITING trước lượt quét — để diff ra danh sách đơn hoàn MỚI phát hiện.
      const orderScope = {
        channel: { userId: req.ownerId! },
        ...(req.allowedChannelIds
          ? { channelId: { in: req.allowedChannelIds } }
          : {}),
      };
      const before = await prisma.order.findMany({
        where: { ...orderScope, returnStatus: ReturnStatus.AWAITING },
        select: { id: true },
      });
      const beforeIds = new Set(before.map((o) => o.id));

      let firstError: string | null = null;
      let anyOk = false;
      for (const channel of realChannels) {
        try {
          if (channel.channelName === ChannelName.SHOPEE) {
            if (!isShopeeConfigured()) continue;
            await syncShopeeOrders(channel, {
              daysBack: SYNC_RETURNS_DAYS_BACK,
              timeRangeField: "update_time",
            });
            // Returns API — nguồn duy nhất thấy yêu cầu Trả hàng/Hoàn tiền
            // trên đơn đã COMPLETED (không đổi order_status nên quét đơn ở
            // trên không thấy); kèm mã vận đơn CHIỀU HOÀN cho kho quét.
            // Bấm tay là "muốn thấy ngay" nên quét sâu hơn nhịp nền một chút.
            await syncShopeeReturns(channel, { daysBack: 7 });
          } else {
            if (!isLazadaConfigured()) continue;
            await syncLazadaOrders(channel, {
              daysBack: SYNC_RETURNS_DAYS_BACK,
              byUpdateTime: true,
            });
          }
          anyOk = true;
        } catch (err) {
          // Một gian lỗi (token hết hạn, sàn chập chờn) không chặn gian khác.
          if (!firstError) firstError = (err as Error).message;
        }
      }
      if (!anyOk && firstError) {
        res.status(502).json({ error: `Không gọi được API sàn: ${firstError}` });
        return;
      }

      const after = await prisma.order.findMany({
        where: { ...orderScope, returnStatus: ReturnStatus.AWAITING },
        select: { id: true, orderCode: true },
      });
      const fresh = after.filter((o) => !beforeIds.has(o.id));
      res.json({ synced: fresh.length, orderCodes: fresh.map((o) => o.orderCode) });
      return;
    }

    // ---- BẢN GIẢ LẬP cho tài khoản demo (không có gian thật nào) ----
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

/**
 * POST /api/warehouse/returns/:id/receive — CÔNG ĐOẠN 1: quét nhận hàng hoàn.
 *
 * Ghi nhận "kiện hàng ĐÃ VỀ TAY kho" (AWAITING → RECEIVED) và dừng ở đó —
 * KHÔNG cộng tồn kho. Việc cộng kho là công đoạn 2, làm lẻ qua
 * `POST /api/orders/:id/return` hoặc gộp qua `POST /api/orders/returns/bulk-inbound`.
 *
 * Nhận cả đơn returnStatus = NONE: thực tế có kiện hoàn về tay TRƯỚC khi sàn
 * kịp báo — quét trúng thì vẫn phải nhận được, đồng thời tự gắn mốc sàn báo
 * hoàn để đơn xuất hiện trong danh sách đối soát.
 */
router.post("/returns/:id/receive", async (req: AuthRequest, res, next) => {
  try {
    const order = await prisma.order.findFirst({
      where: {
        id: req.params.id,
        channel: { userId: req.ownerId! },
        ...(req.allowedChannelIds
          ? { channelId: { in: req.allowedChannelIds } }
          : {}),
      },
      select: {
        id: true,
        orderCode: true,
        returnStatus: true,
        returnRequestedAt: true,
      },
    });
    if (!order) {
      res.status(404).json({ error: "Không tìm thấy đơn hàng" });
      return;
    }
    if (order.returnStatus === ReturnStatus.RECEIVED) {
      res.status(409).json({
        error: `Đơn ${order.orderCode} đã quét nhận rồi — chỉ còn chờ nhập kho`,
      });
      return;
    }
    if (
      order.returnStatus !== ReturnStatus.AWAITING &&
      order.returnStatus !== ReturnStatus.NONE
    ) {
      res.status(409).json({
        error: `Đơn ${order.orderCode} đã được xử lý hoàn trước đó rồi`,
      });
      return;
    }

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: {
        returnStatus: ReturnStatus.RECEIVED,
        // Mốc "đã cầm hàng trên tay" — dừng đồng hồ đếm ngày chờ về
        returnedAt: new Date(),
        // Hàng đã quay về thì vòng đời giao hàng của đơn kết thúc
        shippingStatus: ShippingStatus.CANCELLED,
        // Đơn sàn chưa kịp báo hoàn: lấy luôn lúc quét làm mốc báo hoàn
        returnRequestedAt: order.returnRequestedAt ?? new Date(),
      },
      include: { channel: { select: { channelName: true, shopName: true } } },
    });

    res.json({
      order: updated,
      unannounced: order.returnStatus === ReturnStatus.NONE,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/warehouse/returns/:id/claim — chốt kết quả khiếu nại.
 * Body: { outcome: "COMPENSATED" | "REJECTED", amount?: number, note?: string }
 *
 *   COMPENSATED → CLAIM_SETTLED (bưu cục/sàn đã đền)
 *   REJECTED    → WRITTEN_OFF   (shop chịu hao hụt, tính vào lỗ)
 *
 * ⚠️ CẢ HAI NHÁNH ĐỀU KHÔNG ĐỘNG VÀO TỒN KHO. Hàng đã hỏng hoặc mất thật —
 * được đền bằng TIỀN chứ hàng không quay lại kệ. Cộng kho ở đây là tạo hàng ma:
 * bán ra rồi mới biết không có gì để giao. Endpoint này chỉ đổi trạng thái.
 */
router.post("/returns/:id/claim", async (req: AuthRequest, res, next) => {
  try {
    const { outcome, amount, note } = req.body ?? {};
    if (outcome !== "COMPENSATED" && outcome !== "REJECTED") {
      res.status(400).json({
        error:
          "outcome phải là COMPENSATED (được đền bù) hoặc REJECTED (không được đền)",
      });
      return;
    }
    if (note !== undefined && typeof note !== "string") {
      res.status(400).json({ error: "Ghi chú phải là chuỗi" });
      return;
    }

    // Thua kiện thì không có tiền về, luôn ghi 0 — kể cả client có gửi số khác.
    let compensation = 0;
    if (outcome === "COMPENSATED") {
      const value = typeof amount === "string" ? Number(amount) : amount;
      if (typeof value !== "number" || Number.isNaN(value) || value <= 0) {
        res.status(400).json({
          error:
            "Đã được đền bù thì phải nhập số tiền lớn hơn 0. Nếu bưu cục không đền đồng nào, chọn “Không được đền bù”.",
        });
        return;
      }
      compensation = Math.round(value);
    }

    const order = await prisma.order.findFirst({
      where: {
        id: req.params.id,
        channel: { userId: req.ownerId! },
        ...(req.allowedChannelIds
          ? { channelId: { in: req.allowedChannelIds } }
          : {}),
      },
      select: {
        id: true,
        orderCode: true,
        returnStatus: true,
        returnNote: true,
        totalAmount: true,
      },
    });
    if (!order) {
      res.status(404).json({ error: "Không tìm thấy đơn hàng" });
      return;
    }
    // Chỉ chốt được kết quả cho đơn ĐANG đi khiếu nại
    if (order.returnStatus !== ReturnStatus.DAMAGED) {
      res.status(409).json({
        error: `Đơn ${order.orderCode} không ở trạng thái chờ khiếu nại`,
      });
      return;
    }

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: {
        returnStatus:
          outcome === "COMPENSATED"
            ? ReturnStatus.CLAIM_SETTLED
            : ReturnStatus.WRITTEN_OFF,
        compensationAmount: compensation,
        // Nối ghi chú mới vào ghi chú cũ để giữ lại lý do hư hỏng ban đầu —
        // đó là bằng chứng, ghi đè đi là mất căn cứ đối soát sau này.
        returnNote:
          typeof note === "string" && note.trim()
            ? [order.returnNote, note.trim()].filter(Boolean).join(" · ")
            : order.returnNote,
      },
      include: { channel: { select: { channelName: true, shopName: true } } },
    });

    res.json({ order: updated });
  } catch (err) {
    next(err);
  }
});

export default router;
