import React, { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useColorScheme } from "nativewind";
import { useNotifications, type PushState } from "@/notifications/NotificationsContext";
import { fetchNotificationPreferences, saveNotificationPreferences, sendTestPush } from "@/api/notifications";
import { ApiError } from "@/api/client";
import { categoryMeta, groupMeta } from "@/lib/notification-meta";
import { hapticSelect } from "@/lib/haptics";
import { ICON_TINT } from "@/theme/tokens";
import type { NotificationGroup, NotificationPreferencesResponse } from "@/types/api";

/**
 * CÀI ĐẶT THÔNG BÁO — anh Trung chốt 23/10/2026 chiều: chia NHÓM cha → con.
 * Mỗi nhóm (Đơn hàng, Tài chính, Quảng cáo, Kho, Gian hàng, Tài khoản) là một
 * thẻ: hàng đầu = tên nhóm + công tắc TỔNG; dưới = từng mục con với công tắc
 * riêng. Tắt tổng → mục con mờ đi (vẫn nhớ trạng thái riêng, bật tổng lại là
 * như cũ). Mục khóa (gói, hệ thống) luôn bật. Khối "Nhận thông báo đẩy trên
 * máy này" đứng trên cùng. Lưu ngay khi gạt; lỗi mạng gạt về như cũ + báo.
 * Danh sách đã tắt gửi backend = khóa nhóm và/hoặc khóa mục.
 */
export function NotificationSettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const dark = useColorScheme().colorScheme === "dark";
  const { push, enablePush, disablePush } = useNotifications();
  const [prefs, setPrefs] = useState<NotificationPreferencesResponse | null>(null);
  const [error, setError] = useState("");
  const [pushBusy, setPushBusy] = useState(false);
  // Nút gửi thử: "" = chưa bấm, "sending", hoặc câu kết quả hiện dưới nút vài giây.
  const [testState, setTestState] = useState("");

  const testPush = async () => {
    hapticSelect();
    setTestState("sending");
    try {
      const r = await sendTestPush();
      setTestState(r.sent > 0 ? `Đã gửi tới ${r.sent} máy — tin sẽ hiện sau vài giây.` : "Chưa có máy nào đăng ký nhận. Gạt công tắc ở trên rồi thử lại.");
    } catch (err) {
      setTestState(err instanceof ApiError ? err.message : "Không gửi được, thử lại sau");
    }
  };

  useEffect(() => {
    fetchNotificationPreferences()
      .then(setPrefs)
      .catch((err: unknown) =>
        setError(
          err instanceof ApiError && err.status === 404
            ? "Máy chủ chưa cập nhật tính năng này, thử lại sau."
            : err instanceof ApiError
              ? err.message
              : "Không tải được cài đặt"
        )
      );
  }, []);

  const save = (muted: string[], before: string[]) => {
    setPrefs((p) => (p ? { ...p, muted } : p));
    setError("");
    saveNotificationPreferences(muted)
      .then(setPrefs)
      .catch((err: unknown) => {
        setPrefs((p) => (p ? { ...p, muted: before } : p));
        setError(err instanceof ApiError ? err.message : "Chưa lưu được, thử lại");
      });
  };

  const toggleKey = (key: string, on: boolean) => {
    if (!prefs) return;
    hapticSelect();
    const before = prefs.muted;
    save(on ? before.filter((k) => k !== key) : [...new Set([...before, key])], before);
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

  // Công tắc máy này: tắt hẳn khi không hỗ trợ / thiếu Firebase; lỗi máy chủ thì
  // vẫn cho gạt để thử lại.
  const pushSwitchDisabled = push.status === "unsupported" || (push.status === "error" && push.errorKind === "build");

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
              <Text className="text-[11px] leading-4 text-slate-500 dark:text-slate-400">{pushHint(push)}</Text>
            </View>
            {pushBusy ? (
              <ActivityIndicator color="#10b981" />
            ) : (
              <Switch
                value={push.status === "on"}
                disabled={pushSwitchDisabled}
                onValueChange={(on) => void togglePush(on)}
                trackColor={{ true: "#10b981" }}
              />
            )}
          </View>
          {push.status === "on" ? (
            <>
              <Pressable
                className="mt-3 flex-row items-center justify-center gap-1.5 rounded-xl bg-emerald-50 py-2.5 active:opacity-70 dark:bg-emerald-500/15"
                onPress={() => void testPush()}
                disabled={testState === "sending"}
                accessibilityRole="button"
              >
                <Ionicons name="paper-plane-outline" size={15} color="#059669" />
                <Text className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                  {testState === "sending" ? "Đang gửi…" : "Gửi thử một thông báo"}
                </Text>
              </Pressable>
              {testState && testState !== "sending" ? (
                <Text className="mt-2 text-center text-[11px] leading-4 text-slate-500 dark:text-slate-400">{testState}</Text>
              ) : null}
            </>
          ) : null}
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

        {/* ===== Nhóm cha → mục con ===== */}
        {!prefs ? (
          <View className="items-center rounded-2xl bg-white py-10 dark:bg-slate-900" style={{ elevation: 2 }}>
            {error ? (
              <Text className="px-6 text-center text-sm text-red-500">{error}</Text>
            ) : (
              <ActivityIndicator color="#64748b" />
            )}
          </View>
        ) : (
          prefs.groups.map((g) => (
            <GroupCard key={g.key} group={g} muted={prefs.muted} dark={dark} onToggle={toggleKey} />
          ))
        )}
        {error && prefs ? <Text className="mt-1 px-1 text-xs text-red-500">{error}</Text> : null}
        <Text className="mt-2 px-1 text-[11px] leading-4 text-slate-400 dark:text-slate-500">
          Tắt mục nào thì chuông trong app, bản web và tin đẩy đều không báo mục đó. Cài đặt theo tài khoản,
          dùng chung mọi thiết bị.
        </Text>
      </ScrollView>
    </View>
  );
}

