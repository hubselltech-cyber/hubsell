import { Router } from "express";
import { ChannelName, InventoryLogType, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middleware/auth";
import { setStockAbsolute } from "../services/stock-ledger";
import { syncChannelProducts } from "../marketplace/product-sync";
import { cleanVariantName, productGroupKey, skuFromRoot } from "../lib/product-group";
import {
  backfillOrderLinesByProducts,
  invalidateOwnerCostCaches,
  keepCostOnDetach,
} from "../lib/cost-price";

const router = Router();

/**
 * TẦNG 2 — SẢN PHẨM SÀN & LIÊN KẾT VỀ KHO GỐC
 *
 * Nguồn dữ liệu là bảng đệm `ChannelProduct`: danh mục thô kéo từ từng gian
 * hàng về, KHÔNG phải sản phẩm kho. `productId = null` là chưa liên kết.
 *
 * Nhiều dòng ở đây trỏ chung một `productId` chính là cách 3 gian hàng khác
 * tên map về một mã gốc: đơn từ shop nào đổ về cũng trừ đúng kho đó.
 */

/** Đưa dữ liệu ra ngoài kèm thông tin gian hàng và sản phẩm gốc đã nối. */
const INCLUDE = {
  channel: { select: { id: true, channelName: true, shopName: true } },
  product: {
    select: { id: true, skuCode: true, productName: true, quantityInStock: true },
  },
} as const;

/**
 * GET /api/mappings — danh sách sản phẩm sàn ở tầng đệm.
 * Query: channelName (lọc theo SÀN), channelId (lọc theo GIAN cụ thể),
 *        linked=yes|no, search, page, pageSize
 *
 * channelName và channelId lọc hai tầng độc lập: chọn sàn thu hẹp về mọi gian
 * của sàn đó; chọn thêm một gian thì thu hẹp tiếp về đúng gian ấy.
 */
router.get("/", async (req: AuthRequest, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const channelId =
      typeof req.query.channelId === "string" ? req.query.channelId : "";
    // Chỉ nhận giá trị có thật trong enum, tránh lọc bừa bằng chuỗi rác.
    const rawChannelName =
      typeof req.query.channelName === "string"
        ? req.query.channelName.trim().toUpperCase()
        : "";
    const channelName =
      rawChannelName in ChannelName
        ? (rawChannelName as ChannelName)
        : undefined;
    const linked = typeof req.query.linked === "string" ? req.query.linked : "";
    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : "";
    // inStock=yes (22/10/2026): bỏ phân loại sàn đang báo tồn 0 — hộp "Tự khớp +
    // tạo SKU" dùng để lặp đúng tập sẽ tạo khi khách tích "bỏ qua tồn 0".
    const inStock = req.query.inStock === "yes";

    const scope: Prisma.ChannelProductWhereInput = {
      channel: {
        userId: req.ownerId!,
        ...(req.allowedChannelIds ? { id: { in: req.allowedChannelIds } } : {}),
        ...(channelName ? { channelName } : {}),
      },
      ...(channelId ? { channelId } : {}),
      ...(inStock ? { channelStock: { not: 0 } } : {}),
      ...(search
        ? {
            OR: [
              { channelSku: { contains: search, mode: "insensitive" as const } },
              { productName: { contains: search, mode: "insensitive" as const } },
              { variantName: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const where: Prisma.ChannelProductWhereInput = {
      ...scope,
      ...(linked === "yes"
        ? { productId: { not: null } }
        : linked === "no"
          ? { productId: null }
          : {}),
    };

    // ?view=grouped (22/10/2026, tab Sản phẩm trên sàn cha–con kiểu Salework):
    // phân trang theo SẢN PHẨM SÀN (gian × id sản phẩm), mọi phân loại của một
    // sản phẩm về cùng trang; sản phẩm còn dòng chưa nối lên đầu.
    const grouped =
      req.query.view === "grouped"
        ? await pageOfChannelProductGroups(
            req.ownerId!,
            req.allowedChannelIds ?? null,
            { channelName, channelId, linked, search, inStock },
            page,
            pageSize
          )
        : null;

    const [total, items, linkedCount, unlinkedCount] = await Promise.all([
      grouped ? Promise.resolve(grouped.total) : prisma.channelProduct.count({ where }),
      grouped
        ? prisma.channelProduct
            .findMany({
              where: {
                AND: [
                  where,
                  {
                    OR: grouped.keys.flatMap((k) => [
                      { channelId: k.channelId, externalId: k.itemId },
                      { channelId: k.channelId, externalId: { startsWith: `${k.itemId}-` } },
                      { id: k.itemId },
                    ]),
                  },
                ],
              },
              include: INCLUDE,
            })
            .then((rows) => sortChannelRowsByGroup(rows, grouped.keys))
        : prisma.channelProduct.findMany({
            where,
            // Chưa liên kết lên đầu — đó là việc đang cần làm
            orderBy: [
              { productId: { sort: "asc", nulls: "first" } },
              { channelSku: "asc" },
            ],
            skip: (page - 1) * pageSize,
            take: pageSize,
            include: INCLUDE,
          }),
      // Đếm trên `scope` (KHÔNG kèm điều kiện linked) để hai thẻ lọc luôn có
      // số, kể cả khi đang đứng ở một bên.
      prisma.channelProduct.count({ where: { ...scope, productId: { not: null } } }),
      prisma.channelProduct.count({ where: { ...scope, productId: null } }),
    ]);

    res.json({
      items,
      total,
      page,
      pageSize,
      pageCount: Math.ceil(total / pageSize),
      counts: {
        all: linkedCount + unlinkedCount,
        linked: linkedCount,
        unlinked: unlinkedCount,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/mappings/link — nối MỘT HOẶC NHIỀU sản phẩm sàn về một SKU gốc.
 * Body: { channelProductIds: string[], productId: string }
 *
 * Nhận mảng vì đây là thao tác chính: 3 gian hàng khác tên cùng bán một mẫu
 * thì tích cả 3 rồi nối một lần, thay vì mở từng dòng chọn lại.
 */
router.post("/link", async (req: AuthRequest, res, next) => {
  try {
    const { channelProductIds, productId } = req.body ?? {};
    if (!Array.isArray(channelProductIds) || channelProductIds.length === 0) {
      res.status(400).json({ error: "Chưa chọn sản phẩm sàn nào" });
      return;
    }
    if (channelProductIds.length > 200) {
      res.status(400).json({ error: "Tối đa 200 sản phẩm mỗi lần liên kết" });
      return;
    }
    if (typeof productId !== "string" || !productId) {
      res.status(400).json({ error: "Chưa chọn sản phẩm gốc để nối về" });
      return;
    }

    // Sản phẩm gốc phải thuộc chính shop này
    const product = await prisma.product.findFirst({
      where: { id: productId, userId: req.ownerId! },
      select: { id: true, skuCode: true, productName: true },
    });
    if (!product) {
      res.status(404).json({ error: "Không tìm thấy sản phẩm gốc" });
      return;
    }

    const result = await prisma.channelProduct.updateMany({
      where: {
        id: { in: channelProductIds },
        channel: {
          userId: req.ownerId!,
          ...(req.allowedChannelIds ? { id: { in: req.allowedChannelIds } } : {}),
        },
      },
      data: { productId: product.id },
    });

    // Giá vốn đã nhập ở cấp SKU sàn (lúc chưa nối kho) không được mất khi nối:
    // sản phẩm gốc chưa có giá vốn thì kế thừa số đã nhập bên sàn.
    await inheritChannelCostPrice([product.id], req.ownerId!);
    // Đơn về TRƯỚC khi nối (dòng chưa mang productId, giá vốn = 0) nay tra được
    // giá vốn sản phẩm gốc theo (gian, mã SKU sàn) → vá luôn cho báo cáo cũ đúng.
    await backfillOrderLinesByProducts(prisma, [product.id], req.ownerId!);
    await invalidateOwnerCostCaches(req.ownerId!);

    // Sản phẩm tồn 0 vừa nối SKU sàn → nhận tồn ban đầu theo số trên sàn.
    const seeded = await seedInitialStockFromChannel([product.id], req.ownerId!);

    res.json({
      linked: result.count,
      product,
      seededStock: seeded.get(product.id) ?? null,
    });
  } catch (err) {
    next(err);
  }
});

/** Id sản phẩm sàn (phần trước dấu "-" của externalId) — khóa gom cha–con của tab Sản phẩm trên sàn. */
function channelItemId(externalId: string | null): string | null {
  const head = (externalId ?? "").split("-")[0];
  return head || null;
}

/**
 * PHÂN TRANG THEO SẢN PHẨM SÀN (22/10/2026). Khóa nhóm = gian × id sản phẩm sàn
 * (dòng không có externalId đứng một mình theo id). SQL thô vì Prisma groupBy không
 * gom theo biểu thức; bộ lọc lặp đúng điều kiện của `scope`/`where` phía trên.
 */
async function pageOfChannelProductGroups(
  ownerId: string,
  allowedChannelIds: string[] | null,
  f: { channelName?: ChannelName; channelId: string; linked: string; search: string; inStock: boolean },
  page: number,
  pageSize: number
): Promise<{ keys: { channelId: string; itemId: string }[]; total: number }> {
  const conds: Prisma.Sql[] = [Prisma.sql`c."userId" = ${ownerId}`];
  if (allowedChannelIds) conds.push(Prisma.sql`c."id" IN (${Prisma.join(allowedChannelIds)})`);
  if (f.channelName) conds.push(Prisma.sql`c."channelName" = ${f.channelName}::"ChannelName"`);
  if (f.channelId) conds.push(Prisma.sql`cp."channelId" = ${f.channelId}`);
  if (f.inStock) conds.push(Prisma.sql`(cp."channelStock" IS NULL OR cp."channelStock" <> 0)`);
  if (f.linked === "yes") conds.push(Prisma.sql`cp."productId" IS NOT NULL`);
  if (f.linked === "no") conds.push(Prisma.sql`cp."productId" IS NULL`);
  if (f.search) {
    const like = `%${f.search}%`;
    conds.push(
      Prisma.sql`(cp."channelSku" ILIKE ${like} OR cp."productName" ILIKE ${like} OR cp."variantName" ILIKE ${like})`
    );
  }
  const whereSql = Prisma.join(conds, " AND ");
  const gk = Prisma.sql`cp."channelId" || ':' || COALESCE(NULLIF(split_part(COALESCE(cp."externalId", ''), '-', 1), ''), cp."id")`;
  const [rows, count] = await Promise.all([
    prisma.$queryRaw<{ gk: string }[]>(
      Prisma.sql`SELECT ${gk} AS gk,
                        MIN(CASE WHEN cp."productId" IS NULL THEN 0 ELSE 1 END) AS pending,
                        MIN(cp."productName") AS name
                 FROM "ChannelProduct" cp JOIN "Channel" c ON c."id" = cp."channelId"
                 WHERE ${whereSql}
                 GROUP BY 1 ORDER BY pending ASC, name ASC, gk
                 LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`
    ),
    prisma.$queryRaw<{ n: number }[]>(
      Prisma.sql`SELECT COUNT(DISTINCT ${gk})::int AS n
                 FROM "ChannelProduct" cp JOIN "Channel" c ON c."id" = cp."channelId"
                 WHERE ${whereSql}`
    ),
  ]);
  const keys = rows.map((r) => {
    const i = r.gk.indexOf(":");
    return { channelId: r.gk.slice(0, i), itemId: r.gk.slice(i + 1) };
  });
  return { keys, total: count[0]?.n ?? 0 };
}

/** Xếp dòng theo thứ tự nhóm của trang; trong nhóm theo tên phân loại (số tự nhiên) rồi mã. */
function sortChannelRowsByGroup<
  T extends { id: string; channelId: string; externalId: string | null; variantName: string | null; channelSku: string },
>(rows: T[], keys: { channelId: string; itemId: string }[]): T[] {
  const rank = new Map(keys.map((k, i) => [`${k.channelId}:${k.itemId}`, i]));
  const collator = new Intl.Collator("vi", { numeric: true, sensitivity: "base" });
  const keyOf = (r: T) => `${r.channelId}:${channelItemId(r.externalId) ?? r.id}`;
  return rows.sort((a, b) => {
    const ra = rank.get(keyOf(a)) ?? Number.MAX_SAFE_INTEGER;
    const rb = rank.get(keyOf(b)) ?? Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return collator.compare(a.variantName ?? a.channelSku, b.variantName ?? b.channelSku);
  });
}

/**
 * POST /api/mappings/link-by-sku — NỐI MỘT DÒNG SÀN BẰNG MÃ GÕ TẠI CHỖ (22/10/2026,
 * khách: "nối thủ công kiểu Salework cũng được"). Body: { channelProductId, skuCode }.
 * Mã đã có trong kho → nối vào; chưa có → TẠO SKU kho mới mang đúng mã khách gõ
 * (tên, phân loại, ảnh, giá lấy từ dòng sàn; tồn ban đầu theo sàn) rồi nối.
 */
router.post("/link-by-sku", async (req: AuthRequest, res, next) => {
  try {
    const { channelProductId, skuCode } = req.body ?? {};
    if (typeof channelProductId !== "string" || !channelProductId) {
      res.status(400).json({ error: "Thiếu sản phẩm sàn" });
      return;
    }
    const sku = typeof skuCode === "string" ? skuCode.trim().toUpperCase() : "";
    if (!sku) {
      res.status(400).json({ error: "Gõ mã SKU kho để nối" });
      return;
    }
    if (sku.length > 50) {
      res.status(400).json({ error: "Mã SKU tối đa 50 ký tự" });
      return;
    }
    const cp = await prisma.channelProduct.findFirst({
      where: {
        id: channelProductId,
        channel: {
          userId: req.ownerId!,
          ...(req.allowedChannelIds ? { id: { in: req.allowedChannelIds } } : {}),
        },
      },
      select: { id: true, productId: true },
    });
    if (!cp) {
      res.status(404).json({ error: "Không tìm thấy sản phẩm sàn" });
      return;
    }
    const select = { id: true, skuCode: true, productName: true, variantName: true, quantityInStock: true } as const;
    let product = await prisma.product.findUnique({
      where: { userId_skuCode: { userId: req.ownerId!, skuCode: sku } },
      select,
    });
    let created = false;
    let seededStock: number | null = null;
    if (product) {
      if (cp.productId && cp.productId !== product.id) {
        // Đổi nối sang SKU khác: gỡ trước rồi nối — cùng đường với nút Gỡ.
        await prisma.channelProduct.update({ where: { id: cp.id }, data: { productId: null } });
      }
      await prisma.channelProduct.updateMany({ where: { id: cp.id }, data: { productId: product.id } });
      await inheritChannelCostPrice([product.id], req.ownerId!);
      await backfillOrderLinesByProducts(prisma, [product.id], req.ownerId!);
      await invalidateOwnerCostCaches(req.ownerId!);
      const seeded = await seedInitialStockFromChannel([product.id], req.ownerId!);
      seededStock = seeded.get(product.id) ?? null;
    } else {
      if (cp.productId) {
        await prisma.channelProduct.update({ where: { id: cp.id }, data: { productId: null } });
      }
      await createProductsFromChannelProducts(req.ownerId!, [cp.id], req.allowedChannelIds, {
        skuById: { [cp.id]: sku },
      });
      product = await prisma.product.findUnique({
        where: { userId_skuCode: { userId: req.ownerId!, skuCode: sku } },
        select,
      });
      created = true;
      seededStock = product && product.quantityInStock > 0 ? product.quantityInStock : null;
    }
    if (!product) {
      res.status(500).json({ error: "Không tạo được SKU kho" });
      return;
    }
    res.json({ product, created, seededStock });
  } catch (err) {
    next(err);
  }
});

/**
 * ĐỒNG BỘ LẦN ĐẦU — LẤY TỒN THEO SÀN.
 *
 * Sản phẩm kho đang tồn 0 (chưa từng nhập tồn thật) vừa được nối SKU sàn →
 * nhận tồn ban đầu = số ĐANG CÓ TRÊN SÀN (ChannelProduct.channelStock, cập nhật
 * mỗi lần "Đồng bộ từ sàn"). Nhờ vậy shop mới liên kết xong là số kho khớp ngay
 * với sàn, không có biến động nào bị đẩy ngược lên sàn — vận hành không gián đoạn.
 *
 * Tồn ban đầu tính theo ShopSyncSetting.initialStockMode (Cài đặt đồng bộ):
 *   SUM  (mặc định, chốt 15/08): TỔNG tồn mọi gian ACTIVE — mỗi gian là một
 *        phần hàng riêng, cộng lại mới ra tổng tồn thật của SKU.
 *   MAX: số LỚN NHẤT của một gian — các gian đang cùng niêm yết MỘT lô hàng
 *        (cộng tổng sẽ đếm trùng rồi đẩy số ảo lên mọi gian → bán vượt).
 *   NONE: không gieo — chủ shop tự nhập tồn rồi bấm Sync.
 * Chỉ đụng sản phẩm tồn 0: số tồn người dùng đã nhập tay là chân lý, không bao
 * giờ ghi đè. KHÔNG enqueue đẩy tồn — số vừa lấy TỪ sàn, đẩy lại chỉ tốn quota.
 *
 * Trả map productId → số tồn đã seed để API đưa vào response cho UI báo toast.
 */
async function seedInitialStockFromChannel(
  productIds: string[],
  ownerId: string
): Promise<Map<string, number>> {
  const seeded = new Map<string, number>();
  const ids = [...new Set(productIds)].filter(Boolean);
  if (ids.length === 0) return seeded;

  const setting = await prisma.shopSyncSetting.findUnique({
    where: { userId: ownerId },
    select: { initialStockMode: true },
  });
  const mode = setting?.initialStockMode ?? "SUM";
  if (mode === "NONE") return seeded;

  const bare = await prisma.product.findMany({
    where: { id: { in: ids }, userId: ownerId, quantityInStock: 0 },
    select: { id: true },
  });
  for (const p of bare) {
    const rows = await prisma.channelProduct.findMany({
      where: { productId: p.id, channelStock: { not: null }, status: "ACTIVE" },
      select: {
        channelStock: true,
        channel: { select: { channelName: true, shopName: true } },
      },
    });
    if (rows.length === 0) continue;
    const qty =
      mode === "MAX"
        ? Math.max(...rows.map((r) => r.channelStock ?? 0))
        : rows.reduce((sum, r) => sum + (r.channelStock ?? 0), 0);
    if (qty <= 0) continue;

    // Ghi rõ từng gian góp bao nhiêu để sổ kho tự giải thích được con số tổng.
    const detail =
      (mode === "MAX" ? "lớn nhất một gian: " : "tổng các gian: ") +
      rows
        .map((r) => `${r.channel.shopName}: ${r.channelStock ?? 0}`)
        .join(mode === "MAX" ? " | " : " + ");

    await prisma.$transaction((tx) =>
      setStockAbsolute(tx, {
        productId: p.id,
        quantity: qty,
        type: InventoryLogType.SYNC,
        reason: `Đồng bộ lần đầu khi liên kết: tồn trên sàn (${detail})`,
      })
    );
    seeded.set(p.id, qty);
  }
  return seeded;
}

/**
 * Sản phẩm gốc costPrice = 0 nhưng có SKU sàn vừa nối mang costPrice > 0 →
 * chép số đó sang sản phẩm gốc (không đụng sản phẩm đã có giá vốn thật).
 * Giá trên SKU sàn KHÔNG bị xóa: từ 11/10/2026 nó là giá riêng của gian và vẫn
 * thắng giá kho sau khi nối; giá kho chỉ là mặc định cho các gian còn trống.
 */
async function inheritChannelCostPrice(productIds: string[], ownerId: string) {
  const bare = await prisma.product.findMany({
    where: { id: { in: productIds }, userId: ownerId, costPrice: 0 },
    select: { id: true },
  });
  for (const p of bare) {
    const donor = await prisma.channelProduct.findFirst({
      where: { productId: p.id, costPrice: { gt: 0 } },
      select: { costPrice: true },
    });
    if (donor?.costPrice) {
      await prisma.product.update({
        where: { id: p.id },
        data: { costPrice: donor.costPrice },
      });
    }
  }
}

/**
 * POST /api/mappings/auto-match — TỰ KHỚP các SKU sàn chưa liên kết vào kho gốc
 * theo TRÙNG MÃ SKU (so không phân hoa-thường, kho lưu mã dạng UPPERCASE).
 * Body (tuỳ chọn): { channelId } — giới hạn trong một gian; bỏ trống = mọi gian.
 *
 * Chỉ đụng dòng CHƯA liên kết — liên kết tay trước đó là quyết định của người
 * dùng, auto-match không được ghi đè.
 */
/** Lõi TỰ KHỚP theo mã SKU — dùng chung cho /auto-match và /quick-link. */
async function autoMatchChannelProducts(
  ownerId: string,
  channelId: string,
  allowedChannelIds?: string[] | null
) {
  const [products, unlinked] = await Promise.all([
    prisma.product.findMany({
      where: { userId: ownerId },
      select: { id: true, skuCode: true },
    }),
    prisma.channelProduct.findMany({
      where: {
        productId: null,
        ...(channelId ? { channelId } : {}),
        channel: {
          userId: ownerId,
          ...(allowedChannelIds ? { id: { in: allowedChannelIds } } : {}),
        },
      },
      select: { id: true, channelSku: true },
    }),
  ]);

  const productBySku = new Map(products.map((p) => [p.skuCode.toUpperCase(), p.id]));

  // Gom các dòng khớp theo productId để updateMany theo lô thay vì từng dòng.
  const idsByProduct = new Map<string, string[]>();
  for (const cp of unlinked) {
    const pid = productBySku.get(cp.channelSku.trim().toUpperCase());
    if (!pid) continue;
    const list = idsByProduct.get(pid) ?? [];
    list.push(cp.id);
    idsByProduct.set(pid, list);
  }

  let matched = 0;
  for (const [pid, ids] of idsByProduct) {
    const r = await prisma.channelProduct.updateMany({
      where: { id: { in: ids } },
      data: { productId: pid },
    });
    matched += r.count;
  }

  await inheritChannelCostPrice([...idsByProduct.keys()], ownerId);
  await backfillOrderLinesByProducts(prisma, [...idsByProduct.keys()], ownerId);
  await invalidateOwnerCostCaches(ownerId);

  // Các sản phẩm tồn 0 vừa được tự khớp → nhận tồn ban đầu theo số trên sàn.
  const seeded = await seedInitialStockFromChannel([...idsByProduct.keys()], ownerId);

  return {
    matched,
    products: idsByProduct.size,
    scanned: unlinked.length,
    seededProducts: seeded.size,
  };
}

router.post("/auto-match", async (req: AuthRequest, res, next) => {
  try {
    const channelId =
      typeof req.body?.channelId === "string" ? req.body.channelId : "";
    res.json(
      await autoMatchChannelProducts(req.ownerId!, channelId, req.allowedChannelIds)
    );
  } catch (err) {
    next(err);
  }
});

/**
 * Lõi TẠO SKU KHO từ các dòng sàn chưa nối rồi nối luôn — dùng chung cho
 * /create-products và /quick-link. `channelProductIds` ≤ 200 mỗi lượt.
 */
export interface CreateProductsOptions {
  /**
   * MÃ GỐC khách gõ cho sản phẩm sàn KHÔNG có SKU (hộp Nối SKU nhanh, 22/10/2026,
   * cách Salework "mã gốc + mã model"): khóa = id sản phẩm sàn (phần trước dấu
   * "-" của externalId), giá trị = mã gốc. Mã SKU kho = MÃ GỐC-ĐUÔI-PHÂN-LOẠI.
   * Dòng sàn giữ nguyên channelSku dự phòng (SPE-…), nối "khác mã kho".
   */
  rootSkus?: Record<string, string>;
  /** Bỏ qua phân loại sàn đang báo tồn 0 (khách: "không còn tồn thì khỏi vào kho"). */
  skipZeroStock?: boolean;
  /** Mã SKU kho khách gõ cho TỪNG dòng sàn (nối thủ công tại dòng, /link-by-sku). */
  skuById?: Record<string, string>;
}

/** Mã dự phòng Hubsell tự sinh khi sàn không có SKU — khách không đọc được. */
export function isFallbackChannelSku(sku: string): boolean {
  return /^(SPE|TTK|LZD)-\d/.test(sku);
}

async function createProductsFromChannelProducts(
  ownerId: string,
  channelProductIds: string[],
  allowedChannelIds?: string[] | null,
  options: CreateProductsOptions = {}
) {
  const cps = await prisma.channelProduct.findMany({
    where: {
      id: { in: channelProductIds },
      productId: null, // đã liên kết rồi thì bỏ qua, không tạo trùng
      ...(options.skipZeroStock ? { channelStock: { not: 0 } } : {}),
      channel: {
        userId: ownerId,
        ...(allowedChannelIds ? { id: { in: allowedChannelIds } } : {}),
      },
    },
  });

  let createdProducts = 0;
  let reusedProducts = 0;
  let linked = 0;
  const touchedProductIds: string[] = [];

  // Xử lý TUẦN TỰ theo nhóm mã SKU: nhiều dòng sàn (các phân loại đặt chung
  // SellerSku, hay 2 gian cùng bán một mã) quy về MỘT sản phẩm kho.
  const byUpperSku = new Map<string, typeof cps>();
  const rootSkus = options.rootSkus ?? {};
  for (const cp of cps) {
    // Khách đã gõ mã gốc cho sản phẩm sàn này → mã kho đọc được thay cho SPE-….
    const itemId = (cp.externalId ?? "").split("-")[0];
    const root = itemId ? rootSkus[itemId]?.trim() : "";
    const typed = options.skuById?.[cp.id]?.trim();
    const key = typed
      ? typed.toUpperCase()
      : root && isFallbackChannelSku(cp.channelSku)
        ? skuFromRoot(root, cleanVariantName(cp.variantName))
        : cp.channelSku.trim().toUpperCase();
    const list = byUpperSku.get(key) ?? [];
    list.push(cp);
    byUpperSku.set(key, list);
  }

  for (const [skuCode, group] of byUpperSku) {
    if (!skuCode) continue;
    let product = await prisma.product.findUnique({
      where: { userId_skuCode: { userId: ownerId, skuCode } },
      select: { id: true },
    });
    if (product) {
      reusedProducts++;
    } else {
      // Dòng đại diện: ưu tiên dòng có giá vốn đã nhập, rồi dòng có ảnh.
      const rep =
        group.find((g) => Number(g.costPrice ?? 0) > 0) ??
        group.find((g) => g.imageUrl) ??
        group[0];
      // Tên kho = tên MẪU + phân loại riêng (22/10/2026) — bảng Hàng hóa gom cha–con.
      const variantName = cleanVariantName(rep.variantName);
      product = await prisma.product.create({
        data: {
          userId: ownerId,
          skuCode,
          productName: rep.productName,
          variantName,
          groupKey: productGroupKey(rep.productName, variantName),
          sellingPrice: rep.price,
          costPrice: rep.costPrice ?? 0,
          imageUrl: rep.imageUrl,
          quantityInStock: 0,
        },
        select: { id: true },
      });
      createdProducts++;
    }
    const r = await prisma.channelProduct.updateMany({
      where: { id: { in: group.map((g) => g.id) } },
      data: { productId: product.id },
    });
    linked += r.count;
    touchedProductIds.push(product.id);
  }

  // SKU kho dùng lại đã có giá vốn → vá đơn cũ của các SKU sàn vừa nối.
  await backfillOrderLinesByProducts(prisma, touchedProductIds, ownerId);
  await invalidateOwnerCostCaches(ownerId);

  // SKU kho tạo mới (tồn 0) và SKU dùng lại còn tồn 0 → nhận tồn theo sàn.
  const seeded = await seedInitialStockFromChannel(touchedProductIds, ownerId);

  return {
    createdProducts,
    reusedProducts,
    linked,
    skipped: channelProductIds.length - linked,
    seededProducts: seeded.size,
  };
}

/**
 * POST /api/mappings/quick-link — NỐI NHANH MỘT GIAN, một cú bấm từ dialog
 * Cài đặt đồng bộ (anh Trung 05/09: luồng nối SKU đang khó dùng).
 * Body: { channelId }
 *
 * Ba bước tuần tự, cùng lõi với tab Chờ liên kết:
 *   1. Gian chưa từng kéo danh mục (0 dòng ChannelProduct) → kéo từ sàn trước
 *      (shop vài trăm SKU mất 1-2 phút vì giãn nhịp né rate limit).
 *   2. Tự khớp SKU sàn TRÙNG MÃ với SKU kho có sẵn.
 *   3. Phần còn lại tạo SKU kho từ dữ liệu sàn rồi nối, theo lô ≤200.
 * Tồn ban đầu gieo theo ShopSyncSetting.initialStockMode. Không đụng SKU đã nối.
 */
router.post("/quick-link", async (req: AuthRequest, res, next) => {
  try {
    const channelId = typeof req.body?.channelId === "string" ? req.body.channelId : "";
    if (!channelId) {
      res.status(400).json({ error: "Thiếu channelId" });
      return;
    }
    const options = parseCreateOptions(req.body);
    const channel = await prisma.channel.findFirst({
      where: {
        id: channelId,
        userId: req.ownerId!,
        status: "ACTIVE",
        channelName: { not: ChannelName.OFFLINE },
        ...(req.allowedChannelIds ? { id: { in: req.allowedChannelIds } } : {}),
      },
    });
    if (!channel) {
      res.status(404).json({ error: "Không tìm thấy gian hàng đang hoạt động" });
      return;
    }

    // 1. Chưa có danh mục → kéo từ sàn. Lỗi sàn (token/rate limit) trả 502 rõ ràng.
    let pulled: { scanned: number; created: number } | null = null;
    const existing = await prisma.channelProduct.count({ where: { channelId: channel.id } });
    if (existing === 0) {
      try {
        const r = await syncChannelProducts(channel);
        pulled = { scanned: r.scanned, created: r.created };
      } catch (err) {
        res.status(502).json({
          error: `Không kéo được danh mục từ sàn: ${err instanceof Error ? err.message : "lỗi không rõ"}`,
        });
        return;
      }
    }

    // 2. Tự khớp trùng mã.
    const match = await autoMatchChannelProducts(req.ownerId!, channel.id, req.allowedChannelIds);

    // 3. Tạo SKU kho cho phần còn lại, theo lô — dừng khi không tiến thêm được.
    let createdProducts = 0;
    let reusedProducts = 0;
    let createdLinked = 0;
    for (let guard = 0; guard < 50; guard++) {
      const batch = await prisma.channelProduct.findMany({
        where: {
          channelId: channel.id,
          productId: null,
          status: "ACTIVE",
          ...(options.skipZeroStock ? { channelStock: { not: 0 } } : {}),
        },
        select: { id: true },
        take: 200,
      });
      if (batch.length === 0) break;
      const r = await createProductsFromChannelProducts(
        req.ownerId!,
        batch.map((b) => b.id),
        req.allowedChannelIds,
        options
      );
      createdProducts += r.createdProducts;
      reusedProducts += r.reusedProducts;
      createdLinked += r.linked;
      if (r.linked === 0) break;
    }

    const linkedTotal = await prisma.channelProduct.count({
      where: { channelId: channel.id, productId: { not: null }, externalId: { not: null }, status: "ACTIVE" },
    });
    const stillUnlinked = await prisma.channelProduct.count({
      where: { channelId: channel.id, productId: null, status: "ACTIVE" },
    });

    res.json({
      channel: { id: channel.id, shopName: channel.shopName, channelName: channel.channelName },
      pulled,
      matched: match.matched,
      createdProducts,
      reusedProducts,
      linked: match.matched + createdLinked,
      linkedTotal,
      stillUnlinked,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/mappings/create-products — TẠO SẢN PHẨM KHO từ các SKU sàn đã chọn
 * rồi liên kết luôn. Body: { channelProductIds: string[] } (≤200).
 *
 * Mã SKU kho = channelSku (trim + UPPERCASE theo quy ước kho). Trùng mã đã có
 * trong kho thì KHÔNG tạo mới mà nối vào sản phẩm sẵn có (idempotent). Giá bán/
 * ảnh/tên lấy từ sàn; giá vốn kế thừa số đã nhập ở cấp SKU sàn (nếu có), tồn = 0.
 */
router.post("/create-products", async (req: AuthRequest, res, next) => {
  try {
    const { channelProductIds } = req.body ?? {};
    if (!Array.isArray(channelProductIds) || channelProductIds.length === 0) {
      res.status(400).json({ error: "Chưa chọn sản phẩm sàn nào" });
      return;
    }
    if (channelProductIds.length > 200) {
      res.status(400).json({ error: "Tối đa 200 sản phẩm mỗi lần tạo" });
      return;
    }
    res.json(
      await createProductsFromChannelProducts(
        req.ownerId!,
        channelProductIds,
        req.allowedChannelIds,
        parseCreateOptions(req.body)
      )
    );
  } catch (err) {
    next(err);
  }
});

/** Tùy chọn tạo SKU kho từ body: rootSkus {idSảnPhẩmSàn: mãGốc}, skipZeroStock. */
function parseCreateOptions(body: unknown): CreateProductsOptions {
  const b = (body ?? {}) as { rootSkus?: unknown; skipZeroStock?: unknown };
  const rootSkus: Record<string, string> = {};
  if (b.rootSkus && typeof b.rootSkus === "object") {
    for (const [k, v] of Object.entries(b.rootSkus as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim() && k.trim()) rootSkus[k.trim()] = v.trim().slice(0, 40);
    }
  }
  return { rootSkus, skipZeroStock: b.skipZeroStock === true };
}

/**
 * GET /api/mappings/fallback-items?channelId= — SẢN PHẨM SÀN KHÔNG CÓ MÃ SKU
 * (Hubsell đang phải tự sinh "SPE-…"), gom theo sản phẩm sàn, để hộp "Tự khớp +
 * tạo SKU" hỏi khách MÃ GỐC trước khi tạo (22/10/2026, cách Salework). Chỉ dòng
 * chưa nối, đang bán. Tối đa 300 sản phẩm — nhiều hơn thì khách nên đặt SKU
 * ngay trên sàn (lời khuyên gốc).
 */
router.get("/fallback-items", async (req: AuthRequest, res, next) => {
  try {
    const channelId = typeof req.query.channelId === "string" ? req.query.channelId : "";
    const rows = await prisma.channelProduct.findMany({
      where: {
        productId: null,
        status: "ACTIVE",
        externalId: { not: null },
        channel: {
          userId: req.ownerId!,
          ...(req.allowedChannelIds ? { id: { in: req.allowedChannelIds } } : {}),
        },
        ...(channelId ? { channelId } : {}),
        OR: [
          { channelSku: { startsWith: "SPE-" } },
          { channelSku: { startsWith: "TTK-" } },
          { channelSku: { startsWith: "LZD-" } },
        ],
      },
      select: {
        channelSku: true,
        externalId: true,
        productName: true,
        variantName: true,
        imageUrl: true,
        channelStock: true,
        channel: { select: { id: true, channelName: true, shopName: true } },
      },
      orderBy: [{ productName: "asc" }, { variantName: "asc" }],
      take: 5000,
    });
    const byItem = new Map<
      string,
      {
        itemId: string;
        productName: string;
        imageUrl: string | null;
        channelName: ChannelName;
        shopName: string;
        variants: { variantName: string | null; channelSku: string; channelStock: number | null }[];
      }
    >();
    for (const r of rows) {
      if (!isFallbackChannelSku(r.channelSku)) continue;
      const itemId = (r.externalId ?? "").split("-")[0];
      if (!itemId) continue;
      const g = byItem.get(itemId) ?? {
        itemId,
        productName: r.productName,
        imageUrl: r.imageUrl,
        channelName: r.channel.channelName,
        shopName: r.channel.shopName,
        variants: [],
      };
      if (!g.imageUrl && r.imageUrl) g.imageUrl = r.imageUrl;
      g.variants.push({
        variantName: cleanVariantName(r.variantName),
        channelSku: r.channelSku,
        channelStock: r.channelStock,
      });
      byItem.set(itemId, g);
    }
    const items = [...byItem.values()];
    res.json({ items: items.slice(0, 300), total: items.length });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/mappings/unlink — gỡ liên kết, đưa về lại trạng thái chưa nối.
 * Body: { channelProductIds: string[] }
 *
 * Chỉ đặt productId = null chứ KHÔNG xoá dòng: sản phẩm vẫn đang bán trên sàn,
 * xoá đi thì lần đồng bộ sau lại kéo về, mà lịch sử liên kết thì mất.
 */
router.post("/unlink", async (req: AuthRequest, res, next) => {
  try {
    const { channelProductIds } = req.body ?? {};
    if (!Array.isArray(channelProductIds) || channelProductIds.length === 0) {
      res.status(400).json({ error: "Chưa chọn sản phẩm sàn nào" });
      return;
    }

    const targets = await prisma.channelProduct.findMany({
      where: {
        id: { in: channelProductIds },
        channel: {
          userId: req.ownerId!,
          ...(req.allowedChannelIds ? { id: { in: req.allowedChannelIds } } : {}),
        },
      },
      select: { id: true },
    });
    const ids = targets.map((t) => t.id);

    // Gian đang dùng giá mặc định của kho → chép giá đó xuống thành giá riêng
    // TRƯỚC khi tháo, để giá vốn không tụt về 0 (giá vốn theo gian, 11/10/2026).
    const result = await prisma.$transaction(async (tx) => {
      await keepCostOnDetach(tx, { channelProductIds: ids }, req.ownerId!);
      return tx.channelProduct.updateMany({
        where: { id: { in: ids } },
        data: { productId: null },
      });
    });

    res.json({ unlinked: result.count });
  } catch (err) {
    next(err);
  }
});

export default router;
