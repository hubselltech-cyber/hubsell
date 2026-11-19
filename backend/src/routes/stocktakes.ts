// ============================================================
// KIỂM KÊ THEO PHIÊN — kho chuẩn quốc tế lát 5 (20/11/2026, docs/QUAN-LY-KHO-CHUAN-QUOC-TE.md mục 17;
// anh Trung 19/11: "Làm hết luôn dứt điểm phần kho").
//
// Trang Kiểm kê nhanh (routes/inventory.ts POST /stocktake) giữ nguyên: một người, một máy, đếm xong
// chốt luôn. Phiên là cách THÊM cho shop có nhân viên kho:
//   · nhiều người cùng đếm vào MỘT phiên (số đếm nằm ở máy chủ, không ở trình duyệt của một máy);
//   · đếm xong GỬI DUYỆT, chủ shop duyệt thì mới ghi vào kho (nhân viên không tự đổi tồn);
//   · ĐẾM MÙ: người đếm không thấy số sổ / phần lệch khi đang đếm;
//   · biên bản in được sau khi duyệt.
//
// SỐ SỔ + PHẦN CHÊNH (một luật cho mọi shop, khác trang nhanh của shop cách cũ vốn ghi ĐÈ):
//   bookAtCount = số sổ LÚC ĐẾM dòng đó; lúc duyệt ghi chênh = counted − bookAtCount, số mới = số
//   hiện tại + chênh. Phiên có thể treo vài giờ tới vài ngày trước khi duyệt — ghi đè bằng số đếm
//   sẽ cộng ngược mọi hàng đã bán trong lúc chờ. Số sổ tính theo `stockModel` chụp lúc tạo phiên:
//   LEGACY = sổ tồn bán; ON_HAND = hàng trong kho (tồn bán + đang giữ cho đơn đã chốt).
//
// DUYỆT theo LÔ 50 dòng mỗi giao dịch, mỗi dòng đánh dấu `appliedAt` trong cùng giao dịch với bút
// toán kho → đứt giữa chừng thì bấm duyệt lại chạy tiếp, không dòng nào áp hai lần; hai người bấm
// cùng lúc thì FOR UPDATE SKIP LOCKED chia dòng cho nhau.
// ============================================================
import { randomBytes } from "node:crypto";
import { Router } from "express";
import { InventoryLogType, Prisma, Role } from "@prisma/client";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middleware/auth";
import { finishStockPush, stageStockPush, type StockPushTicket } from "../integrations/inventory-push";
import { applyStockDelta, getStockSettings, type StockModel } from "../services/stock-ledger";

const router = Router();

/** Trần số dòng của một phiên — bằng trần phiếu đếm của trang nhanh (STOCKTAKE_SHEET_MAX). */
const SESSION_LINE_MAX = 2000;
/** Số mã tối đa mỗi lượt gửi số đếm. */
const COUNT_BATCH_MAX = 200;
/** Trần số đếm — khớp STOCKTAKE_COUNT_MAX của routes/inventory.ts. */
const COUNT_MAX = 9_999_999;
/** Số phiên đang mở (đang đếm + chờ duyệt) tối đa của một shop — chặn tạo rác. */
const OPEN_SESSION_MAX = 20;
const APPLY_BATCH = 50;

type Status = "COUNTING" | "PENDING" | "APPROVED" | "CANCELLED";

function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode: status });
}

