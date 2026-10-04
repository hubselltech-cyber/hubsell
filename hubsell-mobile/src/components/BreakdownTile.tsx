import React from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "nativewind";
import { compactMoney } from "@/lib/format";
import { CARD_SHADOW, ICON_TINT, TABULAR, type IconTint } from "@/theme/tokens";

/**
 * THẺ BÓC TÁCH — bản điện thoại của BreakdownCard trên web Báo cáo dòng tiền:
 * tiêu đề + tổng + dòng tỷ trọng ("37% trên doanh thu") + pill ▲/▼ so kỳ
 * trước. Bấm thẻ để bung danh sách khoản con bên dưới lưới (thẻ không tự cao
 * lên — 4 thẻ trong lưới 2×2 luôn bằng nhau trên mọi cỡ màn hình).
 */
export function BreakdownTile({
  title,
  total,
  subtitle,
  share,
  delta,
  deltaInverted = false,
  icon,
  renderIcon,
  tint,
  colorBySign = false,
  featured = false,
  negative = false,
  open,
  onPress,
}: {
  title: string;
  total: number;
  subtitle?: string;
  share?: { percent: number; label: string };
  /** % so kỳ trước; null = kỳ trước trống, không so được. */
  delta?: number | null;
  /** Chi phí tăng là XẤU → đảo màu mũi tên. */
  deltaInverted?: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  /** Vẽ icon riêng (hình Ionicons không có) — nhận màu + cỡ của ô icon. */
  renderIcon?: (color: string, size: number) => React.ReactNode;
  tint: IconTint;
  colorBySign?: boolean;
  featured?: boolean;
  /** Tô số màu đỏ (thẻ Chi phí) */
  negative?: boolean;
  open: boolean;
  onPress: () => void;
}) {
  const { colorScheme } = useColorScheme();
  const dark = colorScheme === "dark";
  const t = ICON_TINT[tint];
  const valueClass = colorBySign
    ? total < 0
      ? "text-red-500 dark:text-red-400"
      : "text-emerald-600 dark:text-emerald-400"
    : negative
      ? "text-red-500 dark:text-red-400"
      : "text-slate-900 dark:text-slate-100";
  const deltaGood = delta != null && (deltaInverted ? delta < 0 : delta >= 0);
  const pct = (v: number) => `${Math.abs(Math.round(v * 10) / 10).toFixed(1).replace(".", ",")}%`;

  return (
    <Pressable
      className={`flex-1 rounded-2xl border p-3.5 active:opacity-80 ${
        featured
          ? // Nền phải ĐẶC: nền trong suốt + elevation trên Android lộ bóng đổ
            // xuyên qua thẻ thành mảng xám loang (anh Trung 04/10). Hai mã màu =
            // emerald-50/60 trên trắng và emerald-500/10 trên slate-900.
            "border-emerald-300 dark:border-emerald-500/40 bg-[#f4fef9] dark:bg-[#102c33]"
          : "border-slate-900/5 dark:border-white/5 bg-white dark:bg-slate-900"
      } ${open ? "border-slate-900 dark:border-slate-100" : ""}`}
      style={CARD_SHADOW}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}: ${compactMoney(total)}`}
    >
      {/* Icon trái + mũi tên phải trên một hàng, TIÊU ĐỀ xuống hàng riêng
          chiếm trọn bề ngang thẻ — màn 320px vẫn đọc đủ "Lợi nhuận ròng tạm tính" */}
      <View className="flex-row items-center justify-between">
        <View
          className="h-7 w-7 items-center justify-center rounded-lg"
          style={{ backgroundColor: dark ? t.dark : t.light }}
        >
          {renderIcon ? (
            renderIcon(t.icon, 15)
          ) : (
            <Ionicons name={icon} size={15} color={t.icon} />
          )}
        </View>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={13} color="#cbd5e1" />
      </View>
      <Text className="mt-2 text-[11px] font-medium text-slate-500 dark:text-slate-400" numberOfLines={2}>
        {title}
      </Text>
      <Text className={`mt-1 text-[20px] font-bold ${valueClass}`} style={TABULAR} numberOfLines={1}>
        {compactMoney(total)}
      </Text>
      {subtitle ? (
        <Text className="mt-0.5 text-[10px] text-slate-400 dark:text-slate-500" numberOfLines={1}>
          {subtitle}
        </Text>
      ) : null}
      {share ? (
        <Text className="mt-0.5 text-[10px] text-slate-400 dark:text-slate-500" numberOfLines={1} style={TABULAR}>
          <Text className="font-semibold text-slate-700 dark:text-slate-300">{pct(share.percent)}</Text>
          {" "}
          {share.label}
        </Text>
      ) : null}
      {delta != null ? (
        <View
          className={`mt-1.5 self-start rounded-full px-1.5 py-0.5 ${
            deltaGood ? "bg-emerald-100 dark:bg-emerald-500/15" : "bg-red-100 dark:bg-red-500/15"
          }`}
        >
          <Text
            className={`text-[10px] font-semibold ${
              deltaGood ? "text-emerald-700 dark:text-emerald-300" : "text-red-600 dark:text-red-300"
            }`}
            style={TABULAR}
          >
            {delta >= 0 ? "▲" : "▼"} {pct(delta)} so kỳ trước
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
