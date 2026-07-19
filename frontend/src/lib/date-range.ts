/**
 * KHOẢNG THỜI GIAN BÁO CÁO — nguồn chân lý dùng chung
 *
 * Mọi trang báo cáo đều dùng cùng một kiểu dữ liệu và cùng cặp query param
 * `?from=&to=`, nên thêm bộ lọc cho một module mới sau này chỉ là việc cắm
 * <DateRangePicker> vào và truyền range xuống hàm gọi API.
 *
 * Ngày ở đây luôn là ngày theo LỊCH ĐỊA PHƯƠNG của người dùng, không phải UTC.
 * Dùng toDateKey() thay cho toISOString() — toISOString() đổi sang UTC nên ở
 * múi giờ Việt Nam (UTC+7) sẽ lùi mất một ngày với các mốc đầu ngày.
 */

export interface DateRange {
  from: Date;
  to: Date;
}

/** Date → "yyyy-mm-dd" theo lịch địa phương (KHÔNG dùng toISOString). */
export function toDateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Date → "dd/mm/yyyy" để hiển thị cho người Việt. */
export function formatDayVN(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Hai Date có cùng một ngày trên lịch không? */
export function isSameDay(a: Date, b: Date): boolean {
  return toDateKey(a) === toDateKey(b);
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export interface RangePreset {
  key: string;
  label: string;
  /** Tính khoảng ngày tại thời điểm bấm (không cache, để qua nửa đêm vẫn đúng) */
  resolve: () => DateRange;
}

/**
 * Các phím chọn nhanh. Nhận `now` để test được và để mọi preset trong cùng một
 * lần bấm đều dựa trên một mốc thời gian thống nhất.
 */
export function buildPresets(now: () => Date = () => new Date()): RangePreset[] {
  return [
    {
      key: "today",
      label: "Hôm nay",
      resolve: () => {
        const t = startOfDay(now());
        return { from: t, to: t };
      },
    },
    {
      key: "yesterday",
      label: "Hôm qua",
      resolve: () => {
        const y = addDays(startOfDay(now()), -1);
        return { from: y, to: y };
      },
    },
    {
      key: "last7",
      label: "7 ngày qua",
      resolve: () => {
        const t = startOfDay(now());
        return { from: addDays(t, -6), to: t };
      },
    },
    {
      key: "last30",
      label: "30 ngày qua",
      resolve: () => {
        const t = startOfDay(now());
        return { from: addDays(t, -29), to: t };
      },
    },
    {
      key: "thisMonth",
      label: "Tháng này",
      resolve: () => {
        const t = startOfDay(now());
        return { from: new Date(t.getFullYear(), t.getMonth(), 1), to: t };
      },
    },
    {
      key: "lastMonth",
      label: "Tháng trước",
      resolve: () => {
        const t = startOfDay(now());
        return {
          from: new Date(t.getFullYear(), t.getMonth() - 1, 1),
          // Ngày 0 của tháng này = ngày cuối tháng trước
          to: new Date(t.getFullYear(), t.getMonth(), 0),
        };
      },
    },
  ];
}

export const RANGE_PRESETS = buildPresets();

/** Khoảng mặc định khi mở trang: 30 ngày qua. */
export function defaultRange(): DateRange {
  return RANGE_PRESETS.find((p) => p.key === "last30")!.resolve();
}

/** Nếu range trùng khít một preset thì trả về preset đó (để hiện nhãn đẹp). */
export function matchPreset(range: DateRange): RangePreset | undefined {
  return RANGE_PRESETS.find((p) => {
    const r = p.resolve();
    return isSameDay(r.from, range.from) && isSameDay(r.to, range.to);
  });
}

/** Nhãn hiển thị trên nút: ưu tiên tên preset, không khớp thì hiện dd/mm/yyyy. */
export function formatRangeLabel(range: DateRange): string {
  const preset = matchPreset(range);
  if (preset) return preset.label;
  if (isSameDay(range.from, range.to)) return formatDayVN(range.from);
  return `${formatDayVN(range.from)} - ${formatDayVN(range.to)}`;
}

/** Đổi range thành query param cho API. Dùng chung cho mọi endpoint báo cáo. */
export function rangeToQuery(range?: DateRange): Record<string, string> {
  if (!range) return {};
  return { from: toDateKey(range.from), to: toDateKey(range.to) };
}