function sessionCode(id: string, at: Date): string {
  const vn = new Date(at.getTime() + 7 * 60 * 60 * 1000);
  const yy = String(vn.getUTCFullYear()).slice(-2);
  const mm = String(vn.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(vn.getUTCDate()).padStart(2, "0");
  return `KK-${yy}${mm}${dd}-${id.slice(-4).toUpperCase()}`;
}

/** Chủ shop mới là người duyệt (nhân viên đếm và gửi duyệt). */
const isOwner = (req: AuthRequest) => req.userRole === Role.ADMIN;

async function loadSession(req: AuthRequest, id: string) {
  const s = await prisma.stocktakeSession.findFirst({ where: { id, ownerId: req.ownerId! } });
  if (!s) fail(404, "Không tìm thấy phiên kiểm kê");
  return s;
}

/**
 * SỐ SỔ của một nhóm mã theo cách của phiên — MỘT hàm cho lúc đếm, lúc xem và lúc duyệt.
 *   có vị trí:  tồn bán tại vị trí (+ đang giữ tại vị trí nếu ON_HAND)
 *   không:      sổ tồn bán của mã (+ đang giữ cho đơn đã chốt nếu ON_HAND)
 * `lock` = đọc dưới khóa dòng (lúc duyệt, trong giao dịch). Mã không còn trong kho thì không có trong Map.
 */
async function bookOf(
  db: Prisma.TransactionClient | typeof prisma,
  ownerId: string,
  model: StockModel,
  locationId: string | null,
  productIds: string[],
  lock = false
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (productIds.length === 0) return out;
  const suffix = lock ? Prisma.sql`FOR UPDATE OF p` : Prisma.empty;
  const products = await db.$queryRaw<{ id: string; quantityInStock: number; committedQuantity: number }[]>`
    SELECT p."id", p."quantityInStock", p."committedQuantity" FROM "Product" p
     WHERE p."userId" = ${ownerId} AND p."id" IN (${Prisma.join(productIds)})
     ORDER BY p."id" ${suffix}`;
  if (!locationId) {
    for (const p of products) out.set(p.id, p.quantityInStock + (model === "ON_HAND" ? p.committedQuantity : 0));
    return out;
  }
  const ids = products.map((p) => p.id);
  if (ids.length === 0) return out;
  const levels = await db.$queryRaw<{ productId: string; quantity: number; committed: number }[]>`
    SELECT "productId", "quantity", "committed" FROM "product_stock_levels"
     WHERE "locationId" = ${locationId} AND "productId" IN (${Prisma.join(ids)})`;
  const byId = new Map(levels.map((l) => [l.productId, l]));
  for (const id of ids) {
    const l = byId.get(id);
    out.set(id, (l?.quantity ?? 0) + (model === "ON_HAND" ? (l?.committed ?? 0) : 0));
  }
  return out;
}

async function namesOf(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter((v): v is string => Boolean(v)))];
  if (uniq.length === 0) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: uniq } }, select: { id: true, fullName: true } });
  return new Map(users.map((u) => [u.id, u.fullName]));
}

function handle(res: import("express").Response, next: import("express").NextFunction, err: unknown) {
  const e = err as Error & { statusCode?: number };
  if (e.statusCode) {
    res.status(e.statusCode).json({ error: e.message });
    return;
  }
  next(err);
}

