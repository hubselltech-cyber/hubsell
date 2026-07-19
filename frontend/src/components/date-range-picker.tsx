"use client";

import * as React from "react";
import { vi } from "date-fns/locale";
import { CalendarDays, ChevronDown } from "lucide-react";
import type { DateRange as DayPickerRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  RANGE_PRESETS,
  formatRangeLabel,
  matchPreset,
  type DateRange,
} from "@/lib/date-range";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * BỘ LỌC KHOẢNG THỜI GIAN DÙNG CHUNG
 *
 * Cắm vào góc phải trên của mọi trang báo cáo, cạnh nút "Làm mới".
 * Bố cục 2 vùng: cột trái là phím chọn nhanh, vùng phải là lịch kép 2 tháng
 * liền kề để chọn khoảng tuỳ ý mà không phải bấm mũi tên qua lại.
 *
 * Quy ước tương tác:
 *  - Bấm phím nhanh  → áp dụng NGAY và đóng popover.
 *  - Chọn lịch tay   → bấm ngày đầu (chưa áp dụng), bấm ngày cuối mới áp dụng.
 *    Đang chọn dở mà đóng popover thì huỷ, giữ nguyên khoảng cũ.
 */
export function DateRangePicker({
  value,
  onChange,
  disabled,
  className,
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  // Khoảng đang chọn dở trong lịch — tách khỏi `value` để chưa chọn xong
  // thì dữ liệu phía dưới chưa bị tải lại lung tung.
  const [draft, setDraft] = React.useState<DayPickerRange | undefined>();

  const activePreset = matchPreset(value);

  // Mở popover thì nạp lại khoảng hiện hành làm điểm xuất phát
  function handleOpenChange(next: boolean) {
    if (next) setDraft({ from: value.from, to: value.to });
    setOpen(next);
  }

  function applyRange(range: DateRange) {
    onChange(range);
    setOpen(false);
  }

  function handleCalendarSelect(
    range: DayPickerRange | undefined,
    clickedDay: Date
  ) {
    // Lịch mở ra với khoảng cũ đã được tô sẵn. Nếu cứ để mặc định, cú bấm ĐẦU
    // TIÊN sẽ nối vào khoảng cũ thành một khoảng hoàn chỉnh và áp dụng ngay với
    // ngày kết thúc mà người dùng chưa hề chọn. Nên khi đang có khoảng hoàn
    // chỉnh, cú bấm kế tiếp phải được hiểu là "bắt đầu chọn lại từ đầu".
    if (draft?.from && draft.to) {
      setDraft({ from: clickedDay, to: undefined });
      return;
    }

    setDraft(range);
    // Chỉ áp dụng khi đã có đủ ngày đầu và ngày cuối
    if (range?.from && range.to) {
      applyRange({ from: range.from, to: range.to });
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        disabled={disabled}
        render={
          <Button
            variant="outline"
            size="sm"
            className={cn("gap-2 font-normal", className)}
          >
            <CalendarDays className="size-4 text-muted-foreground" />
            <span className="font-medium">{formatRangeLabel(value)}</span>
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </Button>
        }
      />

      <PopoverContent align="end" className="w-auto max-w-[calc(100vw-2rem)] p-0">
        <div className="flex flex-col sm:flex-row">
          {/* ── Cột trái: phím chọn nhanh ── */}
          <div className="flex shrink-0 flex-col gap-0.5 border-b p-2 sm:w-40 sm:border-r sm:border-b-0">
            <p className={cn(TEXT_SUB, "px-2 pt-1 pb-2 font-medium uppercase")}>
              Chọn nhanh
            </p>
            {RANGE_PRESETS.map((preset) => {
              const active = activePreset?.key === preset.key;
              return (
                <Button
                  key={preset.key}
                  variant={active ? "secondary" : "ghost"}
                  size="sm"
                  className={cn(
                    "justify-start font-normal",
                    active && "font-medium"
                  )}
                  onClick={() => applyRange(preset.resolve())}
                >
                  {preset.label}
                </Button>
              );
            })}
          </div>

          {/* ── Vùng phải: lịch kép 2 tháng liền kề ── */}
          <div className="p-2">
            <Calendar
              mode="range"
              locale={vi}
              numberOfMonths={2}
              defaultMonth={
                // Mở ra ở tháng của ngày bắt đầu, nhưng lùi 1 tháng để tháng
                // chứa ngày kết thúc nằm ở khung bên phải
                new Date(
                  value.to.getFullYear(),
                  value.to.getMonth() - 1,
                  1
                )
              }
              selected={draft}
              onSelect={handleCalendarSelect}
              // Không cho chọn ngày tương lai — báo cáo chỉ có dữ liệu quá khứ
              disabled={{ after: new Date() }}
              autoFocus
            />
            <p className={cn(TEXT_SUB, "border-t px-3 py-2")}>
              {draft?.from && !draft.to
                ? "Đã chọn ngày bắt đầu — bấm tiếp ngày kết thúc."
                : "Bấm ngày bắt đầu rồi bấm ngày kết thúc để lọc tuỳ ý."}
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
