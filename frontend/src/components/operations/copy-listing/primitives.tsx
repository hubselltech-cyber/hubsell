"use client";

// ============================================================
// SAO CHÉP SẢN PHẨM — mảnh giao diện nhỏ dùng chung (viên nhãn, ảnh thu nhỏ, chân
// trang, nhãn ô nhập) + hằng class của bảng đợt.
// ============================================================

import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { CHANNEL_META } from "@/lib/channel-meta";
import type { ChannelName } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { TEXT_SUB, TEXT_TABLE_HEAD } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * Phân tầng vùng đang làm việc trong bảng đợt (anh góp ý "giao diện phẳng, khó nhìn khi
 * một sản phẩm đi nhiều gian"): dòng đang mở + khung sửa cùng nhận vạch trái accent
 * (`border-l-primary` → tự theo 3 theme) trên nền slate-100; khung sửa là thẻ trắng
 * nổi bên trong để tách khỏi các dòng gian không làm.
 */
export const ROW_ACTIVE = "border-l-[3px] border-l-primary bg-slate-100/80 hover:bg-slate-100/80";
/**
 * whitespace-normal: ô bảng mặc định nowrap → mọi dòng dài trong khung sửa (17 màu, ghi chú) phải
 * xuống dòng, không vẽ tràn ra ngoài làm bảng đợt sinh cuộn ngang (soi 30/10 ở 1280: tràn 555px).
 */
export const PANEL_CELL = "p-3 pl-9 whitespace-normal";
export const PANEL = "rounded-xl border border-slate-200/80 bg-card p-5 shadow-sm whitespace-normal";
/** Nút hành động phụ màu xanh (lấy sản phẩm mới từ sàn) — anh chốt 30/10: sang phải, màu xanh. */
export const ACTION_GREEN = "bg-emerald-600 text-white hover:bg-emerald-700";
/** Nút sửa cần khách bấm — đỏ đặc theo mẫu nút đặc của hệ (bg-*-600 + hover 700, dark giữ 600). */
export const EDIT_BTN_RED = "bg-red-600 text-white hover:bg-red-700";
/** Ô nhập còn thiếu / chưa chuẩn — viền + nền vàng nhạt (đồng bộ chip Còn thiếu). */
export const WARN_INPUT = "border-amber-300 bg-amber-50/40";
/** Ô nhập sai hẳn (mã SKU lỗi) — đỏ. */
export const BAD_INPUT = "border-red-300 bg-red-50/40";

/** Số bước tròn + tiêu đề — anh chốt 30/10 ("giao diện phẳng, xấu"): tiêu đề bước phải có điểm nhấn. */
export function StepTitle({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-[12px] font-semibold text-primary-foreground tabular-nums">
        {n}
      </span>
      <span className="text-[15px] font-semibold text-slate-900">{children}</span>
    </div>
  );
}

export function ChannelChip({ channelName, className }: { channelName: ChannelName; className?: string }) {
  const meta = CHANNEL_META[channelName];
  return (
    <span className={cn("inline-flex rounded-md border px-1.5 py-0.5 text-[11px] font-medium", meta.className, className)}>
      {meta.label}
    </span>
  );
}

export function StatusChip({ label, className }: { label: string; className: string }) {
  return <span className={cn("inline-flex rounded-md border px-2 py-0.5 text-xs font-medium", className)}>{label}</span>;
}

export function Thumb({ src, alt, size = "size-10" }: { src: string | null; alt: string; size?: string }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className={cn("shrink-0 rounded-md border border-slate-200 object-cover", size)} />
  ) : (
    <div className={cn("shrink-0 rounded-md border border-dashed border-slate-200 bg-slate-50", size)} />
  );
}

/** Viên "Bắt buộc": đỏ = sàn từ chối nếu trống; vàng = ghi chú phạm vi ("Bắt buộc 3 sàn", "Lazada bắt buộc"). */
export function RequiredPill({ tone = "red", children = "Bắt buộc" }: { tone?: "red" | "amber"; children?: React.ReactNode }) {
  return (
    <span
      className={cn(
        "rounded px-1 py-px text-[10px] font-medium normal-case tracking-normal",
        tone === "red" ? "border border-rose-200 bg-rose-50 text-red-500" : "bg-amber-50 text-amber-700"
      )}
    >
      {children}
    </span>
  );
}

/**
 * Nhãn ô nhập: chữ nhãn + phần phụ (đếm ký tự, trần, ghi chú) cùng dòng, xuống dòng khi hẹp.
 * `warn` → phần phụ vàng (quá trần / còn thiếu).
 */
export function FieldLabel({
  label,
  meta,
  warn,
  className,
  children,
}: {
  label: React.ReactNode;
  meta?: React.ReactNode;
  warn?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn(TEXT_TABLE_HEAD, "flex flex-wrap items-center gap-x-2 gap-y-0.5", className)}>
      <span>{label}</span>
      {meta != null && meta !== false && <span className={cn("font-normal tabular-nums", warn ? "text-amber-700" : "text-slate-500")}>{meta}</span>}
      {children}
    </div>
  );
}

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

/** Chân bảng: trái = số dòng/trang + tổng, phải = Trang x/y Trước · Sau — luôn hiện. */
export function PagerFooter({
  page,
  pageCount,
  pageSize,
  total,
  onPage,
  onPageSize,
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
  onPageSize?: (n: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        {onPageSize && (
          <>
            <span className={TEXT_SUB}>Hiển thị</span>
            <NativeSelect className="w-32" value={String(pageSize)} onChange={(e) => onPageSize(Number(e.target.value))}>
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n} / trang
                </option>
              ))}
            </NativeSelect>
          </>
        )}
        <span className={cn(TEXT_SUB, "tabular-nums")}>Tổng {formatNumber(total)} sản phẩm</span>
      </div>
      <div className="flex items-center gap-2">
        <span className={cn(TEXT_SUB, "tabular-nums")}>
          Trang {page}/{pageCount}
        </span>
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Trước
        </Button>
        <Button size="sm" variant="outline" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
          Sau
        </Button>
      </div>
    </div>
  );
}
