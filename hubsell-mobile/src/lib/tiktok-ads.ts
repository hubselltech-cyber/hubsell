import { Linking } from "react-native";
import { hapticTap } from "@/lib/haptics";
import type {
  TiktokAdsAdviceKind,
  TiktokAdsAutoMode,
  TiktokAdsAutoVerdict,
  TiktokAdsCampaignAdvice,
  TiktokAdsCampaignRow,
} from "@/types/api";

/**
 * Từ vựng + luật xếp của Trợ lý quảng cáo TikTok trên app — chép nhãn từ web
 * (tiktok-campaign-status.tsx, tiktok-campaign-page.tsx, tiktok-advice-body.tsx)
 * để hai nơi nói một giọng. Luật "Cần xử lý" là của app (web chưa có khối này),
 * thứ tự TỰ CHỌN: tiền đang mất đứng trước tiền có thể kiếm thêm
 * (docs/ADS-TIKTOK-TREN-MOBILE.md mục 5).
 */

/** Nơi chủ shop SỬA chiến dịch GMV Max (ROI mục tiêu, ngân sách, bật / tắt) — API không sửa được. */
export const TIKTOK_SELLER_CENTER_URL = "https://seller-vn.tiktok.com/";

/** Mở Seller Center bằng trình duyệt hệ thống (app TikTok Seller có bắt link hay không: chưa kiểm). */
export function openSellerCenter() {
  hapticTap();
  void Linking.openURL(TIKTOK_SELLER_CENTER_URL);
}

export type TiktokStatusKey = "ongoing" | "paused" | "ended";

export function tiktokStatusKey(raw: string): TiktokStatusKey {
  return raw === "ongoing" || raw === "ended" ? raw : "paused";
}

export const TIKTOK_STATUS_LABEL: Record<TiktokStatusKey, string> = {
  ongoing: "Đang chạy",
  paused: "Tạm dừng",
  ended: "Đã dừng",
};

export const TIKTOK_AUTO_MODE_LABEL: Record<TiktokAdsAutoMode, string> = {
  off: "Tắt",
  dry_run: "Diễn tập",
  live: "Tự loại thật",
};

/** Màu nhãn nhận định theo tông (web TIKTOK_ADVICE_TONE). */
export const TIKTOK_ADVICE_TONE: Record<
  TiktokAdsCampaignAdvice["tone"],
  { bg: string; text: string; edge: string }
> = {
  warn: { bg: "bg-red-500", text: "text-white", edge: "border-l-red-500" },
  info: { bg: "bg-amber-500", text: "text-white", edge: "border-l-amber-500" },
  ok: {
    bg: "bg-emerald-50 dark:bg-emerald-500/15",
    text: "text-emerald-700 dark:text-emerald-300",
    edge: "border-l-emerald-500",
  },
  muted: {
    bg: "bg-slate-100 dark:bg-slate-800",
    text: "text-slate-500 dark:text-slate-400",
    edge: "border-l-slate-400",
  },
};

/** Kết luận lượt xét tự động của từng video (web AUTO_VERDICT_BADGE). */
export const TIKTOK_AUTO_VERDICT: Record<
  TiktokAdsAutoVerdict,
  { label: string; bg: string; text: string }
> = {
  exclude: { label: "Sẽ loại", bg: "bg-rose-50 dark:bg-rose-500/15", text: "text-red-500 dark:text-red-300" },
  grace: { label: "Ân hạn", bg: "bg-amber-50 dark:bg-amber-500/15", text: "text-amber-700 dark:text-amber-300" },
  flag: { label: "Cần xem", bg: "bg-amber-50 dark:bg-amber-500/15", text: "text-amber-700 dark:text-amber-300" },
  protected: { label: "Đã khôi phục tay", bg: "bg-slate-100 dark:bg-slate-800", text: "text-slate-500 dark:text-slate-400" },
  healthy: { label: "Ổn", bg: "bg-emerald-50 dark:bg-emerald-500/15", text: "text-emerald-700 dark:text-emerald-300" },
  insufficient: { label: "Chưa đủ dữ liệu", bg: "bg-slate-100 dark:bg-slate-800", text: "text-slate-500 dark:text-slate-400" },
  learning: { label: "Chờ học xong", bg: "bg-sky-50 dark:bg-sky-500/15", text: "text-sky-700 dark:text-sky-300" },
};

