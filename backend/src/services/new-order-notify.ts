// ============================================================
// THÔNG BÁO ĐƠN MỚI — gom đợt, hỏa tốc báo ngay (app mobile, 23/10/2026)
//
// Đồng bộ đơn 3 sàn gọi noteNewOrder() ngay sau khi TẠO Order. Luật:
//   · Chỉ đơn khách ĐẶT trong 2 giờ gần đây mới là "mới" — lượt nạp lịch sử
//     khi vừa nối gian (hàng nghìn đơn cũ) không được nổ chuông.
//   · HỎA TỐC → một thông báo riêng NGAY (cửa sổ hành động vài giờ).
//   · Đơn thường → GOM: đợi 45 giây cho lô sync xong rồi một thông báo
//     "N đơn mới" theo gian; trong 15 phút kế tiếp, đợt mới CỘNG DỒN vào cùng
//     bản ghi chuông (không đẻ 20 dòng "1 đơn mới") nhưng điện thoại vẫn
//     rung mỗi đợt với số tăng thêm.
// Bộ đệm nằm trong RAM của tiến trình worker — mất khi restart chỉ mất một
// thông báo tiện ích, không phải dữ liệu. Chi phí: O(số chủ shop có đơn
// trong 45 giây), không phụ thuộc số đơn.
// ============================================================

import { amendNotification, notify } from "./notifications";
import { isExpressShipping } from "./shipping";

export interface NewOrderNote {
  ownerId: string;
  shopName: string;
  channelName: string;
  orderCode: string;
  totalAmount: number;
  /** Tên hãng nguyên văn sàn trả — để nhận diện hỏa tốc. */
  carrierName: string | null;
  /** Thời điểm khách đặt (create_time của sàn). */
  placedAt: Date | null;
}

/** Đơn đặt lâu hơn mốc này = nạp lịch sử, không báo. */
export const FRESH_WINDOW_MS = 2 * 60 * 60 * 1000;
/** Chờ lô đồng bộ gom xong rồi mới báo. */
export const FLUSH_DELAY_MS = 45_000;
/** Đợt sau cộng dồn vào bản ghi chuông của đợt trước trong cửa sổ này. */
export const MERGE_WINDOW_MS = 15 * 60 * 1000;

const CHANNEL_LABEL: Record<string, string> = {
  SHOPEE: "Shopee",
  LAZADA: "Lazada",
  TIKTOK: "TikTok",
  OFFLINE: "Offline",
};

interface ShopCount {
  label: string;
  count: number;
}

export interface OrderBatch {
  count: number;
  amount: number;
  byShop: Map<string, ShopCount>;
}

interface Pending extends OrderBatch {
  timer: ReturnType<typeof setTimeout> | null;
}

interface Rolling extends OrderBatch {
  notificationId: string;
  startedAt: number;
}

const pending = new Map<string, Pending>();
const rolling = new Map<string, Rolling>();

/** Để test thay đồng hồ / cửa gửi mà không đụng DB. */
export interface NewOrderDeps {
  now: () => number;
  notify: typeof notify;
  amend: typeof amendNotification;
  flushDelayMs: number;
}
const deps: NewOrderDeps = { now: () => Date.now(), notify, amend: amendNotification, flushDelayMs: FLUSH_DELAY_MS };

export function _setNewOrderDeps(partial: Partial<NewOrderDeps>): void {
  Object.assign(deps, partial);
}
export function _resetNewOrderBuffers(): void {
  for (const p of pending.values()) if (p.timer) clearTimeout(p.timer);
  pending.clear();
  rolling.clear();
}

/** "2,1 tr" / "850 k" / "1,2 tỷ" — gọn cho một dòng thông báo. */
export function compactVnd(v: number): string {
  const a = Math.abs(v);
  const f = (x: number, d: number) => x.toFixed(d).replace(/\.0+$/, "").replace(".", ",");
  if (a >= 1e9) return `${f(v / 1e9, 1)} tỷ`;
  if (a >= 1e6) return `${f(v / 1e6, 1)} tr`;
  if (a >= 1e3) return `${Math.round(v / 1e3)} k`;
  return `${Math.round(v)} đ`;
}

