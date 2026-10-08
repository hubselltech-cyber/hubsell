import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAuth } from "../auth/AuthContext";
import { changePassword, deleteAccount } from "../api/auth";
import { usePlan } from "@/plan/PlanContext";
import { ApiError } from "../api/client";
import type { MyPlanResponse } from "../types/api";
import { UserAvatar } from "./UserAvatar";

/** "+84912345678" → "0912345678" — khách Việt đọc số theo dạng trong nước. */
function displayPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  return phone.startsWith("+84") ? `0${phone.slice(3)}` : phone;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Nhãn + dòng phụ của gói — cùng cách gọi tên với /settings/plan trên web. */
function planSummary(data: MyPlanResponse): {
  name: string;
  badge: { label: string; tone: "sky" | "red" } | null;
  note: string | null;
} | null {
  // Tài khoản điều hành nền tảng không bị gói nào ràng — vẫn hiện dòng để
  // người dùng khỏi tưởng thiếu thông tin.
  if (data.exempt) {
    return { name: "Tài khoản điều hành", badge: null, note: "Không giới hạn theo gói" };
  }
  if (!data.plan) return null;
  const sub = data.subscription;
  if (!sub) return { name: data.plan.name, badge: null, note: null };
  const end = sub.currentPeriodEnd;
  if (sub.status !== "ACTIVE") {
    return {
      name: data.plan.name,
      badge: { label: sub.isTrial ? "Hết dùng thử" : "Quá hạn", tone: "red" },
      note: end ? `Đã hết hạn ${fmtDate(end)}` : null,
    };
  }
  return {
    name: data.plan.name,
    badge: sub.isTrial ? { label: "Dùng thử", tone: "sky" } : null,
    note: end
      ? `Hết hạn ${fmtDate(end)}${sub.daysLeft !== null ? ` · còn ${sub.daysLeft} ngày` : ""}`
      : "Không thời hạn",
  };
}

function InfoRow({
  icon,
  label,
  children,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View className="flex-row items-center gap-3 border-t border-slate-100 py-3 dark:border-slate-800">
      <View className="h-9 w-9 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800">
        <Ionicons name={icon} size={18} color="#64748b" />
      </View>
      <View className="flex-1">
        <Text className="text-[11px] text-slate-500 dark:text-slate-400">{label}</Text>
        {children}
      </View>
    </View>
  );
}

/**
 * Dòng "Gói đang dùng" TẮT trên cả hai nền tảng (anh Trung 08/10: một bản dựng,
 * iOS + Android cùng hành vi; luật store xem plan/plan-ui.ts). Giữ mã để bật
 * lại khi có cách bán hợp lệ trong app.
 */
const SHOW_PLAN = false;

const VALUE_CLS = "text-sm font-medium text-slate-900 dark:text-slate-100";
const EMPTY_CLS = "text-sm text-slate-400 dark:text-slate-500";
const INPUT_CLS =
  "rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100";

/**
 * Trang Tài khoản — mở từ dòng tên ở đầu màn Cấu hình: thông tin liên hệ, gói
 * đang dùng, đổi mật khẩu, đăng xuất. Dùng chung cho cả 2 vai.
 */