/** Trạng thái phân phối của video (web DELIVERY_META). */
export const TIKTOK_DELIVERY_LABEL: Record<string, string> = {
  DELIVERING: "Đang phân phối",
  LEARNING: "Đang học",
  IN_QUEUE: "Chờ thử",
};

/**
 * Mức nặng của nhận định cho khối "Cần xử lý" — số nhỏ = nặng hơn; vắng = không
 * đưa vào khối. Chỉ xét chiến dịch đang chạy.
 */
const ATTENTION_RANK: Partial<Record<TiktokAdsAdviceKind, number>> = {
  no_orders: 0, // tiêu tiền không ra đơn
  losing: 1, // ROI thực dưới hòa vốn
  no_delivery: 2, // TikTok không phân phối
  target_below: 3, // mục tiêu đặt dưới hòa vốn
  budget_capped: 4, // ngân sách đang chặn
  target_binding: 5, // mục tiêu đang ghìm phân phối
};

/** Diễn tập gần nhất định loại video → cũng là việc cần chủ shop nhìn. Trả số video. */
export function dryRunPlanned(c: TiktokAdsCampaignRow): number {
  const a = c.auto;
  if (!a || (a.lastRunMode ?? a.mode) !== "dry_run" || a.lastRunExclude <= 0) return 0;
  if (!a.lastRunOn) return 0;
  // lastRunOn = YYYY-MM-DD lịch VN, lượt chạy sau 12h trưa; chỉ tính hôm nay / hôm qua.
  const ran = new Date(`${a.lastRunOn}T12:00:00+07:00`).getTime();
  if (Number.isNaN(ran) || Date.now() - ran > 36 * 3600 * 1000) return 0;
  return a.lastRunExclude;
}

export function attentionRank(c: TiktokAdsCampaignRow): number | null {
  if (tiktokStatusKey(c.status) !== "ongoing") return null;
  const kind = c.advice?.kind;
  const r = kind ? ATTENTION_RANK[kind] : undefined;
  if (r != null) return r;
  if (dryRunPlanned(c) > 0) return 6;
  return null;
}

/** Chiến dịch cần chủ shop nhìn, xếp nặng trước; cùng mức thì chi phí kỳ giảm dần. */
export function sortAttention(rows: TiktokAdsCampaignRow[]): TiktokAdsCampaignRow[] {
  return rows
    .map((c) => ({ c, r: attentionRank(c) }))
    .filter((x): x is { c: TiktokAdsCampaignRow; r: number } => x.r != null)
    .sort((a, b) => a.r - b.r || b.c.spend - a.c.spend)
    .map((x) => x.c);
}

/**
 * Việc app làm được với thẻ: "videos" = mở màn Video để loại (tiêu không ra
 * đơn / đang lỗ / diễn tập định loại); "seller_center" = phải sửa trong Seller Center.
 */
export function attentionAction(c: TiktokAdsCampaignRow): "videos" | "seller_center" {
  const kind = c.advice?.kind;
  if (kind === "no_orders" || kind === "losing") return "videos";
  if (c.advice?.editInSellerCenter) return "seller_center";
  return "videos";
}

/** ROI của TikTok (doanh thu ÷ chi phí) — "11,4x"; null = chưa tiêu tiền. */
export function fmtRoi(v: number | null | undefined): string {
  if (v == null) return "—";
  const s = v.toFixed(2).replace(/\.?0+$/, "");
  return `${s.replace(".", ",")}x`;
}

/** "YYYY-MM-DD" → "dd/mm". */
export function ddmm(d: string): string {
  return `${d.slice(8, 10)}/${d.slice(5, 7)}`;
}

/** ISO → "hh:mm dd/mm" cho dòng "Số tới …". */
export function fmtSyncedAt(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())} ${p(d.getDate())}/${p(d.getMonth() + 1)}`;
}

/** Rút gọn mã video dài (19 số) cho dòng hẹp: "7421…9083". */
export function shortVideoId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id;
}
