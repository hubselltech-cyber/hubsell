import type { ChannelName, ReturnStatus, ShippingStatus } from "../types/api";

/** Nhãn + màu (class NativeWind) cho trạng thái giao hàng. */
export const SHIPPING_STATUS: Record<
  ShippingStatus,
  { label: string; bg: string; text: string }
> = {
  PENDING: {
    label: "Chờ xử lý",
    bg: "bg-amber-100 dark:bg-amber-500/15",
    text: "text-amber-700 dark:text-amber-300",
  },
  PROCESSED: {
    label: "Đã xử lý",
    bg: "bg-sky-100 dark:bg-sky-500/15",
    text: "text-sky-700 dark:text-sky-300",
  },
  SHIPPING: {
    label: "Đang giao",
    bg: "bg-indigo-100 dark:bg-indigo-500/15",
    text: "text-indigo-700 dark:text-indigo-300",
  },
  DELIVERED: {
    label: "Đã giao",
    bg: "bg-emerald-100 dark:bg-emerald-500/15",
    text: "text-emerald-700 dark:text-emerald-300",
  },
  CANCELLED: {
    label: "Đã hủy", // = STATUS_META web; hoàn/trả có nhãn riêng ở RETURN_STATUS
    bg: "bg-red-100 dark:bg-red-500/15",
    text: "text-red-600 dark:text-red-300",
  },
};

/**
 * Nhãn trạng thái của MỘT ĐƠN — dùng chung cho thẻ đơn ngoài danh sách và dòng Trạng
 * thái trong chi tiết đơn (12/11/2026: trước đó thẻ ghi "Chờ đóng gói" mà mở ra lại ghi
 * "Đã xử lý"). Đơn còn ở Đã xử lý thì đọc theo BƯỚC ĐÓNG GÓI (cùng chữ với nhãn phụ ở
 * cột Trạng thái web): Chưa in phiếu → Chờ đóng gói → Đã đóng gói → Đã bàn giao. Đơn
 * đã đi giao / đã giao / hủy giữ nhãn vận chuyển — việc gói đã qua.
 */
export function orderStatusBadge(o: {
  shippingStatus: ShippingStatus;
  labelPrintedAt?: string | null;
  packingDoneAt?: string | null;
  handoverSheetId?: string | null;
}): { label: string; bg: string; text: string } {
  const ship = SHIPPING_STATUS[o.shippingStatus];
  if (o.shippingStatus !== "PROCESSED") return ship;
  if (o.packingDoneAt) {
    return {
      label: o.handoverSheetId ? "Đã bàn giao" : "Đã đóng gói",
      bg: "bg-emerald-100 dark:bg-emerald-500/15",
      text: "text-emerald-700 dark:text-emerald-300",
    };
  }
  if (o.labelPrintedAt) return { ...ship, label: "Chờ đóng gói" };
  return {
    label: "Chưa in phiếu",
    bg: "bg-amber-100 dark:bg-amber-500/15",
    text: "text-amber-700 dark:text-amber-300",
  };
}

export const RETURN_STATUS: Record<
  ReturnStatus,
  { label: string; bg: string; text: string }
> = {
  NONE: {
    label: "Không hoàn",
    bg: "bg-slate-100 dark:bg-slate-800",
    text: "text-slate-500 dark:text-slate-400",
  },
  AWAITING: {
    label: "Chờ hàng về",
    bg: "bg-amber-100 dark:bg-amber-500/15",
    text: "text-amber-700 dark:text-amber-300",
  },
  // Câu chữ trạng thái hoàn THỐNG NHẤT 3 nơi (app, web /orders, web
  // /warehouse/returns) từ 26/10/2026 — trước mỗi nơi một kiểu, cùng một đơn
  // ba tên khác nhau.
  RECEIVED: {
    label: "Đã nhận · chờ nhập kho",
    bg: "bg-sky-100 dark:bg-sky-500/15",
    text: "text-sky-700 dark:text-sky-300",
  },
  RECEIVED_INTACT: {
    label: "Đã nhập kho",
    bg: "bg-emerald-100 dark:bg-emerald-500/15",
    text: "text-emerald-700 dark:text-emerald-300",
  },
  DAMAGED: {
    label: "Hàng hỏng · chờ khiếu nại sàn",
    bg: "bg-red-100 dark:bg-red-500/15",
    text: "text-red-600 dark:text-red-300",
  },
  CLAIM_SETTLED: {
    label: "Đã được đền bù",
    bg: "bg-emerald-100 dark:bg-emerald-500/15",
    text: "text-emerald-700 dark:text-emerald-300",
  },
  WRITTEN_OFF: {
    label: "Hao hụt / xóa sổ",
    bg: "bg-slate-200 dark:bg-slate-700",
    text: "text-slate-600 dark:text-slate-300",
  },
};

export const CHANNEL_LABEL: Record<ChannelName, string> = {
  SHOPEE: "Shopee",
  LAZADA: "Lazada",
  TIKTOK: "TikTok",
  OFFLINE: "Offline",
};

/** Nhãn NGẮN của hãng vận chuyển — cho chip lọc chật chỗ trên mobile. */
export const CARRIER_SHORT: Record<string, string> = {
  // Nhóm HỎA TỐC mọi sàn (backend lọc theo tên hãng nguyên văn) — đứng đầu như web.
  EXPRESS: "⚡ Hỏa tốc",
  SPX: "SPX",
  GHTK: "GHTK",
  GHN: "GHN",
  JT: "J&T",
  VIETTEL_POST: "VTPost",
  NINJA_VAN: "Ninja",
  BEST: "BEST",
  KHAC: "Khác",
};

/** Nhãn hãng vận chuyển — CHÉP TAY từ frontend/src/lib/carrier-meta.ts. */
export const CARRIER_LABEL: Record<string, string> = {
  EXPRESS: "Hỏa tốc (mọi sàn)",
  SPX: "SPX Express",
  GHTK: "Giao Hàng Tiết Kiệm",
  GHN: "Giao Hàng Nhanh",
  JT: "J&T Express",
  VIETTEL_POST: "Viettel Post",
  NINJA_VAN: "Ninja Van",
  BEST: "BEST Express",
  KHAC: "Hãng khác / shop tự giao",
};
