import type { PackFlash } from "./pack-scan-feedback";

/**
 * QUÉT NHIỀU ĐƠN (12/11/2026) — phần thuần của chế độ "Quét nhiều" ở tab QR giữa: gom một
 * XẤP KIỆN bằng cách quét liên tục rồi xem thống kê của đúng xấp đó. Chỉ XEM, không đổi
 * trạng thái đơn nào (khác Quét đóng gói).
 *
 * Khách đang dùng ShipXanh xin: "phần xem đơn để chế độ quét nhiều đơn xong xem thống kê
 * thì sẽ tiện hơn với các shop nhờ ship TikTok buổi trưa" — lô giao giữa ngày là một xấp
 * kiện cụ thể, không bộ lọc trạng thái nào khoanh đúng được, chỉ quét mới khoanh được.
 *
 * Hơn bản của ShipXanh ở một điểm có chủ ý: ĐƠN ĐÃ HỦY lẫn trong lô kêu còi + màn đỏ, nằm
 * riêng trong danh sách và KHÔNG tính vào số hàng (kiện đó phải rút ra, không giao).
 *
 * Tệp này không import React Native để chạy được dưới node --test.
 */

/** Phần của một đơn mà lô cần — khớp OrderDto của GET /api/orders/lookup. */
export interface BatchOrder {
  id: string;
  orderCode: string;
  trackingCode: string | null;
  shippingStatus: string;
  cancelRequestedAt?: string | null;
  carrier: string | null;
  shippingCarrierName?: string | null;
  labelPrintedAt?: string | null;
  packingDoneAt?: string | null;
  handoverSheetId?: string | null;
  channel: { channelName: string; shopName: string };
  items: {
    productName: string;
    channelSku: string | null;
    quantity: number;
    imageUrl?: string | null;
    product?: { imageUrl: string | null } | null;
  }[];
}

export interface BatchLine {
  /** Mã SKU; null khi dòng gom theo sản phẩm có nhiều SKU, hoặc hàng không có SKU. */
  sku: string | null;
  name: string;
  qty: number;
  /** Số ĐƠN trong lô có món này. */
  orders: number;
  /** Số SKU khác nhau của sản phẩm (chỉ có nghĩa ở bảng theo sản phẩm). */
  skuCount: number;
  imageUrl: string | null;
}

export interface BatchSummary {
  /** Mọi kiện đã quét, kể cả đơn hủy. */
  parcels: number;
  /** Đơn đã hủy lẫn trong lô — phải rút kiện ra. */
  cancelled: number;
  /** Khách đang xin hủy (đơn chưa hủy) — để riêng chờ shop trả lời sàn. */
  cancelRequested: number;
  /** Tổng số lượng hàng của các đơn CHƯA hủy. */
  qty: number;
  bySku: BatchLine[];
  byProduct: BatchLine[];
  /** Số kiện chưa hủy theo sàn / theo hãng vận chuyển, nhiều trước. */
  byChannel: { key: string; count: number }[];
  byCarrier: { key: string; count: number }[];
}

export function isCancelled(o: { shippingStatus: string }): boolean {
  return o.shippingStatus === "CANCELLED";
}

function imageOf(it: BatchOrder["items"][number]): string | null {
  return it.imageUrl ?? it.product?.imageUrl ?? null;
}

function tally(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function ranked(map: Map<string, number>): { key: string; count: number }[] {
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key, "vi"));
}

/**
 * Cộng hàng của lô. Cùng luật gom với Phiếu nhặt hàng (backend lib/pick-summary.ts): theo
 * SKU thì hàng không có SKU gom theo tên; theo sản phẩm thì gom theo tên, một SKU duy nhất
 * thì hiện SKU đó. Đơn đã hủy bị loại khỏi mọi con số hàng.
 * `carrierLabel` do màn truyền vào (nhãn hãng nằm ở lib/labels, có import RN).
 */