function GroupCard({
  group,
  muted,
  dark,
  onToggle,
}: {
  group: NotificationGroup;
  muted: string[];
  dark: boolean;
  onToggle: (key: string, on: boolean) => void;
}) {
  const gm = groupMeta(group.key);
  const gt = ICON_TINT[gm.tint];
  const groupLocked = group.items.every((it) => it.locked);
  const groupOn = groupLocked || !muted.includes(group.key);
  return (
    <View className="mb-3 rounded-2xl bg-white px-4 dark:bg-slate-900" style={{ elevation: 2 }}>
      {/* Hàng tổng của nhóm */}
      <View className="flex-row items-center gap-3 border-b border-slate-100 py-3 dark:border-slate-800">
        <View
          className="h-9 w-9 items-center justify-center rounded-xl"
          style={{ backgroundColor: dark ? gt.dark : gt.light }}
        >
          <Ionicons name={gm.icon} size={18} color={gt.icon} />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-base font-bold text-slate-900 dark:text-slate-100" numberOfLines={1}>
            {group.label}
          </Text>
          <Text className="text-[11px] text-slate-400 dark:text-slate-500">
            {groupLocked ? "Luôn bật" : groupOn ? "Đang nhận" : "Đã tắt cả nhóm"}
          </Text>
        </View>
        <Switch
          value={groupOn}
          disabled={groupLocked}
          onValueChange={(v) => onToggle(group.key, v)}
          trackColor={{ true: "#10b981" }}
          accessibilityLabel={`Bật tắt cả nhóm ${group.label}`}
        />
      </View>
      {/* Mục con — mờ đi khi tắt tổng, vẫn giữ trạng thái riêng */}
      {group.items.map((c, i) => {
        const meta = categoryMeta(c.key);
        const tint = ICON_TINT[meta.tint];
        const itemOn = !!c.locked || !muted.includes(c.key);
        const dimmed = !groupOn && !c.locked;
        return (
          <View
            key={c.key}
            className={`flex-row items-center gap-3 py-2.5 ${
              i < group.items.length - 1 ? "border-b border-slate-100 dark:border-slate-800" : ""
            }`}
            style={dimmed ? { opacity: 0.45 } : undefined}
          >
            <View
              className="ml-1 h-8 w-8 items-center justify-center rounded-lg"
              style={{ backgroundColor: dark ? tint.dark : tint.light }}
            >
              <Ionicons name={meta.icon} size={16} color={tint.icon} />
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
              value={itemOn && groupOn}
              disabled={!!c.locked || !groupOn}
              onValueChange={(v) => onToggle(c.key, v)}
              trackColor={{ true: "#10b981" }}
              accessibilityLabel={c.label}
            />
          </View>
        );
      })}
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
      return p.errorKind === "build"
        ? "Bản dựng này chưa bật được tin đẩy. Chuông trong app vẫn hoạt động."
        : "Chưa đăng ký được với máy chủ. Gạt để thử lại.";
    case "unsupported":
      return "Không hỗ trợ trên nền này.";
    default:
      return "Bật để nhận tin ngay cả khi không mở app.";
  }
}
