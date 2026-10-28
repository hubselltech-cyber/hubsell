import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import {
  connectLazadaCode,
  connectShopeeCode,
  connectTiktokCode,
  fetchAuthUrl,
  fetchCatalogPending,
  fetchChannels,
  type OauthPlatform,
} from "@/api/channels";
import { ApiError } from "@/api/client";
import type { CatalogPendingChannel, ChannelListItem } from "@/types/api";
import { openChannelAuth, parseAuthReturn, type AuthReturn } from "@/lib/channel-auth";
import { hapticTap } from "@/lib/haptics";
import { CHANNEL_LABEL } from "@/lib/labels";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import { useChannelColors } from "@/theme/channel-colors";
import { ActionButton } from "@/components/ActionButton";
import { Card } from "@/components/Card";

/**
 * MÀN GIAN HÀNG (28/10/2026) — nối sàn ngay trong app, thay cho việc bắt khách
 * mở app.hubsell.vn trên điện thoại.
 *
 * Một hành động chính: "Kết nối gian hàng" → chọn sàn → trang ủy quyền của
 * sàn mở lên → về app. KHÔNG có nút Đồng bộ đơn / đối soát / sản phẩm: từ
 * 28/09 + 02/10/2026 worker tự kéo trọn 3 tháng đơn, đối soát và danh mục
 * ngay sau khi nối (02/10: gian TikTok 1.398 đơn + 799 SP về trong ~14 phút).
 * Màn này chỉ CHO THẤY việc đó đang chạy (dải tiến độ) — trang Kênh bán web
 * không cho thấy nên khách vẫn tưởng phải bấm Đồng bộ.
 */

const PLATFORMS: { key: OauthPlatform; label: string; hint: string }[] = [
  { key: "SHOPEE", label: "Shopee", hint: "Đăng nhập tài khoản shop (không dùng tài khoản chính)" },
  { key: "TIKTOK", label: "TikTok Shop", hint: "Chọn Thời hạn cấp quyền: Không giới hạn" },
  { key: "LAZADA", label: "Lazada", hint: "Lazada có thể hỏi đăng ký gói Hubsell 0đ trước" },
];

const PLATFORM_ORDER: ChannelListItem["channelName"][] = ["SHOPEE", "TIKTOK", "LAZADA", "OFFLINE"];

/** Trạng thái một gian — cùng câu chữ thẻ gian trên web (channels/page.tsx). */
function channelState(c: ChannelListItem): {
  label: string;
  tone: "ok" | "warn" | "bad" | "muted";
  reason?: string;
  reconnect: boolean;
} {
  if (c.hibernatedAt) {
    return { label: "Ngủ đông", tone: "muted", reason: "Gói đã hết hạn, gian tạm ngừng đồng bộ", reconnect: false };
  }
  if (c.status === "ACTIVE") {
    if (c.needsReauth) {
      return {
        label: "Đang hoạt động",
        tone: "ok",
        reason: "Cần ủy quyền lại để Hubsell được phép đẩy tồn kho lên TikTok",
        reconnect: true,
      };
    }
    return { label: "Đang hoạt động", tone: "ok", reconnect: false };
  }
  const lost = c.authLostReason ?? "";
  const platform = CHANNEL_LABEL[c.channelName];
  if (lost && !/shop_access_expired/i.test(lost)) {
    return {
      label: "Mất ủy quyền",
      tone: "bad",
      reason: /shop_no_linked/i.test(lost)
        ? `${platform} báo gian đã gỡ ủy quyền cho Hubsell`
        : `${platform} từ chối làm mới quyền (${lost})`,
      reconnect: true,
    };
  }
  if (lost) {
    return { label: "Hết hạn ủy quyền", tone: "bad", reason: `${platform} báo hết hạn ủy quyền`, reconnect: true };
  }
  return { label: "Đã ngắt kết nối", tone: "bad", reconnect: true };
}

function fmtDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || d.getFullYear() > 2100) return null; // TikTok "Không giới hạn" = năm 2125
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

