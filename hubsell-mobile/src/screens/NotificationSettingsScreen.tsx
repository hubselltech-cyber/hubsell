import React, { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useColorScheme } from "nativewind";
import { useNotifications, type PushState } from "@/notifications/NotificationsContext";
import { fetchNotificationPreferences, saveNotificationPreferences } from "@/api/notifications";
import { ApiError } from "@/api/client";
import { categoryMeta } from "@/lib/notification-meta";
import { hapticSelect } from "@/lib/haptics";
import { ICON_TINT } from "@/theme/tokens";
import type { NotificationPreferencesResponse } from "@/types/api";

/**
 * CÀI ĐẶT THÔNG BÁO — hai khối: (1) công tắc nhận tin ĐẨY trên máy này
 * (quyền hệ điều hành + token thiết bị), (2) công tắc từng NHÓM — khách chọn
 * loại mình quan tâm (anh Trung 23/10/2026). Nhóm tắt thì cả chuông trong
 * app, chuông web lẫn tin đẩy đều im (backend bỏ qua ngay khi phát).
 * Lưu ngay khi gạt, lỗi mạng thì gạt về như cũ + báo một dòng.
 */
export function NotificationSettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const dark = useColorScheme().colorScheme === "dark";
  const { push, enablePush, disablePush } = useNotifications();
  const [prefs, setPrefs] = useState<NotificationPreferencesResponse | null>(null);
  const [error, setError] = useState("");
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    fetchNotificationPreferences()
      .then(setPrefs)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Không tải được cài đặt"));
  }, []);

  const toggleCategory = (key: string, on: boolean) => {
    if (!prefs) return;
    hapticSelect();
    const before = prefs.muted;
    const muted = on ? before.filter((k) => k !== key) : [...new Set([...before, key])];
    setPrefs({ ...prefs, muted });
    setError("");
    saveNotificationPreferences(muted)
      .then(setPrefs)
      .catch((err: unknown) => {
        setPrefs((p) => (p ? { ...p, muted: before } : p));
        setError(err instanceof ApiError ? err.message : "Chưa lưu được, thử lại");
      });
  };

  const togglePush = async (on: boolean) => {
    hapticSelect();
    setPushBusy(true);
    try {
      if (on) await enablePush();
      else await disablePush();
    } finally {
      setPushBusy(false);
    }
  };

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.navigate("/notifications");
  };

  return (
    <View className="flex-1 bg-slate-50 dark:bg-slate-950" style={{ paddingTop: insets.top + 6 }}>
      <View className="mb-1 flex-row items-center gap-1 px-2">
        <Pressable
          className="h-10 w-10 items-center justify-center rounded-full active:opacity-60"
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel="Quay lại"
        >
          <Ionicons name="chevron-back" size={24} color="#64748b" />
        </Pressable>
        <Text className="flex-1 text-lg font-bold text-slate-900 dark:text-slate-100">Cài đặt thông báo</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 + insets.bottom }}>
        {/* ===== Trên máy này ===== */}
        <View className="mb-4 rounded-2xl bg-white p-4 dark:bg-slate-900" style={{ elevation: 2 }}>
          <View className="flex-row items-center gap-3">
            <View className="h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 dark:bg-emerald-500/15">
              <Ionicons name="phone-portrait-outline" size={20} color="#059669" />
            </View>
            <View className="flex-1">
              <Text className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Nhận thông báo đẩy trên máy này
              </Text>
              <Text className="text-[11px] leading-4 text-slate-500 dark:text-slate-400">
                {pushHint(push)}
              </Text>
            </View>
            {pushBusy ? (
              <ActivityIndicator color="#10b981" />
            ) : (
              <Switch
                value={push.status === "on"}
                disabled={push.status === "unsupported" || push.status === "error"}
                onValueChange={(on) => void togglePush(on)}
                trackColor={{ true: "#10b981" }}
              />
            )}
          </View>
          {push.status === "denied" ? (
            <Pressable
              className="mt-3 flex-row items-center justify-center gap-1.5 rounded-xl bg-slate-100 py-2.5 active:opacity-70 dark:bg-slate-800"
              onPress={() => void Linking.openSettings()}
              accessibilityRole="button"
            >
              <Ionicons name="settings-outline" size={15} color="#475569" />
              <Text className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Mở Cài đặt {Platform.OS === "ios" ? "iPhone" : "điện thoại"}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {/* ===== Loại thông báo ===== */}
        <Text className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          Loại thông báo
        </Text>
        <View className="rounded-2xl bg-white px-4 dark:bg-slate-900" style={{ elevation: 2 }}>
          {!prefs ? (
            <View className="items-center py-10">
              {error ? (
                <Text className="text-center text-sm text-red-500">{error}</Text>
              ) : (
                <ActivityIndicator color="#64748b" />
              )}
            </View>
          ) : (
            prefs.categories.map((c, i) => {
              const meta = categoryMeta(c.key);
              const tint = ICON_TINT[meta.tint];
              const on = c.locked || !prefs.muted.includes(c.key);
              return (
                <View
                  key={c.key}
                  className={`flex-row items-center gap-3 py-3 ${
                    i < prefs.categories.length - 1 ? "border-b border-slate-100 dark:border-slate-800" : ""
                  }`}
                >
                  <View
                    className="h-9 w-9 items-center justify-center rounded-xl"
                    style={{ backgroundColor: dark ? tint.dark : tint.light }}
                  >
                    <Ionicons name={meta.icon} size={18} color={tint.icon} />
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="text-sm font-medium text-slate-900 dark:text-slate-100" numberOfLines={2}>
                      {c.label}
                    </Text>
                    <Text className="text-[11px] leading-4 text-slate-500 dark:text-slate-400" numberOfLines={2}>
                      {c.hint}
                    </Text>
                  </View>
                  <Switch
                    value={on}
                    disabled={!!c.locked}
                    onValueChange={(v) => toggleCategory(c.key, v)}
                    trackColor={{ true: "#10b981" }}
                    accessibilityLabel={c.label}
                  />
                </View>
              );
            })
          )}
        </View>
        {error && prefs ? <Text className="mt-2 px-1 text-xs text-red-500">{error}</Text> : null}
        <Text className="mt-3 px-1 text-[11px] leading-4 text-slate-400 dark:text-slate-500">
          Tắt nhóm nào thì chuông trong app, bản web và tin đẩy đều không báo nhóm đó. Cài đặt theo tài
          khoản, dùng chung mọi thiết bị.
        </Text>
      </ScrollView>
    </View>
  );
}

function pushHint(p: PushState): string {
  switch (p.status) {
    case "on":
      return "Đang bật. Đơn hỏa tốc, khách xin hủy… sẽ báo ngay cả khi không mở app.";
    case "denied":
      return "Điện thoại đang chặn thông báo của Hubsell. Cho phép trong Cài đặt rồi bật lại.";
    case "error":
      return "Bản dựng này chưa bật được tin đẩy. Chuông trong app vẫn hoạt động.";
    case "unsupported":
      return "Không hỗ trợ trên nền này.";
    default:
      return "Bật để nhận tin ngay cả khi không mở app.";
  }
}
