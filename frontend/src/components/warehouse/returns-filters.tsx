"use client";

import {
  ArrowDown,
  ArrowUp,
  PackageCheck,
  PackageOpen,
  PackageSearch,
  PackageX,
  Timer,
} from "lucide-react";

import {
  DashboardCard,
  type DashboardCardProps,
} from "@/components/dashboard/dashboard-card";
import type { ReturnShippingFilter } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * BA BỘ ĐIỀU KHIỂN DANH SÁCH của Đối soát đơn hoàn (anh Trung chốt 13/11/2026 tối):
 *   1. ReturnStatusCards   — các thẻ số to, BẤM ĐƯỢC = bộ lọc tình trạng kho;
 *   2. ReturnShippingChips — hàng chip = bộ lọc Trạng thái vận chuyển;
 *   3. ReturnSortToggle    — mũi tên nền tròn ở tiêu đề cột Thời gian chờ.
 * Trang (app/warehouse/returns/page.tsx) giữ state; tệp này chỉ vẽ.
 */

/** Giá trị bộ lọc tình trạng kho — khớp tham số `status` của GET /api/warehouse/returns. */
export type ReturnStatusFilter =
  | ""
  | "AWAITING"
  | "RECEIVED"
  | "OVERDUE"
  | "ISSUES"
  | "RECEIVED_INTACT";

/** Nhóm trạng thái của thẻ Hàng hỏng · khiếu nại sàn — khớp filter ISSUES ở backend. */
const ISSUE_KEYS = ["DAMAGED", "CLAIM_SETTLED", "WRITTEN_OFF"] as const;

/** Thẻ số bấm được. role="button" trên div vì thẻ chứa <p>/<div> (không hợp lệ trong <button>). */
function FilterCard({
  active,
  onToggle,
  ...card
}: DashboardCardProps & { active: boolean; onToggle: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={active}
      title={
        active
          ? "Đang lọc theo thẻ này — bấm lần nữa để bỏ lọc"
          : "Bấm để lọc danh sách theo thẻ này"
      }
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      className="h-full cursor-pointer rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <DashboardCard
        {...card}
        className={cn("transition-shadow hover:shadow-md", active && "ring-2 ring-primary")}
      />
    </div>
  );
}

/**
 * Các thẻ số = bộ lọc TÌNH TRẠNG KHO: bấm thẻ để lọc, bấm lại thẻ đang chọn để bỏ lọc.
 * Số trên thẻ không đổi theo thẻ / chip đang chọn. Năm cột từ 1400 px, hẹp hơn 3 / 2 cột
 * — viết 87.5rem chứ không 1400px: Tailwind xếp luật theo đơn vị, viết px thì luật lg:
 * đứng sau và thắng.
 */
export function ReturnStatusCards({
  value,
  onToggle,
  summary,
  overdueDays,
}: {
  value: ReturnStatusFilter;
  /** Bấm một thẻ; trang tự quyết bật hay bỏ lọc. */
  onToggle: (key: Exclude<ReturnStatusFilter, "">) => void;
  /** Số đếm theo trạng thái + `overdue` từ GET /api/warehouse/returns. */
  summary: Record<string, number>;
  overdueDays: number;
}) {
  const received = summary.RECEIVED ?? 0;
  const overdue = summary.overdue ?? 0;
  const damaged = summary.DAMAGED ?? 0;
  const issues = ISSUE_KEYS.reduce((sum, k) => sum + (summary[k] ?? 0), 0);
  const card = (key: Exclude<ReturnStatusFilter, "">) => ({
    active: value === key,
    onToggle: () => onToggle(key),
  });

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 min-[87.5rem]:grid-cols-5">
      <FilterCard
        {...card("AWAITING")}
        title="Chờ hàng về"
        value={formatNumber(summary.AWAITING ?? 0)}
        icon={PackageSearch}
        tone="warning"
        subtitle="Sàn đã báo hoàn, kho chưa quét nhận"
      />
      <FilterCard
        {...card("RECEIVED")}
        title="Đã nhận · chờ nhập kho"
        value={formatNumber(received)}
        icon={PackageOpen}
        tone={received > 0 ? "positive" : "neutral"}
        subtitle="Hàng đã về tay, chờ cộng lại tồn kho"
      />
      <FilterCard
        {...card("OVERDUE")}
        title={`Quá ${overdueDays} ngày chưa về`}
        value={formatNumber(overdue)}
        icon={Timer}
        tone={overdue > 0 ? "negative" : "neutral"}
        featured={overdue > 0}
        subtitle="Căn cứ khiếu nại bưu cục"
      />
      <FilterCard
        {...card("ISSUES")}
        title="Hàng hỏng · khiếu nại sàn"
        value={formatNumber(issues)}
        icon={PackageX}
        tone="negative"
        colorValue
        subtitle={`${formatNumber(damaged)} chờ khiếu nại · ${formatNumber(issues - damaged)} đã chốt`}
      />
      <FilterCard
        {...card("RECEIVED_INTACT")}
        title="Đã nhập kho"
        value={formatNumber(summary.RECEIVED_INTACT ?? 0)}
        icon={PackageCheck}
        subtitle="Hàng nguyên vẹn, đã cộng lại tồn kho"
      />
    </div>
  );
}

