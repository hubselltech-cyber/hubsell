import React from "react";
import { Pressable, ScrollView, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import Constants from "expo-constants";
import { useAuth } from "../auth/AuthContext";
import { useThemePref, type ThemePref } from "../theme/ThemeContext";
import { useBiometricLock } from "../auth/BiometricGate";
import { SegmentedTabs } from "./SegmentedTabs";
import { UserAvatar } from "./UserAvatar";

/**
 * Trang công khai trên landing (hubsell.vn) — cả App Store lẫn Google Play đều
 * bắt app có link Chính sách bảo mật ngay trong app (Apple 5.1.1). Nút xóa tài
 * khoản THẬT nằm trong AccountScreen (Apple 5.1.1(v) đòi xóa ngay trong app);
 * link ở đây chỉ là trang chính sách. Mở bằng trình duyệt trong app.
 */
const SITE = "https://hubsell.vn";
const ABOUT_LINKS: { key: string; label: string; hint: string; url: string; icon: React.ComponentProps<typeof Ionicons>["name"] }[] = [
  {
    key: "support",
    label: "Trung tâm hỗ trợ",
    hint: "Email, Zalo, hướng dẫn sử dụng",
    url: `${SITE}/ho-tro`,
    icon: "help-buoy-outline",
  },
  {
    key: "privacy",
    label: "Chính sách bảo mật",
    hint: "Dữ liệu nào được thu thập, dùng ra sao",
    url: `${SITE}/privacy`,
    icon: "shield-checkmark-outline",
  },
  {
    key: "terms",
    label: "Điều khoản dịch vụ",
    hint: "Quy định sử dụng Hubsell",
    url: `${SITE}/terms`,
    icon: "document-text-outline",
  },
  {
    key: "delete",
    label: "Chính sách xóa tài khoản",
    hint: "Nút xóa nằm trong trang Tài khoản — dữ liệu xóa hẳn trong 30 ngày",
    url: `${SITE}/xoa-tai-khoan`,
    icon: "trash-outline",
  },
];

const APP_VERSION = Constants.expoConfig?.version ?? "1.0.0";

const THEME_OPTIONS: { key: ThemePref; label: string }[] = [
  { key: "light", label: "Sáng" },
  { key: "dark", label: "Tối" },
  { key: "system", label: "Hệ thống" },
];

/** Màn Cấu hình — dùng chung cho cả 2 vai. Dòng tên mở trang Tài khoản. */
export function SettingsScreen() {
  const { user } = useAuth();
  const { pref, setPref } = useThemePref();
  const bio = useBiometricLock();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  if (!user) return null;

  const identity =
    user.staffUsername && user.username
      ? `${user.username}/${user.staffUsername}`
      : (user.username ?? user.email ?? "");
  const roleLabel = user.role === "ADMIN" ? "Chủ shop" : "Nhân viên";

  return (
    <View className="flex-1 bg-slate-50 dark:bg-slate-950">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingTop: insets.top + 16 }}
      >
        <Text className="mb-4 text-2xl font-bold text-slate-900 dark:text-slate-100">
          Cấu hình
        </Text>

        {/* Tài khoản — liên hệ, gói, đổi mật khẩu, đăng xuất nằm trong trang con */}
        <Pressable
          className="mb-4 flex-row items-center gap-3 rounded-2xl bg-white p-4 active:opacity-70 dark:bg-slate-900"
          style={{ elevation: 2 }}
          onPress={() => router.push("/account")}
          accessibilityRole="button"
          accessibilityLabel="Mở trang Tài khoản"
        >
          <UserAvatar user={user} />
          <View className="flex-1">
            <Text className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {user.fullName}
            </Text>
            <Text className="text-xs text-slate-500 dark:text-slate-400">
              {identity} · {roleLabel}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#94a3b8" />
        </Pressable>

        {/* Giao diện Sáng/Tối — mặc định theo lịch sáng↔tối của hệ điều hành */}
        <View
          className="mb-4 rounded-2xl bg-white p-4 dark:bg-slate-900"
          style={{ elevation: 2 }}
        >
          <Text className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
            Giao diện
          </Text>
          <SegmentedTabs options={THEME_OPTIONS} value={pref} onChange={setPref} />
          <Text className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">
            "Hệ thống" tự chuyển sáng↔tối theo cài đặt điện thoại.
          </Text>
        </View>

        {/* Khóa app bằng Face ID/vân tay — chỉ hiện khi máy có sinh trắc học */}
        {bio.supported ? (
          <View
            className="mb-4 rounded-2xl bg-white p-4 dark:bg-slate-900"
            style={{ elevation: 2 }}
          >
            <View className="flex-row items-center gap-3">
              <View className="h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 dark:bg-emerald-500/15">
                <Ionicons name="finger-print" size={20} color="#059669" />
              </View>
              <View className="flex-1">
                <Text className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Khóa app bằng sinh trắc học
                </Text>
                <Text className="text-[11px] text-slate-500 dark:text-slate-400">
                  Mở app phải Face ID/vân tay mới xem được số liệu
                </Text>
              </View>
              <Switch
                value={bio.enabled}
                onValueChange={(on) => void bio.setEnabled(on)}
                trackColor={{ true: "#10b981" }}
              />
            </View>
          </View>
        ) : null}

        {/* Về Hubsell — link pháp lý + hỗ trợ (bắt buộc để lên App Store / Google Play) */}
        <View
          className="mb-4 rounded-2xl bg-white px-4 py-2 dark:bg-slate-900"
          style={{ elevation: 2 }}
        >
          <Text className="mb-1 mt-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            Về Hubsell
          </Text>
          {ABOUT_LINKS.map((l, i) => (
            <Pressable
              key={l.key}
              className={`flex-row items-center gap-3 py-3 active:opacity-70 ${
                i < ABOUT_LINKS.length - 1
                  ? "border-b border-slate-100 dark:border-slate-800"
                  : ""
              }`}
              onPress={() => void WebBrowser.openBrowserAsync(l.url)}
              accessibilityRole="link"
            >
              <View
                className={`h-9 w-9 items-center justify-center rounded-xl ${
                  l.key === "delete"
                    ? "bg-red-50 dark:bg-red-500/10"
                    : "bg-slate-100 dark:bg-slate-800"
                }`}
              >
                <Ionicons
                  name={l.icon}
                  size={18}
                  color={l.key === "delete" ? "#ef4444" : "#475569"}
                />
              </View>
              <View className="flex-1">
                <Text
                  className={`text-sm font-medium ${
                    l.key === "delete"
                      ? "text-red-500"
                      : "text-slate-900 dark:text-slate-100"
                  }`}
                >
                  {l.label}
                </Text>
                <Text className="text-[11px] text-slate-500 dark:text-slate-400">
                  {l.hint}
                </Text>
              </View>
              <Ionicons name="open-outline" size={16} color="#94a3b8" />
            </Pressable>
          ))}
        </View>

        <Text className="mt-6 text-center text-[11px] text-slate-400">
          Hubsell Mobile · v{APP_VERSION}
        </Text>
      </ScrollView>
    </View>
  );
}
