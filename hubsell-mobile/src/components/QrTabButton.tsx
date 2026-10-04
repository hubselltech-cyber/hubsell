import React from "react";
import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

/**
 * Nút QR CHÍNH GIỮA thanh tab (anh Trung 04/10) — quét bất kỳ đơn nào để xem
 * chi tiết đơn hàng. Nút tròn emerald nằm gọn TRONG thanh tab (không nhô lên —
 * Android cắt phần tràn ra ngoài thanh), không nhãn chữ. Dùng chung cho khu
 * chủ shop và khu nhân viên.
 */
export function QrTabButton({
  onPress,
  onLongPress,
}: {
  onPress?: ((e: never) => void) | null;
  onLongPress?: ((e: never) => void) | null;
}) {
  return (
    <Pressable
      onPress={onPress as never}
      onLongPress={onLongPress as never}
      accessibilityRole="button"
      accessibilityLabel="Quét mã xem chi tiết đơn hàng"
      className="flex-1 items-center justify-center active:opacity-80"
    >
      <View className="h-11 w-11 items-center justify-center rounded-full bg-emerald-500">
        <Ionicons name="qr-code-outline" size={22} color="#fff" />
      </View>
    </Pressable>
  );
}
