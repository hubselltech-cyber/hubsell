// ============================================================
// VỊ TRÍ CHỨA HÀNG — API (đợt B 24/09/2026, khung anh Trung chốt 15/09)
//
// Kho nhỏ / kệ / ô đều là "vị trí", cây cha-con, khách tự đặt tên. Shop chưa
// tạo dòng nào = chưa dùng tính năng, giao diện y hệt cũ. Bấm "Thêm vị trí"
// lần đầu → hệ thống tự sinh gốc "Kho chính" (mặc định) và đổ toàn bộ tồn hiện
// có vào gốc, rồi tạo vị trí khách vừa nhập. Xóa hết vị trí = quay về như cũ.
//
// Tồn theo vị trí do services/stock-ledger.ts ghi (một cửa); ở đây chỉ có
// CRUD vị trí, đọc tồn theo vị trí, chuyển vị trí, sửa số tại vị trí.
// ============================================================
import { Router } from "express";
import { Prisma, Role } from "@prisma/client";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middleware/auth";
import { enqueueStockPush } from "../integrations/inventory-push";
import {
  createRootLocationTx,
  setLevelAbsolute,
  transferStockTx,
} from "../services/stock-ledger";
import { codeFromName, expandLocationPattern } from "../lib/location-pattern";
import { buildLocationLabelsPdf } from "../services/fulfillment/location-labels-pdf";

const router = Router();

const NAME_MAX = 60;
const CODE_MAX = 30;

function parseName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 && t.length <= NAME_MAX ? t : null;
}
function parseCode(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim().toUpperCase();
  return t.length > 0 && t.length <= CODE_MAX ? t : undefined;
}

type Tx = Prisma.TransactionClient;

/**
 * CÂY KHO › KỆ › TẦNG (anh Trung 24/09: sinh kệ phải nằm TRONG kho, không thành kho khác).
 * Thứ tự ưu tiên trừ hàng = duyệt cây theo chiều sâu: cha rồi tới các con của nó, anh em
 * xếp theo sortOrder. Sau mọi lần tạo / đổi cha / sắp lại, đánh số lại 0..n theo đúng thứ tự
 * đó để `listLocations` (sổ kho) chỉ cần ORDER BY sortOrder là ra cây.
 */
