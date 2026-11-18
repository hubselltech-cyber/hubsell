/**
 * CHỮ CỦA MỘT DÒNG HÀNG + GOM DÒNG THEO SẢN PHẨM (19/11/2026).
 *
 * Khách không đặt SKU trên sàn kêu: màn "Quét xem chi tiết đơn" in "SKU: 1733668291614…"
 * (id của sàn) còn tên phân loại bị cắt ở đuôi tên. Từ nay máy chủ trả sẵn ba trường cho
 * mỗi dòng hàng theo MỘT luật (backend lib/order-line-display.ts):
 *   baseName     tên sản phẩm không đuôi phân loại
 *   variantName  tên phân loại — null = sản phẩm đơn / không tách được
 *   sellerSku    mã NGƯỜI BÁN tự đặt — null khi mã là mã máy của sàn (không in ra)
 * App KHÔNG tự cắt tên: tên sản phẩm của khách có sẵn " - " rất nhiều, cắt mò là sai.
 *
 * Một đơn có thể tới 20 phân loại (anh Trung 19/11: "giao diện cho khách xem phải đẹp vì
 * có thể trong 1 đơn hàng khách có tới 20 sản phẩm sku") → `groupOrderLines` gom các phân
 * loại CÙNG sản phẩm dưới một tên, tên dài không lặp 20 lần.
 *
 * Tệp này không import React Native để chạy được dưới node --test.
 */

export interface LineTextSource {
  productName: string;
  channelSku: string | null;
  baseName?: string | null;
  variantName?: string | null;
  sellerSku?: string | null;
}

export interface LineText {
  baseName: string;
  variantName: string | null;
  sellerSku: string | null;
}

/**
 * Mã máy của sàn / Hubsell tự dựng — bản RÚT GỌN của isMachineSku ở backend, chỉ dùng khi
 * máy chủ chưa trả `sellerSku` (bản máy chủ cũ, hoặc dòng gom tại app). Dãy toàn số từ 16
 * chữ số = sku_id TikTok (19 số); mã vạch dài nhất thông dụng chỉ 14 số.
 */
export function looksLikeMachineSku(sku: string | null | undefined): boolean {
  const s = (sku ?? "").trim();
  return /^(SPE|TTK|LZD)-\d/.test(s) || /^\d{16,}$/.test(s) || /^\d+_[A-Z]{2}AMZ-\d+$/.test(s);
}

/** Chữ hiển thị của một dòng: lấy của máy chủ; máy chủ cũ chưa trả thì giữ nguyên tên, chỉ ẩn mã máy. */
export function lineText(it: LineTextSource): LineText {
  const name = (it.productName ?? "").trim();
  if (it.baseName !== undefined && it.baseName !== null) {
    return {
      baseName: it.baseName.trim() || name,
      variantName: it.variantName?.trim() || null,
      sellerSku: it.sellerSku?.trim() || null,
    };
  }
  const sku = (it.channelSku ?? "").trim();
  return { baseName: name, variantName: null, sellerSku: sku && !looksLikeMachineSku(sku) ? sku : null };
}

export interface LineGroup<T> {
  key: string;
  baseName: string;
  lines: (T & { text: LineText })[];
  /** Tổng số món của nhóm. */
  qty: number;
}

/**
 * Gom dòng hàng của MỘT đơn theo sản phẩm, giữ thứ tự sàn trả (nhóm đứng ở chỗ dòng đầu
 * tiên của nó). Chỉ dòng CÓ phân loại mới gom với nhau theo tên sản phẩm; sản phẩm đơn
 * luôn đứng riêng — hai dòng trùng tên mà không có phân loại là hai món khác (quà tặng 0 đ…).
 */
export function groupOrderLines<T extends LineTextSource & { quantity: number }>(items: T[]): LineGroup<T>[] {
  const groups: LineGroup<T>[] = [];
  const byName = new Map<string, LineGroup<T>>();
  items.forEach((it, i) => {
    const text = lineText(it);
    const qty = Number(it.quantity) || 0;
    const line = { ...it, text };
    if (!text.variantName) {
      groups.push({ key: `s:${i}`, baseName: text.baseName, lines: [line], qty });
      return;
    }
    const k = text.baseName.toLowerCase();
    let g = byName.get(k);
    if (!g) {
      g = { key: `v:${i}`, baseName: text.baseName, lines: [], qty: 0 };
      byName.set(k, g);
      groups.push(g);
    }
    g.lines.push(line);
    g.qty += qty;
  });
  return groups;
}

/** Tổng số dòng hàng và số món của đơn — in ở đầu danh sách ("20 dòng hàng · 34 món"). */
export function lineTotals(items: { quantity: number }[]): { lines: number; qty: number } {
  return { lines: items.length, qty: items.reduce((n, it) => n + (Number(it.quantity) || 0), 0) };
}

export interface GoodsRowSource {
  name: string;
  /** Khóa gom (mã thô của sàn) — null = gom theo tên. */
  sku: string | null;
  skuCount?: number;
  baseName?: string | null;
  variantName?: string | null;
  sellerSku?: string | null;
}

export interface GoodsRowText {
  /** Dòng to. */
  title: string;
  /** Dòng PHÂN LOẠI đậm ngay dưới tiêu đề — null khi không có, hoặc khi chính nó đã là tiêu đề. */
  variant: string | null;
  /** Dòng phụ nhỏ — chuỗi rỗng = không in. */
  sub: string;
}

/**
 * Chữ của một dòng trong Phiếu nhặt hàng / thống kê Quét nhiều. Tên phân loại LUÔN có dòng
 * riêng, không nằm ở đuôi tên: tên dài cắt 2 dòng thì các phân loại của cùng một sản phẩm
 * trông y hệt nhau, kho không biết lấy món nào (soi local 19/11/2026).
 *   Theo SKU      có mã người bán → mã to / phân loại / tên sản phẩm nhỏ;
 *                 không có mã     → TÊN PHÂN LOẠI to / tên sản phẩm nhỏ (trước 19/11 là dãy id sàn).
 *   Theo sản phẩm tên to / phân loại / dòng phụ = "N SKU" khi nhiều mã, không thì mã người bán;
 *                 không có mã thì KHÔNG in gì — shop không đặt SKU sẽ thấy "Không có mã SKU" ở
 *                 mọi dòng, chỉ thêm rối. Câu đó chỉ còn ở tab Theo SKU cho dòng gom theo tên.
 */
export function goodsRowText(row: GoodsRowSource, bySku: boolean): GoodsRowText {
  const t = lineText({
    productName: row.name,
    channelSku: row.sku,
    baseName: row.baseName,
    variantName: row.variantName,
    sellerSku: row.sellerSku,
  });
  if (!bySku) {
    const many = (row.skuCount ?? 1) > 1;
    return {
      title: t.baseName,
      variant: t.variantName,
      sub: many ? `${row.skuCount} SKU` : (t.sellerSku ?? ""),
    };
  }
  if (t.sellerSku) return { title: t.sellerSku, variant: t.variantName, sub: t.baseName };
  if (t.variantName) return { title: t.variantName, variant: null, sub: t.baseName };
  return { title: t.baseName, variant: null, sub: "Không có mã SKU" };
}
