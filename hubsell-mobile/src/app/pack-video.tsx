import React, { useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError } from "@/api/client";
import { acceptPackVideoConsent } from "@/api/pack-video";
import { useAuth } from "@/auth/AuthContext";
import { hasPackVideoNative, packVideoGate, packVideoRecordCaps } from "@/lib/pack-video-access";
import { hapticTap } from "@/lib/haptics";

/**
 * /pack-video — CỬA của màn quay video đóng hàng / khui hàng hoàn (`?mode=unbox`), route gốc phủ thanh tab như màn
 * Quét đóng gói. Lối vào: nút "Quay video" ở tab Đơn hàng, nút "Quay video khui hàng" ở Kho › Đơn hoàn.
 *
 * Cửa này KHÔNG nhập thư viện camera: màn quay thật (screens/PackVideoScreen) được nạp MUỘN, chỉ sau khi biết bản app
 * có phần gốc camera quay video — mã JS này có thể tới bản app cũ qua cập nhật từ xa, nạp thư viện ở đó là văng.
 * Thứ tự kiểm: đăng nhập → bản app có camera quay → cổng máy chủ (đã mở / chủ shop cần đồng ý / chưa mở) → quyền quay.
 */
export default function PackVideoRoute() {
  const { status, user } = useAuth();
  const params = useLocalSearchParams<{ mode?: string }>();

  if (status === "loading") return null;
  if (status === "signedOut" || !user) return <Redirect href="/login" />;

  if (!hasPackVideoNative()) {
    return (
      <Notice
        title="Bản app này chưa quay video được"
        body="Cập nhật app Hubsell lên bản mới nhất trên App Store / CH Play rồi mở lại mục này."
      />
    );
  }

  const gate = packVideoGate(user);
  if (gate === "consent") {
    return user.role === "ADMIN" ? (
      <ConsentCard />
    ) : (
      <Notice
        title="Chủ shop chưa bật Video đóng hàng"
        body="Nhờ chủ shop mở mục Quay video trên app hoặc trang Video đóng hàng trên web và bấm đồng ý một lần."
      />
    );
  }
  const caps = packVideoRecordCaps(user);
  if (gate !== "open" || (!caps.pack && !caps.unbox)) {
    return (
      <Notice
        title="Tài khoản chưa quay video được"
        body="Tính năng Video đóng hàng chưa mở cho tài khoản này, hoặc tài khoản chưa có quyền Đơn hàng / Đối soát đơn hoàn."
      />
    );
  }

  // Nạp muộn — xem chú thích đầu tệp.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PackVideoScreen } = require("@/screens/PackVideoScreen") as typeof import("@/screens/PackVideoScreen");
  return <PackVideoScreen initialMode={params.mode === "unbox" ? "unbox" : undefined} />;
}

function useLeave() {
  const router = useRouter();
  return () => {
    hapticTap();
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };
}

function Shell({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const leave = useLeave();
  return (
    <View
      className="flex-1 bg-slate-50 px-5 dark:bg-slate-950"
      style={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }}
    >
      <Pressable
        onPress={leave}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Trở về"
        className="mb-2 flex-row items-center gap-1 self-start rounded-lg py-2 pr-3 active:opacity-70"
      >
        <Ionicons name="chevron-back" size={20} color="#64748b" />
        <Text className="text-sm font-semibold text-slate-600 dark:text-slate-300">Trở về</Text>
      </Pressable>
      {/* Cuộn được: thẻ đồng ý dài hơn màn hình ở máy nhỏ / cỡ chữ máy lớn thì vẫn kéo tới được nút. */}
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ flexGrow: 1, justifyContent: "center", paddingVertical: 8 }}
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </View>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <Shell>
      <View className="items-center gap-3 rounded-2xl border border-slate-900/5 bg-white p-6 dark:border-white/5 dark:bg-slate-900">
        <View className="h-11 w-11 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
          <Ionicons name="videocam-off-outline" size={20} color="#64748b" />
        </View>
        <Text className="text-center text-base font-semibold text-slate-900 dark:text-slate-100">{title}</Text>
        <Text className="text-center text-sm leading-5 text-slate-600 dark:text-slate-300">{body}</Text>
      </View>
    </Shell>
  );
}

