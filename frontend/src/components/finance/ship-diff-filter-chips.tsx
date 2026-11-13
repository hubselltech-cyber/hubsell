import { cn } from "@/lib/utils";

/**
 * Hàng chip lọc một chạm của rổ Truy thu phí ship — dùng chung cho bảng Theo đơn (chip in số đơn) và
 * bảng Theo sản phẩm (chip in tiền rút gọn). Chấm màu: teal = ca khiếu nại được, xám = shop chịu theo
 * chính sách sàn, hổ phách = nên kiểm tra.
 */
export interface ShipDiffFilterChip<K extends string> {
  key: K;
  label: string;
  /** Con số in mờ sau nhãn (số đơn hoặc tiền rút gọn). */
  value: string;
  title?: string;
  dot?: "claimable" | "policy" | "warn";
}

const DOT_CLASS = { claimable: "bg-teal-500", policy: "bg-slate-400", warn: "bg-amber-500" } as const;

export function ShipDiffFilterChips<K extends string>({
  chips,
  value,
  onChange,
  ariaLabel,
}: {
  chips: ShipDiffFilterChip<K>[];
  value: K;
  onChange: (key: K) => void;
  ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap items-center gap-1.5">
      {chips.map((c) => {
        const active = value === c.key;
        return (
          <button
            key={c.key || "all"}
            type="button"
            role="radio"
            aria-checked={active}
            title={c.title}
            onClick={() => onChange(c.key)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-slate-200 bg-card text-slate-600 hover:border-slate-300 hover:text-slate-900"
            )}
          >
            {c.dot && <span className={cn("size-1.5 rounded-full", active ? "bg-current opacity-70" : DOT_CLASS[c.dot])} aria-hidden />}
            {c.label}
            <span className={cn("tabular-nums", active ? "opacity-80" : "text-slate-400")}>{c.value}</span>
          </button>
        );
      })}
    </div>
  );
}
