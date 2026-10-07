"use client";

// ============================================================
// TRẠNG THÁI CHIẾN DỊCH GMV MAX — một chỗ cho từ vựng, thứ tự nhóm, nhãn, và bộ lọc
//
// Backend (integrations/tiktok-ads/campaign-status.ts) đã xếp "đang chạy trên cùng →
// tạm dừng → đã dừng". Phía trang vẫn xếp lại theo NHÓM (ổn định, giữ nguyên thứ tự
// trong nhóm) để bất biến "đang chạy luôn ở trên" không phụ thuộc vào việc bản API
// nào đang được cache — tầng hiển thị tự bảo vệ điều nó hứa với người dùng.
// ============================================================

import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

import { Badge } from "@/components/ui/badge";

export type TiktokCampaignStatusKey = "ongoing" | "paused" | "ended";

/** Thứ tự nhóm trên bảng và thứ tự chip lọc. */
export const TIKTOK_CAMPAIGN_STATUS_ORDER: readonly TiktokCampaignStatusKey[] = ["ongoing", "paused", "ended"];

export const TIKTOK_CAMPAIGN_STATUS_META: Record<
  TiktokCampaignStatusKey,
  { label: string; badgeClass: string; dotClass: string; hint: string }
> = {
  ongoing: {
    label: "Đang chạy",
    badgeClass: "bg-emerald-500 text-white",
    dotClass: "bg-emerald-500",
    hint: "TikTok đang phân phối chiến dịch này.",
  },
  paused: {
    label: "Tạm dừng",
    badgeClass: "bg-amber-100 text-amber-700",
    dotClass: "bg-amber-400",
    hint: "Chiến dịch đang tắt trên TikTok — bật lại được từ Seller Center.",
  },
  ended: {
    label: "Đã dừng",
    badgeClass: "bg-slate-100 text-slate-500",
    dotClass: "bg-slate-400",
    hint: "TikTok không còn liệt kê chiến dịch này (đã xóa hoặc hết hạn). Số liệu cũ vẫn giữ để đối chiếu.",
  },
};

/**
 * Chuẩn hóa status thô từ API về ba nhóm. Giá trị lạ → "paused": không bao giờ tự suy ra
 * "đang chạy", và cũng không giấu hẳn một chiến dịch Hubsell chưa hiểu.
 */
export function tiktokCampaignStatusKey(raw: string): TiktokCampaignStatusKey {
  if (raw === "ongoing") return "ongoing";
  if (raw === "ended" || raw === "deleted" || raw === "closed") return "ended";
  return "paused";
}

/** Xếp theo nhóm trạng thái, ổn định (Array.prototype.sort ổn định từ ES2019). */
export function sortTiktokCampaignsByStatus<T extends { status: string }>(rows: readonly T[]): T[] {
  const rank = (r: T) => TIKTOK_CAMPAIGN_STATUS_ORDER.indexOf(tiktokCampaignStatusKey(r.status));
  return [...rows].sort((a, b) => rank(a) - rank(b));
}

export type TiktokCampaignStatusFilter = "all" | TiktokCampaignStatusKey;

export function countTiktokCampaignStatuses<T extends { status: string }>(
  rows: readonly T[]
): Record<TiktokCampaignStatusKey, number> {
  const out: Record<TiktokCampaignStatusKey, number> = { ongoing: 0, paused: 0, ended: 0 };
  for (const r of rows) out[tiktokCampaignStatusKey(r.status)]++;
  return out;
}

export function TiktokCampaignStatusBadge({ status, className }: { status: string; className?: string }) {
  const m = TIKTOK_CAMPAIGN_STATUS_META[tiktokCampaignStatusKey(status)];
  return (
    <Badge className={cn(m.badgeClass, className)} title={m.hint}>
      {m.label}
    </Badge>
  );
}

/**
 * Chip lọc theo trạng thái, mỗi chip kèm số đếm trên TOÀN BỘ danh sách (không phải phần
 * đang hiện) để người dùng thấy ngay "3 đang chạy, 5 tạm dừng, 12 đã dừng" mà không phải
 * bấm thử. Chip của nhóm rỗng vẫn hiện nhưng mờ và bấm được (để thấy "không có"), trừ
 * khi cả danh sách rỗng.
 */
export function TiktokCampaignStatusFilterChips({
  value,
  onChange,
  counts,
  className,
}: {
  value: TiktokCampaignStatusFilter;
  onChange: (v: TiktokCampaignStatusFilter) => void;
  counts: Record<TiktokCampaignStatusKey, number>;
  className?: string;
}) {
  const total = counts.ongoing + counts.paused + counts.ended;
  const chips: { key: TiktokCampaignStatusFilter; label: string; count: number; dotClass?: string; hint?: string }[] = [
    { key: "all", label: "Tất cả", count: total },
    ...TIKTOK_CAMPAIGN_STATUS_ORDER.map((k) => ({
      key: k,
      label: TIKTOK_CAMPAIGN_STATUS_META[k].label,
      count: counts[k],
      dotClass: TIKTOK_CAMPAIGN_STATUS_META[k].dotClass,
      hint: TIKTOK_CAMPAIGN_STATUS_META[k].hint,
    })),
  ];
  return (
    <div role="radiogroup" aria-label="Lọc chiến dịch theo trạng thái" className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {chips.map((c) => {
        const active = value === c.key;
        return (
          <button
            key={c.key}
            type="button"
            role="radio"
            aria-checked={active}
            title={c.hint}
            onClick={() => onChange(c.key)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors",
              active
                ? "border-slate-900 bg-slate-900 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-transparent dark:text-slate-300",
              !active && c.count === 0 && "text-slate-400 dark:text-slate-500"
            )}
          >
            {c.dotClass && <span className={cn("size-1.5 rounded-full", active ? "bg-current opacity-70" : c.dotClass)} aria-hidden />}
            {c.label}
            <span className={cn("tabular-nums", active ? "opacity-80" : "text-slate-400")}>{formatNumber(c.count)}</span>
          </button>
        );
      })}
    </div>
  );
}
