import { Router } from "express";
import { ChannelName, InventoryLogType, Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import type { AuthRequest } from "../auth";

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

    const scope: Prisma.ChannelProductWhereInput = {
      channel: {
        userId: req.ownerId!,
        ...(req.allowedChannelIds ? { id: { in: req.allowedChannelIds } } : {}),
        ...(channelName ? { channelName } : {}),
      },
      ...(channelId ? { channelId } : {}),
      ...(search
        ? {
            OR: [
              { channelSku: { contains: search, mode: "insensitive" as const } },
              { productName: { contains: search, mode: "insensitive" as const } },
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

    const [total, items, linkedCount, unlinkedCount] = await Promise.all([
      prisma.channelProduct.count({ where }),
      prisma.channelProduct.findMany({
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

/**
 * ĐỒNG BỘ LẦN ĐẦU — LẤY TỒN THEO SÀN.
 *
 * Sản phẩm kho đang tồn 0 (chưa từng nhập tồn thật) vừa được nối SKU sàn →
 * nhận tồn ban đầu = số ĐANG CÓ TRÊN SÀN (ChannelProduct.channelStock, cập nhật
 * mỗi lần "Đồng bộ từ sàn"). Nhờ vậy shop mới liên kết xong là số kho khớp ngay
 * với sàn, không có biến động nào bị đẩy ngược lên sàn — vận hành không gián đoạn.
 *
 * Tồn ban đầu = TỔNG tồn của mọi gian ACTIVE (chốt của anh Trung 15/08: mỗi
 * gian được xem là một phần hàng riêng, cộng lại mới ra tổng tồn thật của SKU).
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
    const qty = rows.reduce((sum, r) => sum + (r.channelStock ?? 0), 0);
    if (qty <= 0) continue;

    // Ghi rõ từng gian góp bao nhiêu để sổ kho tự giải thích được con số tổng.
    const detail = rows
      .map((r) => `${r.channel.shopName}: ${r.channelStock ?? 0}`)
      .join(" + ");

    await prisma.$transaction([
      prisma.product.update({
        where: { id: p.id },
        data: { quantityInStock: qty },
      }),
      prisma.inventoryLog.create({
        data: {
          productId: p.id,
          changeQuantity: qty,
          type: InventoryLogType.SYNC,
          reason: `Đồng bộ lần đầu khi liên kết: tổng tồn các gian trên sàn (${detail})`,
        },
      }),
    ]);
    seeded.set(p.id, qty);
  }
  return seeded;
}

/**
 * Sản phẩm gốc costPrice = 0 nhưng có SKU sàn vừa nối mang costPrice > 0 →
 * chép số đó sang sản phẩm gốc (không đụng sản phẩm đã có giá vốn thật).
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
router.post("/auto-match", async (req: AuthRequest, res, next) => {
  try {
    const channelId =
      typeof req.body?.channelId === "string" ? req.body.channelId : "";

    const [products, unlinked] = await Promise.all([
      prisma.product.findMany({
        where: { userId: req.ownerId! },
        select: { id: true, skuCode: true },
      }),
      prisma.channelProduct.findMany({
        where: {
          productId: null,
          ...(channelId ? { channelId } : {}),
          channel: {
            userId: req.ownerId!,
            ...(req.allowedChannelIds ? { id: { in: req.allowedChannelIds } } : {}),
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

    await inheritChannelCostPrice([...idsByProduct.keys()], req.ownerId!);

    // Các sản phẩm tồn 0 vừa được tự khớp → nhận tồn ban đầu theo số trên sàn.
    const seeded = await seedInitialStockFromChannel(
      [...idsByProduct.keys()],
      req.ownerId!
    );

    res.json({
      matched,
      products: idsByProduct.size,
      scanned: unlinked.length,
      seededProducts: seeded.size,
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

    const cps = await prisma.channelProduct.findMany({
      where: {
        id: { in: channelProductIds },
        productId: null, // đã liên kết rồi thì bỏ qua, không tạo trùng
        channel: {
          userId: req.ownerId!,
          ...(req.allowedChannelIds ? { id: { in: req.allowedChannelIds } } : {}),
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
    for (const cp of cps) {
      const key = cp.channelSku.trim().toUpperCase();
      const list = byUpperSku.get(key) ?? [];
      list.push(cp);
      byUpperSku.set(key, list);
    }

    for (const [skuCode, group] of byUpperSku) {
      if (!skuCode) continue;
      let product = await prisma.product.findUnique({
        where: { userId_skuCode: { userId: req.ownerId!, skuCode } },
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
        product = await prisma.product.create({
          data: {
            userId: req.ownerId!,
            skuCode,
            productName: rep.productName,
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

    // SKU kho tạo mới (tồn 0) và SKU dùng lại còn tồn 0 → nhận tồn theo sàn.
    const seeded = await seedInitialStockFromChannel(touchedProductIds, req.ownerId!);

    res.json({
      createdProducts,
      reusedProducts,
      linked,
      skipped: channelProductIds.length - linked,
      seededProducts: seeded.size,
    });
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

    const result = await prisma.channelProduct.updateMany({
      where: {
        id: { in: channelProductIds },
        channel: {
          userId: req.ownerId!,
          ...(req.allowedChannelIds ? { id: { in: req.allowedChannelIds } } : {}),
        },
      },
      data: { productId: null },
    });

    res.json({ unlinked: result.count });
  } catch (err) {
    next(err);
  }
});

export default router;