// GET /api/stocktakes — 50 phiên mới nhất của shop.
router.get("/", async (req: AuthRequest, res, next) => {
  try {
    const sessions = await prisma.stocktakeSession.findMany({
      where: { ownerId: req.ownerId! },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    // Phiên chưa duyệt chưa có số tổng ghi sẵn → đếm dòng một lượt cho các phiên đang mở.
    const openIds = sessions.filter((s) => s.status === "COUNTING" || s.status === "PENDING").map((s) => s.id);
    const counts = openIds.length
      ? await prisma.stocktakeLine.groupBy({ by: ["sessionId"], where: { sessionId: { in: openIds } }, _count: { _all: true } })
      : [];
    const countById = new Map(counts.map((c) => [c.sessionId, c._count._all]));
    const names = await namesOf(sessions.flatMap((s) => [s.createdById, s.approvedById]));
    res.json({
      items: sessions.map((s) => ({
        id: s.id,
        code: s.code,
        status: s.status,
        locationName: s.locationName,
        blind: s.blind,
        note: s.note,
        createdAt: s.createdAt,
        createdByName: s.createdById ? (names.get(s.createdById) ?? null) : null,
        submittedAt: s.submittedAt,
        approvedAt: s.approvedAt,
        approvedByName: s.approvedById ? (names.get(s.approvedById) ?? null) : null,
        lineCount: countById.get(s.id) ?? s.lineCount,
        adjustedCount: s.adjustedCount,
        totalDown: s.totalDown,
        totalUp: s.totalUp,
      })),
      canApprove: isOwner(req),
    });
  } catch (err) {
    handle(res, next, err);
  }
});

// POST /api/stocktakes — mở phiên. Body: { locationId?, blind?, note? }
router.post("/", async (req: AuthRequest, res, next) => {
  try {
    const ownerId = req.ownerId!;
    const body = req.body ?? {};
    const locationId = typeof body.locationId === "string" && body.locationId ? body.locationId : null;
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 200) : "";
    let locationName: string | null = null;
    if (locationId) {
      const loc = await prisma.stockLocation.findFirst({ where: { id: locationId, userId: ownerId }, select: { name: true } });
      if (!loc) fail(404, "Không tìm thấy vị trí");
      locationName = loc.name;
    }
    const open = await prisma.stocktakeSession.count({ where: { ownerId, status: { in: ["COUNTING", "PENDING"] } } });
    if (open >= OPEN_SESSION_MAX) {
      fail(400, `Đang có ${open} phiên chưa xong — duyệt hoặc hủy bớt rồi mở phiên mới`);
    }
    const { stockModel } = await getStockSettings(prisma, ownerId);
    const id = `kk${randomBytes(11).toString("hex")}`;
    const at = new Date();
    const s = await prisma.stocktakeSession.create({
      data: {
        id,
        ownerId,
        code: sessionCode(id, at),
        stockModel,
        locationId,
        locationName,
        blind: body.blind === true,
        note: note || null,
        createdById: req.userId ?? null,
        createdAt: at,
      },
    });
    res.json({ id: s.id, code: s.code });
  } catch (err) {
    handle(res, next, err);
  }
});

// GET /api/stocktakes/:id — phiên + mọi dòng đã đếm. Đếm mù: người không phải chủ shop không nhận
// số sổ / phần lệch khi phiên còn đang đếm.
router.get("/:id", async (req: AuthRequest, res, next) => {
  try {
    const s = await loadSession(req, String(req.params.id));
    const lines = await prisma.stocktakeLine.findMany({ where: { sessionId: s.id }, orderBy: { skuCode: "asc" } });
    const owner = isOwner(req);
    const hideBook = s.blind && !owner && s.status === "COUNTING";
    const open = s.status === "COUNTING" || s.status === "PENDING";
    // Số sổ HIỆN TẠI chỉ cần khi phiên còn mở (để hiện biến động từ lúc đếm).
    const nowBook =
      open && !hideBook
        ? await bookOf(prisma, s.ownerId, s.stockModel as StockModel, s.locationId, lines.map((l) => l.productId))
        : new Map<string, number>();
    const [names, shopOwner] = await Promise.all([
      namesOf([s.createdById, s.submittedById, s.approvedById, ...lines.map((l) => l.countedById)]),
      prisma.user.findUnique({ where: { id: s.ownerId }, select: { fullName: true, phone: true, email: true } }),
    ]);
    const nameOf = (id: string | null) => (id ? (names.get(id) ?? null) : null);
    res.json({
      session: {
        id: s.id,
        code: s.code,
        status: s.status as Status,
        stockModel: s.stockModel,
        locationId: s.locationId,
        locationName: s.locationName,
        blind: s.blind,
        note: s.note,
        createdAt: s.createdAt,
        createdByName: nameOf(s.createdById),
        submittedAt: s.submittedAt,
        submittedByName: nameOf(s.submittedById),
        approvedAt: s.approvedAt,
        approvedByName: nameOf(s.approvedById),
        cancelledAt: s.cancelledAt,
        adjustedCount: s.adjustedCount,
        totalDown: s.totalDown,
        totalUp: s.totalUp,
      },
      lines: lines.map((l) => ({
        productId: l.productId,
        skuCode: l.skuCode,
        productName: l.productName,
        counted: l.counted,
        countedAt: l.countedAt,
        countedByName: nameOf(l.countedById),
        ...(hideBook
          ? {}
          : {
              bookAtCount: l.bookAtCount,
              // Phiên còn mở: sổ đã đổi bao nhiêu từ lúc đếm (hàng rời kho, nhập thêm…). Mã đã xóa → null.
              ...(open ? { drift: nowBook.has(l.productId) ? nowBook.get(l.productId)! - l.bookAtCount : null } : {}),
              bookAtApply: l.bookAtApply,
              delta: l.delta,
              applied: l.appliedAt !== null,
            }),
      })),
      hideBook,
      canApprove: owner,
      shop: { name: shopOwner?.fullName ?? "Shop", phone: shopOwner?.phone ?? null, email: shopOwner?.email ?? null },
    });
  } catch (err) {
    handle(res, next, err);
  }
});

// POST /api/stocktakes/:id/count — ghi số đếm. Body: { items: [{ productId, counted } | { productId, add } | { productId, counted: null }] }
//   counted = đặt số đếm của mã; add = cộng thêm (máy quét, hai người đếm cùng một mã ở hai kệ → cộng
//   dồn, không ai đè ai); counted null = bỏ dòng. Mỗi lần ghi chụp lại số sổ lúc đó.
router.post("/:id/count", async (req: AuthRequest, res, next) => {
  try {
    const s = await loadSession(req, String(req.params.id));
    if (s.status !== "COUNTING") fail(409, "Phiên không còn ở bước đếm — tải lại trang");
    const raw = req.body?.items;
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > COUNT_BATCH_MAX) {
      fail(400, `Cần 1–${COUNT_BATCH_MAX} mã mỗi lượt`);
    }
    type Item = { productId: string; mode: "set" | "add" | "clear"; value: number };
    const items: Item[] = [];
    for (const it of raw as { productId?: unknown; counted?: unknown; add?: unknown }[]) {
      if (typeof it?.productId !== "string" || !it.productId) fail(400, "Thiếu mã sản phẩm");
      if (it.counted === null) {
        items.push({ productId: it.productId, mode: "clear", value: 0 });
        continue;
      }
      const isAdd = it.add !== undefined;
      const n = Number(isAdd ? it.add : it.counted);
      if (!Number.isInteger(n) || n < (isAdd ? 1 : 0) || n > COUNT_MAX) fail(400, "Số đếm không hợp lệ");
      items.push({ productId: it.productId, mode: isAdd ? "add" : "set", value: n });
    }
    const ids = [...new Set(items.map((i) => i.productId))];
    const products = await prisma.product.findMany({
      where: { userId: s.ownerId, id: { in: ids } },
      select: { id: true, skuCode: true, productName: true },
    });
    if (products.length !== ids.length) fail(404, "Có mã không còn trong kho — tải lại trang");
    const byId = new Map(products.map((p) => [p.id, p]));
    const book = await bookOf(prisma, s.ownerId, s.stockModel as StockModel, s.locationId, ids);

    const writes = items.filter((i) => i.mode !== "clear");
    const existing = await prisma.stocktakeLine.count({ where: { sessionId: s.id } });
    const known = writes.length
      ? await prisma.stocktakeLine.count({ where: { sessionId: s.id, productId: { in: writes.map((w) => w.productId) } } })
      : 0;
    if (existing + (new Set(writes.map((w) => w.productId)).size - known) > SESSION_LINE_MAX) {
      fail(400, `Một phiên tối đa ${SESSION_LINE_MAX} mã — chia theo vị trí hoặc mở phiên khác`);
    }

    const actor = req.userId ?? null;
    await prisma.$transaction(async (tx) => {
      // Khóa dòng phiên: lượt ghi số đếm không chen được vào giữa lúc phiên chuyển sang chờ duyệt.
      const locked = await tx.$queryRaw<{ status: string }[]>`
        SELECT "status" FROM "stocktake_sessions" WHERE "id" = ${s.id} FOR SHARE`;
      if (locked[0]?.status !== "COUNTING") fail(409, "Phiên không còn ở bước đếm — tải lại trang");
      const clears = items.filter((i) => i.mode === "clear").map((i) => i.productId);
      if (clears.length) await tx.stocktakeLine.deleteMany({ where: { sessionId: s.id, productId: { in: clears } } });
      for (const w of writes) {
        const p = byId.get(w.productId)!;
        const b = book.get(w.productId) ?? 0;
        const id = `kl${randomBytes(11).toString("hex")}`;
        // "add" cộng dồn NGAY TRONG câu lệnh (không đọc rồi ghi) → hai máy quét cùng một mã không mất lượt.
        await tx.$executeRaw`
          INSERT INTO "stocktake_lines" ("id", "sessionId", "productId", "skuCode", "productName", "counted", "bookAtCount", "countedAt", "countedById")
          VALUES (${id}, ${s.id}, ${w.productId}, ${p.skuCode}, ${p.productName}, ${w.value}, ${b}, now(), ${actor})
          ON CONFLICT ("sessionId", "productId") DO UPDATE SET
            "counted" = LEAST(${COUNT_MAX}, CASE WHEN ${w.mode === "add"} THEN "stocktake_lines"."counted" + EXCLUDED."counted" ELSE EXCLUDED."counted" END),
            "bookAtCount" = EXCLUDED."bookAtCount",
            "countedAt" = now(),
            "countedById" = EXCLUDED."countedById",
            "skuCode" = EXCLUDED."skuCode",
            "productName" = EXCLUDED."productName"`;
      }
    });
    const fresh = await prisma.stocktakeLine.findMany({
      where: { sessionId: s.id, productId: { in: ids } },
      select: { productId: true, counted: true, bookAtCount: true },
    });
    const hideBook = s.blind && !isOwner(req);
    res.json({
      lines: fresh.map((l) => ({ productId: l.productId, counted: l.counted, ...(hideBook ? {} : { bookAtCount: l.bookAtCount }) })),
      cleared: items.filter((i) => i.mode === "clear").map((i) => i.productId),
    });
  } catch (err) {
    handle(res, next, err);
  }
});