/**
 * Chữ trùng với cột Trạng thái vận chuyển; riêng "Giao thất bại" là nhóm kiện quay đầu
 * kho chưa nhận — trong nhóm này từng dòng mới hỏi hãng nên bộ lọc không tách tiếp được.
 */
const SHIP_CHIPS: { key: ReturnShippingFilter; label: string; title?: string }[] = [
  { key: "RETURNED", label: "Hoàn thành công" },
  { key: "RETURNING", label: "Đang hoàn về" },
  { key: "WAITING_BUYER", label: "Chờ khách gửi hàng" },
  {
    key: "FAILED_DELIVERY",
    label: "Giao thất bại",
    title:
      "Kiện giao thất bại đang quay về, kho chưa nhận. Hãng đã trả kiện hay chưa được hỏi từ hãng vận chuyển cho từng dòng khi mở trang.",
  },
  { key: "NO_SIGNAL", label: "Chưa có tin từ hãng" },
];

const CHIP_CLASS =
  "flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors";
const CHIP_ON = "border-primary bg-primary text-primary-foreground";
const CHIP_OFF = "bg-background text-muted-foreground hover:bg-muted hover:text-foreground";

/**
 * Hàng chip = bộ lọc TRẠNG THÁI VẬN CHUYỂN. Trả về các chip rời (fragment) để trang xếp
 * chung hàng với ô lọc gian + ô tìm. Số trên chip đếm trong tình trạng kho đang chọn ở
 * thẻ; chip 0 đơn ẩn đi (trừ chip đang chọn) cho hàng lọc ngắn.
 */
export function ReturnShippingChips({
  value,
  onChange,
  counts,
}: {
  value: ReturnShippingFilter | "";
  onChange: (next: ReturnShippingFilter | "") => void;
  counts: Partial<Record<ReturnShippingFilter, number>>;
}) {
  const total = Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0);
  return (
    <>
      <button
        type="button"
        aria-pressed={value === ""}
        onClick={() => onChange("")}
        className={cn(CHIP_CLASS, value === "" ? CHIP_ON : CHIP_OFF)}
      >
        Tất cả
        {total > 0 && <span className="tabular-nums opacity-70">{formatNumber(total)}</span>}
      </button>
      {SHIP_CHIPS.map((c) => {
        const active = value === c.key;
        const count = counts[c.key] ?? 0;
        if (count === 0 && !active) return null;
        return (
          <button
            key={c.key}
            type="button"
            aria-pressed={active}
            title={c.title}
            onClick={() => onChange(active ? "" : c.key)}
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

/**
 * Tiêu đề cột Thời gian chờ kèm mũi tên trong nền tròn: ĐỎ ↓ = ngày cũ → mới (chờ lâu
 * nhất trước, mặc định), XANH ↑ = sàn báo hoàn mới nhất trước. Bấm để đổi chiều. Không
 * dùng components/shared/sort-header.tsx vì cần nền màu theo chiều.
 */
export function ReturnSortToggle({
  newestFirst,
  onToggle,
}: {
  newestFirst: boolean;
  onToggle: () => void;
}) {
  const Arrow = newestFirst ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={onToggle}
      title={
        newestFirst
          ? "Đang xếp: sàn báo hoàn mới nhất trước. Bấm để xếp từ ngày cũ tới mới."
          : "Đang xếp: từ ngày cũ tới mới (chờ lâu nhất trước). Bấm để xếp mới nhất trước."
      }
      className="inline-flex items-center gap-1.5 font-medium text-foreground"
    >
      Thời gian chờ
      <span
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full text-white",
          newestFirst ? "bg-emerald-500" : "bg-red-500"
        )}
      >
        <Arrow className="size-3.5" strokeWidth={2.5} />
      </span>
    </button>
  );
}
