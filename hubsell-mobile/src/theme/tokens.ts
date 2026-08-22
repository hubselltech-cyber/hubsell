import type { TextStyle, ViewStyle } from "react-native";

/**
 * TOKEN THIẾT KẾ dùng chung toàn app — cùng ngôn ngữ với web (chốt 15-16/08):
 * bóng card 2 lớp, số tabular-nums, màu tint cho icon chip. Mọi màn mới lấy
 * từ đây, không tự chế shadow/màu lẻ tẻ.
 */

/** Số liệu LUÔN đi kèm style này — các chữ số cùng bề rộng, cột số không nhảy. */
export const TABULAR: TextStyle = { fontVariant: ["tabular-nums"] };

/**
 * Bóng card chuẩn: iOS bóng mềm 2 lớp cảm giác nổi nhẹ, Android elevation
 * tương đương. Card nào cũng thêm viền hairline (trong Card.tsx) để giữ nét
 * trên nền tối — elevation gần như vô hình trên dark mode.
 */
export const CARD_SHADOW: ViewStyle = {
  shadowColor: "#0f172a",
  shadowOpacity: 0.08,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 3,
};

/** Bóng nhấn cho phần tử nổi bật (CTA, orb) — sâu hơn card thường. */
export const RAISED_SHADOW: ViewStyle = {
  shadowColor: "#0f172a",
  shadowOpacity: 0.16,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 6 },
  elevation: 6,
};

/**
 * Bảng tint cho icon chip trên thẻ chỉ số — nền nhạt + màu icon đậm cùng họ,
 * đủ tương phản ở cả hai theme (nền dark dùng alpha trên màu gốc).
 */
export const ICON_TINT = {
  emerald: { light: "#d1fae5", dark: "rgba(16,185,129,0.16)", icon: "#10b981" },
  sky: { light: "#e0f2fe", dark: "rgba(14,165,233,0.16)", icon: "#0ea5e9" },
  violet: { light: "#ede9fe", dark: "rgba(139,92,246,0.16)", icon: "#8b5cf6" },
  amber: { light: "#fef3c7", dark: "rgba(245,158,11,0.16)", icon: "#d97706" },
  red: { light: "#fee2e2", dark: "rgba(239,68,68,0.16)", icon: "#ef4444" },
  slate: { light: "#f1f5f9", dark: "rgba(148,163,184,0.14)", icon: "#64748b" },
} as const;

export type IconTint = keyof typeof ICON_TINT;
