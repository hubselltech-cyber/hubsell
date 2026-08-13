import type { ChannelName, ReturnStatus, ShippingStatus } from "../types/api";

/** Nhãn + màu (class NativeWind) cho trạng thái giao hàng. */
export const SHIPPING_STATUS: Record<
  ShippingStatus,
  { label: string; bg: string; text: string }
> = {
  PENDING: { label: "Chờ xử lý", bg: "bg-amber-100", text: "text-amber-700" },
  PROCESSED: { label: "Đã xử lý", bg: "bg-sky-100", text: "text-sky-700" },
  SHIPPING: { label: "Đang giao", bg: "bg-indigo-100", text: "text-indigo-700" },
  DELIVERED: { label: "Đã giao", bg: "bg-emerald-100", text: "text-emerald-700" },
  CANCELLED: { label: "Hủy/Hoàn", bg: "bg-red-100", text: "text-red-600" },
};

export const RETURN_STATUS: Record<
  ReturnStatus,
  { label: string; bg: string; text: string }
> = {
  NONE: { label: "Không hoàn", bg: "bg-slate-100", text: "text-slate-500" },
  AWAITING: { label: "Chờ hàng về", bg: "bg-amber-100", text: "text-amber-700" },
  RECEIVED: { label: "Đã quét nhận — chờ nhập kho", bg: "bg-sky-100", text: "text-sky-700" },
  RECEIVED_INTACT: { label: "Đã nhập kho", bg: "bg-emerald-100", text: "text-emerald-700" },
  DAMAGED: { label: "Hàng hỏng — chờ khiếu nại", bg: "bg-red-100", text: "text-red-600" },
  CLAIM_SETTLED: { label: "Đã được đền bù", bg: "bg-emerald-100", text: "text-emerald-700" },
  WRITTEN_OFF: { label: "Đã xóa sổ", bg: "bg-slate-200", text: "text-slate-600" },
};

export const CHANNEL_LABEL: Record<ChannelName, string> = {
  SHOPEE: "Shopee",
  LAZADA: "Lazada",
  TIKTOK: "TikTok",
  OFFLINE: "Offline",
};
