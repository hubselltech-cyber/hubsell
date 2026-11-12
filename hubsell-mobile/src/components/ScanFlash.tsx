import React from "react";
import { Platform, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import type { PackFlash, PackFlashKind, PackHaptic } from "@/lib/pack-scan-feedback";
import { TABULAR } from "@/theme/tokens";

/**
 * MÀN BÁO của các màn quét liên tục (Quét đóng gói, Quét nhiều): phủ kín vùng camera, tự
 * tắt, không có nút nào — người quét nhìn kiện chứ không nhìn màn hình, nên màu phải nhận
 * ra từ khóe mắt và rung phải phân biệt được bằng tay. Tách khỏi PackScanScreen 12/11/2026
 * để hai màn báo CÙNG một kiểu.
 */

/** Màu màn báo — cố định, không theo giao diện sáng / tối (phải nhận ra từ khóe mắt). */
export const FLASH_STYLE: Record<
  PackFlashKind,
  { bg: string; fg: string; sub: string; icon: keyof typeof Ionicons.glyphMap; dot: string }
> = {
  ok: { bg: "rgba(5,150,105,0.95)", fg: "#ffffff", sub: "#d1fae5", icon: "checkmark-circle", dot: "#34d399" },
  caution: { bg: "rgba(245,158,11,0.96)", fg: "#1c1917", sub: "#451a03", icon: "warning", dot: "#fbbf24" },
  dup: { bg: "rgba(245,158,11,0.96)", fg: "#1c1917", sub: "#451a03", icon: "copy", dot: "#fbbf24" },
  cancelled: { bg: "rgba(220,38,38,0.97)", fg: "#ffffff", sub: "#fee2e2", icon: "ban", dot: "#f87171" },
  blocked: { bg: "rgba(190,18,60,0.96)", fg: "#ffffff", sub: "#ffe4e6", icon: "close-circle", dot: "#fb7185" },
  failed: { bg: "rgba(190,18,60,0.96)", fg: "#ffffff", sub: "#ffe4e6", icon: "alert-circle", dot: "#fb7185" },
};

export function vibrateScan(kind: PackHaptic): void {
  if (Platform.OS === "web") return;
  const N = Haptics.NotificationFeedbackType;
  const fire = (t: Haptics.NotificationFeedbackType) => void Haptics.notificationAsync(t).catch(() => {});
  if (kind === "success") fire(N.Success);
  else if (kind === "warning") fire(N.Warning);
  else {
    fire(N.Error);
    // Đơn hủy: nhịp thứ hai để tay cầm máy cũng nhận ra, không lẫn với lỗi thường.
    if (kind === "errorTwice") setTimeout(() => fire(N.Error), 350);
  }
}

export function ScanFlashOverlay({ flash }: { flash: PackFlash | null }) {
  if (!flash) return null;
  const fs = FLASH_STYLE[flash.kind];
  return (
    <View
      pointerEvents="none"
      className="absolute inset-0 items-center justify-center px-6"
      style={{ backgroundColor: fs.bg }}
      accessibilityLiveRegion="assertive"
      accessibilityLabel={`${flash.title}. ${flash.code}. ${flash.detail ?? ""}`}
    >
      <Ionicons name={fs.icon} size={92} color={fs.fg} />
      <Text className="mt-3 text-center text-[30px] font-extrabold leading-[36px]" style={{ color: fs.fg }}>
        {flash.title}
      </Text>
      <Text className="mt-2 text-center text-[19px] font-bold" style={[TABULAR, { color: fs.fg }]} numberOfLines={1}>
        {flash.code}
      </Text>
      {flash.meta ? (
        <Text className="mt-1 text-center text-sm font-medium" style={{ color: fs.sub }} numberOfLines={1}>
          {flash.meta}
        </Text>
      ) : null}
      {flash.detail ? (
        <Text className="mt-3 text-center text-[17px] font-semibold leading-6" style={{ color: fs.fg }}>
          {flash.detail}
        </Text>
      ) : null}
    </View>
  );
}
