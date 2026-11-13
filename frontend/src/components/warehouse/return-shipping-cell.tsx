"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import {
  RETURN_CARRIER_BATCH,
  fetchReturnCarrierStatus,
  type ReturnCarrierStatus,
  type ReturnRow,
  type ReturnShippingState,
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * CỘT "TRẠNG THÁI VẬN CHUYỂN" của Đối soát đơn hoàn (anh Trung 13/11/2026, thay cột
 * Khách hàng: "để biết ship đã báo hoàn thành công hay chưa để dễ dàng đối soát").
 *
 * Hai nguồn:
 *   1. `order.returnShipping` — backend tính sẵn từ số của sàn (lib/return-shipping.ts),
 *      đủ cho đơn khách trả hàng và đơn kho đã nhận. Không tốn call sàn.
 *   2. Kiện GIAO THẤT BẠI quay đầu đang chờ về: API hoàn của sàn không nói gì về chặng
 *      về → hỏi hành trình hãng vận chuyển (cùng API với Chi tiết đơn hàng), theo lô
 *      10 đơn của trang đang xem, mỗi đơn 1 call sàn, backend đệm 10 phút.
 *
 * Chấm màu + chữ (không dùng viên bo như cột Tình trạng) để hai cột trạng thái đứng
 * gần nhau không lẫn. KHÔNG viết lớp dark: cho màu — globals.css đã lật thang.
 */
const SHIPPING_META: Record<ReturnShippingState, { label: string; dot: string; text: string }> = {
  RETURNED: { label: "Hoàn thành công", dot: "bg-emerald-500", text: "text-emerald-700" },
  // blue chứ không indigo: thang indigo chưa được lật ở giao diện tối (chữ chìm vào nền).
  RETURNING: { label: "Đang hoàn về", dot: "bg-blue-500", text: "text-blue-700" },
  WAITING_BUYER: { label: "Chờ khách gửi hàng", dot: "bg-amber-500", text: "text-amber-700" },
  NO_SIGNAL: { label: "Chưa có tin từ hãng", dot: "bg-zinc-400", text: "text-muted-foreground" },
};

/** Hỏi lại hãng sau chừng này — khớp thời gian đệm của backend (TRACKING_CACHE_MS). */
const CARRIER_STALE_MS = 10 * 60 * 1000;

/** Đơn cần hỏi hành trình hãng: giao thất bại quay đầu, kho chưa nhận, sàn có API hành trình. */
function needsCarrierLookup(o: ReturnRow): boolean {
  return (
    o.returnStatus === "AWAITING" &&
    o.returnShipping?.state === "NO_SIGNAL" &&
    o.returnShipping.failedDelivery &&
    Boolean(o.trackingCode) &&
    (o.channel.channelName === "SHOPEE" || o.channel.channelName === "TIKTOK")
  );
}

/**
 * Trạng thái hãng của các đơn cần hỏi trên trang đang xem. Hỏi tuần tự từng lô
 * RETURN_CARRIER_BATCH đơn (một yêu cầu đang bay mỗi lúc) để dòng hiện dần và không
 * dồn cả trang 100 đơn vào sàn cùng lúc. Đổi trang giữa chừng thì bỏ các lô chưa hỏi.
 */
