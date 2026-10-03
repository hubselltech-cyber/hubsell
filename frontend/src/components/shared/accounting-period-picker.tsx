"use client";

import * as React from "react";
import { vi } from "date-fns/locale";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import type { DateRange as DayPickerRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  detectPeriod,
  formatPeriodLabel,
  monthPeriod,
  parseDateKey,
  quarterPeriod,
  shiftPeriod,
  yearPeriod,
  type AccountingPeriodKind,
} from "@/lib/accounting-period";
import { toDateKey, type DateRange } from "@/lib/date-range";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * BỘ CHỌN KỲ KẾ TOÁN — Tháng / Quý / Năm / Tùy chỉnh.
 *
 * Dành cho các trang sổ sách (sổ quỹ, bảng kê): kế toán chốt theo kỳ chứ không
 * theo "7 ngày qua". Trang báo cáo bán hàng vẫn dùng <DateRangePicker>.
 *
 * Quy ước tương tác:
 *  - Hai mũi tên cạnh nút: lùi/tiến MỘT kỳ cùng loại (tháng → tháng kề, quý →
 *    quý kề…) mà không phải mở hộp chọn.
 *  - Tháng / Quý / Năm: bấm ô nào áp dụng NGAY ô đó và đóng.
 *  - Tùy chỉnh: gõ hai mốc ngày hoặc bấm trên lịch, rồi bấm "Áp dụng" — chưa
 *    bấm thì sổ phía dưới chưa tải lại.
 * Cho chọn cả kỳ tương lai: checklist chi cố định cần xem trước tháng sau.
 */
interface AccountingPeriodPickerProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  disabled?: boolean;
  className?: string;
}

const KIND_TABS: [AccountingPeriodKind, string][] = [
  ["month", "Tháng"],
  ["quarter", "Quý"],
  ["year", "Năm"],
  ["custom", "Tùy chỉnh"],
];

/** Số năm trên một trang của tab Năm. */
const YEARS_PER_PAGE = 6;