/** Đổi trạng thái có điều kiện (một câu UPDATE) — hai người bấm cùng lúc chỉ một người thắng. */
async function moveStatus(id: string, from: Status[], data: Prisma.StocktakeSessionUpdateManyMutationInput): Promise<boolean> {
  const r = await prisma.stocktakeSession.updateMany({ where: { id, status: { in: from } }, data });
  return r.count === 1;
}

/**
 * Hủy / mở lại: chỉ được khi CHƯA dòng nào áp vào kho. Khóa dòng phiên (FOR UPDATE) rồi mới đếm dòng
 * đã áp — lô duyệt nào cũng lấy khóa chia sẻ trên dòng phiên trước khi ghi, nên không có cảnh "vừa
 * đếm thấy 0 dòng đã áp thì lô duyệt chen vào ghi kho, rồi phiên bị đánh dấu đã hủy".
 */
async function moveIfUntouched(
  id: string,
  from: Status[],
  data: Prisma.StocktakeSessionUpdateManyMutationInput
): Promise<"ok" | "wrong-status" | "applying"> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ status: string }[]>`
      SELECT "status" FROM "stocktake_sessions" WHERE "id" = ${id} FOR UPDATE`;
    if (!rows[0] || !from.includes(rows[0].status as Status)) return "wrong-status";
    const applied = await tx.stocktakeLine.count({ where: { sessionId: id, appliedAt: { not: null } } });
    if (applied > 0) return "applying";
    await tx.stocktakeSession.update({ where: { id }, data });
    return "ok";
  });
}

