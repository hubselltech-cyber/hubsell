/**
 * MẠNG LƯỚI KOC & AFFILIATE — TYPES + META DÙNG CHUNG (đã LÊN SỐ THẬT 30/08)
 *
 * File này từng chứa dữ liệu MOCK cho cả 5 trang /koc-marketing. Từ nhịp 1
 * "Sổ KOC" (bảng koc_* + /api/koc CRUD) toàn bộ mock đã gỡ — chỉ còn nhãn/màu
 * và ngưỡng hiển thị dùng chung. Số liệu + công thức Net-ROI giờ TÍNH Ở
 * BACKEND (routes/koc.ts, dựa computePnlRow SSOT) — FE tuyệt đối không tự
 * bấm lại công thức (vết xe đổ phí sàn hardcode, xem memory hubsell-tai-chinh-co-so).
 */

import type { KocSampleStatus } from "@/lib/api";

export type KocPlatform = "TIKTOK" | "SHOPEE" | "LAZADA";

/** Nhãn + màu nhận diện sàn — dùng cho badge kênh ở mọi bảng KOC. */
export const KOC_PLATFORM_META: Record<
  KocPlatform,
  { label: string; badgeClass: string }
> = {
  TIKTOK: {
    label: "TikTok Shop",
    badgeClass: "border-violet-200 bg-violet-50 text-violet-700",
  },
  SHOPEE: {
    label: "Shopee",
    badgeClass: "border-orange-200 bg-orange-50 text-orange-700",
  },
  LAZADA: {
    label: "Lazada",
    badgeClass: "border-sky-200 bg-sky-50 text-sky-700",
  },
};

/** Badge sàn an toàn cho ChannelName bất kỳ (OFFLINE không có trong meta). */
export function kocPlatformMeta(platform: string) {
  return (
    KOC_PLATFORM_META[platform as KocPlatform] ?? {
      label: platform,
      badgeClass: "border-zinc-200 bg-zinc-50 text-zinc-600",
    }
  );
}

/** Nhãn trạng thái phiếu mẫu. "Quá hạn" KHÔNG phải trạng thái — backend trả
 *  cờ `overdue` suy từ WAITING + quá postDeadlineAt, UI tô đè bằng OVERDUE_META. */
export const SAMPLE_STATUS_META: Record<
  KocSampleStatus,
  { label: string; badgeClass: string }
> = {
  WAITING: {
    label: "⏳ Chờ lên bài",
    badgeClass: "border-amber-200 bg-amber-50 text-amber-700",
  },
  POSTED: {
    label: "✅ Đã đăng bài",
    badgeClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  BURNED: {
    label: "🔥 Bùng mẫu",
    badgeClass: "border-rose-200 bg-rose-50 text-rose-700",
  },
};

export const SAMPLE_OVERDUE_META = {
  label: "⚠️ Quá hạn chưa đăng",
  badgeClass: "border-rose-200 bg-rose-50 text-red-600",
};

export const KOC_EXPENSE_TYPE_LABEL: Record<string, string> = {
  BOOKING: "Booking lẻ",
  MCN_CONTRACT: "Hợp đồng MCN",
};

export const KOC_PARTNER_STATUS_META: Record<
  string,
  { label: string; badgeClass: string }
> = {
  ACTIVE: {
    label: "Đang hợp tác",
    badgeClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  PAUSED: {
    label: "Tạm dừng",
    badgeClass: "border-slate-200 bg-slate-50 text-slate-500",
  },
  BLACKLISTED: {
    label: "Danh sách đen",
    badgeClass: "border-rose-200 bg-rose-50 text-red-600",
  },
};
