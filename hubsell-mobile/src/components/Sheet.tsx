import React from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

/**
 * Khung HỘP TRƯỢT ĐÁY dùng chung cho các hộp của luồng Xử lý đơn (19/11/2026) — cùng hình
 * với hộp Bộ lọc / Thống kê của màn Đơn hàng: nền mờ, bo góc trên, tay nắm, tiêu đề + nút
 * đóng, đáy chừa phần nút điều hướng của máy (bẫy Android 04/10: thiếu
 * `navigationBarTranslucent` + đệm đáy là nút cuối bị thanh 3 nút che).
 *
 * `locked` = đang có việc dở trên máy chủ: bấm nền / phím Back / nút X đều không đóng.
 */
export function Sheet({
  visible,
  title,
  subtitle,
  onClose,
  locked = false,
  height,
  onBack,
  children,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  locked?: boolean;
  /** Lớp chiều cao của hộp; mặc định co theo nội dung, trần 88 % màn. */
  height?: "auto" | "tall";
  /** Có thì hiện mũi tên quay lại bên trái tiêu đề (hộp có nhiều bước). */
  onBack?: () => void;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const close = () => {
    if (!locked) onClose();
  };
  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="slide"
      onRequestClose={close}
    >
      <View className="flex-1 justify-end bg-black/40">
        <Pressable className="flex-1" onPress={close} accessibilityLabel="Đóng" />
        <View
          className={`rounded-t-3xl bg-white px-4 pt-3 dark:bg-slate-900 ${
            height === "tall" ? "h-[88%]" : "max-h-[88%]"
          }`}
          style={{ paddingBottom: 20 + insets.bottom }}
        >
          <View className="mb-1 items-center">
            <View className="h-1 w-10 rounded-full bg-slate-200 dark:bg-slate-700" />
          </View>
          <View className="mb-2 flex-row items-center gap-2">
            {onBack ? (
              <Pressable
                onPress={onBack}
                hitSlop={10}
                disabled={locked}
                accessibilityRole="button"
                accessibilityLabel="Quay lại"
              >
                <Ionicons name="chevron-back" size={20} color="#64748b" />
              </Pressable>
            ) : null}
            <View className="min-w-0 flex-1">
              <Text className="text-base font-bold text-slate-900 dark:text-slate-100" numberOfLines={1}>
                {title}
              </Text>
              {subtitle ? (
                <Text className="text-[11px] text-slate-500 dark:text-slate-400" numberOfLines={1}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
            {locked ? null : (
              <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Đóng">
                <Ionicons name="close" size={20} color="#64748b" />
              </Pressable>
            )}
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}

/** Nút chính ở đáy hộp — một hành động, chữ đậm, có trạng thái đang chạy. */
export function SheetButton({
  label,
  onPress,
  disabled = false,
  tone = "primary",
  icon,
  grow = 1,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: "primary" | "plain";
  icon?: keyof typeof Ionicons.glyphMap;
  /** Hệ số bề ngang so với nút bên cạnh (mặc định chia đều) — nút chính chữ dài đặt 1.5. */
  grow?: number;
}) {
  const primary = tone === "primary";
  return (
    <Pressable
      className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-xl py-3 active:opacity-80 ${
        primary ? "bg-emerald-500" : "bg-slate-100 dark:bg-slate-800"
      } ${disabled ? "opacity-50" : ""}`}
      style={grow === 1 ? undefined : { flexGrow: grow }}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
    >
      {icon ? <Ionicons name={icon} size={16} color={primary ? "#fff" : "#64748b"} /> : null}
      <Text
        className={`shrink text-sm font-bold ${primary ? "text-white" : "text-slate-600 dark:text-slate-300"}`}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}