function shopLabel(n: Pick<NewOrderNote, "shopName" | "channelName">): string {
  return `${CHANNEL_LABEL[n.channelName] ?? n.channelName} ${n.shopName}`;
}

function addToBatch(b: OrderBatch, n: NewOrderNote): void {
  b.count += 1;
  b.amount += Number.isFinite(n.totalAmount) ? n.totalAmount : 0;
  const key = `${n.channelName}:${n.shopName}`;
  const s = b.byShop.get(key) ?? { label: shopLabel(n), count: 0 };
  s.count += 1;
  b.byShop.set(key, s);
}

/**
 * Nội dung một đợt: "Shopee ANO 2 · TikTok Hi.Bé 1 · tổng 2,1 tr".
 * Một gian: "Gian Shopee ANO · tổng 2,1 tr". Quá 3 gian thì "+N gian khác".
 */
export function describeBatch(b: OrderBatch): string {
  const shops = [...b.byShop.values()].sort((x, y) => y.count - x.count);
  const head =
    shops.length === 1
      ? `Gian ${shops[0].label}`
      : shops
          .slice(0, 3)
          .map((s) => `${s.label} ${s.count}`)
          .join(" · ") + (shops.length > 3 ? ` · +${shops.length - 3} gian khác` : "");
  return `${head} · tổng ${compactVnd(b.amount)}`;
}

export function noteNewOrder(n: NewOrderNote): void {
  if (!n.placedAt || deps.now() - n.placedAt.getTime() > FRESH_WINDOW_MS) return;

  if (isExpressShipping(n.carrierName)) {
    void deps.notify(n.ownerId, {
      type: "order_express",
      title: `⚡ Đơn hỏa tốc ${n.orderCode}`,
      body: `${shopLabel(n)} · ${compactVnd(n.totalAmount)}. ${n.carrierName ?? "Hãng"} đến lấy trong vài giờ — chuẩn bị hàng ngay.`,
      link: `/orders?search=${encodeURIComponent(n.orderCode)}`,
      dedupe: false,
    });
  }

  let p = pending.get(n.ownerId);
  if (!p) {
    p = { count: 0, amount: 0, byShop: new Map(), timer: null };
    pending.set(n.ownerId, p);
  }
  addToBatch(p, n);
  if (!p.timer) {
    p.timer = setTimeout(() => void flushOwner(n.ownerId), deps.flushDelayMs);
    p.timer.unref?.();
  }
}

/** Gửi đợt đang gom của một chủ shop (test gọi thẳng để khỏi chờ timer). */
export async function flushOwner(ownerId: string): Promise<void> {
  const b = pending.get(ownerId);
  pending.delete(ownerId);
  if (!b || b.count === 0) return;
  if (b.timer) clearTimeout(b.timer);

  const now = deps.now();
  const r = rolling.get(ownerId);
  if (r && now - r.startedAt < MERGE_WINDOW_MS) {
    r.count += b.count;
    r.amount += b.amount;
    for (const [k, s] of b.byShop) {
      const cur = r.byShop.get(k) ?? { label: s.label, count: 0 };
      cur.count += s.count;
      r.byShop.set(k, cur);
    }
    const amended = await deps.amend(
      ownerId,
      r.notificationId,
      { title: `${r.count} đơn mới`, body: `${describeBatch(r)} (15 phút gần đây)` },
      { title: `+${b.count} đơn mới`, body: describeBatch(b), data: { type: "order_new", link: "/orders" } }
    );
    if (amended) return;
    // Bản ghi cũ đã được đọc / xóa → mở đợt mới bên dưới.
    rolling.delete(ownerId);
  }

  const res = await deps.notify(ownerId, {
    type: "order_new",
    title: `${b.count} đơn mới`,
    body: describeBatch(b),
    link: "/orders",
    dedupe: false,
  });
  if (res) {
    rolling.set(ownerId, {
      notificationId: res.id,
      startedAt: now,
      count: b.count,
      amount: b.amount,
      byShop: new Map(b.byShop),
    });
  }
}