export function useReturnCarrierStatus(rows: ReturnRow[]): Record<string, ReturnCarrierStatus> {
  const [byId, setById] = useState<Record<string, ReturnCarrierStatus>>({});
  /** id → lúc đã hỏi (ms): lượt tự làm mới 30 giây của danh sách không hỏi lại. */
  const asked = useRef(new Map<string, number>());
  const needKey = rows.filter(needsCarrierLookup).map((o) => o.id).join(",");

  useEffect(() => {
    if (!needKey) return;
    const now = Date.now();
    const todo = needKey.split(",").filter((id) => now - (asked.current.get(id) ?? 0) > CARRIER_STALE_MS);
    if (todo.length === 0) return;
    for (const id of todo) asked.current.set(id, now);

    let cancelled = false;
    void (async () => {
      for (let i = 0; i < todo.length; i += RETURN_CARRIER_BATCH) {
        if (cancelled) {
          // Lô chưa hỏi: gỡ dấu để lần quay lại trang này hỏi tiếp.
          for (const id of todo.slice(i)) asked.current.delete(id);
          return;
        }
        try {
          const res = await fetchReturnCarrierStatus(todo.slice(i, i + RETURN_CARRIER_BATCH));
          setById((prev) => ({ ...prev, ...res.items }));
        } catch {
          // Lỗi mạng / backend bản cũ: ô giữ "Chưa có tin từ hãng", 10 phút sau mới hỏi lại.
          const failed = Object.fromEntries(
            todo.slice(i, i + RETURN_CARRIER_BATCH).map((id) => [id, { status: "error" } as const])
          );
          setById((prev) => ({ ...prev, ...failed }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [needKey]);

  return byId;
}

/** Mốc mới nhất của hãng: "giờ · nguyên văn", tối đa hai dòng (rê chuột xem đủ). */
function LatestLine({ latest }: { latest: { at: string | null; description: string } }) {
  const text = `${latest.at ? `${formatDateTime(latest.at)} · ` : ""}${latest.description}`;
  return (
    <p className={cn(TEXT_SUB, "mt-0.5 line-clamp-2")} title={text}>
      {text}
    </p>
  );
}

export function ReturnShippingCell({
  order,
  carrier,
}: {
  order: ReturnRow;
  /** Kết quả hỏi hãng của đơn này; undefined = chưa hỏi / đang hỏi / không thuộc diện hỏi. */
  carrier?: ReturnCarrierStatus;
}) {
  const s = order.returnShipping;
  if (!s) return <span className={TEXT_SUB}>—</span>;

  const lookup = needsCarrierLookup(order);
  const live = carrier?.status === "ok" ? carrier : null;
  const state: ReturnShippingState = live ? live.state : s.state;
  const meta = SHIPPING_META[state];
  const asking = lookup && !carrier;

  // Dòng phụ: AI nói kiện đã về và lúc nào; chưa về thì mốc mới nhất của hãng.
  let sub: string | null = null;
  if (state === "RETURNED") {
    if (live) sub = live.at ? `Hãng báo ${formatDateTime(live.at)}` : "Hãng báo đã trả kiện";
    else if (s.source === "platform") sub = s.at ? `Sàn báo ${formatDateTime(s.at)}` : "Sàn báo kiện đã về shop";
    else sub = s.at ? `Kho nhận ${formatDateTime(s.at)}` : "Kho đã nhận";
  } else if (!live) {
    if (state === "RETURNING") sub = "Sàn chưa báo kiện về tới";
    else if (s.failedDelivery) sub = "Giao thất bại, kiện quay đầu";
  }

  // w-40 + cho xuống dòng: cột rộng cố định ~cột Khách hàng cũ, bảng không phình
  // thêm ở màn 1440 (ô bảng mặc định không xuống dòng).
  return (
    <div className="w-40 whitespace-normal">
      {asking ? (
        <p className="flex items-center gap-1.5 text-muted-foreground">
          <Loader2 className="size-3.5 shrink-0 animate-spin" />
          Đang hỏi hãng…
        </p>
      ) : (
        <p className={cn("flex items-center gap-1.5 font-medium", meta.text)}>
          <span className={cn("size-2 shrink-0 rounded-full", meta.dot)} />
          {meta.label}
        </p>
      )}
      {sub && <p className={cn(TEXT_SUB, "mt-0.5")}>{sub}</p>}
      {live && live.state !== "RETURNED" && live.latest && <LatestLine latest={live.latest} />}
      {/* Ca cần đối soát nhất: hãng / sàn nói kiện đã trả về mà kho chưa quét nhận. */}
      {state === "RETURNED" && order.returnStatus === "AWAITING" && (
        <p className={cn(TEXT_SUB, "mt-0.5 font-medium text-red-500")}>Kho chưa quét nhận</p>
      )}
    </div>
  );
}