const PRIVACY_URL = "https://hubsell.vn/privacy";

/** Ba điều chủ shop cần biết trước khi bật — cùng nội dung với thẻ bật trên web (video-consent.tsx). */
const CONSENT_POINTS = [
  "Video có hình tem vận đơn: tên, số điện thoại, địa chỉ người mua.",
  "Video lưu ở kho Cloudflare R2 đặt ngoài Việt Nam, chỉ tài khoản của shop xem được.",
  "Hệ thống tự xóa video sau khi đơn qua hạn khiếu nại 3 ngày, lưu tối đa 60 ngày từ ngày quay. Shop tự xóa từng video được bất cứ lúc nào trên web.",
  "Tặng 2 giờ quay đầu tiên.",
];

/**
 * THẺ BẬT VIDEO ĐÓNG HÀNG — lần đầu chủ shop mở mục này (máy chủ trả cổng "consent"). Video có hình tem vận đơn và
 * lưu ở kho ngoài Việt Nam nên Chính sách bảo mật hứa xin đồng ý trước. Bấm xong máy chủ ghi sổ đồng ý + tặng giờ
 * quay; app đọc lại người dùng và màn quay mở ngay. KHÔNG nêu giá / lời mời mua giờ ở đây (app không bán giờ quay).
 */
function ConsentCard() {
  const { refreshUser } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const accept = async () => {
    if (busy) return;
    hapticTap();
    setBusy(true);
    setError("");
    try {
      await acceptPackVideoConsent();
      await refreshUser(); // máy chủ quyết cổng: đọc lại người dùng để màn quay mở
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Chưa bật được, thử lại sau.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <View className="gap-4 rounded-2xl border border-slate-900/5 bg-white p-6 dark:border-white/5 dark:bg-slate-900">
        <View className="items-center gap-2">
          <View className="h-11 w-11 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-500/15">
            <Ionicons name="videocam" size={20} color="#10b981" />
          </View>
          <Text className="text-center text-base font-semibold text-slate-900 dark:text-slate-100">
            Bật Video đóng hàng
          </Text>
          <Text className="text-center text-xs leading-5 text-slate-500 dark:text-slate-400">
            Quay lúc đóng hàng bằng điện thoại, tìm lại bằng mã vận đơn khi cần bằng chứng khiếu nại.
          </Text>
        </View>
        <View className="gap-2">
          {CONSENT_POINTS.map((p) => (
            <View key={p} className="flex-row gap-2">
              <Text className="text-sm leading-5 text-slate-400">•</Text>
              <Text className="flex-1 text-sm leading-5 text-slate-700 dark:text-slate-300">{p}</Text>
            </View>
          ))}
        </View>
        {error ? <Text className="text-center text-sm text-red-500 dark:text-red-400">{error}</Text> : null}
        <Pressable
          onPress={() => void accept()}
          disabled={busy}
          accessibilityRole="button"
          className={`flex-row items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3.5 active:opacity-85 ${
            busy ? "opacity-60" : ""
          }`}
        >
          {busy ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="videocam" size={18} color="#fff" />}
          <Text className="text-sm font-bold text-white">Đồng ý và bắt đầu</Text>
        </Pressable>
        <Text className="text-center text-xs leading-5 text-slate-500 dark:text-slate-400">
          Bấm nút là đồng ý cho Hubsell lưu và xử lý video theo{" "}
          <Text
            className="font-semibold text-sky-700 dark:text-sky-400"
            onPress={() => void Linking.openURL(PRIVACY_URL)}
          >
            Chính sách bảo mật
          </Text>
          .
        </Text>
      </View>
    </Shell>
  );
}
