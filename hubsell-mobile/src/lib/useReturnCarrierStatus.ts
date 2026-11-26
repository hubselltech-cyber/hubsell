import { useEffect, useRef, useState } from "react";
import { RETURN_CARRIER_BATCH, fetchReturnCarrierStatus } from "@/api/warehouse";
import type { ReturnCarrierStatus, ReturnOrderDto } from "@/types/api";
import { needsCarrierLookup } from "./return-shipping";

/** Hỏi lại hãng sau chừng này — khớp thời gian đệm của backend (TRACKING_CACHE_MS). */
const CARRIER_STALE_MS = 10 * 60 * 1000;

/**
 * Trạng thái hãng của các kiện GIAO THẤT BẠI đang hiện trong danh sách đơn hoàn — bản app
 * của hook cùng tên bên web (frontend/src/components/warehouse/return-shipping-cell.tsx).
 *
 * TIẾT CHẾ lệnh gọi sàn: chỉ hỏi dòng thuộc diện (needsCarrierLookup), tuần tự từng lô
 * RETURN_CARRIER_BATCH đơn (một yêu cầu đang bay mỗi lúc), mỗi đơn tối đa một lần / 10 phút
 * (kéo làm mới, đổi bộ lọc rồi quay lại không hỏi lại). Trang app 20 đơn → nhiều nhất 20
 * lệnh gọi cho một lượt mở, bấm "Xem thêm" mới hỏi 20 đơn kế.
 */
export function useReturnCarrierStatus(
  rows: ReturnOrderDto[],
  /**
   * Gọi khi một lô trả về có kiện HÃNG BÁO ĐÃ TRẢ — lúc đó backend vừa lưu mốc, số đếm của
   * nhóm lọc "Ship báo đã hoàn" / "Giao thất bại" đã đổi; màn dùng để tải lại số đếm.
   */
  onReturned?: () => void
): Record<string, ReturnCarrierStatus> {
  const [byId, setById] = useState<Record<string, ReturnCarrierStatus>>({});
  /** id → lúc đã hỏi (ms). */
  const asked = useRef(new Map<string, number>());
  const onReturnedRef = useRef(onReturned);
  useEffect(() => {
    onReturnedRef.current = onReturned;
  });
  const needKey = rows.filter(needsCarrierLookup).map((o) => o.id).join(",");

  useEffect(() => {
    if (!needKey) return;
    const now = Date.now();
    const askedAt = asked.current;
    const todo = needKey.split(",").filter((id) => now - (askedAt.get(id) ?? 0) > CARRIER_STALE_MS);
    if (todo.length === 0) return;
    for (const id of todo) askedAt.set(id, now);

    let cancelled = false;
    /** Vị trí đơn đầu tiên CHƯA gửi đi hỏi. */
    let next = 0;
    void (async () => {
      for (let i = 0; i < todo.length; i += RETURN_CARRIER_BATCH) {
        if (cancelled) return;
        const batch = todo.slice(i, i + RETURN_CARRIER_BATCH);
        next = i + RETURN_CARRIER_BATCH;
        try {
          const res = await fetchReturnCarrierStatus(batch);
          // Đơn backend không trả (không còn thuộc diện hỏi) coi như hãng không có tin,
          // để dòng không treo mãi ở "Đang hỏi hãng…".
          const filled = Object.fromEntries(
            batch.map((id) => [id, res.items[id] ?? ({ status: "unsupported" } as const)])
          );
          setById((prev) => ({ ...prev, ...filled }));
          if (Object.values(filled).some((r) => r.status === "ok" && r.state === "RETURNED")) {
            onReturnedRef.current?.();
          }
        } catch {
          // Lỗi mạng / backend bản cũ: dòng về "Giao thất bại, kiện quay đầu", 10 phút sau hỏi lại.
          const failed = Object.fromEntries(batch.map((id) => [id, { status: "error" } as const]));
          setById((prev) => ({ ...prev, ...failed }));
        }
      }
    })();
    return () => {
      cancelled = true;
      // Danh sách đổi giữa chừng (bấm "Xem thêm", đổi bộ lọc): các lô chưa gửi phải gỡ dấu
      // NGAY TẠI ĐÂY, trước khi lượt effect kế chạy — gỡ muộn (trong vòng lặp, sau khi lô
      // đang bay về) thì lượt kế đã bỏ qua chúng và dòng treo mãi ở "Đang hỏi hãng…".
      for (const id of todo.slice(next)) askedAt.delete(id);
    };
  }, [needKey]);

  return byId;
}
