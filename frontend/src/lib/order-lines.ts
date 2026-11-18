/**
 * CHỮ CỦA MỘT DÒNG HÀNG TRONG ĐƠN (19/11/2026) — bản web của hubsell-mobile/src/lib/order-lines.ts.
 *
 * Máy chủ trả sẵn ba trường cho mỗi dòng hàng theo MỘT luật (backend lib/order-line-display.ts):
 *   baseName     tên sản phẩm không đuôi phân loại
 *   variantName  tên phân loại — null = sản phẩm đơn / không tách được
 *   sellerSku    mã NGƯỜI BÁN tự đặt — null khi mã là mã máy của sàn (không in ra)
 * Khách không đặt SKU trên sàn trước đây thấy dãy id sàn ở chỗ mã SKU, còn tên phân loại
 * thì bị cắt ở đuôi tên. Giao diện KHÔNG tự cắt `productName`: tên sản phẩm của khách có
 * sẵn " - " rất nhiều. `channelSku` vẫn là khóa (nối kho, gom dòng) — tệp này chỉ lo chữ.
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
 * máy chủ chưa trả `sellerSku`. Dãy toàn số từ 16 chữ số = sku_id TikTok (19 số); mã vạch
 * dài nhất thông dụng chỉ 14 số.
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
 * Gom dòng hàng của MỘT đơn theo sản phẩm, giữ thứ tự sàn trả (nhóm đứng ở chỗ dòng đầu tiên
 * của nó) — đơn tới 20 phân loại thì tên dài in một lần thay vì lặp 20 lần (anh Trung 19/11).
 * Chỉ dòng CÓ phân loại mới gom với nhau theo tên sản phẩm; sản phẩm đơn luôn đứng riêng — hai
 * dòng trùng tên mà không có phân loại là hai món khác (quà tặng 0 đ…). Cùng luật với mobile.
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
