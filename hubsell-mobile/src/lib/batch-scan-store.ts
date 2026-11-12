import { useSyncExternalStore } from "react";
import type { OrderDto } from "@/types/api";

/**
 * LÔ ĐANG QUÉT của chế độ "Quét nhiều" — giữ ở ngoài màn hình (biến của module) để lô
 * KHÔNG MẤT khi đổi sang Xem đơn / Đóng gói, rời tab QR hay khóa máy giữa chừng: người
 * đang gom 60 kiện cho shipper mà lỡ chạm nhầm tab không phải quét lại từ đầu. Lô chỉ mất
 * khi bấm "Xóa lô" hoặc tắt hẳn app; không lưu xuống máy (số của lô là số tức thời, để
 * qua ngày hôm sau là sai với trạng thái đơn).
 */
export interface BatchEntry {
  order: OrderDto;
  /** Lúc quét (ms) — danh sách xếp mới nhất trước. */
  at: number;
}

let entries: BatchEntry[] = [];
const listeners = new Set<() => void>();

function emit(next: BatchEntry[]): void {
  entries = next;
  for (const l of listeners) l();
}

export const batchStore = {
  has(orderId: string): boolean {
    return entries.some((e) => e.order.id === orderId);
  },
  /** Thêm kiện vào ĐẦU danh sách; đã có thì không thêm (trả false). */
  add(order: OrderDto, at: number): boolean {
    if (batchStore.has(order.id)) return false;
    emit([{ order, at }, ...entries]);
    return true;
  },
  remove(orderId: string): void {
    emit(entries.filter((e) => e.order.id !== orderId));
  },
  clear(): void {
    emit([]);
  },
};

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Danh sách kiện của lô, mới nhất trước; tự vẽ lại khi lô đổi. */
export function useBatch(): BatchEntry[] {
  return useSyncExternalStore(
    subscribe,
    () => entries,
    () => entries
  );
}