// POST /api/stocktakes/:id/submit — đếm xong, gửi duyệt.
router.post("/:id/submit", async (req: AuthRequest, res, next) => {
  try {
    const s = await loadSession(req, String(req.params.id));
    const lines = await prisma.stocktakeLine.count({ where: { sessionId: s.id } });
    if (lines === 0) fail(400, "Phiên chưa có mã nào được đếm");
    const ok = await moveStatus(s.id, ["COUNTING"], { status: "PENDING", submittedAt: new Date(), submittedById: req.userId ?? null });
    if (!ok) fail(409, "Phiên không còn ở bước đếm — tải lại trang");
    res.json({ status: "PENDING" });
  } catch (err) {
    handle(res, next, err);
  }
});

// POST /api/stocktakes/:id/reopen — trả phiên về bước đếm (đếm lại / đếm thêm). Chỉ khi chưa áp dòng nào.
router.post("/:id/reopen", async (req: AuthRequest, res, next) => {
  try {
    const s = await loadSession(req, String(req.params.id));
    const r = await moveIfUntouched(s.id, ["PENDING"], { status: "COUNTING", submittedAt: null, submittedById: null });
    if (r === "applying") fail(409, "Phiên đang được duyệt dở — bấm Duyệt để chạy nốt");
    if (r !== "ok") fail(409, "Phiên không ở bước chờ duyệt — tải lại trang");
    res.json({ status: "COUNTING" });
  } catch (err) {
    handle(res, next, err);
  }
});

// POST /api/stocktakes/:id/cancel — bỏ phiên, không ghi gì vào kho. Chủ shop hoặc người mở phiên.
router.post("/:id/cancel", async (req: AuthRequest, res, next) => {
  try {
    const s = await loadSession(req, String(req.params.id));
    if (!isOwner(req) && s.createdById !== req.userId) fail(403, "Chỉ chủ shop hoặc người mở phiên được hủy");
    const r = await moveIfUntouched(s.id, ["COUNTING", "PENDING"], { status: "CANCELLED", cancelledAt: new Date() });
    if (r === "applying") fail(409, "Phiên đang được duyệt dở — bấm Duyệt để chạy nốt");
    if (r !== "ok") fail(409, "Phiên đã duyệt hoặc đã hủy");
    res.json({ status: "CANCELLED" });
  } catch (err) {
    handle(res, next, err);
  }
});

