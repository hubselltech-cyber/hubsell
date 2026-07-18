import type { ChannelName } from "@/lib/api";

// Nhãn & màu dùng chung cho từng sàn/kênh bán
export const CHANNEL_META: Record<
  ChannelName,
  { label: string; className: string }
> = {
  SHOPEE: {
    label: "Shopee",
    className: "bg-orange-100 text-orange-700 border-orange-200",
  },
  LAZADA: {
    label: "Lazada",
    className: "bg-blue-100 text-blue-700 border-blue-200",
  },
  TIKTOK: {
    label: "TikTok",
    className: "bg-zinc-900 text-white border-zinc-900",
  },
  OFFLINE: {
    label: "Offline",
    className: "bg-zinc-100 text-zinc-700 border-zinc-200",
  },
};
