import React from "react";
import { Keyboard, Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { CircleControl } from "@/components/ScanChrome";

/**
 * THANH TRÊN của các màn quét liên tục: nút đóng / quay lại, tên màn + một dòng nói phải
 * làm gì, đèn pin, công tắc chế độ của tab QR giữa và khung ngắm. Nổi trên camera nên chữ
 * có đổ bóng (cảnh camera có thể SÁNG: tem trắng, kho đèn mạnh). Tách khỏi PackScanScreen
 * 12/11/2026 để Quét đóng gói và Quét nhiều dùng chung.
 */
export function ScanTopBar({
  title,
  subtitle,
  embedded,
  onClose,
  modeSwitch,
  torch,
  onToggleTorch,
  showViewfinder,
  viewfinderBottom = 150,
}: {
  title: string;
  subtitle: string;
  /** Đang nằm trong tab QR giữa → nút X (onClose) thay mũi tên quay lại. */
  embedded: boolean;
  onClose?: () => void;
  modeSwitch?: React.ReactNode;
  torch: boolean;
  onToggleTorch: () => void;
  /** Ẩn khung ngắm khi màn báo đang phủ camera. */
  showViewfinder: boolean;
  /** Phần đáy bị dải điều khiển che — khung ngắm canh giữa phần còn lại. */
  viewfinderBottom?: number;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const isWeb = Platform.OS === "web";
  return (
    <View pointerEvents="box-none" className="absolute inset-0" style={{ paddingTop: insets.top + 12 }}>
      <View className="flex-row items-center justify-between px-4">
        <View className="flex-1 flex-row items-center gap-2.5 pr-2">
          {embedded && onClose ? (
            <Pressable
              className="active:opacity-70"
              onPress={() => {
                Keyboard.dismiss();
                onClose();
              }}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Đóng màn quét"
            >
              <CircleControl>
                <Ionicons name="close" size={22} color="#fff" />
              </CircleControl>
            </Pressable>
          ) : !embedded && router.canGoBack() ? (
            <Pressable
              className="active:opacity-70"
              onPress={() => router.back()}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Quay lại"
            >
              <CircleControl>
                <Ionicons name="arrow-back" size={20} color="#fff" />
              </CircleControl>
            </Pressable>
          ) : null}
          <View className="flex-1">
            <Text
              className="text-lg font-bold text-white"
              style={{ textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 4 }}
            >
              {title}
            </Text>
            <Text
              className="text-[11px] text-slate-200"
              style={{ textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 3 }}
              numberOfLines={1}
            >
              {subtitle}
            </Text>
          </View>
        </View>
        {!isWeb ? (
          <Pressable
            className="active:opacity-70"
            onPress={onToggleTorch}
            accessibilityRole="button"
            accessibilityLabel={torch ? "Tắt đèn" : "Bật đèn"}
          >
            {torch ? (
              <View className="h-10 w-10 items-center justify-center rounded-full bg-amber-400">
                <Ionicons name="flash" size={18} color="#0f172a" />
              </View>
            ) : (
              <CircleControl>
                <Ionicons name="flash-outline" size={18} color="#fff" />
              </CircleControl>
            )}
          </Pressable>
        ) : null}
      </View>
      {modeSwitch}
      {!isWeb && showViewfinder ? (
        <View className="flex-1 items-center justify-center" style={{ paddingBottom: viewfinderBottom }}>
          <View className="h-40 w-72 rounded-2xl border-2 border-white/80" />
        </View>
      ) : null}
    </View>
  );
}
