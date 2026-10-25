// ============================================================
// THÔNG BÁO ĐƠN MỚI — gom đợt, hỏa tốc báo ngay (app mobile, 23/10/2026)
//
// Đồng bộ đơn 3 sàn gọi noteNewOrder() ngay sau khi TẠO Order. Luật:
//   · Chỉ đơn khách ĐẶT trong 2 giờ gần đây mới là "mới" — lượt nạp lịch sử
//     khi vừa nối gian (hàng nghìn đơn cũ) không được nổ chuông.
//   · HỎA TỐC → một thông báo riêng NGAY (cửa sổ hành động vài giờ).
//   · Đơn thường → GOM: đợi 45 giây cho lô sync xong rồi một thông báo
//     "Có N đơn hàng mới cần xử lý" + từng gian: sàn · shop · số đơn · tiền
//     (anh Trung 23/10 tối: phải nói rõ là đơn mới cần xử lý, kèm sàn + shop +
//     doanh thu); trong 15 phút kế tiếp, đợt mới CỘNG DỒN vào cùng bản ghi
//     chuông (không đẻ 20 dòng) nhưng điện thoại vẫn rung mỗi đợt.
//   · Khách tắt mục "Đơn hàng mới" → đợt bị bỏ ngay ở flush (kể cả đợt cộng
//     dồn — trước đây đường amend không hỏi, lọt tin sau khi tắt).
// Bộ đệm nằm trong RAM của tiến trình worker — mất khi restart chỉ mất một
// thông báo tiện ích, không phải dữ liệu. Chi phí: O(số chủ shop có đơn
// trong 45 giây), không phụ thuộc số đơn.
// ============================================================

import { vndCompact } from "../lib/ads-format";
import { amendNotification, isNotificationTypeMuted, notify } from "./notifications";
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
/** Số gian liệt kê trong một tin; dư thì "+N gian khác". */
const SHOPS_SHOWN = 3;

const CHANNEL_LABEL: Record<string, string> = {
  SHOPEE: "Shopee",
  LAZADA: "Lazada",
  TIKTOK: "TikTok",
  OFFLINE: "Offline",
};

interface ShopCount {
  /** "Shopee · ANO Official Store" */
  label: string;
  count: number;
  amount: number;
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
  isMuted: (ownerId: string, type: string) => Promise<boolean>;
  flushDelayMs: number;
}
const deps: NewOrderDeps = {
  now: () => Date.now(),
  notify,
  amend: amendNotification,
  isMuted: isNotificationTypeMuted,
  flushDelayMs: FLUSH_DELAY_MS,
};

export function _setNewOrderDeps(partial: Partial<NewOrderDeps>): void {
  Object.assign(deps, partial);
}
export function _resetNewOrderBuffers(): void {
  for (const p of pending.values()) if (p.timer) clearTimeout(p.timer);
  pending.clear();
  rolling.clear();
}

/** "2,1 tr" / "850 k" / "1,2 tỷ" — gọn cho một dòng thông báo (bản dùng chung ở lib/ads-format). */
export const compactVnd = vndCompact;

function shopLabel(n: Pick<NewOrderNote, "shopName" | "channelName">): string {
  return `${CHANNEL_LABEL[n.channelName] ?? n.channelName} · ${n.shopName}`;
}

function addToBatch(b: OrderBatch, n: NewOrderNote): void {
  const amount = Number.isFinite(n.totalAmount) ? n.totalAmount : 0;
  b.count += 1;
  b.amount += amount;
  const key = `${n.channelName}:${n.shopName}`;
  const s = b.byShop.get(key) ?? { label: shopLabel(n), count: 0, amount: 0 };
  s.count += 1;
  s.amount += amount;
  b.byShop.set(key, s);
}

function mergeBatch(into: OrderBatch, from: OrderBatch): void {
  into.count += from.count;
  into.amount += from.amount;
  for (const [k, s] of from.byShop) {
    const cur = into.byShop.get(k) ?? { label: s.label, count: 0, amount: 0 };
    cur.count += s.count;
    cur.amount += s.amount;
    into.byShop.set(k, cur);
  }
}

/**
 * "Hubsell đã nhận 3 đơn mới · 1,2 tr — chờ bạn chuẩn bị hàng" (25/10/2026, anh
 * Trung: chuông phải cho thấy GIÁ TRỊ — máy đã kéo đơn về, kèm tiền, rồi mới
 * tới việc của chủ shop).
 */
export function titleOf(count: number, amount: number): string {
  return `Hubsell đã nhận ${count} đơn mới · ${vndCompact(amount)} — chờ bạn chuẩn bị hàng`;
}

/**
 * Nội dung: mỗi gian một dòng "Shopee · ANO: 2 đơn · 1,2 tr", nhiều gian thì
 * thêm dòng Tổng; quá 3 gian thì "+N gian khác".
 */
export function describeBatch(b: OrderBatch): string {
  const shops = [...b.byShop.values()].sort((x, y) => y.count - x.count || y.amount - x.amount);
  const lines = shops
    .slice(0, SHOPS_SHOWN)
    .map((s) => `${s.label}: ${s.count} đơn · ${compactVnd(s.amount)}`);
  if (shops.length > SHOPS_SHOWN) lines.push(`+${shops.length - SHOPS_SHOWN} gian khác`);
  if (shops.length > 1) lines.push(`Tổng ${compactVnd(b.amount)}`);
  return lines.join("\n");
}

export function noteNewOrder(n: NewOrderNote): void {
  if (!n.placedAt || deps.now() - n.placedAt.getTime() > FRESH_WINDOW_MS) return;

  if (isExpressShipping(n.carrierName)) {
    void deps.notify(n.ownerId, {
      type: "order_express",
      title: `⚡ Đơn hỏa tốc ${n.orderCode} cần xử lý ngay`,
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

  // Khách tắt "Đơn hàng mới" → bỏ cả đợt (notify() cũng tự chặn, nhưng đường
  // cộng dồn phải chặn ở đây).
  if (await deps.isMuted(ownerId, "order_new")) {
    rolling.delete(ownerId);
    return;
  }

  const now = deps.now();
  const r = rolling.get(ownerId);
  if (r && now - r.startedAt < MERGE_WINDOW_MS) {
    mergeBatch(r, b);
    const amended = await deps.amend(
      ownerId,
      r.notificationId,
      { title: titleOf(r.count, r.amount), body: `${describeBatch(r)}\n(15 phút gần đây)` },
      { title: `Thêm ${b.count} đơn mới · ${vndCompact(b.amount)} — chờ bạn chuẩn bị hàng`, body: describeBatch(b), data: { type: "order_new", link: "/orders" } }
    );
    if (amended) return;
    // Bản ghi cũ đã được đọc / xóa → mở đợt mới bên dưới.
    rolling.delete(ownerId);
  }

  const res = await deps.notify(ownerId, {
    type: "order_new",
    title: titleOf(b.count, b.amount),
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
      byShop: new Map([...b.byShop].map(([k, s]) => [k, { ...s }])),
    });
  }
}