export function AccountingPeriodPicker({
  value,
  onChange,
  disabled,
  className,
}: AccountingPeriodPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [kind, setKind] = React.useState<AccountingPeriodKind>("month");
  // Năm đang lật tới trong lưới tháng/quý (và năm cuối trang của tab Năm).
  const [viewYear, setViewYear] = React.useState(() => value.to.getFullYear());
  // Khoảng đang chọn dở ở tab Tùy chỉnh — tách khỏi `value` để chưa bấm Áp
  // dụng thì sổ phía dưới chưa tải lại.
  const [draft, setDraft] = React.useState<DayPickerRange | undefined>();
  // Tháng đang hiện ở khung trái của lịch — gõ mốc ngày thì lịch lật theo.
  const [calMonth, setCalMonth] = React.useState(() => value.from);

  const active = detectPeriod(value);
  const today = new Date();

  // Mở hộp thì đứng đúng tab + năm của kỳ đang xem.
  function handleOpenChange(next: boolean) {
    if (next) {
      setKind(active.kind);
      setViewYear(value.to.getFullYear());
      setDraft({ from: value.from, to: value.to });
      // Lùi 1 tháng để tháng chứa ngày kết thúc nằm ở khung bên phải
      setCalMonth(new Date(value.to.getFullYear(), value.to.getMonth() - 1, 1));
    }
    setOpen(next);
  }

  function apply(range: DateRange) {
    onChange(range);
    setOpen(false);
  }

  function handleCalendarSelect(
    range: DayPickerRange | undefined,
    clickedDay: Date
  ) {
    // Đang có khoảng hoàn chỉnh mà bấm tiếp = bắt đầu chọn lại từ đầu (cùng
    // quy ước với DateRangePicker), không nối vào khoảng cũ.
    if (draft?.from && draft.to) {
      setDraft({ from: clickedDay, to: undefined });
      return;
    }
    setDraft(range);
  }

  function handleDraftInput(side: "from" | "to", key: string) {
    const day = key ? parseDateKey(key) : undefined;
    setDraft((prev) => ({ from: prev?.from, to: prev?.to, [side]: day }));
    if (day) {
      // "Từ ngày" hiện ở khung trái, "Đến ngày" ở khung phải.
      setCalMonth(
        new Date(day.getFullYear(), day.getMonth() - (side === "to" ? 1 : 0), 1)
      );
    }
  }

  function applyDraft() {
    if (!draft?.from || !draft.to) return;
    // Gõ ngược (từ > đến) thì tự đảo thay vì báo lỗi.
    const [from, to] =
      draft.from <= draft.to ? [draft.from, draft.to] : [draft.to, draft.from];
    apply({ from, to });
  }

  const yearPageStart = viewYear - YEARS_PER_PAGE + 1;

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Button
        variant="outline"
        size="icon"
        disabled={disabled}
        title="Kỳ trước"
        aria-label="Kỳ trước"
        onClick={() => onChange(shiftPeriod(value, -1))}
      >
        <ChevronLeft className="size-4" />
      </Button>

      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          disabled={disabled}
          render={
            <Button variant="outline" className="gap-2 font-normal">
              <CalendarDays className="size-4 text-muted-foreground" />
              <span className="whitespace-nowrap">{formatPeriodLabel(value)}</span>
              <ChevronDown className="size-3.5 text-muted-foreground" />
            </Button>
          }
        />

        <PopoverContent
          align="end"
          className="w-auto max-w-[calc(100vw-2rem)] overflow-x-auto p-0"
        >
          {/* ── Hàng tab loại kỳ ── */}
          <div className="border-b p-2">
            <div className="flex gap-0.5 rounded-md bg-muted p-0.5">
              {KIND_TABS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={kind === key}
                  className={cn(
                    "h-7 flex-1 rounded-[5px] px-2.5 text-[0.8rem] whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                    kind === key
                      ? "bg-background font-medium text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  onClick={() => setKind(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {kind !== "custom" && (
            <div className="w-72 p-2">
              {/* ── Lật năm ── */}
              <div className="flex items-center justify-between pb-2">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={kind === "year" ? "Các năm trước" : "Năm trước"}
                  onClick={() =>
                    setViewYear((y) => y - (kind === "year" ? YEARS_PER_PAGE : 1))
                  }
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <p className="text-sm font-medium tabular-nums">
                  {kind === "year" ? `${yearPageStart} – ${viewYear}` : `Năm ${viewYear}`}
                </p>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={kind === "year" ? "Các năm sau" : "Năm sau"}
                  onClick={() =>
                    setViewYear((y) => y + (kind === "year" ? YEARS_PER_PAGE : 1))
                  }
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>

              {kind === "month" && (
                <div className="grid grid-cols-3 gap-1">
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
                    const selected =
                      active.kind === "month" &&
                      active.year === viewYear &&
                      active.month === m;
                    const isNow =
                      today.getFullYear() === viewYear && today.getMonth() + 1 === m;
                    return (
                      <Button
                        key={m}
                        variant={selected ? "default" : "ghost"}
                        size="sm"
                        className={cn(
                          "h-9 font-normal",
                          selected && "font-medium",
                          isNow && !selected && "border border-border"
                        )}
                        onClick={() => apply(monthPeriod(viewYear, m))}
                      >
                        Tháng {m}
                      </Button>
                    );
                  })}
                </div>
              )}

              {kind === "quarter" && (
                <div className="grid grid-cols-2 gap-1">
                  {[1, 2, 3, 4].map((q) => {
                    const selected =
                      active.kind === "quarter" &&
                      active.year === viewYear &&
                      active.quarter === q;
                    const isNow =
                      today.getFullYear() === viewYear &&
                      Math.floor(today.getMonth() / 3) + 1 === q;
                    return (
                      <Button
                        key={q}
                        variant={selected ? "default" : "ghost"}
                        className={cn(
                          "h-14 flex-col gap-0 font-normal",
                          isNow && !selected && "border border-border"
                        )}
                        onClick={() => apply(quarterPeriod(viewYear, q))}
                      >
                        <span className="text-sm font-medium">Quý {q}</span>
                        <span
                          className={cn(
                            "text-xs",
                            selected ? "text-primary-foreground/80" : "text-muted-foreground"
                          )}
                        >
                          Tháng {q * 3 - 2} – {q * 3}
                        </span>
                      </Button>
                    );
                  })}
                </div>
              )}

              {kind === "year" && (
                <div className="grid grid-cols-3 gap-1">
                  {Array.from({ length: YEARS_PER_PAGE }, (_, i) => yearPageStart + i).map(
                    (y) => {
                      const selected = active.kind === "year" && active.year === y;
                      const isNow = today.getFullYear() === y;
                      return (
                        <Button
                          key={y}
                          variant={selected ? "default" : "ghost"}
                          size="sm"
                          className={cn(
                            "h-9 font-normal tabular-nums",
                            selected && "font-medium",
                            isNow && !selected && "border border-border"
                          )}
                          onClick={() => apply(yearPeriod(y))}
                        >
                          {y}
                        </Button>
                      );
                    }
                  )}
                </div>
              )}
            </div>
          )}

          {kind === "custom" && (
            <div className="p-2">
              <div className="flex flex-wrap items-end gap-2 px-1 pb-2">
                <label className="grid gap-1">
                  <span className={TEXT_SUB}>Từ ngày</span>
                  <Input
                    type="date"
                    className="w-40"
                    value={draft?.from ? toDateKey(draft.from) : ""}
                    onChange={(e) => handleDraftInput("from", e.target.value)}
                  />
                </label>
                <label className="grid gap-1">
                  <span className={TEXT_SUB}>Đến ngày</span>
                  <Input
                    type="date"
                    className="w-40"
                    value={draft?.to ? toDateKey(draft.to) : ""}
                    onChange={(e) => handleDraftInput("to", e.target.value)}
                  />
                </label>
                <Button
                  className="ml-auto"
                  disabled={!draft?.from || !draft.to}
                  onClick={applyDraft}
                >
                  Áp dụng
                </Button>
              </div>
              <Calendar
                mode="range"
                locale={vi}
                numberOfMonths={2}
                month={calMonth}
                onMonthChange={setCalMonth}
                selected={draft}
                onSelect={handleCalendarSelect}
              />
              <p className={cn(TEXT_SUB, "border-t px-3 py-2")}>
                {draft?.from && !draft.to
                  ? "Đã chọn ngày bắt đầu — bấm tiếp ngày kết thúc rồi Áp dụng."
                  : "Gõ hai mốc ngày hoặc bấm trên lịch, rồi bấm Áp dụng."}
              </p>
            </div>
          )}
        </PopoverContent>
      </Popover>

      <Button
        variant="outline"
        size="icon"
        disabled={disabled}
        title="Kỳ sau"
        aria-label="Kỳ sau"
        onClick={() => onChange(shiftPeriod(value, 1))}
      >
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}
