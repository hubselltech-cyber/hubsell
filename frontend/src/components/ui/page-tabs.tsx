import type { ReactNode } from "react";

import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * THANH TAB CẤP TRANG — đo theo YouTube Studio 19/09/2026.
 *
 * Studio: chữ tab 16px/500 (thân trang 14px), tab cao 48px, nhãn cách nhau
 * 40px, CHƯA chọn #606060 → đang chọn #0f0f0f, vạch chọn 2px bo tròn rộng
 * ĐÚNG BẰNG NHÃN (không ăn ra phần đệm), đường kẻ đáy chạy suốt bề ngang vùng
 * nội dung. Bản viết tay cũ của Hubsell (14px, cao 41, vạch ăn cả đệm px-4,
 * đường kẻ chỉ dài bằng nội dung trên nền slate-50) cùng cỡ + cùng màu với
 * dòng mô tả ngay phía trên nên thanh tab chìm vào trang.
 *
 * Hubsell dùng 15px thay vì 16: Inter rộng hơn Roboto ~6%, 15px Inter cho bề
 * ngang nhãn tương đương 16px Roboto — 6 tab có số đếm của trang Đơn hàng vẫn
 * vừa một hàng ở 1280px.
 */
export type PageTabItem<K extends string> = {
  key: K;
  label: ReactNode;
  /** Số đếm cạnh nhãn; undefined hoặc 0 thì không hiện. */
  count?: number;
  /**
   * "attention" = số việc ĐANG CHỜ khách xử lý (viên hổ phách đặc) — khác số
   * đếm thường chỉ là thông tin (viên xám dịu).
   */
  countTone?: "neutral" | "attention";
  countTitle?: string;
};

export function PageTabs<K extends string>({
  tabs,
  value,
  onChange,
  ariaLabel,
  trailing,
  className,
}: {
  tabs: readonly PageTabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  ariaLabel: string;
  /** Thông tin phụ ghim mép phải hàng tab (vd. mốc cập nhật số liệu). */
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      // Điện thoại: một hàng cuộn ngang (6 tab xuống dòng = 4 hàng × 48px, quá
      // cao). Từ sm: xuống dòng như cũ, không giấu tab sau thanh cuộn.
      className={cn(
        "flex gap-x-8 overflow-x-auto overflow-y-hidden border-b [scrollbar-width:none] sm:flex-wrap sm:overflow-visible",
        className
      )}
    >
      {tabs.map((t) => {
        const active = value === t.key;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            className={cn(
              // Cỡ chữ tab luôn HƠN ô nhập một bậc: Input / NativeSelect là
              // 14px ở laptop và nở 16px từ 2xl — tab đứng yên thì ở màn PC lớn
              // chữ trong ô tìm kiếm to hơn tiêu đề tab, tab bị lép (anh Trung 19/09).
              "group relative -mb-px flex h-12 shrink-0 items-center whitespace-nowrap gap-2 text-[15px] font-medium transition-colors 2xl:text-[17px]",
              active
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span
                title={t.countTitle}
                className={cn(
                  // Viên đếm của tab đang chọn = đen đặc như bản cũ (anh Trung
                  // 19/09 xem prod: viên xám dịu làm mất điểm nhấn — giữ như cũ).
                  "rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums",
                  t.countTone === "attention"
                    ? "bg-amber-500 text-white"
                    : active
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                )}
              >
                {formatNumber(t.count)}
              </span>
            )}
            {/* Vạch chọn rộng đúng bằng nhãn, bo hai góc trên; hover hiện vạch mờ */}
            <span
              aria-hidden
              className={cn(
                "absolute inset-x-0 bottom-0 h-[3px] rounded-t-[3px] transition-colors",
                active ? "bg-primary" : "bg-transparent group-hover:bg-border"
              )}
            />
          </button>
        );
      })}
      {trailing && <div className="ml-auto flex shrink-0 items-center">{trailing}</div>}
    </div>
  );
}

/**
 * DẢI ĐẦU TRANG — nền trắng tràn mép, dính liền thanh header, chứa dòng mô tả
 * + nút hành động + PageTabs. Studio tách "vùng tiêu đề" (tiêu đề + tab, kẻ đáy
 * suốt trang) khỏi "vùng nội dung"; Hubsell có sẵn nền trang slate-50 nên dải
 * trắng này tách vùng còn rõ hơn Studio mà không thêm màu nào.
 *
 * Margin âm phải khớp padding của <main> trong app-shell.tsx
 * (px-4 py-5 md:px-6 md:py-6 lg:px-8) — đổi bên đó thì đổi ở đây.
 * PageTabs đặt cuối dải, truyền className="border-b-0" để dùng chung đường kẻ
 * đáy của dải.
 */
export function PageHeaderBand({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "-mx-4 -mt-5 border-b bg-card px-4 pt-4 md:-mx-6 md:-mt-6 md:px-6 lg:-mx-8 lg:px-8",
        className
      )}
    >
      {children}
    </div>
  );
}