async function normalizeTreeOrderTx(tx: Tx, userId: string) {
  const rows = await tx.stockLocation.findMany({
    where: { userId },
    select: { id: true, parentId: true, sortOrder: true, createdAt: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const ids = new Set(rows.map((r) => r.id));
  const children = new Map<string | null, typeof rows>();
  for (const r of rows) {
    const key = r.parentId && ids.has(r.parentId) ? r.parentId : null;
    const arr = children.get(key) ?? [];
    arr.push(r);
    children.set(key, arr);
  }
  const ordered: string[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null) => {
    for (const r of children.get(parent) ?? []) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      ordered.push(r.id);
      walk(r.id);
    }
  };
  walk(null);
  const bySort = new Map(rows.map((r) => [r.id, r.sortOrder]));
  await Promise.all(
    ordered
      .map((id, i) => (bySort.get(id) === i ? null : tx.stockLocation.update({ where: { id }, data: { sortOrder: i } })))
      .filter(Boolean)
  );
}

/** Đường dẫn "Kho 2 › Kệ A1 › T2" cho từng vị trí. */
function buildPaths(rows: { id: string; parentId: string | null; name: string }[]): Map<string, string> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const paths = new Map<string, string>();
  const pathOf = (id: string, guard = 0): string => {
    const cached = paths.get(id);
    if (cached) return cached;
    const r = byId.get(id)!;
    const parent = r.parentId && byId.has(r.parentId) && guard < 20 ? pathOf(r.parentId, guard + 1) : null;
    const p = parent ? `${parent} › ${r.name}` : r.name;
    paths.set(id, p);
    return p;
  };
  for (const r of rows) pathOf(r.id);
  return paths;
}

/** Danh sách vị trí + số SKU có hàng + tổng tồn mỗi vị trí (một câu groupBy), kèm đường dẫn cây. */
async function listWithTotals(ownerId: string) {
  const [locations, totals] = await Promise.all([
    prisma.stockLocation.findMany({
      where: { userId: ownerId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        parentId: true,
        name: true,
        code: true,
        sortOrder: true,
        isDefault: true,
        isReturnDefault: true,
        sellable: true,
        createdAt: true,
      },
    }),
    prisma.productStockLevel.groupBy({
      by: ["locationId"],
      where: { location: { userId: ownerId }, quantity: { not: 0 } },
      _sum: { quantity: true },
      _count: { _all: true },
    }),
  ]);
  const byLoc = new Map(totals.map((t) => [t.locationId, t]));
  const paths = buildPaths(locations);
  return locations.map((l) => ({
    ...l,
    path: paths.get(l.id) ?? l.name,
    skuCount: byLoc.get(l.id)?._count._all ?? 0,
    totalQuantity: byLoc.get(l.id)?._sum.quantity ?? 0,
  }));
}

// GET /api/stock-locations — danh sách (rỗng = shop chưa dùng vị trí)
router.get("/", async (req: AuthRequest, res, next) => {
  try {
    const items = await listWithTotals(req.ownerId!);
    res.json({ items, enabled: items.length > 0 });
  } catch (err) {
    next(err);
  }
});

// GET /api/stock-locations/levels?productId= — tồn theo vị trí của MỘT SKU
// (chi tiết "Đang ở"): trả đủ mọi vị trí, vị trí không có dòng = 0.
router.get("/levels", async (req: AuthRequest, res, next) => {
  try {
    const productId = typeof req.query.productId === "string" ? req.query.productId : "";
    if (!productId) {
      res.status(400).json({ error: "Thiếu mã sản phẩm" });
      return;
    }
    const product = await prisma.product.findFirst({
      where: { id: productId, userId: req.ownerId! },
      select: { id: true, skuCode: true, productName: true, quantityInStock: true },
    });
    if (!product) {
      res.status(404).json({ error: "Không tìm thấy sản phẩm" });
      return;
    }
    const [locations, levels] = await Promise.all([
      prisma.stockLocation.findMany({
        where: { userId: req.ownerId! },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true, name: true, code: true, isDefault: true, sellable: true },
      }),
      prisma.productStockLevel.findMany({
        where: { productId },
        select: { locationId: true, quantity: true },
      }),
    ]);
    const qty = new Map(levels.map((l) => [l.locationId, l.quantity]));
    res.json({
      product,
      levels: locations.map((l) => ({ ...l, quantity: qty.get(l.id) ?? 0 })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/stock-locations — thêm vị trí. Lần đầu: tự sinh gốc "Kho chính".
// Body: { name, code?, parentId? }. Chỉ chủ shop.
router.post("/", async (req: AuthRequest, res, next) => {
  try {
    if (req.userRole !== Role.ADMIN) {
      res.status(403).json({ error: "Chỉ chủ shop mới được thêm vị trí chứa hàng" });
      return;
    }
    const name = parseName(req.body?.name);
    if (!name) {
      res.status(400).json({ error: `Tên vị trí phải có, tối đa ${NAME_MAX} ký tự` });
      return;
    }
    const code = parseCode(req.body?.code);
    if (code === undefined && req.body?.code !== undefined) {
      res.status(400).json({ error: `Mã vị trí tối đa ${CODE_MAX} ký tự` });
      return;
    }
    const parentId =
      typeof req.body?.parentId === "string" && req.body.parentId ? req.body.parentId : null;
    const ownerId = req.ownerId!;

    const result = await prisma.$transaction(async (tx) => {
      // Khoá theo chủ shop để hai lượt "thêm lần đầu" song song không tạo 2 gốc.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${ownerId} FOR UPDATE`;
      const count = await tx.stockLocation.count({ where: { userId: ownerId } });
      let createdRoot: { id: string; name: string } | null = null;
      if (count === 0) {
        createdRoot = await createRootLocationTx(tx, ownerId);
      }
      if (parentId) {
        const parent = await tx.stockLocation.findFirst({
          where: { id: parentId, userId: ownerId },
          select: { id: true },
        });
        if (!parent) {
          throw Object.assign(new Error("Vị trí cha không tồn tại"), { statusCode: 400 });
        }
      }
      const max = await tx.stockLocation.aggregate({
        where: { userId: ownerId },
        _max: { sortOrder: true },
      });
      const created = await tx.stockLocation.create({
        data: {
          userId: ownerId,
          name,
          code: code ?? null,
          parentId,
          sortOrder: (max._max.sortOrder ?? -1) + 1,
        },
        select: { id: true, name: true },
      });
      await normalizeTreeOrderTx(tx, ownerId);
      return { created, createdRoot };
    });

    const items = await listWithTotals(ownerId);
    res.status(201).json({ ...result, items, enabled: true });
  } catch (err) {
    const e = err as Error & { statusCode?: number; code?: string };
    if (e.code === "P2002") {
      res.status(409).json({ error: "Mã vị trí đã có trong shop — chọn mã khác" });
      return;
    }
    if (e.statusCode) {
      res.status(e.statusCode).json({ error: e.message });
      return;
    }
    next(err);
  }
});

// PATCH /api/stock-locations/:id — đổi tên / mã / cha / mặc định / nhận hoàn.
router.patch("/:id", async (req: AuthRequest, res, next) => {
  try {
    if (req.userRole !== Role.ADMIN) {
      res.status(403).json({ error: "Chỉ chủ shop mới được sửa vị trí chứa hàng" });
      return;
    }
    const ownerId = req.ownerId!;
    const loc = await prisma.stockLocation.findFirst({
      where: { id: req.params.id, userId: ownerId },
    });
    if (!loc) {
      res.status(404).json({ error: "Không tìm thấy vị trí" });
      return;
    }
    const b = req.body ?? {};
    const data: Prisma.StockLocationUpdateInput = {};
    if (b.name !== undefined) {
      const name = parseName(b.name);
      if (!name) {
        res.status(400).json({ error: `Tên vị trí phải có, tối đa ${NAME_MAX} ký tự` });
        return;
      }
      data.name = name;
    }
    if (b.code !== undefined) {
      const code = parseCode(b.code);
      if (code === undefined) {
        res.status(400).json({ error: `Mã vị trí tối đa ${CODE_MAX} ký tự` });
        return;
      }
      data.code = code;
    }
    if (b.parentId !== undefined) {
      const parentId = typeof b.parentId === "string" && b.parentId ? b.parentId : null;
      if (parentId === loc.id) {
        res.status(400).json({ error: "Vị trí không thể là cha của chính nó" });
        return;
      }
      if (parentId) {
        const parent = await prisma.stockLocation.findFirst({
          where: { id: parentId, userId: ownerId },
          select: { id: true, parentId: true },
        });
        if (!parent) {
          res.status(400).json({ error: "Vị trí cha không tồn tại" });
          return;
        }
        // Cha mới không được là con/cháu của chính nó (vòng lặp) — đi ngược lên tới gốc.
        const all = await prisma.stockLocation.findMany({
          where: { userId: ownerId },
          select: { id: true, parentId: true },
        });
        const up = new Map(all.map((a) => [a.id, a.parentId]));
        let cur: string | null | undefined = parent.id;
        let guard = 0;
        while (cur && guard++ < 50) {
          if (cur === loc.id) {
            res.status(400).json({ error: "Không thể đặt con/cháu làm cha (vòng lặp)" });
            return;
          }
          cur = up.get(cur);
        }
      }
      data.parent = parentId ? { connect: { id: parentId } } : { disconnect: true };
    }
    if (b.sellable !== undefined) {
      if (typeof b.sellable !== "boolean") {
        res.status(400).json({ error: "Cờ bán được phải là true/false" });
        return;
      }
      if (b.sellable !== loc.sellable) {
        // Đổi cờ khi còn hàng sẽ làm tổng bán lệch âm thầm → bắt chuyển hàng đi trước
        // (cùng cách với xóa). Vị trí mặc định luôn phải bán được.
        const stocked = await prisma.productStockLevel.count({
          where: { locationId: loc.id, quantity: { not: 0 } },
        });
        if (stocked > 0) {
          res.status(409).json({
            error: `"${loc.name}" còn ${stocked} SKU có hàng — chuyển hàng đi trước rồi mới đổi cờ bán được`,
            code: "LOCATION_HAS_STOCK",
          });
          return;
        }
        if (!b.sellable && (loc.isDefault || b.isDefault === true)) {
          res.status(400).json({ error: "Vị trí mặc định phải bán được — chọn vị trí khác làm ô không bán" });
          return;
        }
      }
      data.sellable = b.sellable;
    }
    if (b.isDefault === true && !loc.sellable && b.sellable !== true) {
      res.status(400).json({ error: "Ô không bán không thể làm vị trí mặc định" });
      return;
    }

    await prisma.$transaction(async (tx) => {
      // Mặc định / nhận hoàn: mỗi shop đúng một → hạ cờ ở dòng khác trước.
      if (b.isDefault === true) {
        await tx.stockLocation.updateMany({
          where: { userId: ownerId, isDefault: true },
          data: { isDefault: false },
        });
        data.isDefault = true;
      }
      if (b.isReturnDefault !== undefined) {
        if (b.isReturnDefault === true) {
          await tx.stockLocation.updateMany({
            where: { userId: ownerId, isReturnDefault: true },
            data: { isReturnDefault: false },
          });
        }
        data.isReturnDefault = b.isReturnDefault === true;
      }
      await tx.stockLocation.update({ where: { id: loc.id }, data });
      if (b.parentId !== undefined) await normalizeTreeOrderTx(tx, ownerId);
    });

    const items = await listWithTotals(ownerId);
    res.json({ items, enabled: items.length > 0 });
  } catch (err) {
    const e = err as Error & { code?: string };
    if (e.code === "P2002") {
      res.status(409).json({ error: "Mã vị trí đã có trong shop — chọn mã khác" });
      return;
    }
    next(err);
  }
});

// PUT /api/stock-locations/order — thứ tự ưu tiên trừ hàng. Body: { ids: string[] }
// (đủ mọi vị trí của shop, theo thứ tự mới).
router.put("/order", async (req: AuthRequest, res, next) => {
  try {
    if (req.userRole !== Role.ADMIN) {
      res.status(403).json({ error: "Chỉ chủ shop mới được sắp thứ tự vị trí" });
      return;
    }
    const ids = Array.isArray(req.body?.ids) ? (req.body.ids as unknown[]) : null;
    if (!ids || !ids.every((x) => typeof x === "string")) {
      res.status(400).json({ error: "Thiếu danh sách vị trí" });
      return;
    }
    const ownerId = req.ownerId!;
    const own = await prisma.stockLocation.findMany({
      where: { userId: ownerId },
      select: { id: true },
    });
    const ownIds = new Set(own.map((o) => o.id));
    if (ids.length !== ownIds.size || !(ids as string[]).every((id) => ownIds.has(id))) {
      res.status(400).json({ error: "Danh sách phải gồm đúng mọi vị trí của shop" });
      return;
    }
    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < ids.length; i++) {
        await tx.stockLocation.update({ where: { id: ids[i] as string }, data: { sortOrder: i } });
      }
      // Khách chỉ đổi chỗ anh em; đánh số lại theo cây để con luôn đi sau cha.
      await normalizeTreeOrderTx(tx, ownerId);
    });
    const items = await listWithTotals(ownerId);
    res.json({ items, enabled: items.length > 0 });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/stock-locations/:id — chặn khi còn hàng hoặc còn vị trí con
// (học Shopify). Xóa gốc khi nó là vị trí CUỐI CÙNG = tắt tính năng: level của
// gốc xóa theo (cascade), tổng vẫn ở Product.quantityInStock nên không mất gì.
router.delete("/:id", async (req: AuthRequest, res, next) => {
  try {
    if (req.userRole !== Role.ADMIN) {
      res.status(403).json({ error: "Chỉ chủ shop mới được xóa vị trí" });
      return;
    }
    const ownerId = req.ownerId!;
    const loc = await prisma.stockLocation.findFirst({
      where: { id: req.params.id, userId: ownerId },
      select: {
        id: true,
        name: true,
        isDefault: true,
        _count: { select: { children: true } },
      },
    });
    if (!loc) {
      res.status(404).json({ error: "Không tìm thấy vị trí" });
      return;
    }
    if (loc._count.children > 0) {
      res.status(409).json({
        error: `"${loc.name}" còn ${loc._count.children} vị trí con — xóa hoặc chuyển con đi trước`,
      });
      return;
    }
    const total = await prisma.stockLocation.count({ where: { userId: ownerId } });
    const stocked = await prisma.productStockLevel.count({
      where: { locationId: loc.id, quantity: { not: 0 } },
    });
    if (total > 1 && stocked > 0) {
      res.status(409).json({
        error: `"${loc.name}" còn ${stocked} SKU có hàng — chuyển hàng sang vị trí khác trước rồi mới xóa`,
        code: "LOCATION_HAS_STOCK",
      });
      return;
    }
    if (total > 1 && loc.isDefault) {
      res.status(409).json({
        error: `"${loc.name}" đang là vị trí mặc định — đặt vị trí khác làm mặc định trước`,
        code: "LOCATION_IS_DEFAULT",
      });
      return;
    }
    await prisma.stockLocation.delete({ where: { id: loc.id } });
    const items = await listWithTotals(ownerId);
    res.json({ items, enabled: items.length > 0 });
  } catch (err) {
    next(err);
  }
});

// POST /api/stock-locations/transfer — chuyển hàng giữa hai vị trí (tổng không đổi,
// không đẩy sàn). Body: { fromLocationId, toLocationId, items: [{productId, quantity}], reason? }
router.post("/transfer", async (req: AuthRequest, res, next) => {
  try {
    const { fromLocationId, toLocationId, items, reason } = req.body ?? {};
    if (typeof fromLocationId !== "string" || typeof toLocationId !== "string") {
      res.status(400).json({ error: "Thiếu nơi đi / nơi đến" });
      return;
    }
    if (!Array.isArray(items) || items.length === 0 || items.length > 200) {
      res.status(400).json({ error: "Phiếu chuyển cần 1–200 dòng" });
      return;
    }
    const ownerId = req.ownerId!;
    const locs = await prisma.stockLocation.findMany({
      where: { userId: ownerId, id: { in: [fromLocationId, toLocationId] } },
      select: { id: true, name: true },
    });
    const from = locs.find((l) => l.id === fromLocationId);
    const to = locs.find((l) => l.id === toLocationId);
    if (!from || !to) {
      res.status(400).json({ error: "Vị trí không thuộc shop" });
      return;
    }
    const note =
      typeof reason === "string" && reason.trim()
        ? reason.trim()
        : `Chuyển vị trí: ${from.name} → ${to.name}`;
    const ids = (items as { productId?: unknown }[]).map((it) => it.productId);
    if (!ids.every((id) => typeof id === "string" && id)) {
      res.status(400).json({ error: "Dòng thiếu mã sản phẩm" });
      return;
    }
    const owned = await prisma.product.count({
      where: { userId: ownerId, id: { in: ids as string[] } },
    });
    if (owned !== new Set(ids).size) {
      res.status(404).json({ error: "Có mã không còn trong kho" });
      return;
    }

    const results = await prisma.$transaction(async (tx) => {
      const out: { productId: string; from: number; to: number; totalChanged: boolean }[] = [];
      for (const it of items as { productId: string; quantity: unknown }[]) {
        const r = await transferStockTx(tx, {
          productId: it.productId,
          fromLocationId,
          toLocationId,
          quantity: Number(it.quantity),
          reason: note,
          actorId: req.userId ?? null,
        });
        out.push({ productId: it.productId, from: r.from, to: r.to, totalChanged: r.totalChanged });
      }
      return out;
    });
    // Qua / ra khỏi ô "không bán" thì tồn bán đổi → đẩy Có thể bán mới lên sàn.
    const changed = results.filter((r) => r.totalChanged).map((r) => r.productId);
    if (changed.length) {
      await enqueueStockPush(changed, { source: `chuyển vị trí ${from.name} → ${to.name}` });
    }
    res.json({ moved: results.length, results });
  } catch (err) {
    const e = err as Error & { statusCode?: number };
    if (e.statusCode) {
      res.status(e.statusCode).json({ error: e.message });
      return;
    }
    next(err);
  }
});

// POST /api/stock-locations/bulk — SINH VỊ TRÍ HÀNG LOẠT (đợt 2, học Nhanh.vn):
// Body: { pattern: "Kệ A[1-5]" | "Kệ [A-C][1-3]", parentId? }. Tên đã có trong shop
// thì bỏ qua; mã tự sinh từ tên (không dấu, in hoa), trùng thì để trống.
router.post("/bulk", async (req: AuthRequest, res, next) => {
  try {
    if (req.userRole !== Role.ADMIN) {
      res.status(403).json({ error: "Chỉ chủ shop mới được thêm vị trí chứa hàng" });
      return;
    }
    const pattern = typeof req.body?.pattern === "string" ? req.body.pattern.trim() : "";
    const parsed = expandLocationPattern(pattern);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const parentId =
      typeof req.body?.parentId === "string" && req.body.parentId ? req.body.parentId : null;
    const ownerId = req.ownerId!;

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${ownerId} FOR UPDATE`;
      const existing = await tx.stockLocation.findMany({
        where: { userId: ownerId },
        select: { name: true, code: true, sortOrder: true },
      });
      let createdRoot: { id: string; name: string } | null = null;
      if (existing.length === 0) createdRoot = await createRootLocationTx(tx, ownerId);
      if (parentId) {
        const parent = await tx.stockLocation.findFirst({
          where: { id: parentId, userId: ownerId },
          select: { id: true },
        });
        if (!parent) throw Object.assign(new Error("Vị trí cha không tồn tại"), { statusCode: 400 });
      }
      const names = new Set(existing.map((e) => e.name.toLowerCase()));
      const codes = new Set(existing.map((e) => e.code).filter(Boolean) as string[]);
      if (createdRoot) names.add(createdRoot.name.toLowerCase());
      // Gốc vừa sinh trong cùng transaction chưa nằm trong `existing` (sortOrder 0) → xếp sau nó.
      let sortOrder = Math.max(createdRoot ? 0 : -1, ...existing.map((e) => e.sortOrder)) + 1;
      const rows: { userId: string; name: string; code: string | null; parentId: string | null; sortOrder: number }[] = [];
      const skipped: string[] = [];
      for (const name of parsed.names) {
        if (names.has(name.toLowerCase())) {
          skipped.push(name);
          continue;
        }
        let code: string | null = codeFromName(name);
        if (!code || codes.has(code)) code = null;
        if (code) codes.add(code);
        names.add(name.toLowerCase());
        rows.push({ userId: ownerId, name, code, parentId, sortOrder: sortOrder++ });
      }
      if (rows.length) await tx.stockLocation.createMany({ data: rows });
      await normalizeTreeOrderTx(tx, ownerId);
      return { created: rows.length, skipped, createdRoot };
    });

    const items = await listWithTotals(ownerId);
    res.status(201).json({ ...result, items, enabled: true });
  } catch (err) {
    const e = err as Error & { statusCode?: number };
    if (e.statusCode) {
      res.status(e.statusCode).json({ error: e.message });
      return;
    }
    next(err);
  }
});

// POST /api/stock-locations/labels — TEM VỊ TRÍ (PDF A4, mã vạch Code 128 theo mã).
// Body: { ids?: string[] } — bỏ trống = in hết. Vị trí không có mã thì tem chỉ có tên.
router.post("/labels", async (req: AuthRequest, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? (req.body.ids as unknown[]).filter((x) => typeof x === "string") : null;
    const locations = await prisma.stockLocation.findMany({
      where: { userId: req.ownerId!, ...(ids && ids.length ? { id: { in: ids as string[] } } : {}) },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { name: true, code: true },
    });
    if (locations.length === 0) {
      res.status(404).json({ error: "Không có vị trí nào để in" });
      return;
    }
    const bytes = await buildLocationLabelsPdf(locations);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'inline; filename="tem-vi-tri.pdf"');
    res.send(Buffer.from(bytes));
  } catch (err) {
    next(err);
  }
});

// POST /api/stock-locations/set-level — sửa số tại MỘT vị trí (thay kiểm kê ở đợt 1).
// Body: { productId, locationId, quantity, reason? }. Tổng đổi theo → đẩy sàn.
router.post("/set-level", async (req: AuthRequest, res, next) => {
  try {
    const { productId, locationId, quantity, reason } = req.body ?? {};
    if (typeof productId !== "string" || typeof locationId !== "string") {
      res.status(400).json({ error: "Thiếu sản phẩm hoặc vị trí" });
      return;
    }
    const target = Number(quantity);
    if (!Number.isInteger(target) || target < 0) {
      res.status(400).json({ error: "Số lượng phải là số nguyên không âm" });
      return;
    }
    const ownerId = req.ownerId!;
    const [product, loc] = await Promise.all([
      prisma.product.findFirst({ where: { id: productId, userId: ownerId }, select: { id: true } }),
      prisma.stockLocation.findFirst({
        where: { id: locationId, userId: ownerId },
        select: { id: true, name: true },
      }),
    ]);
    if (!product || !loc) {
      res.status(404).json({ error: "Không tìm thấy sản phẩm hoặc vị trí" });
      return;
    }
    const written = await prisma.$transaction((tx) =>
      setLevelAbsolute(tx, {
        productId,
        locationId,
        quantity: target,
        reason:
          typeof reason === "string" && reason.trim()
            ? reason.trim()
            : `Sửa số tại ${loc.name}`,
        actorId: req.userId ?? null,
      })
    );
    if (written.delta !== 0) {
      await enqueueStockPush([productId], { source: `sửa số tại vị trí ${loc.name}` });
    }
    res.json({
      productId,
      locationId,
      previous: written.previous,
      quantity: target,
      delta: written.delta,
      quantityInStock: written.quantityInStock,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
