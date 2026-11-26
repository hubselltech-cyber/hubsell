"use client";

import {
  AlarmClock,
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
import { formatSpan } from "@/lib/return-complaint-due";
import { cn } from "@/lib/utils";

/**
 * BỐN BỘ ĐIỀU KHIỂN DANH SÁCH của Đối soát đơn hoàn (ba bộ đầu anh Trung chốt 13/11/2026 tối):
 *   1. ReturnStatusCards   — các thẻ số to, BẤM ĐƯỢC = bộ lọc tình trạng kho;
 *   2. ReturnShippingChips — hàng chip = bộ lọc Trạng thái vận chuyển;
 *   3. ReturnSortToggle    — mũi tên nền tròn ở tiêu đề cột Thời hạn;
 *   4. ReturnDueSoonStrip  — dải nhắc một dòng "sắp hết hạn khiếu nại" (25/11/2026), bấm = lọc.
 * Trang (app/warehouse/returns/page.tsx) giữ state; tệp này chỉ vẽ.
 */

/** Giá trị bộ lọc tình trạng kho — khớp tham số `status` của GET /api/warehouse/returns. */
export type ReturnStatusFilter =
  | ""
  | "AWAITING"
  | "RECEIVED"
  | "OVERDUE"
  | "ISSUES"
  | "RECEIVED_INTACT"
  /** Sắp hết hạn khiếu nại (còn ≤ 24 giờ) — bật từ dải nhắc, không có thẻ riêng. */
  | "DUE_SOON";

/** Nhóm trạng thái của thẻ Hàng hỏng · khiếu nại sàn — khớp filter ISSUES ở backend. */
const ISSUE_KEYS = ["DAMAGED", "CLAIM_SETTLED", "WRITTEN_OFF"] as const;

/**
 * Thẻ số bấm được. role="button" trên div vì thẻ chứa <p>/<div> (không hợp lệ trong <button>).
 * Xuất ra ngoài để tab Đơn hoàn của trang Video đóng hàng dùng đúng cùng một kiểu thẻ lọc.
 */
export function FilterCard({
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
  onToggle: (key: Exclude<ReturnStatusFilter, "" | "DUE_SOON">) => void;
  /** Số đếm theo trạng thái + `overdue` từ GET /api/warehouse/returns. */
  summary: Record<string, number>;
  overdueDays: number;
}) {
  const received = summary.RECEIVED ?? 0;
  const overdue = summary.overdue ?? 0;
  const damaged = summary.DAMAGED ?? 0;
  const issues = ISSUE_KEYS.reduce((sum, k) => sum + (summary[k] ?? 0), 0);
  const card = (key: Exclude<ReturnStatusFilter, "" | "DUE_SOON">) => ({
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
 * kho chưa nhận, hãng chưa báo trả — dòng nào được hỏi hãng mà hãng báo đã trả thì backend
 * lưu mốc và đơn sang "Hoàn thành công" (26/11/2026).
 */
const SHIP_CHIPS: { key: ReturnShippingFilter; label: string; title?: string }[] = [
  { key: "RETURNED", label: "Hoàn thành công" },
  { key: "RETURNING", label: "Đang hoàn về" },
  { key: "WAITING_BUYER", label: "Chờ khách gửi hàng" },
  {
    key: "FAILED_DELIVERY",
    label: "Giao thất bại",
    title:
      "Kiện giao thất bại đang quay về, kho chưa nhận. Mỗi dòng được hỏi hãng vận chuyển khi hiện ra; hãng báo đã trả kiện thì đơn chuyển sang nhóm Hoàn thành công.",
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
      Thời hạn
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

/**
 * DẢI NHẮC "SẮP HẾT HẠN KHIẾU NẠI" — một dòng mỏng, chỉ hiện khi có đơn còn ≤ 24 giờ (hoặc đang lọc theo nó).
 * Bấm = lọc danh sách về đúng các đơn đó, hạn gần nhất lên đầu; bấm lại để bỏ. Không làm thẻ số thứ sáu:
 * hàng thẻ là tình trạng kho, còn đây là việc có đồng hồ. KHÔNG viết lớp dark: — globals.css đã lật thang màu.
 */
export function ReturnDueSoonStrip({
  count,
  nearestAt,
  nowMs,
  active,
  onToggle,
}: {
  /** Số đơn còn hạn và còn ≤ 24 giờ (`summary.dueSoon`). */
  count: number;
  /** Hạn gần nhất (ISO) — null khi không có đơn nào. */
  nearestAt: string | null;
  nowMs: number;
  active: boolean;
  onToggle: () => void;
}) {
  if (count === 0 && !active) return null;
  const left = nearestAt ? new Date(nearestAt).getTime() - nowMs : 0;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
      <AlarmClock className="size-4 shrink-0 text-rose-700" aria-hidden />
      {count > 0 ? (
        <span>
          <b className="font-semibold tabular-nums">{formatNumber(count)} đơn hoàn</b> sắp hết hạn khiếu nại
          {left > 0 && (
            <>
              {" "}
              · gần nhất còn <b className="font-semibold tabular-nums">{formatSpan(left)}</b>
            </>
          )}
        </span>
      ) : (
        <span>Không còn đơn hoàn nào sắp hết hạn khiếu nại.</span>
      )}
      <button
        type="button"
        aria-pressed={active}
        onClick={onToggle}
        className="ml-auto rounded font-semibold text-rose-700 underline decoration-rose-700/40 underline-offset-4 hover:decoration-rose-700"
      >
        {active ? "Bỏ lọc" : `Xem ${formatNumber(count)} đơn`}
      </button>
    </div>
  );
}
