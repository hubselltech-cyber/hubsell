import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

/**
 * Haptic dùng chung cho thao tác UI thường nhật — web-sim thì im lặng
 * (expo-haptics trên web reject promise, gây warning nếu gọi thẳng).
 * Màn quét kho có bộ haptic ngữ nghĩa riêng (success/warning/error) tại chỗ.
 */

/** Rung "tách" nhẹ khi chọn tab / bộ lọc — kiểu selection của hệ điều hành. */
export function hapticSelect() {
  if (Platform.OS === "web") return;
  void Haptics.selectionAsync();
}

/** Rung nhẹ khi bấm hành động điều hướng / nút chính. */
export function hapticTap() {
  if (Platform.OS === "web") return;
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}
