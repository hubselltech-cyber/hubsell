import { useColorScheme } from "nativewind";

/**
 * Màu nhận diện từng sàn — token dùng thống nhất cho donut, chấm chú giải,
 * chip lọc toàn app (chuyển từ components/ChannelDonut.tsx về theme/ 22/08
 * khi component donut kênh riêng bị gỡ — chỉ còn bảng màu là sống).
 */
export const CHANNEL_COLOR: Record<string, string> = {
  SHOPEE: "#ee4d2d",
  LAZADA: "#6d28d9",
  TIKTOK: "#0f172a",
  OFFLINE: "#94a3b8",
};

/**
 * Màu sàn theo scheme — TikTok đen thương hiệu TÀNG HÌNH trên nền tối nên
 * dark đổi sang trắng ngà (đúng bộ đôi đen/trắng của chính TikTok).
 */
export function useChannelColors(): Record<string, string> {
  const { colorScheme } = useColorScheme();
  return colorScheme === "dark"
    ? { ...CHANNEL_COLOR, TIKTOK: "#e2e8f0" }
    : CHANNEL_COLOR;
}
