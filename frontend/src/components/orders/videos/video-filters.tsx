"use client";

import { AlarmClock, PackageCheck, PackageX, VideoOff } from "lucide-react";

import { FilterCard } from "@/components/warehouse/returns-filters";
import type { PackVideoChip, PackVideoReturnCard } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * BỘ LỌC MỘT CHẠM của trang Video đóng hàng:
 *   1. VideoChips       — hàng chip có số đếm của tab Video đóng hàng;
 *   2. ReturnVideoCards — thẻ số to BẤM ĐƯỢC của tab Đơn hoàn (cùng kiểu thẻ lọc của trang
 *      Đối soát đơn hoàn: bấm để lọc, bấm lại để bỏ).
 * Trang giữ state; tệp này chỉ vẽ.
 */

const CHIPS: { key: Exclude<PackVideoChip, "all">; label: string; title: string }[] = [
  { key: "returns", label: "Đơn có hoàn", title: "Video của đơn đang có yêu cầu hoàn / trả hàng" },
  { key: "unmatched", label: "Chưa khớp đơn", title: "Tem đã quay nhưng chưa tìm ra đơn tương ứng" },
  { key: "pending", label: "Chưa tải lên xong", title: "Đã quay trên điện thoại nhưng tệp chưa lên kho" },
  // Chỉ hiện khi có số (chip 0 video tự ẩn) — tức là khi luật tự xóa đã gán hạn cho video.
  {
    key: "expiring",
    label: "Sắp tự xóa",
    title: "Hệ thống sẽ tự xóa trong 3 ngày tới (đơn đã qua hạn khiếu nại). Cần giữ thì tải về trước.",
  },
];

const CHIP_CLASS =
  "flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors";
const CHIP_ON = "border-primary bg-primary text-primary-foreground";
const CHIP_OFF = "bg-background text-muted-foreground hover:bg-muted hover:text-foreground";

/** Chip 0 video ẩn đi (trừ chip đang chọn) cho hàng lọc ngắn; trả về các chip rời để trang xếp hàng. */
export function VideoChips({
  value,
  onChange,
  counts,
}: {
  value: PackVideoChip;
  onChange: (next: PackVideoChip) => void;
  counts: Partial<Record<PackVideoChip, number>>;
}) {
  const all = counts.all ?? 0;
  return (
    <>
      <button
        type="button"
        aria-pressed={value === "all"}
        onClick={() => onChange("all")}
        className={cn(CHIP_CLASS, value === "all" ? CHIP_ON : CHIP_OFF)}
      >
        Tất cả
        {all > 0 && <span className="tabular-nums opacity-70">{formatNumber(all)}</span>}
      </button>
      {CHIPS.map((c) => {
        const active = value === c.key;
        const count = counts[c.key] ?? 0;
        if (count === 0 && !active) return null;
        return (
          <button
            key={c.key}
            type="button"
            aria-pressed={active}
            title={c.title}
            onClick={() => onChange(active ? "all" : c.key)}
            className={cn(CHIP_CLASS, active ? CHIP_ON : CHIP_OFF)}
          >
            {c.label}
            {count > 0 && <span className="tabular-nums opacity-70">{formatNumber(count)}</span>}
          </button>
        );
      })}
    </>
  );
}

/** Bốn thẻ lọc của tab Đơn hoàn — việc có hạn đứng đầu. Số trên thẻ không đổi theo thẻ đang chọn. */
export function ReturnVideoCards({
  value,
  onToggle,
  cards,
}: {
  value: PackVideoReturnCard;
  onToggle: (key: Exclude<PackVideoReturnCard, "all">) => void;
  cards: Partial<Record<PackVideoReturnCard, number>>;
}) {
  const hasPack = cards.has_pack ?? 0;
  const damaged = cards.damaged_no_unbox ?? 0;
  const noVideo = cards.no_video ?? 0;
  const dueSoon = cards.due_soon ?? 0;
  const card = (key: Exclude<PackVideoReturnCard, "all">) => ({
    active: value === key,
    onToggle: () => onToggle(key),
  });
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <FilterCard
        {...card("due_soon")}
        title="Sắp hết hạn khiếu nại"
        value={formatNumber(dueSoon)}
        icon={AlarmClock}
        tone={dueSoon > 0 ? "negative" : "neutral"}
        featured={dueSoon > 0}
        subtitle="Còn dưới 24 giờ để kiểm hàng / khiếu nại sàn"
      />
      <FilterCard
        {...card("has_pack")}
        title="Có hoàn · có video đóng"
        value={formatNumber(hasPack)}
        icon={PackageCheck}
        tone={hasPack > 0 ? "positive" : "neutral"}
        subtitle="Đơn hoàn đã có sẵn bằng chứng lúc đóng gói"
      />
      <FilterCard
        {...card("damaged_no_unbox")}
        title="Hàng hỏng · chưa có video khui"
        value={formatNumber(damaged)}
        icon={PackageX}
        tone={damaged > 0 ? "negative" : "neutral"}
        featured={damaged > 0}
        subtitle="Kho báo hỏng nhưng chưa quay lúc mở kiện"
      />
      <FilterCard
        {...card("no_video")}
        title="Không có video"
        value={formatNumber(noVideo)}
        icon={VideoOff}
        tone="warning"
        subtitle="Đơn hoàn chưa có video đóng lẫn video khui"
      />
    </div>
  );
}