export function summarizeBatch(
  orders: BatchOrder[],
  carrierLabel: (o: BatchOrder) => string = (o) => o.shippingCarrierName ?? o.carrier ?? "Chưa rõ hãng"
): BatchSummary {
  type Acc = BatchLine & { orderIds: Set<string>; skuSet: Set<string> };
  const skus = new Map<string, Acc>();
  const products = new Map<string, Acc>();
  const channels = new Map<string, number>();
  const carriers = new Map<string, number>();
  let cancelled = 0;
  let cancelRequested = 0;
  let qty = 0;

  const bump = (map: Map<string, Acc>, key: string, seed: () => Acc, o: BatchOrder, q: number, skuKey: string, img: string | null) => {
    let a = map.get(key);
    if (!a) {
      a = seed();
      map.set(key, a);
    }
    a.qty += q;
    a.orderIds.add(o.id);
    a.skuSet.add(skuKey);
    a.imageUrl ??= img;
    return a;
  };

  for (const o of orders) {
    if (isCancelled(o)) {
      cancelled++;
      continue;
    }
    if (o.cancelRequestedAt) cancelRequested++;
    tally(channels, o.channel.channelName);
    tally(carriers, carrierLabel(o));
    for (const it of o.items) {
      const q = Number(it.quantity) || 0;
      if (q <= 0) continue;
      const sku = (it.channelSku ?? "").trim() || null;
      // Không SKU thì tên là thứ duy nhất phân biệt được hàng; tiền tố để không đụng SKU thật.
      const skuKey = sku ? `sku:${sku}` : `name:${it.productName}`;
      const img = imageOf(it);
      const blank = (name: string, s: string | null): Acc => ({
        sku: s,
        name,
        qty: 0,
        orders: 0,
        skuCount: 0,
        imageUrl: null,
        orderIds: new Set(),
        skuSet: new Set(),
      });
      bump(skus, skuKey, () => blank(it.productName, sku), o, q, skuKey, img);
      const p = bump(products, it.productName, () => blank(it.productName, null), o, q, skuKey, img);
      p.sku = p.skuSet.size === 1 ? sku : null;
      qty += q;
    }
  }

  const finish = (map: Map<string, Acc>): BatchLine[] =>
    [...map.values()]
      .map(({ orderIds, skuSet, ...line }) => ({ ...line, orders: orderIds.size, skuCount: skuSet.size }))
      .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name, "vi"));

  return {
    parcels: orders.length,
    cancelled,
    cancelRequested,
    qty,
    bySku: finish(skus),
    byProduct: finish(products),
    byChannel: ranked(channels),
    byCarrier: ranked(carriers),
  };
}

/**
 * Kết quả một lượt quét → màn báo + âm + rung. `already` = kiện đã nằm trong lô.
 * Dùng chung khuôn PackFlash với Quét đóng gói để hai màn kêu / hiện cùng kiểu; `counter`
 * luôn null (số của lô đếm từ danh sách, không đếm theo lượt quét).
 */
export function flashOfBatchScan(o: BatchOrder, meta: string | null, already: boolean): PackFlash {
  const base = { code: o.orderCode, meta, counter: null };
  if (isCancelled(o)) {
    return {
      ...base,
      kind: "cancelled",
      title: "ĐƠN ĐÃ HỦY",
      detail: already ? "Kiện này đã quét rồi — vẫn rút ra, không giao" : "Rút kiện này ra khỏi lô — không giao",
      sound: "cancelled",
      haptic: "errorTwice",
      holdMs: 2500,
      short: already ? "ĐƠN ĐÃ HỦY, đã quét rồi — rút ra" : "ĐƠN ĐÃ HỦY, rút khỏi lô",
    };
  }
  if (already) {
    return {
      ...base,
      kind: "dup",
      title: "ĐÃ CÓ TRONG LÔ",
      detail: "Kiện này quét rồi, không cộng thêm",
      sound: "duplicate",
      haptic: "warning",
      holdMs: 1200,
      short: "đã có trong lô",
    };
  }
  if (o.cancelRequestedAt) {
    return {
      ...base,
      kind: "caution",
      title: "KHÁCH ĐANG XIN HỦY",
      detail: "Đã thêm vào lô — để riêng kiện, chờ shop trả lời sàn",
      sound: "error",
      haptic: "error",
      holdMs: 2500,
      short: "khách đang xin hủy — để riêng",
    };
  }
  return {
    ...base,
    kind: "ok",
    title: "ĐÃ THÊM VÀO LÔ",
    detail: null,
    sound: "success",
    haptic: "success",
    holdMs: 700,
    short: "đã thêm vào lô",
  };
}

/** Lượt tra hỏng ở chế độ Quét nhiều — cùng khuôn với Quét đóng gói, đổi câu cho đúng việc. */
export function flashOfBatchError(scanned: string, status: number, message: string): PackFlash {
  const base = {
    kind: "failed" as const,
    code: scanned,
    meta: null,
    sound: "error" as const,
    haptic: "error" as const,
    holdMs: 2000,
    counter: null,
  };
  if (status === 0 || status === 408 || status >= 500) {
    return {
      ...base,
      title: "CHƯA THÊM ĐƯỢC",
      detail: "Mất kết nối máy chủ — kiện này CHƯA vào lô. Giữ kiện trong khung, máy tự thử lại.",
      short: "CHƯA thêm — mất kết nối",
    };
  }
  if (status === 404) {
    return {
      ...base,
      title: "KHÔNG THẤY ĐƠN",
      detail: "Tem của đơn vị khác, hoặc đơn chưa về Hubsell",
      short: "không thấy đơn",
    };
  }
  if (status === 409) {
    return {
      ...base,
      title: "MÃ KHỚP NHIỀU ĐƠN",
      detail: "Quét lại đúng mã vận đơn trên tem, hoặc gõ thêm ký tự",
      short: "mã khớp nhiều đơn",
    };
  }
  return { ...base, title: "KHÔNG THÊM ĐƯỢC", detail: message, short: message };
}