// POST /api/stocktakes/:id/approve — DUYỆT: ghi phần chênh của từng dòng vào kho. Chỉ chủ shop.
router.post("/:id/approve", async (req: AuthRequest, res, next) => {
  try {
    if (!isOwner(req)) fail(403, "Chỉ chủ shop được duyệt phiên kiểm kê");
    const s = await loadSession(req, String(req.params.id));
    if (s.status !== "PENDING") fail(409, s.status === "APPROVED" ? "Phiên đã duyệt rồi" : "Phiên chưa gửi duyệt");
    const model = s.stockModel as StockModel;
    const stamp = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date());
    const head = `Kiểm kê ${stamp}${s.locationName ? ` tại ${s.locationName}` : ""} (phiên ${s.code})`;

    for (;;) {
      let ticket: StockPushTicket | null = null;
      const done = await prisma.$transaction(
        async (tx) => {
          const batch = await tx.$queryRaw<{ id: string; productId: string; counted: number; bookAtCount: number }[]>`
            SELECT "id", "productId", "counted", "bookAtCount" FROM "stocktake_lines"
             WHERE "sessionId" = ${s.id} AND "appliedAt" IS NULL
             ORDER BY "id" LIMIT ${APPLY_BATCH} FOR UPDATE SKIP LOCKED`;
          if (batch.length === 0) return 0;
          // Phiên phải còn chờ duyệt (không bị hủy / mở lại giữa hai lô).
          const st = await tx.$queryRaw<{ status: string }[]>`
            SELECT "status" FROM "stocktake_sessions" WHERE "id" = ${s.id} FOR SHARE`;
          if (st[0]?.status !== "PENDING") fail(409, "Phiên vừa đổi trạng thái — tải lại trang");
          const current = await bookOf(tx, s.ownerId, model, s.locationId, batch.map((b) => b.productId), true);
          const changed: string[] = [];
          for (const b of batch) {
            const now = current.get(b.productId);
            if (now === undefined) {
              // Mã đã bị xóa khỏi kho sau lúc đếm → bỏ qua, biên bản ghi rõ "không áp".
              await tx.stocktakeLine.update({ where: { id: b.id }, data: { appliedAt: new Date(), delta: null, bookAtApply: null } });
              continue;
            }
            const delta = b.counted - b.bookAtCount;
            if (delta !== 0) {
              const sign = delta > 0 ? `+${delta}` : `${delta}`;
              await applyStockDelta(tx, {
                productId: b.productId,
                delta,
                type: InventoryLogType.ADJUST,
                reason: `${head}: sổ ${b.bookAtCount}, đếm ${b.counted}, chênh ${sign}`,
                actorId: req.userId ?? null,
                locationId: s.locationId,
                kind: "STOCKTAKE",
              });
              changed.push(b.productId);
            }
            await tx.stocktakeLine.update({ where: { id: b.id }, data: { appliedAt: new Date(), delta, bookAtApply: now } });
          }
          if (changed.length) {
            ticket = await stageStockPush(tx, changed, { source: `kiểm kê phiên ${s.code}` });
          }
          return batch.length;
        },
        { timeout: 60_000 }
      );
      await finishStockPush(ticket);
      if (done === 0) break;
    }

    // Còn dòng chưa áp = lượt duyệt khác đang giữ → để lượt đó chốt.
    const left = await prisma.stocktakeLine.count({ where: { sessionId: s.id, appliedAt: null } });
    if (left > 0) fail(409, "Phiên đang được duyệt ở nơi khác — đợi vài giây rồi tải lại");
    const agg = await prisma.$queryRaw<{ lines: number; adjusted: number; down: number; up: number }[]>`
      SELECT COUNT(*)::int AS "lines",
             COUNT(*) FILTER (WHERE "delta" IS NOT NULL AND "delta" <> 0)::int AS "adjusted",
             COALESCE(SUM(CASE WHEN "delta" < 0 THEN -"delta" ELSE 0 END), 0)::int AS "down",
             COALESCE(SUM(CASE WHEN "delta" > 0 THEN "delta" ELSE 0 END), 0)::int AS "up"
        FROM "stocktake_lines" WHERE "sessionId" = ${s.id}`;
    const a = agg[0]!;
    await moveStatus(s.id, ["PENDING"], {
      status: "APPROVED",
      approvedAt: new Date(),
      approvedById: req.userId ?? null,
      lineCount: a.lines,
      adjustedCount: a.adjusted,
      totalDown: a.down,
      totalUp: a.up,
    });
    console.log(`[stocktake] ${s.code}: duyệt ${a.lines} mã, ${a.adjusted} mã chênh (−${a.down} / +${a.up}) (${req.userId ?? "?"})`);
    res.json({ status: "APPROVED", lineCount: a.lines, adjustedCount: a.adjusted, totalDown: a.down, totalUp: a.up });
  } catch (err) {
    handle(res, next, err);
  }
});

export default router;
