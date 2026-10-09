"use client";

import Link from "next/link";

import { CopyIconButton } from "@/components/ui/copy-icon-button";
import { CHANNEL_META } from "@/lib/channel-meta";
import type { ChannelName } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { OrderRef, OrderRefs } from "@/components/dashboard/command-center/types";

/**
 * CHIP MÃ ĐƠN đính kèm cảnh báo / dòng nhật ký vận hành (anh Trung 09/10/2026:
 * "thông báo kiểu này phải kèm mã đơn và nút sao chép — khách hỏi đơn nào, xem
 * ở đâu"). Một component cho cả thẻ cảnh báo lẫn nhật ký:
 *   · huy hiệu sàn + mã đơn TRÊN SÀN (font mono) — bấm mã mở trang Đơn hàng đã
 *     điền sẵn mã vào ô tìm kiếm;
 *   · nút sao chép nằm NGOÀI vùng link (điểm 6 khẩu vị bảng số liệu);
 *   · quá `max` mã thì "+N đơn khác" dẫn tới trang xử lý của cảnh báo;
 *   · rê chuột lên mã thấy tên gian + số tiền của đơn đó.
 */
export function OrderRefChips({
  orderRefs,
  max,
  className,
}: {
  orderRefs: OrderRefs;
  /** Số mã in ra — thẻ lẫn nhật ký đều 3 (anh Trung 09/10), backend cũng chỉ gửi 3. */
  max: number;
  className?: string;
}) {
  const shown = orderRefs.refs.slice(0, max);
  if (shown.length === 0) return null;
  const rest = Math.max(0, orderRefs.refTotal - shown.length);

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {shown.map((r) => (
        <OrderRefChip key={`${r.channelName}-${r.code}`} r={r} />
      ))}
      {rest > 0 &&
        (orderRefs.href ? (
          <Link
            href={orderRefs.href}
            className="text-[11px] font-medium text-emerald-700 hover:underline"
            title={orderRefs.label}
          >
            +{rest} đơn khác
          </Link>
        ) : (
          <span className="text-[11px] text-muted-foreground">+{rest} đơn khác</span>
        ))}
    </div>
  );
}

function OrderRefChip({ r }: { r: OrderRef }) {
  const meta = CHANNEL_META[r.channelName as ChannelName];
  const shop = r.shopName ? ` · ${r.shopName}` : "";
  const tip = `${meta?.label ?? r.channelName}${shop}\n${formatVnd(r.amount)}`;
  return (
    <span
      className="inline-flex max-w-full items-center gap-1 rounded-md border bg-muted/40 py-0.5 pl-1 pr-0.5 font-mono text-[11px] text-foreground"
      title={tip}
    >
      {meta && (
        <span
          className={cn(
            "rounded px-1 font-sans text-[9px] font-bold uppercase leading-4",
            meta.className
          )}
        >
          {meta.label}
        </span>
      )}
      <Link
        href={`/orders?q=${encodeURIComponent(r.code)}`}
        className="min-w-0 truncate hover:underline"
      >
        {r.code}
      </Link>
      <CopyIconButton value={r.code} what="mã đơn" className="size-4" />
    </span>
  );
}

function formatVnd(n: number): string {
  return `${Math.round(n).toLocaleString("vi-VN")}₫`;
}

/**
 * Đọc {refs, refTotal, href, label} từ JSON backend (payload thẻ hoặc meta nhật
 * ký). Thiếu / sai kiểu → null, giao diện chỉ in chữ như trước — dòng cũ không
 * có meta và payload của cảnh báo không phải đơn hàng đều đi nhánh này. Bản ghi
 * cũ có thể mang nhiều hơn 3 mã → `max` ở component vẫn cắt.
 */
export function parseOrderRefs(raw: unknown): OrderRefs | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { refs?: unknown; refTotal?: unknown; href?: unknown; label?: unknown };
  if (!Array.isArray(o.refs)) return null;
  const refs: OrderRef[] = [];
  for (const x of o.refs) {
    if (!x || typeof x !== "object") continue;
    const r = x as Partial<OrderRef>;
    if (typeof r.code !== "string" || !r.code) continue;
    refs.push({
      code: r.code,
      channelName: typeof r.channelName === "string" ? r.channelName : "",
      shopName: typeof r.shopName === "string" ? r.shopName : null,
      amount: typeof r.amount === "number" ? r.amount : Number(r.amount ?? 0) || 0,
    });
  }
  if (refs.length === 0) return null;
  return {
    refs,
    refTotal:
      typeof o.refTotal === "number" && o.refTotal >= refs.length ? o.refTotal : refs.length,
    href: typeof o.href === "string" ? o.href : undefined,
    label: typeof o.label === "string" ? o.label : undefined,
  };
}
