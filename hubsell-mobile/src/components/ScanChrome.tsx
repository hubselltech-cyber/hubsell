import React from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import type { PermissionResponse } from "expo-camera";
import { ActionButton } from "@/components/ActionButton";
import { hapticSelect } from "@/lib/haptics";

/**
 * PHẦN DÙNG CHUNG của các màn quét bằng camera (05/11/2026): ScanScreen (quét nhận đơn
 * hoàn / xem chi tiết đơn) và PackScanScreen (quét đóng gói). Tách ra khi có màn quét
 * thứ hai — hai màn khác hẳn nhau về luồng (một bên dừng lại chờ bấm, một bên quét liên
 * tục) nhưng cùng loại mã, cùng nút nổi trên camera, cùng màn xin quyền.
 */

/** Loại mã camera đọc — tem của ba sàn dùng Code 128 cho mã vận đơn, kèm QR. */
export const SCANNABLE = [
  "qr",
  "code128",
  "code39",
  "code93",
  "itf14",
  "ean13",
  "datamatrix",
] as const;

// Liquid Glass (trend 2026) CHỈ cho lớp điều khiển nổi trên camera — panel
// dữ liệu vẫn nền đặc cho dễ đọc. Máy không hỗ trợ (Android/iOS cũ/web)
// fallback về đen mờ như cũ.
export const GLASS = isLiquidGlassAvailable();

/** Nút tròn trên nền camera: Liquid Glass khi máy hỗ trợ, fallback đen mờ. */
export function CircleControl({ children }: { children: React.ReactNode }) {
  if (GLASS) {
    return (
      <GlassView
        glassEffectStyle="regular"
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        {children}
      </GlassView>
    );
  }
  return (
    <View className="h-10 w-10 items-center justify-center rounded-full bg-black/40">
      {children}
    </View>
  );
}

/**
 * Màn giải thích TRƯỚC hộp xin quyền camera.
 * Apple 5.1.1(iv) (06/10/2026): màn này không được "thúc" người dùng cấp quyền — nút
 * phải là "Tiếp tục", không phải "Cấp quyền". Hộp quyền của hệ thống mới là nơi họ
 * quyết. iOS chỉ hỏi MỘT lần: đã từ chối thì requestPermission() về ngay không hiện gì
 * → canAskAgain=false: nói rõ và mở Cài đặt của app.
 */
export function CameraPermissionPrompt({
  permission,
  onRequest,
}: {
  permission: PermissionResponse;
  onRequest: () => void;
}) {
  const mustOpenSettings = !permission.canAskAgain;
  return (
    <View className="flex-1 items-center justify-center bg-slate-950 px-8">
      <Ionicons name="camera-outline" size={48} color="#64748b" />
      <Text className="mt-4 text-center text-base font-semibold text-white">
        Quét mã vận đơn bằng camera
      </Text>
      <Text className="mt-2 text-center text-sm text-slate-400 dark:text-slate-500">
        {mustOpenSettings
          ? "Camera đang tắt cho Hubsell. Bạn có thể bật lại trong Cài đặt → Hubsell → Camera."
          : "Màn hình này dùng camera để đọc mã trên tem kiện hàng. Ở bước tiếp theo, hệ thống sẽ hỏi bạn có cho phép hay không."}
      </Text>
      <ActionButton
        label={mustOpenSettings ? "Mở Cài đặt" : "Tiếp tục"}
        icon={mustOpenSettings ? "settings-outline" : "arrow-forward"}
        className="mt-6 min-w-[220px]"
        onPress={() => {
          if (mustOpenSettings) void Linking.openSettings();
          else onRequest();
        }}
      />
      <Text className="mt-6 text-center text-xs text-slate-500">
        Không dùng camera? Vào tab Đơn hàng để tìm đơn theo mã vận đơn / mã đơn.
      </Text>
    </View>
  );
}

/** Hai việc của nút QR giữa thanh tab (anh Trung chốt 05/11). */
export type ScanTabMode = "detail" | "pack";

const SCAN_TAB_MODES: { key: ScanTabMode; label: string }[] = [
  { key: "detail", label: "Xem đơn" },
  { key: "pack", label: "Đóng gói" },
];

/**
 * Công tắc "Xem đơn · Đóng gói" nổi trên camera ở tab QR giữa. Khu nhân viên không có
 * tab Đơn hàng nên đây là lối vào Quét đóng gói của người gói hàng. Nền đen mờ + chữ
 * trắng vì cảnh camera có thể sáng (tem trắng, kho đèn mạnh).
 */
export function ScanModeSwitch({
  value,
  onChange,
}: {
  value: ScanTabMode;
  onChange: (mode: ScanTabMode) => void;
}) {
  return (
    <View className="mt-3 flex-row self-center rounded-full bg-black/55 p-1">
      {SCAN_TAB_MODES.map((m) => {
        const active = value === m.key;
        return (
          <Pressable
            key={m.key}
            className="active:opacity-80"
            onPress={() => {
              if (active) return;
              hapticSelect();
              onChange(m.key);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={m.label}
            hitSlop={4}
          >
            {/* key theo trạng thái: đổi nền của một view đang hiện làm MẤT bo góc trên
                Android (bẫy 04/10, xem AppTabBar) → dựng lại viên khi đổi chế độ. */}
            <View
              key={active ? "on" : "off"}
              style={{
                borderRadius: 999,
                paddingHorizontal: 18,
                paddingVertical: 7,
                backgroundColor: active ? "#ffffff" : "transparent",
              }}
            >
              <Text
                className={`text-[13px] font-bold ${active ? "text-slate-900" : "text-white"}`}
              >
                {m.label}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
