// ============================================================
// THỐNG KÊ BỐC HÀNG (04/11/2026) — cộng số lượng cần lấy theo SKU và theo sản phẩm.
//
// Đầu vào là các nhóm (SKU, tên) đã gom sẵn bằng SQL ở route GET
// /api/orders/pick-summary. Hàm thuần để test được mà không cần DB.
//
// Danh sách bốc hàng phải ĐỦ: không cắt top N như /api/orders/stats của mobile,
// thiếu một dòng là kho thiếu hàng mà không biết.
//
// Đơn hỏa tốc lên đầu vì kho phải nhặt trước, cùng luật với /api/orders/stats.
// ============================================================

export interface PickLineGroup {
  channelSku: string;
  productName: string;
  qty: number;
  /** Phần số lượng thuộc đơn hỏa tốc. */
  expressQty: number;
  imageUrl: string | null;
}

export interface PickSkuRow {
  /** null = dòng đơn không có SKU, gom riêng theo tên để không dồn hàng khác nhau làm một. */
  sku: string | null;
  name: string;
  qty: number;
  expressQty: number;
  imageUrl: string | null;
}

export interface PickProductRow {
  name: string;
  /** Số SKU khác nhau của sản phẩm — kho biết phải lấy mấy loại. */
  skuCount: number;
  /** Mã SKU khi sản phẩm chỉ có đúng một SKU; nhiều SKU thì null. */
  sku: string | null;
  qty: number;
  expressQty: number;
  imageUrl: string | null;
}

export interface PickSummary {
  totals: { qty: number; expressQty: number; skuCount: number; productCount: number };
  bySku: PickSkuRow[];
  byProduct: PickProductRow[];
}

/** Hỏa tốc trước, rồi số lượng giảm dần, rồi tên để thứ tự ổn định giữa các lần mở. */
function byPickOrder<T extends { expressQty: number; qty: number; name: string }>(a: T, b: T): number {
  return b.expressQty - a.expressQty || b.qty - a.qty || a.name.localeCompare(b.name, "vi");
}

export function summarizePickLines(groups: PickLineGroup[]): PickSummary {
  const skus = new Map<string, PickSkuRow>();
  const products = new Map<string, PickProductRow & { skuSet: Set<string> }>();
  let totalQty = 0;
  let totalExpress = 0;

  for (const g of groups) {
    const sku = g.channelSku.trim() || null;
    // Không SKU thì tên là thứ duy nhất phân biệt được hàng; tiền tố để không đụng
    // một SKU thật trùng chữ với tên.
    const skuKey = sku ? `sku:${sku}` : `name:${g.productName}`;

    const s = skus.get(skuKey) ?? {
      sku,
      name: g.productName,
      qty: 0,
      expressQty: 0,
      imageUrl: null,
    };
    s.qty += g.qty;
    s.expressQty += g.expressQty;
    s.imageUrl ??= g.imageUrl;
    skus.set(skuKey, s);

    const p = products.get(g.productName) ?? {
      name: g.productName,
      skuCount: 0,
      sku: null,
      qty: 0,
      expressQty: 0,
      imageUrl: null,
      skuSet: new Set<string>(),
    };
    p.qty += g.qty;
    p.expressQty += g.expressQty;
    p.imageUrl ??= g.imageUrl;
    p.skuSet.add(skuKey);
    p.sku = p.skuSet.size === 1 ? sku : null;
    products.set(g.productName, p);

    totalQty += g.qty;
    totalExpress += g.expressQty;
  }

  return {
    totals: {
      qty: totalQty,
      expressQty: totalExpress,
      skuCount: skus.size,
      productCount: products.size,
    },
    bySku: [...skus.values()].sort(byPickOrder),
    byProduct: [...products.values()]
      .map(({ skuSet, ...rest }) => ({ ...rest, skuCount: skuSet.size }))
      .sort(byPickOrder),
  };
}