export function ChannelsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const colors = useChannelColors();
  const params = useLocalSearchParams() as Record<string, string | string[] | undefined>;

  const [items, setItems] = useState<ChannelListItem[]>([]);
  const [catalogPending, setCatalogPending] = useState<CatalogPendingChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [pickOpen, setPickOpen] = useState(false);
  /** Gian đích khi bấm Kết nối lại — gửi kèm để backend đối chiếu shop_id. */
  const [reconnectTarget, setReconnectTarget] = useState<ChannelListItem | null>(null);
  const [busy, setBusy] = useState<string>(""); // "SHOPEE" | "TIKTOK" | "LAZADA" | "exchange"
  const [toast, setToast] = useState("");
  const tiktokState = useRef<string | null>(null);
  const handledParams = useRef("");

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 5000);
  };

  const load = useCallback(async (mode: "first" | "pull" | "silent") => {
    if (mode === "pull") setRefreshing(true);
    else if (mode === "first") setLoading(true);
    try {
      const [list, pending] = await Promise.all([
        fetchChannels(),
        fetchCatalogPending().catch(() => ({ pending: [] })),
      ]);
      setItems(list);
      setCatalogPending(pending.pending);
      setError("");
    } catch (err) {
      if (mode !== "silent") setError(err instanceof ApiError ? err.message : "Có lỗi xảy ra, thử lại");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load("first");
  }, [load]);
  useAutoRefresh(() => void load("silent"));

  // Gian đang kéo đơn / danh mục → hỏi nhịp 15 s cho dải tiến độ tự tắt.
  const pendingBackfill = items.filter((c) => c.historyBackfillPending && c.status === "ACTIVE");
  const anyPending = pendingBackfill.length > 0 || catalogPending.length > 0;
  useEffect(() => {
    if (!anyPending) return;
    const t = setInterval(() => void load("silent"), 15_000);
    return () => clearInterval(t);
  }, [anyPending, load]);

  /** Kết quả ủy quyền (từ phiên trình duyệt hoặc deep link) → đổi code / báo. */
  const handleReturn = useCallback(
    async (r: AuthReturn) => {
      const target = reconnectTarget?.id;
      try {
        if (r.kind === "shopee") {
          if (r.status === "connected") {
            notify(r.isNew ? `Đã kết nối gian "${r.shop}". Hubsell đang kéo 3 tháng đơn gần nhất.` : `Đã cập nhật ủy quyền cho gian "${r.shop}".`);
          } else if (r.status === "error") {
            notify(`Kết nối Shopee thất bại: ${r.msg || "lỗi không rõ"}`);
          } else if (r.code && r.shopId) {
            setBusy("exchange");
            const res = await connectShopeeCode(r.code, r.shopId, target);
            notify(res.message);
          }
        } else if (r.kind === "lazada") {
          if (r.status === "connected") {
            notify(r.isNew ? `Đã kết nối gian "${r.shop}". Hubsell đang kéo 3 tháng đơn gần nhất.` : `Đã cập nhật ủy quyền cho gian "${r.shop}".`);
          } else if (r.status === "error") {
            notify(`Kết nối Lazada thất bại: ${r.msg || "lỗi không rõ"}`);
          } else if (r.code) {
            setBusy("exchange");
            const res = await connectLazadaCode(r.code, target);
            notify(res.message);
          }
        } else if (r.kind === "tiktok") {
          // state do backend sinh lúc xin link, app giữ để chống link lạ nối gian.
          if (tiktokState.current && r.state && r.state !== tiktokState.current) {
            notify("Phiên ủy quyền TikTok không khớp, hãy bấm Kết nối lại từ đầu.");
            return;
          }
          setBusy("exchange");
          const res = await connectTiktokCode(r.code, target);
          notify(
            `Đã kết nối ${res.connected} gian TikTok Shop.${res.message ? ` ${res.message}` : ""}`
          );
        }
        if (r.kind !== "none") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (err) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        notify(err instanceof ApiError ? err.message : "Không kết nối được máy chủ.");
      } finally {
        setBusy("");
        setReconnectTarget(null);
        tiktokState.current = null;
        void load("silent");
      }
    },
    [reconnectTarget, load]
  );

  // Deep link `hubsellmobile://channels?shopee=connected…` (Android mở thẳng
  // màn này thay vì trả về phiên trình duyệt) — xử lý một lần mỗi bộ tham số.
  useEffect(() => {
    const key = JSON.stringify(params);
    if (!key || key === "{}" || handledParams.current === key) return;
    handledParams.current = key;
    const qs = new URLSearchParams(
      Object.entries(params).filter((e): e is [string, string] => typeof e[1] === "string")
    ).toString();
    const r = parseAuthReturn(`?${qs}`);
    if (r.kind !== "none") void handleReturn(r);
  }, [params, handleReturn]);

  const startAuth = async (platform: OauthPlatform, target?: ChannelListItem) => {
    hapticTap();
    setPickOpen(false);
    setBusy(platform);
    setReconnectTarget(target ?? null);
    try {
      const { url, state } = await fetchAuthUrl(platform, target?.id);
      tiktokState.current = platform === "TIKTOK" ? (state ?? null) : null;
      const r = await openChannelAuth(url);
      if (r.kind === "none") {
        // Phiên đóng không mang kết quả (backend chưa nảy về app / giả lập web)
        // → tải lại để thấy gian vừa nối; chữ nhắc cho ca giả lập web.
        if (Platform.OS === "web") notify("Ủy quyền xong ở tab vừa mở, quay lại đây kéo xuống tải lại.");
        setBusy("");
        setReconnectTarget(null);
        void load("silent");
        return;
      }
      await handleReturn(r);
    } catch (err) {
      setBusy("");
      setReconnectTarget(null);
      notify(err instanceof ApiError ? err.message : "Không mở được trang ủy quyền.");
    }
  };

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.navigate("/(admin)/home");
  };

  const active = items.filter((c) => c.status === "ACTIVE" && !c.hibernatedAt).length;
  const grouped = PLATFORM_ORDER.map((p) => ({
    platform: p,
    rows: items.filter((c) => c.channelName === p),
  })).filter((g) => g.rows.length > 0);

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
        <Text className="flex-1 text-lg font-bold text-slate-900 dark:text-slate-100">Gian hàng</Text>
        {items.length > 0 ? (
          <Text className="pr-3 text-xs text-slate-500 dark:text-slate-400">
            {active}/{items.length} đang nối
          </Text>
        ) : null}
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 32 + insets.bottom }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load("pull")} />}
      >
        <ActionButton
          label="Kết nối gian hàng"
          sublabel="Shopee · TikTok Shop · Lazada"
          icon="add-circle-outline"
          onPress={() => {
            hapticTap();
            setReconnectTarget(null);
            setPickOpen(true);
          }}
          loading={busy !== ""}
          disabled={busy !== ""}
          className="mb-4"
        />

        {/* DẢI TIẾN ĐỘ — worker đang kéo nền, khách không phải bấm gì */}
        {anyPending ? (
          <Card className="mb-4 border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
            <View className="flex-row items-center gap-2">
              <ActivityIndicator size="small" color="#d97706" />
              <Text className="flex-1 text-sm font-semibold text-amber-800 dark:text-amber-300">
                Hubsell đang kéo dữ liệu về
              </Text>
            </View>
            {pendingBackfill.map((c) => (
              <Text key={`o-${c.id}`} className="mt-2 text-xs leading-5 text-amber-800/90 dark:text-amber-200/90">
                · Đơn 3 tháng gần nhất + đối soát của <Text className="font-semibold">{c.shopName}</Text>
              </Text>
            ))}
            {catalogPending.map((c) => (
              <Text key={`p-${c.id}`} className="mt-1 text-xs leading-5 text-amber-800/90 dark:text-amber-200/90">
                · Danh mục sản phẩm của <Text className="font-semibold">{c.shopName}</Text>
              </Text>
            ))}
            <Text className="mt-2 text-[11px] leading-4 text-amber-700/80 dark:text-amber-200/70">
              Thường xong trong 10–20 phút. Xong là Tổng quan có số, bước kế là nhập giá vốn.
            </Text>
          </Card>
        ) : null}

        {loading ? (
          <View className="items-center py-16">
            <ActivityIndicator size="large" color="#64748b" />
          </View>
        ) : error ? (
          <Card className="items-center p-6">
            <Text className="text-center text-sm text-red-600 dark:text-red-400">{error}</Text>
            <Pressable className="mt-3" onPress={() => void load("first")}>
              <Text className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Thử lại</Text>
            </Pressable>
          </Card>
        ) : items.length === 0 ? (
          <Card className="items-center p-6">
            <View className="mb-3 h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 dark:bg-emerald-500/15">
              <Ionicons name="storefront-outline" size={28} color="#059669" />
            </View>
            <Text className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Chưa có gian hàng nào
            </Text>
            <Text className="mt-1.5 text-center text-xs leading-5 text-slate-500 dark:text-slate-400">
              Bấm Kết nối gian hàng, đăng nhập sàn và xác nhận — đơn, đối soát, danh mục sản
              phẩm sẽ tự về trong vài phút.
            </Text>
          </Card>
        ) : (
          grouped.map((g) => (
            <View key={g.platform} className="mb-4">
              <View className="mb-2 flex-row items-center gap-2 px-1">
                <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colors[g.platform] }} />
                <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {CHANNEL_LABEL[g.platform]} · {g.rows.length}
                </Text>
              </View>
              {g.rows.map((c) => {
                const st = channelState(c);
                const expire = fmtDay(c.channelName === "SHOPEE" ? c.authExpireAt : c.refreshTokenExpireAt);
                const dot =
                  st.tone === "ok" ? "#10b981" : st.tone === "bad" ? "#ef4444" : st.tone === "warn" ? "#f59e0b" : "#94a3b8";
                const textTone =
                  st.tone === "ok"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : st.tone === "bad"
                      ? "text-red-600 dark:text-red-400"
                      : "text-slate-500 dark:text-slate-400";
                return (
                  <Card key={c.id} className="mb-2 p-4">
                    <View className="flex-row items-start gap-3">
                      <View className="flex-1">
                        <Text className="text-sm font-semibold text-slate-900 dark:text-slate-100" numberOfLines={1}>
                          {c.shopName}
                        </Text>
                        <View className="mt-1 flex-row items-center gap-1.5">
                          <View className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: dot }} />
                          <Text className={`text-xs font-medium ${textTone}`}>{st.label}</Text>
                        </View>
                        {st.reason ? (
                          <Text className="mt-1 text-[11px] leading-4 text-red-600 dark:text-red-400">{st.reason}</Text>
                        ) : null}
                        {c.historyBackfillPending && c.status === "ACTIVE" ? (
                          <Text className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                            Đang kéo đơn 3 tháng gần nhất
                          </Text>
                        ) : expire && c.status === "ACTIVE" ? (
                          <Text className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                            Ủy quyền đến {expire}
                          </Text>
                        ) : null}
                      </View>
                      {st.reconnect && c.channelName !== "OFFLINE" ? (
                        <Pressable
                          className="rounded-xl border border-emerald-600 px-3 py-2 active:opacity-70 dark:border-emerald-400"
                          onPress={() => void startAuth(c.channelName as OauthPlatform, c)}
                          disabled={busy !== ""}
                        >
                          <Text className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                            Kết nối lại
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </Card>
                );
              })}
            </View>
          ))
        )}
      </ScrollView>

      {toast ? (
        <View className="absolute inset-x-4 top-20 rounded-xl bg-slate-900 px-4 py-3 dark:bg-slate-100">
          <Text className="text-center text-xs font-medium text-white dark:text-slate-900">{toast}</Text>
        </View>
      ) : null}

      {/* Chọn sàn — một danh sách ba dòng, không khối hướng dẫn nhiều bước */}
      <Modal
        visible={pickOpen}
        transparent
        statusBarTranslucent
        navigationBarTranslucent
        animationType="slide"
        onRequestClose={() => setPickOpen(false)}
      >
        <View className="flex-1 justify-end bg-black/40">
          <Pressable className="flex-1" onPress={() => setPickOpen(false)} />
          <View
            className="rounded-t-3xl bg-white px-4 pt-3 dark:bg-slate-900"
            style={{ paddingBottom: 20 + insets.bottom }}
          >
            <View className="mb-3 items-center">
              <View className="h-1 w-10 rounded-full bg-slate-200 dark:bg-slate-700" />
            </View>
            <Text className="mb-3 text-base font-bold text-slate-900 dark:text-slate-100">
              Kết nối gian hàng trên sàn nào?
            </Text>
            {PLATFORMS.map((p) => (
              <Pressable
                key={p.key}
                className="mb-2 flex-row items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 active:opacity-70 dark:border-slate-700 dark:bg-slate-800"
                onPress={() => void startAuth(p.key)}
              >
                <View
                  className="h-10 w-10 items-center justify-center rounded-xl"
                  style={{ backgroundColor: `${colors[p.key]}22` }}
                >
                  <View className="h-3 w-3 rounded-full" style={{ backgroundColor: colors[p.key] }} />
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-semibold text-slate-900 dark:text-slate-100">{p.label}</Text>
                  <Text className="text-[11px] text-slate-500 dark:text-slate-400">{p.hint}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
              </Pressable>
            ))}
            <Text className="mt-1 text-center text-[11px] leading-4 text-slate-400 dark:text-slate-500">
              Hubsell chỉ kéo 3 tháng đơn gần nhất. Đăng nhập đúng tài khoản của gian cần nối.
            </Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}
