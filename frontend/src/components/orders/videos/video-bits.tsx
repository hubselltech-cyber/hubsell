"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, ImageIcon } from "lucide-react";

import { shopOnlyName } from "@/components/shared/channel-filter";
import { Button } from "@/components/ui/button";
import { CopyIconButton } from "@/components/ui/copy-icon-button";
import { NativeSelect } from "@/components/ui/native-select";
import type { ChannelName, PackVideoOrderItem } from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { PRODUCT_NAME_CLAMP, TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * MẢNH NHỎ DÙNG CHUNG của trang Video đóng hàng: huy hiệu sàn, mã có nút chép,
 * viên nhãn, ô sản phẩm gọn, thanh chuyển trang theo con trỏ.
 */

/** Các mức số dòng mỗi trang — đồng bộ với trang Đơn hàng và Đối soát đơn hoàn. */
export const VIDEO_PAGE_SIZES = [20, 50, 100];

const BADGE_CLASS = "inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium";

/** Viên nhãn trạng thái (cặp nền nhạt + chữ đậm theo thang màu của dự án). */
export function MetaBadge({
  meta,
  title,
}: {
  meta: { label: string; className: string } | undefined;
  title?: string;
}) {
  if (!meta) return null;
  return (
    <span title={title} className={cn(BADGE_CLASS, meta.className)}>
      {meta.label}
    </span>
  );
}

/** Huy hiệu sàn — cùng kiểu trang Đơn hàng. */
export function ChannelBadge({ platform }: { platform: ChannelName | null }) {
  if (!platform) return null;
  const meta = CHANNEL_META[platform];
  if (!meta) return null;
  return <span className={cn(BADGE_CLASS, meta.className)}>{meta.label}</span>;
}

/** Tên gian đã bỏ tiền tố sàn (huy hiệu đứng cạnh đã nói sàn nào). */
export function shopNameOf(platform: ChannelName | null, shopName: string | null): string {
  if (!shopName) return "";
  return platform ? shopOnlyName(platform, shopName) || shopName : shopName;
}

/** Mã định danh dài (mã vận đơn, mã đơn) chữ đều nét + nút chép một chạm. */
export function CodeWithCopy({
  value,
  what,
  strong,
}: {
  value: string | null;
  /** Tên đối tượng cho tooltip nút chép, vd "mã vận đơn". */
  what: string;
  strong?: boolean;
}) {
  if (!value) return <span className={TEXT_SUB}>—</span>;
  return (
    <span className="inline-flex max-w-full items-center gap-1">
      <span className={cn("truncate font-mono", strong ? "text-sm font-semibold text-slate-900" : "text-xs text-slate-500")} title={value}>
        {value}
      </span>
      <CopyIconButton value={value} what={what} />
    </span>
  );
}

function ItemThumb({ item }: { item: PackVideoOrderItem }) {
  if (!item.imageUrl) {
    return (
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <ImageIcon className="size-4" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={item.imageUrl} alt="" className="size-9 shrink-0 rounded-md object-cover ring-1 ring-foreground/10" />
  );
}

function ItemLine({ item }: { item: PackVideoOrderItem }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <ItemThumb item={item} />
      <div className="min-w-0 flex-1">
        <p className={PRODUCT_NAME_CLAMP} title={item.name}>
          {item.name}
        </p>
        {item.variantName && (
          <p className={cn(TEXT_SUB, PRODUCT_NAME_CLAMP)} title={item.variantName}>
            {item.variantName}
          </p>
        )}
      </div>
      <span className="shrink-0 font-semibold tabular-nums">×{item.quantity}</span>
    </div>
  );
}

/**
 * Sản phẩm của đơn, bản gọn: luôn hiện dòng đầu, các dòng sau gấp sau nút "+N sản phẩm
 * khác" (cùng cách trang Đơn hàng) để mọi dòng bảng cao gần bằng nhau. `expanded` = trang
 * hồ sơ, hiện hết.
 */
export function VideoProductsCell({
  items,
  expanded = false,
}: {
  items: PackVideoOrderItem[];
  expanded?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  if (items.length === 0) return <span className={TEXT_SUB}>—</span>;
  const showAll = expanded || open;
  const shown = showAll ? items : items.slice(0, 1);
  const rest = items.length - 1;
  return (
    <div className="min-w-0 space-y-2">
      {shown.map((item, i) => (
        <ItemLine key={i} item={item} />
      ))}
      {!expanded && rest > 0 && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-xs font-medium text-sky-700 underline-offset-2 hover:underline"
        >
          {open ? "Thu gọn" : `+${rest} sản phẩm khác`}
        </button>
      )}
    </div>
  );
}

/**
 * Thanh chuyển trang cho danh sách phân trang bằng CON TRỎ: máy chủ không trả tổng số
 * trang, nên chỉ có số trang đang xem + Trang trước / Trang sau (cùng nút, cùng chỗ với
 * trang Đơn hàng).
 */
export function CursorPager({
  page,
  pageSize,
  onPageSize,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  busy,
  unit,
}: {
  /** Số trang đang xem, bắt đầu từ 1. */
  page: number;
  pageSize: number;
  onPageSize: (n: number) => void;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  busy: boolean;
  /** "video" hoặc "đơn". */
  unit: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Hiển thị</span>
        <NativeSelect
          className="w-20"
          aria-label={`Số ${unit} mỗi trang`}
          value={String(pageSize)}
          onChange={(e) => onPageSize(Number(e.target.value))}
        >
          {VIDEO_PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </NativeSelect>
        <span className="text-sm text-muted-foreground">
          {unit}/trang · trang {page}
        </span>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={!hasPrev || busy} onClick={onPrev}>
          <ChevronLeft className="size-4" />
          Trang trước
        </Button>
        <Button variant="outline" size="sm" disabled={!hasNext || busy} onClick={onNext}>
          Trang sau
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

/**
 * Trạng thái phân trang bằng con trỏ: giữ chồng con trỏ đã đi qua để lùi được.
 * `resetKey` đổi (đổi bộ lọc, đổi cỡ trang) thì tự về trang đầu.
 */
export function useCursorPages(resetKey: string) {
  const [state, setState] = React.useState<{ key: string; stack: string[] }>({ key: resetKey, stack: [] });
  // Bộ lọc đổi → chồng cũ không còn nghĩa; tính ngay lúc vẽ để không gọi API với con trỏ của bộ lọc trước.
  const stack = state.key === resetKey ? state.stack : [];
  return {
    cursor: stack.length > 0 ? stack[stack.length - 1] : undefined,
    page: stack.length + 1,
    hasPrev: stack.length > 0,
    next: (cursor: string) => setState({ key: resetKey, stack: [...stack, cursor] }),
    prev: () => setState({ key: resetKey, stack: stack.slice(0, -1) }),
  };
}