export function AccountScreen() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  // Gói đang dùng — đọc từ PlanContext (một nguồn với dải nhắc Trang chủ);
  // chưa tải được thì chỉ ẩn dòng gói, không chặn cả màn.
  // iOS KHÔNG hiện: Apple từ chối 3.1.1 (06/10/2026) vì thấy "gói · dùng thử ·
  // hết hạn" mà không mua được bằng In-App Purchase. Gói bán cho doanh nghiệp
  // trên web, app chỉ là công cụ dùng — trên iOS giấu luôn cho khỏi tranh cãi.
  const { plan: myPlan } = usePlan();
  const plan = SHOW_PLAN ? myPlan : null;

  if (!user) return null;

  const identity =
    user.staffUsername && user.username
      ? `${user.username}/${user.staffUsername}`
      : (user.username ?? user.email ?? "");
  const roleLabel = user.role === "ADMIN" ? "Chủ shop" : "Nhân viên";
  const phone = displayPhone(user.phone);
  const planInfo = plan ? planSummary(plan) : null;

  const submit = async () => {
    setMessage(null);
    if (!current || !next) {
      setMessage({ ok: false, text: "Điền đủ mật khẩu hiện tại và mật khẩu mới" });
      return;
    }
    if (next !== confirm) {
      setMessage({ ok: false, text: "Mật khẩu nhập lại không khớp" });
      return;
    }
    setBusy(true);
    try {
      await changePassword(current, next);
      setMessage({ ok: true, text: "Đã đổi mật khẩu thành công" });
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      setMessage({
        ok: false,
        text: err instanceof ApiError ? err.message : "Có lỗi xảy ra, thử lại sau",
      });
    } finally {
      setBusy(false);
    }
  };

  const isOwner = user.role === "ADMIN";

  // Xóa tài khoản ngay trong app (Apple 5.1.1(v)): đòi mật khẩu + hộp xác nhận.
  const runDelete = async () => {
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await deleteAccount(deletePassword);
      await signOut();
      router.replace("/login");
      Alert.alert(
        "Đã xóa tài khoản",
        "Thông tin cá nhân của bạn đã được xóa. Dữ liệu còn lại sẽ xóa hẳn trong 30 ngày."
      );
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : "Có lỗi xảy ra, thử lại sau");
    } finally {
      setDeleteBusy(false);
    }
  };
  const confirmDelete = () => {
    setDeleteError("");
    if (!deletePassword) {
      setDeleteError("Nhập mật khẩu hiện tại để xác nhận");
      return;
    }
    Alert.alert(
      "Xóa tài khoản?",
      isOwner
        ? "Tài khoản của bạn và mọi nhân viên trong shop sẽ bị khóa ngay, gian hàng ngừng đồng bộ. Không hoàn tác được."
        : "Tài khoản của bạn sẽ bị khóa ngay và không hoàn tác được.",
      [
        { text: "Hủy", style: "cancel" },
        { text: "Xóa tài khoản", style: "destructive", onPress: () => void runDelete() },
      ]
    );
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-slate-50 dark:bg-slate-950"
      behavior="padding"
    >
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          padding: 16,
          paddingTop: insets.top + 12,
          paddingBottom: insets.bottom + 24,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="mb-4 flex-row items-center gap-2">
          <Pressable
            className="h-10 w-10 items-center justify-center rounded-full active:opacity-70"
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
            accessibilityRole="button"
            accessibilityLabel="Quay lại"
            hitSlop={8}
          >
            <Ionicons name="chevron-back" size={24} color="#64748b" />
          </Pressable>
          <Text className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Tài khoản
          </Text>
        </View>

        <View
          className="mb-4 rounded-2xl bg-white px-4 pt-4 dark:bg-slate-900"
          style={{ elevation: 2 }}
        >
          <View className="flex-row items-center gap-3 pb-4">
            <UserAvatar user={user} />
            <View className="flex-1">
              <Text className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {user.fullName}
              </Text>
              <Text className="text-xs text-slate-500 dark:text-slate-400">
                {identity} · {roleLabel}
              </Text>
            </View>
          </View>

          <InfoRow icon="call-outline" label="Số điện thoại">
            <Text className={phone ? VALUE_CLS : EMPTY_CLS} selectable>
              {phone || "Chưa có"}
            </Text>
          </InfoRow>

          <InfoRow icon="mail-outline" label="Email">
            <Text className={user.email ? VALUE_CLS : EMPTY_CLS} selectable>
              {user.email || "Chưa có"}
            </Text>
          </InfoRow>

          {planInfo ? (
            <InfoRow icon="ribbon-outline" label="Gói đang dùng">
              <View className="flex-row flex-wrap items-center gap-2">
                <Text className={VALUE_CLS}>{planInfo.name}</Text>
                {planInfo.badge ? (
                  <View
                    className={`rounded-full px-2 py-0.5 ${
                      planInfo.badge.tone === "red"
                        ? "bg-red-50 dark:bg-red-500/15"
                        : "bg-sky-50 dark:bg-sky-500/15"
                    }`}
                  >
                    <Text
                      className={`text-[11px] font-semibold ${
                        planInfo.badge.tone === "red"
                          ? "text-red-600 dark:text-red-400"
                          : "text-sky-700 dark:text-sky-300"
                      }`}
                    >
                      {planInfo.badge.label}
                    </Text>
                  </View>
                ) : null}
              </View>
              {planInfo.note ? (
                <Text className="text-[11px] text-slate-500 dark:text-slate-400">
                  {planInfo.note}
                </Text>
              ) : null}
            </InfoRow>
          ) : null}
        </View>

        <View
          className="mb-4 rounded-2xl bg-white p-4 dark:bg-slate-900"
          style={{ elevation: 2 }}
        >
          <Text className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
            Đổi mật khẩu
          </Text>
          <TextInput
            className={`mb-2 ${INPUT_CLS}`}
            placeholder="Mật khẩu hiện tại"
            placeholderTextColor="#94a3b8"
            secureTextEntry
            value={current}
            onChangeText={setCurrent}
          />
          <TextInput
            className={`mb-2 ${INPUT_CLS}`}
            placeholder="Mật khẩu mới (tối thiểu 8 ký tự)"
            placeholderTextColor="#94a3b8"
            secureTextEntry
            value={next}
            onChangeText={setNext}
          />
          <TextInput
            className={`mb-3 ${INPUT_CLS}`}
            placeholder="Nhập lại mật khẩu mới"
            placeholderTextColor="#94a3b8"
            secureTextEntry
            value={confirm}
            onChangeText={setConfirm}
          />
          {message ? (
            <Text
              className={`mb-2 text-xs ${message.ok ? "text-emerald-600" : "text-red-500"}`}
            >
              {message.text}
            </Text>
          ) : null}
          <Pressable
            className="items-center rounded-xl bg-slate-900 py-3 active:opacity-80 dark:bg-slate-700"
            onPress={submit}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text className="text-sm font-semibold text-white">Đổi mật khẩu</Text>
            )}
          </Pressable>
        </View>

        <View
          className="mb-4 rounded-2xl bg-white p-4 dark:bg-slate-900"
          style={{ elevation: 2 }}
        >
          <Text className="mb-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
            Xóa tài khoản
          </Text>
          <Text className="mb-3 text-xs leading-5 text-slate-500 dark:text-slate-400">
            Xóa ngay thông tin cá nhân (tên, email, số điện thoại, ảnh) và khóa đăng nhập.
            {isOwner ? " Nhân viên trong shop cũng bị khóa, gian hàng ngừng đồng bộ." : ""}{" "}
            Dữ liệu còn lại xóa hẳn trong 30 ngày; chứng từ kế toán giữ theo luật. Không hoàn
            tác được.
          </Text>
          <TextInput
            className={`mb-3 ${INPUT_CLS}`}
            placeholder="Mật khẩu hiện tại để xác nhận"
            placeholderTextColor="#94a3b8"
            secureTextEntry
            value={deletePassword}
            onChangeText={setDeletePassword}
          />
          {deleteError ? <Text className="mb-2 text-xs text-red-500">{deleteError}</Text> : null}
          <Pressable
            className="items-center rounded-xl border border-red-300 py-3 active:opacity-80 dark:border-red-800"
            onPress={confirmDelete}
            disabled={deleteBusy}
            accessibilityRole="button"
          >
            {deleteBusy ? (
              <ActivityIndicator color="#ef4444" size="small" />
            ) : (
              <Text className="text-sm font-semibold text-red-500">Xóa tài khoản</Text>
            )}
          </Pressable>
        </View>

        <Pressable
          className="flex-row items-center justify-center gap-2 rounded-2xl border border-red-200 bg-white py-3.5 active:opacity-80 dark:border-red-900 dark:bg-slate-900"
          onPress={async () => {
            await signOut();
            router.replace("/login");
          }}
        >
          <Ionicons name="log-out-outline" size={18} color="#ef4444" />
          <Text className="text-sm font-semibold text-red-500">Đăng xuất</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
