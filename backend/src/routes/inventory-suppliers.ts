import { Router } from "express";
import { InventoryLogType, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middleware/auth";
import { canSeeFinancials } from "../middleware/auth";
import {
  parsePaymentAmount,
  parsePurchasePrice,
  payableFields,
  sumVoucherCost,
  utcTimestampLiteral,
  weightedAveragePrice,
  type StockVoucherLine,
} from "../lib/stock-voucher";

// ============================================================
// NHÀ CUNG CẤP + BÁO CÁO NHẬP HÀNG (05/11/2026, docs/QUAN-LY-KHO-TAI-CAU-TRUC.md mục 5).
// Gắn vào router /api/inventory (cùng quyền kho). Anh Trung: "đây là phần thống kê thôi,
// phiếu nhập cũng đơn giản" → phiếu nhập chỉ thêm nhà cung cấp + giá nhập từng dòng; mọi
// con số ở đây ĐỌC từ bảng hẹp purchase_lines. KHÔNG tự đổi giá vốn, không đụng sổ tài chính.
// Giá nhập là số tài chính: chỉ trả / nhận với người thấy tài chính (canSeeFinancials).
// ============================================================

export const supplierRouter = Router();

const SUPPLIER_MAX = 500;
const NAME_MAX = 120;

function text(v: unknown, max: number): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

/**
 * Nhà cung cấp cho một phiếu nhập: `supplierId` (đã có) hoặc `supplierName` (gõ tên — trùng tên
 * không phân hoa thường thì dùng lại, chưa có thì tạo tại chỗ). Không truyền gì → null.
 */
export async function resolveSupplier(
  ownerId: string,
  body: { supplierId?: unknown; supplierName?: unknown }
): Promise<{ ok: true; supplier: { id: string; name: string } | null } | { ok: false; error: string }> {
  if (typeof body.supplierId === "string" && body.supplierId.trim()) {
    const s = await prisma.supplier.findFirst({ where: { id: body.supplierId.trim(), ownerId }, select: { id: true, name: true } });
    if (!s) return { ok: false, error: "Không tìm thấy nhà cung cấp — tải lại trang rồi chọn lại" };
    return { ok: true, supplier: s };
  }
  const name = text(body.supplierName, NAME_MAX);
  if (!name) return { ok: true, supplier: null };
  const existing = await prisma.supplier.findFirst({
    where: { ownerId, name: { equals: name, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (existing) return { ok: true, supplier: existing };
  const count = await prisma.supplier.count({ where: { ownerId } });
  if (count >= SUPPLIER_MAX) return { ok: false, error: `Tối đa ${SUPPLIER_MAX} nhà cung cấp — ngừng dùng bớt nhà cũ` };
  const created = await prisma.supplier.create({ data: { ownerId, name }, select: { id: true, name: true } });
  return { ok: true, supplier: created };
}

function parseRange(q: Record<string, unknown>): { ok: true; from: Date | null; to: Date | null } | { ok: false } {
  const from = typeof q.from === "string" && q.from ? new Date(q.from) : null;
  const to = typeof q.to === "string" && q.to ? new Date(q.to) : null;
  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) return { ok: false };
  return { ok: true, from, to };
}

/** Điều kiện khoảng ngày trên purchase_lines (cột DateTime không múi giờ → ép chuỗi UTC ::timestamp). */
function rangeSql(from: Date | null, to: Date | null): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (from) parts.push(Prisma.sql`AND l."createdAt" >= ${utcTimestampLiteral(from)}::timestamp`);
  if (to) parts.push(Prisma.sql`AND l."createdAt" <= ${utcTimestampLiteral(to)}::timestamp`);
  return parts.length ? Prisma.join(parts, " ") : Prisma.empty;
}

// GET /api/inventory/suppliers?search=&from=&to=&brief=1&includeInactive=1
// brief=1: chỉ id + tên (ô chọn trên phiếu nhập). Mặc định kèm số liệu nhập trong khoảng ngày.
supplierRouter.get("/suppliers", async (req: AuthRequest, res, next) => {
  try {
    const q = req.query as Record<string, unknown>;
    const search = typeof q.search === "string" ? q.search.trim() : "";
    const brief = q.brief === "1";
    const includeInactive = q.includeInactive === "1";
    const range = parseRange(q);
    if (!range.ok) {
      res.status(400).json({ error: "Khoảng ngày không hợp lệ" });
      return;
    }
    const rows = await prisma.supplier.findMany({
      where: {
        ownerId: req.ownerId!,
        ...(includeInactive ? {} : { isActive: true }),
        ...(search ? { name: { contains: search, mode: "insensitive" } } : {}),
      },
      orderBy: { name: "asc" },
      take: SUPPLIER_MAX,
    });
    if (brief) {
      res.json({ items: rows.map((s) => ({ id: s.id, name: s.name })) });
      return;
    }
    const seesCost = canSeeFinancials(req);
    const stats = await prisma.$queryRaw<
      { supplierId: string | null; vouchers: number; qty: number; value: number | null; last: Date | null }[]
    >`SELECT l."supplierId",
             COUNT(DISTINCT l."voucherId")::int AS vouchers,
             SUM(l."quantity")::float8 AS qty,
             SUM(l."quantity" * l."purchasePrice")::float8 AS value,
             MAX(l."createdAt") AS last
      FROM "purchase_lines" l
      WHERE l."ownerId" = ${req.ownerId!} ${rangeSql(range.from, range.to)}
      GROUP BY l."supplierId"`;
    const byId = new Map(stats.map((s) => [s.supplierId, s]));
    const none = byId.get(null);
    // CÒN NỢ theo nhà cung cấp (08/11/2026, mục 8): số dư HIỆN TẠI trên mọi phiếu nhập đang theo dõi —
    // KHÔNG lọc theo khoảng ngày (nợ là số dư, không phải lưu lượng). Chỉ người thấy tài chính.
    const debts = seesCost
      ? await prisma.stockVoucher.groupBy({
          by: ["supplierId"],
          where: { ownerId: req.ownerId!, type: InventoryLogType.IMPORT, supplierId: { not: null }, debtAmount: { gt: 0 } },
          _sum: { debtAmount: true },
          _count: { _all: true },
        })
      : [];
    const debtById = new Map(debts.map((d) => [d.supplierId, { total: Number(d._sum.debtAmount ?? 0), count: d._count._all }]));
    const totalDebt = debts.reduce((a, d) => a + Number(d._sum.debtAmount ?? 0), 0);
    res.json({
      items: rows.map((s) => {
        const st = byId.get(s.id);
        const debt = debtById.get(s.id);
        return {
          id: s.id,
          name: s.name,
          phone: s.phone,
          taxCode: s.taxCode,
          address: s.address,
          note: s.note,
          isActive: s.isActive,
          voucherCount: st?.vouchers ?? 0,
          totalQuantity: st?.qty ?? 0,
          // Giá trị nhập = Σ số lượng × giá nhập trên các dòng CÓ giá. Chưa dòng nào có giá → null.
          totalValue: seesCost ? (st?.value ?? null) : null,
          lastImportAt: st?.last ?? null,
          // Còn nợ hiện tại (mọi thời gian); null = không thấy tài chính. 0 = không nợ.
          debt: seesCost ? (debt?.total ?? 0) : null,
          debtVoucherCount: seesCost ? (debt?.count ?? 0) : null,
        };
      }),
      // Phiếu nhập không ghi nhà cung cấp trong khoảng ngày — một dòng nhắc nhẹ dưới bảng.
      unassigned: { voucherCount: none?.vouchers ?? 0, totalQuantity: none?.qty ?? 0 },
      costHidden: !seesCost,
      totalDebt: seesCost ? totalDebt : null,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/inventory/suppliers
supplierRouter.post("/suppliers", async (req: AuthRequest, res, next) => {
  try {
    const b = req.body ?? {};
    const name = text(b.name, NAME_MAX);
    if (!name) {
      res.status(400).json({ error: "Nhập tên nhà cung cấp" });
      return;
    }
    const dup = await prisma.supplier.findFirst({
      where: { ownerId: req.ownerId!, name: { equals: name, mode: "insensitive" } },
      select: { id: true },
    });
    if (dup) {
      res.status(409).json({ error: `Đã có nhà cung cấp tên "${name}"` });
      return;
    }
    const count = await prisma.supplier.count({ where: { ownerId: req.ownerId! } });
    if (count >= SUPPLIER_MAX) {
      res.status(400).json({ error: `Tối đa ${SUPPLIER_MAX} nhà cung cấp — ngừng dùng bớt nhà cũ` });
      return;
    }
    const s = await prisma.supplier.create({
      data: {
        ownerId: req.ownerId!,
        name,
        phone: text(b.phone, 30) ?? null,
        taxCode: text(b.taxCode, 20) ?? null,
        address: text(b.address, 255) ?? null,
        note: text(b.note, 500) ?? null,
      },
    });
    res.json({ supplier: s });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/inventory/suppliers/:id — sửa thông tin / ngừng dùng. Tên trên phiếu cũ GIỮ như lúc lập.
supplierRouter.patch("/suppliers/:id", async (req: AuthRequest, res, next) => {
  try {
    const cur = await prisma.supplier.findFirst({ where: { id: String(req.params.id), ownerId: req.ownerId! } });
    if (!cur) {
      res.status(404).json({ error: "Không tìm thấy nhà cung cấp" });
      return;
    }
    const b = req.body ?? {};
    const data: Prisma.SupplierUpdateInput = {};
    if (b.name !== undefined) {
      const name = text(b.name, NAME_MAX);
      if (!name) {
        res.status(400).json({ error: "Nhập tên nhà cung cấp" });
        return;
      }
      if (name.toLowerCase() !== cur.name.toLowerCase()) {
        const dup = await prisma.supplier.findFirst({
          where: { ownerId: req.ownerId!, id: { not: cur.id }, name: { equals: name, mode: "insensitive" } },
          select: { id: true },
        });
        if (dup) {
          res.status(409).json({ error: `Đã có nhà cung cấp tên "${name}"` });
          return;
        }
      }
      data.name = name;
    }
    const phone = text(b.phone, 30);
    if (phone !== undefined) data.phone = phone;
    const taxCode = text(b.taxCode, 20);
    if (taxCode !== undefined) data.taxCode = taxCode;
    const address = text(b.address, 255);
    if (address !== undefined) data.address = address;
    const note = text(b.note, 500);
    if (note !== undefined) data.note = note;
    if (typeof b.isActive === "boolean") data.isActive = b.isActive;
    const s = await prisma.supplier.update({ where: { id: cur.id }, data });
    res.json({ supplier: s });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GIÁ NHẬP THEO SẢN PHẨM — ý anh Trung 05/11: gõ sản phẩm → giá từng nhà cung cấp + giá nhập
// trung bình để khách TỰ nhập giá vốn nếu muốn. Mỗi SKU kho một dòng; nhà cung cấp là dòng con
// (không nền tảng nào bày N cột — khảo sát mục 5.6).
// GET /api/inventory/purchase-stats/products?search=&from=&to=&page=&pageSize=&sort=&dir=
// ============================================================
const STATS_PAGE_SIZES = [20, 50, 100, 500]; // 500 = xuất Excel theo trang
type StatsSort = "recent" | "quantity" | "avg";

supplierRouter.get("/purchase-stats/products", async (req: AuthRequest, res, next) => {
  try {
    if (!canSeeFinancials(req)) {
      res.status(403).json({ error: "Giá nhập là số tài chính — tài khoản này không được xem" });
      return;
    }
    const q = req.query as Record<string, unknown>;
    const range = parseRange(q);
    if (!range.ok) {
      res.status(400).json({ error: "Khoảng ngày không hợp lệ" });
      return;
    }
    const search = typeof q.search === "string" ? q.search.trim() : "";
    const page = Math.max(1, Number(q.page) || 1);
    const sizeRaw = Number(q.pageSize) || 20;
    const pageSize = STATS_PAGE_SIZES.includes(sizeRaw) ? sizeRaw : 20;
    const sort: StatsSort = q.sort === "quantity" || q.sort === "avg" ? q.sort : "recent";
    const asc = q.dir === "asc";
    const owner = req.ownerId!;
    const rng = rangeSql(range.from, range.to);
    const like = `%${search.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const searchSql = search ? Prisma.sql`AND (p."skuCode" ILIKE ${like} OR p."productName" ILIKE ${like})` : Prisma.empty;
    // Giá trị không tính được (chưa dòng nào có giá) luôn xếp cuối ở cả hai chiều.
    const orderSql =
      sort === "quantity"
        ? Prisma.raw(`SUM(l."quantity") ${asc ? "ASC" : "DESC"}`)
        : sort === "avg"
          ? Prisma.raw(
              `(SUM(l."quantity" * l."purchasePrice") / NULLIF(SUM(CASE WHEN l."purchasePrice" IS NOT NULL THEN l."quantity" ELSE 0 END), 0)) ${asc ? "ASC" : "DESC"} NULLS LAST`
            )
          : Prisma.raw(`MAX(l."createdAt") ${asc ? "ASC" : "DESC"}`);

    const [countRows, pageRows] = await Promise.all([
      prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM (
          SELECT l."productId" FROM "purchase_lines" l JOIN "Product" p ON p."id" = l."productId"
          WHERE l."ownerId" = ${owner} AND p."userId" = ${owner} ${rng} ${searchSql}
          GROUP BY l."productId") t`,
      prisma.$queryRaw<
        { productId: string; qty: number; pricedQty: number; value: number; vouchers: number; last: Date }[]
      >`SELECT l."productId",
               SUM(l."quantity")::float8 AS qty,
               SUM(CASE WHEN l."purchasePrice" IS NOT NULL THEN l."quantity" ELSE 0 END)::float8 AS "pricedQty",
               COALESCE(SUM(l."quantity" * l."purchasePrice"), 0)::float8 AS value,
               COUNT(DISTINCT l."voucherId")::int AS vouchers,
               MAX(l."createdAt") AS last
        FROM "purchase_lines" l JOIN "Product" p ON p."id" = l."productId"
        WHERE l."ownerId" = ${owner} AND p."userId" = ${owner} ${rng} ${searchSql}
        GROUP BY l."productId"
        ORDER BY ${orderSql}, l."productId"
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    ]);
    const total = countRows[0]?.n ?? 0;
    const ids = pageRows.map((r) => r.productId);
    if (ids.length === 0) {
      res.json({ items: [], total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) });
      return;
    }

    const [breakdown, latest, products] = await Promise.all([
      prisma.$queryRaw<
        { productId: string; supplierId: string | null; qty: number; pricedQty: number; value: number; vouchers: number; last: Date }[]
      >`SELECT l."productId", l."supplierId",
               SUM(l."quantity")::float8 AS qty,
               SUM(CASE WHEN l."purchasePrice" IS NOT NULL THEN l."quantity" ELSE 0 END)::float8 AS "pricedQty",
               COALESCE(SUM(l."quantity" * l."purchasePrice"), 0)::float8 AS value,
               COUNT(DISTINCT l."voucherId")::int AS vouchers,
               MAX(l."createdAt") AS last
        FROM "purchase_lines" l
        WHERE l."ownerId" = ${owner} AND l."productId" IN (${Prisma.join(ids)}) ${rng}
        GROUP BY l."productId", l."supplierId"`,
      prisma.$queryRaw<{ productId: string; supplierId: string | null; price: number; at: Date }[]>`
        SELECT DISTINCT ON (l."productId", l."supplierId")
               l."productId", l."supplierId", l."purchasePrice"::float8 AS price, l."createdAt" AS at
        FROM "purchase_lines" l
        WHERE l."ownerId" = ${owner} AND l."productId" IN (${Prisma.join(ids)}) AND l."purchasePrice" IS NOT NULL ${rng}
        ORDER BY l."productId", l."supplierId", l."createdAt" DESC`,
      prisma.product.findMany({
        where: { id: { in: ids }, userId: owner },
        select: { id: true, skuCode: true, productName: true, variantName: true, imageUrl: true, costPrice: true },
      }),
    ]);
    const supplierIds = [...new Set(breakdown.map((b) => b.supplierId).filter((x): x is string => Boolean(x)))];
    const suppliers = supplierIds.length
      ? await prisma.supplier.findMany({ where: { id: { in: supplierIds }, ownerId: owner }, select: { id: true, name: true } })
      : [];
    const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));
    const productById = new Map(products.map((p) => [p.id, p]));
    const latestKey = (pid: string, sid: string | null) => `${pid}|${sid ?? ""}`;
    const latestBy = new Map(latest.map((l) => [latestKey(l.productId, l.supplierId), l]));

    res.json({
      items: pageRows.map((r) => {
        const p = productById.get(r.productId);
        const rows = breakdown
          .filter((b) => b.productId === r.productId)
          .map((b) => {
            const lp = latestBy.get(latestKey(b.productId, b.supplierId));
            return {
              supplierId: b.supplierId,
              // Phiếu nhập không ghi nhà cung cấp vẫn vào trung bình (có giá là tính) — gom một dòng riêng.
              supplierName: b.supplierId ? (supplierName.get(b.supplierId) ?? "Nhà cung cấp đã xóa") : null,
              quantity: b.qty,
              voucherCount: b.vouchers,
              avgPrice: weightedAveragePrice(b.value, b.pricedQty),
              lastPrice: lp ? Math.round(lp.price) : null,
              lastPriceAt: lp?.at ?? null,
              lastImportAt: b.last,
            };
          })
          // Rẻ nhất lên đầu; nhà chưa có giá xuống cuối.
          .sort((a, b) => (a.lastPrice ?? Infinity) - (b.lastPrice ?? Infinity) || b.quantity - a.quantity);
        return {
          productId: r.productId,
          skuCode: p?.skuCode ?? "",
          productName: p?.productName ?? "",
          variantName: p?.variantName ?? null,
          imageUrl: p?.imageUrl ?? null,
          costPrice: p?.costPrice != null ? Number(p.costPrice) : null,
          totalQuantity: r.qty,
          pricedQuantity: r.pricedQty,
          voucherCount: r.vouchers,
          avgPrice: weightedAveragePrice(r.value, r.pricedQty),
          lastImportAt: r.last,
          suppliers: rows,
        };
      }),
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// SỬA NHÀ CUNG CẤP / GIÁ NHẬP trên phiếu NHẬP đã lập (không sửa số lượng — số lượng là sổ kho).
// Lý do có đường này: chưa có hủy phiếu, gõ nhầm giá một lần là báo cáo sai mãi; thủ kho lập
// phiếu thường không biết giá, chủ shop / kế toán bổ sung sau.
// PATCH /api/inventory/vouchers/:id  { supplierId? | supplierName? | supplierId: null, prices?: [{productId, purchasePrice}] }
// ============================================================
supplierRouter.patch("/vouchers/:id", async (req: AuthRequest, res, next) => {
  try {
    if (!canSeeFinancials(req)) {
      res.status(403).json({ error: "Chỉ người được xem tài chính mới sửa được nhà cung cấp và giá nhập của phiếu" });
      return;
    }
    const v = await prisma.stockVoucher.findFirst({ where: { id: String(req.params.id), ownerId: req.ownerId! } });
    if (!v) {
      res.status(404).json({ error: "Không tìm thấy phiếu kho" });
      return;
    }
    if (v.type !== InventoryLogType.IMPORT) {
      res.status(400).json({ error: "Chỉ phiếu nhập mới có nhà cung cấp và giá nhập" });
      return;
    }
    const b = req.body ?? {};
    const touchSupplier = "supplierId" in b || "supplierName" in b;
    let supplier: { id: string; name: string } | null = v.supplierId ? { id: v.supplierId, name: v.supplierName ?? "" } : null;
    if (touchSupplier) {
      const r = await resolveSupplier(req.ownerId!, b);
      if (!r.ok) {
        res.status(400).json({ error: r.error });
        return;
      }
      supplier = r.supplier;
    }
    const lines = Array.isArray(v.lines) ? (v.lines as unknown as StockVoucherLine[]) : [];
    const known = new Set(lines.map((l) => l.productId));
    const priceChanges = new Map<string, number | null>();
    if (b.prices !== undefined) {
      if (!Array.isArray(b.prices)) {
        res.status(400).json({ error: "Danh sách giá không hợp lệ" });
        return;
      }
      for (const raw of b.prices as { productId?: unknown; purchasePrice?: unknown }[]) {
        const pid = typeof raw?.productId === "string" ? raw.productId : "";
        if (!known.has(pid)) continue;
        const empty = raw.purchasePrice === null || raw.purchasePrice === undefined || raw.purchasePrice === "";
        const price = parsePurchasePrice(raw.purchasePrice);
        if (!empty && price === null) {
          res.status(400).json({ error: "Giá nhập phải là số từ 0 trở lên" });
          return;
        }
        priceChanges.set(pid, empty ? null : price);
      }
    }
    const nextLines = lines.map((l) => (priceChanges.has(l.productId) ? { ...l, purchasePrice: priceChanges.get(l.productId) ?? null } : l));
    const nextTotal = sumVoucherCost(nextLines);
    // Công nợ (mục 8): sửa giá nhập → còn nợ tính lại theo giá trị mới; bỏ nhà cung cấp → thôi theo dõi,
    // nhưng không được bỏ khi phiếu đã có lần trả tiền (xóa lần trả trước).
    const removingSupplier = touchSupplier && !supplier && v.supplierId;
    if (removingSupplier) {
      const paid = await prisma.supplierPayment.count({ where: { voucherId: v.id } });
      if (paid > 0) {
        res.status(400).json({ error: "Phiếu đã có lần trả tiền cho nhà cung cấp này — xóa các lần trả trước khi bỏ nhà cung cấp" });
        return;
      }
    }
    const payable = payableFields(nextTotal, removingSupplier ? null : v.paidAmount != null ? Number(v.paidAmount) : null);

    await prisma.$transaction(async (tx) => {
      // Phiếu lập trước khi có bảng purchase_lines (sáng 05/11) → dựng dòng từ ảnh chụp rồi mới sửa.
      const existing = await tx.purchaseLine.count({ where: { voucherId: v.id } });
      if (existing === 0 && nextLines.length > 0) {
        await tx.purchaseLine.createMany({
          data: nextLines.map((l) => ({
            ownerId: v.ownerId,
            voucherId: v.id,
            supplierId: supplier?.id ?? null,
            productId: l.productId,
            quantity: l.quantity,
            purchasePrice: l.purchasePrice != null ? new Prisma.Decimal(l.purchasePrice) : null,
            createdAt: v.createdAt,
          })),
        });
      } else {
        if (touchSupplier) {
          await tx.purchaseLine.updateMany({ where: { voucherId: v.id }, data: { supplierId: supplier?.id ?? null } });
        }
        if (priceChanges.size > 0) {
          const values = [...priceChanges.entries()].map(([pid, price]) => Prisma.sql`(${pid}::text, ${price}::numeric)`);
          await tx.$executeRaw`UPDATE "purchase_lines" l SET "purchasePrice" = x.price
            FROM (VALUES ${Prisma.join(values)}) AS x("productId", price)
            WHERE l."voucherId" = ${v.id} AND l."productId" = x."productId"`;
        }
      }
      await tx.stockVoucher.update({
        where: { id: v.id },
        data: {
          supplierId: supplier?.id ?? null,
          supplierName: supplier?.name ?? null,
          lines: nextLines as unknown as Prisma.InputJsonValue,
          totalCost: new Prisma.Decimal(nextTotal),
          paidAmount: payable.paidAmount != null ? new Prisma.Decimal(payable.paidAmount) : null,
          debtAmount: payable.debtAmount != null ? new Prisma.Decimal(payable.debtAmount) : null,
        },
      });
    });
    console.log(
      `[stock-voucher] sửa ${v.code}: nhà cung cấp ${v.supplierName ?? "—"} → ${supplier?.name ?? "—"}, ${priceChanges.size} giá nhập (${req.userId ?? "?"})`
    );
    res.json({ ok: true, supplier, priceCount: priceChanges.size });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// CÔNG NỢ NHÀ CUNG CẤP — BẢN HẸP (08/11/2026, docs/QUAN-LY-KHO-TAI-CAU-TRUC.md mục 8).
// Anh Trung chốt "Làm bản hẹp NCC": chỉ phải trả theo TỪNG PHIẾU NHẬP có nhà cung cấp; ghi trả tiền
// từng lần; không menu Công nợ riêng, không công nợ khách / nhân viên, không định khoản, không tuổi nợ,
// KHÔNG vào Dòng tiền (tiền trả NCC đã nằm trong giá vốn — cộng thêm là đếm hai lần).
// Chỉ người thấy tài chính (canSeeFinancials). Phiếu đổi trong giao dịch có khóa dòng (FOR UPDATE).
// ============================================================
const PAYMENT_NOTE_MAX = 200;

async function loadPayableVoucher(req: AuthRequest, res: import("express").Response) {
  if (!canSeeFinancials(req)) {
    res.status(403).json({ error: "Chỉ người được xem tài chính mới ghi được công nợ nhà cung cấp" });
    return null;
  }
  const v = await prisma.stockVoucher.findFirst({ where: { id: String(req.params.id), ownerId: req.ownerId! } });
  if (!v) {
    res.status(404).json({ error: "Không tìm thấy phiếu kho" });
    return null;
  }
  if (v.type !== InventoryLogType.IMPORT) {
    res.status(400).json({ error: "Chỉ phiếu nhập mới có công nợ nhà cung cấp" });
    return null;
  }
  if (!v.supplierId) {
    res.status(400).json({ error: "Ghi nhà cung cấp cho phiếu trước (nút sửa phiếu), rồi mới theo dõi công nợ" });
    return null;
  }
  return v;
}

function payableOf(v: { totalCost: Prisma.Decimal; paidAmount: Prisma.Decimal | null; debtAmount: Prisma.Decimal | null }) {
  return {
    totalCost: Number(v.totalCost),
    paidAmount: v.paidAmount != null ? Number(v.paidAmount) : null,
    debt: v.debtAmount != null ? Number(v.debtAmount) : null,
  };
}

// POST /api/inventory/vouchers/:id/payable  — bắt đầu theo dõi: "chưa trả" (ghi nợ toàn bộ) cho phiếu
// lập trước 08/11 hoặc do nhân viên không thấy tài chính lập. Đã theo dõi rồi thì trả nguyên trạng.
supplierRouter.post("/vouchers/:id/payable", async (req: AuthRequest, res, next) => {
  try {
    const v = await loadPayableVoucher(req, res);
    if (!v) return;
    if (v.paidAmount != null) {
      res.json({ ok: true, ...payableOf(v) });
      return;
    }
    const payable = payableFields(Number(v.totalCost), 0);
    const updated = await prisma.stockVoucher.update({
      where: { id: v.id },
      data: { paidAmount: new Prisma.Decimal(0), debtAmount: new Prisma.Decimal(payable.debtAmount ?? 0) },
    });
    console.log(`[supplier-debt] ${v.code}: bắt đầu theo dõi, còn nợ ${payable.debtAmount} (${req.userId ?? "?"})`);
    res.json({ ok: true, ...payableOf(updated) });
  } catch (err) {
    next(err);
  }
});

// POST /api/inventory/vouchers/:id/payments  { amount, paidAt?, note? } — ghi MỘT lần trả tiền.
// Không cho trả quá số còn nợ (nhầm số là chuyện thường; trả thừa thật thì ghi đúng số còn nợ).
supplierRouter.post("/vouchers/:id/payments", async (req: AuthRequest, res, next) => {
  try {
    const v0 = await loadPayableVoucher(req, res);
    if (!v0) return;
    const b = req.body ?? {};
    const amount = parsePaymentAmount(b.amount);
    if (amount === null) {
      res.status(400).json({ error: "Số tiền trả phải lớn hơn 0" });
      return;
    }
    const paidAt = typeof b.paidAt === "string" && b.paidAt ? new Date(b.paidAt) : new Date();
    if (Number.isNaN(paidAt.getTime()) || paidAt.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
      res.status(400).json({ error: "Ngày trả không hợp lệ" });
      return;
    }
    const note = text(b.note, PAYMENT_NOTE_MAX) ?? null;

    const result = await prisma.$transaction(async (tx) => {
      const [v] = await tx.$queryRaw<{ id: string; totalCost: Prisma.Decimal; paidAmount: Prisma.Decimal | null }[]>`
        SELECT "id", "totalCost", "paidAmount" FROM "stock_vouchers" WHERE "id" = ${v0.id} FOR UPDATE`;
      if (!v) throw Object.assign(new Error("Không tìm thấy phiếu kho"), { statusCode: 404 });
      const total = Number(v.totalCost);
      const paidBefore = v.paidAmount != null ? Number(v.paidAmount) : 0;
      const remaining = Math.max(0, Math.round(total) - Math.round(paidBefore));
      if (amount > remaining) {
        throw Object.assign(
          new Error(remaining > 0 ? `Phiếu chỉ còn nợ ${remaining.toLocaleString("vi-VN")} đ — số trả không được lớn hơn` : "Phiếu này đã trả đủ"),
          { statusCode: 400 }
        );
      }
      const payment = await tx.supplierPayment.create({
        data: {
          ownerId: v0.ownerId,
          voucherId: v0.id,
          supplierId: v0.supplierId,
          amount: new Prisma.Decimal(amount),
          paidAt,
          note,
          createdById: req.userId ?? null,
        },
      });
      const payable = payableFields(total, paidBefore + amount);
      const updated = await tx.stockVoucher.update({
        where: { id: v0.id },
        data: {
          paidAmount: new Prisma.Decimal(payable.paidAmount ?? 0),
          debtAmount: new Prisma.Decimal(payable.debtAmount ?? 0),
        },
      });
      return { payment, updated };
    });
    console.log(
      `[supplier-debt] ${v0.code}: trả ${amount} cho ${v0.supplierName ?? "—"}, còn nợ ${Number(result.updated.debtAmount ?? 0)} (${req.userId ?? "?"})`
    );
    res.json({ ok: true, paymentId: result.payment.id, ...payableOf(result.updated) });
  } catch (err) {
    const e = err as Error & { statusCode?: number };
    if (e.statusCode) {
      res.status(e.statusCode).json({ error: e.message });
      return;
    }
    next(err);
  }
});

// DELETE /api/inventory/vouchers/:id/payments/:paymentId — xóa một lần trả ghi nhầm; đã trả = Σ còn lại.
supplierRouter.delete("/vouchers/:id/payments/:paymentId", async (req: AuthRequest, res, next) => {
  try {
    const v0 = await loadPayableVoucher(req, res);
    if (!v0) return;
    const pid = String(req.params.paymentId);
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "stock_vouchers" WHERE "id" = ${v0.id} FOR UPDATE`;
      const removed = await tx.supplierPayment.deleteMany({ where: { id: pid, voucherId: v0.id, ownerId: v0.ownerId } });
      if (removed.count === 0) throw Object.assign(new Error("Không tìm thấy lần trả này"), { statusCode: 404 });
      const agg = await tx.supplierPayment.aggregate({ where: { voucherId: v0.id }, _sum: { amount: true } });
      const payable = payableFields(Number(v0.totalCost), Number(agg._sum.amount ?? 0));
      return tx.stockVoucher.update({
        where: { id: v0.id },
        data: {
          paidAmount: new Prisma.Decimal(payable.paidAmount ?? 0),
          debtAmount: new Prisma.Decimal(payable.debtAmount ?? 0),
        },
      });
    });
    console.log(`[supplier-debt] ${v0.code}: xóa lần trả ${pid}, còn nợ ${Number(result.debtAmount ?? 0)} (${req.userId ?? "?"})`);
    res.json({ ok: true, ...payableOf(result) });
  } catch (err) {
    const e = err as Error & { statusCode?: number };
    if (e.statusCode) {
      res.status(e.statusCode).json({ error: e.message });
      return;
    }
    next(err);
  }
});
