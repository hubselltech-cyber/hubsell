import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import {
  finishTransaction,
  getPendingTransactionsIOS,
  useIAP,
  type Product,
  type Purchase,
} from "expo-iap";
import { useAuth } from "@/auth/AuthContext";
import { usePlan } from "@/plan/PlanContext";
import { fmtDate } from "@/plan/plan-ui";
import { hapticTap } from "@/lib/haptics";
import { ApiError } from "@/api/client";
import {
  fetchAppleCatalog,
  redeemApplePurchase,
  type AppleCatalogItem,
  type AppleCycle,
} from "@/api/apple-iap";

/**
 * MÀN GÓI DỊCH VỤ — MUA QUA APP STORE (10/10/2026, Apple từ chối 3.1.1 ba lần).
 *
 * Luật viết chữ trên màn này (Apple 3.1.1 + 3.1.3): chỉ có MỘT cách mua là
 * App Store; KHÔNG nhắc web, payOS, chuyển khoản, giá nơi khác, không so sánh
 * hay chú thích vì sao giá như vậy. Giá in ra là displayPrice StoreKit trả về.
 *
 * Luồng: catalog backend (mã sản phẩm + appAccountToken) → fetchProducts
 * StoreKit → khách chọn gói + kỳ → requestPurchase → onPurchaseSuccess →
 * POST redeem (backend xác minh JWS, ghi nhận) → finishTransaction → tải lại
 * trạng thái gói. Redeem lỗi thì KHÔNG finish — giao dịch còn trong hàng đợi
 * StoreKit, nút "Khôi phục giao dịch" hoặc lần mở sau xử lý tiếp.
 *
 * Chỉ iOS + chủ shop: Android chưa nối Google Play Billing (làm sau), mục này
 * không hiện trên Android (SettingsScreen gác).
 */

const CYCLE_ORDER: AppleCycle[] = ["MONTHLY", "QUARTERLY", "SEMIANNUAL", "YEARLY"];
const CYCLE_LABEL: Record<AppleCycle, string> = {
  MONTHLY: "1 tháng",
  QUARTERLY: "3 tháng",
  SEMIANNUAL: "6 tháng",
  YEARLY: "12 tháng",
};
const CYCLE_MONTHS: Record<AppleCycle, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  SEMIANNUAL: 6,
  YEARLY: 12,
};

const nf = new Intl.NumberFormat("vi-VN");

interface PlanGroup {
  planId: string;
  planCode: string;
  planName: string;
  tier: number;
  maxOrdersPerMonth: number | null;
  maxChannels: number | null;
  maxStaff: number | null;
  /** Chỉ các kỳ StoreKit có sản phẩm (đã duyệt + có giá). */
  cycles: { cycle: AppleCycle; productId: string; product: Product }[];
}

function groupCatalog(items: AppleCatalogItem[], products: Product[]): PlanGroup[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  const groups = new Map<string, PlanGroup>();
  for (const it of items) {
    const product = byId.get(it.productId);
    if (!product) continue;
    let g = groups.get(it.planId);
    if (!g) {
      g = {
        planId: it.planId,
        planCode: it.planCode,
        planName: it.planName,
        tier: it.tier,
        maxOrdersPerMonth: it.maxOrdersPerMonth,
        maxChannels: it.maxChannels,
        maxStaff: it.maxStaff,
        cycles: [],
      };
      groups.set(it.planId, g);
    }
    g.cycles.push({ cycle: it.cycle, productId: it.productId, product });
  }
  return [...groups.values()]
    .map((g) => ({
      ...g,
      cycles: g.cycles.sort((a, b) => CYCLE_ORDER.indexOf(a.cycle) - CYCLE_ORDER.indexOf(b.cycle)),
    }))
    .sort((a, b) => a.tier - b.tier);
}

function limitLine(g: PlanGroup): string {
  const parts = [
    g.maxOrdersPerMonth != null ? `${nf.format(g.maxOrdersPerMonth)} đơn/tháng` : "Không giới hạn đơn",
    g.maxChannels != null ? `${g.maxChannels} gian hàng` : "Không giới hạn gian hàng",
    g.maxStaff != null ? `${g.maxStaff} nhân viên` : "Không giới hạn nhân viên",
  ];
  return parts.join(" · ");
}

export function PlanStoreScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { plan: myPlan, refresh: refreshPlan } = usePlan();

  const [catalog, setCatalog] = useState<AppleCatalogItem[] | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedCycle, setSelectedCycle] = useState<Record<string, AppleCycle>>({});
  const [buying, setBuying] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  // Giao dịch đang xử lý — chống xử lý trùng khi StoreKit bắn lặp.
  const handling = useRef(new Set<string>());

  const handlePurchase = useCallback(
    async (purchase: Purchase, source: "buy" | "restore") => {
      const key = purchase.id || purchase.purchaseToken || purchase.productId;
      if (handling.current.has(key)) return;
      handling.current.add(key);
      try {
        if (purchase.purchaseState === "pending") {
          Alert.alert("Đang chờ xác nhận", "Apple đang xử lý thanh toán. Gói sẽ tự kích hoạt khi hoàn tất.");
          return;
        }
        const jws = purchase.purchaseToken;
        if (!jws) throw new Error("Thiếu dữ liệu giao dịch từ App Store");
        const r = await redeemApplePurchase(jws);
        await finishTransaction({ purchase, isConsumable: true });
        await refreshPlan();
        if (source === "buy" || r.outcome === "recorded") {
          Alert.alert(
            "Đã kích hoạt gói",
            `Gói ${r.planName} (${CYCLE_LABEL[r.cycle]}) có hiệu lực${
              r.periodEnd ? ` tới ${fmtDate(r.periodEnd)}` : ""
            }.`
          );
        }
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : (err as Error).message;
        Alert.alert(
          "Chưa ghi nhận được giao dịch",
          `${msg}\n\nGiao dịch vẫn được Apple giữ — mở lại mục này hoặc bấm "Khôi phục giao dịch" để thử lại.`
        );
      } finally {
        handling.current.delete(key);
        setBuying(null);
      }
    },
    [refreshPlan]
  );

  const { connected, products, fetchProducts, requestPurchase } = useIAP({
    onPurchaseSuccess: (purchase) => void handlePurchase(purchase, "buy"),
    onPurchaseError: (error) => {
      setBuying(null);
      if (error.code === "user-cancelled") return;
      Alert.alert("Không mua được", error.message || "Apple từ chối giao dịch, thử lại sau.");
    },
  });

  // 1. Danh mục từ backend.
  useEffect(() => {
    let cancelled = false;
    fetchAppleCatalog()
      .then((res) => {
        if (cancelled) return;
        setCatalog(res.items);
        setToken(res.appAccountToken);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof ApiError ? err.message : "Không tải được danh mục gói");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 2. Giá từ StoreKit khi đã nối và có danh mục.
  useEffect(() => {
    if (!connected || !catalog || catalog.length === 0) return;
    void fetchProducts({ skus: catalog.map((c) => c.productId), type: "in-app" });
  }, [connected, catalog, fetchProducts]);

  const groups = useMemo(() => (catalog ? groupCatalog(catalog, products) : []), [catalog, products]);
  const storeReady = connected && catalog !== null;
  const nothingToSell = storeReady && catalog.length > 0 && products.length === 0;

  const buy = async (g: PlanGroup) => {
    const cycle = selectedCycle[g.planId] ?? g.cycles[0]?.cycle;
    const entry = g.cycles.find((c) => c.cycle === cycle);
    if (!entry || !token) return;
    hapticTap();
    setBuying(entry.productId);
    try {
      await requestPurchase({
        request: { apple: { sku: entry.productId, appAccountToken: token, quantity: 1 } },
        type: "in-app",
      });
      // Kết quả về qua onPurchaseSuccess / onPurchaseError.
    } catch (err) {
      setBuying(null);
      Alert.alert("Không mua được", (err as Error).message || "Thử lại sau.");
    }
  };

  // 3. Giao dịch chưa finish (app chết giữa chừng / redeem lỗi) → ghi nhận lại.
  // Non-renewing là giao dịch "tiêu hao" với StoreKit: KHÔNG nằm trong
  // currentEntitlements (getAvailablePurchases) mà trong Transaction.unfinished
  // → dùng getPendingTransactionsIOS.
  const restore = async () => {
    hapticTap();
    setRestoring(true);
    try {
      const pending = (await getPendingTransactionsIOS()).filter((p) => p.purchaseToken);
      if (pending.length === 0) {
        Alert.alert("Không có giao dịch chờ", "Mọi giao dịch App Store của bạn đã được ghi nhận.");
        return;
      }
      for (const p of pending) await handlePurchase(p, "restore");
    } catch (err) {
      Alert.alert("Không khôi phục được", (err as Error).message || "Thử lại sau.");
    } finally {
      setRestoring(false);
    }
  };

  const current = myPlan?.plan;
  const sub = myPlan?.subscription;
  const isOwner = user?.role === "ADMIN";

  return (
    <View className="flex-1 bg-slate-50 dark:bg-slate-950">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          padding: 16,
          paddingTop: insets.top + 12,
          paddingBottom: insets.bottom + 24,
        }}
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
          <Text className="text-2xl font-bold text-slate-900 dark:text-slate-100">Gói dịch vụ</Text>
        </View>

        {/* Gói đang dùng */}
        {current ? (
          <View className="mb-4 rounded-2xl bg-white p-4 dark:bg-slate-900" style={{ elevation: 2 }}>
            <Text className="text-[11px] text-slate-500 dark:text-slate-400">Gói đang dùng</Text>
            <View className="mt-1 flex-row items-center gap-2">
              <Text className="text-lg font-bold text-slate-900 dark:text-slate-100">{current.name}</Text>
              {sub?.isTrial ? (
                <View className="rounded-full bg-sky-100 px-2 py-0.5 dark:bg-sky-500/15">
                  <Text className="text-[11px] font-semibold text-sky-700 dark:text-sky-300">Dùng thử</Text>
                </View>
              ) : null}
              {sub && sub.status !== "ACTIVE" ? (
                <View className="rounded-full bg-red-100 px-2 py-0.5 dark:bg-red-500/15">
                  <Text className="text-[11px] font-semibold text-red-700 dark:text-red-300">Hết hạn</Text>
                </View>
              ) : null}
            </View>
            {sub?.currentPeriodEnd ? (
              <Text className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {sub.status === "ACTIVE" ? "Hiệu lực tới" : "Đã hết hạn"} {fmtDate(sub.currentPeriodEnd)}
                {sub.status === "ACTIVE" && sub.daysLeft !== null ? ` · còn ${sub.daysLeft} ngày` : ""}
              </Text>
            ) : null}
            <Text className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">
              Mua cùng gói thì kỳ mới nối tiếp kỳ hiện tại, không mất ngày.
            </Text>
          </View>
        ) : null}

        {!isOwner ? (
          <View className="rounded-2xl bg-white p-4 dark:bg-slate-900" style={{ elevation: 2 }}>
            <Text className="text-sm text-slate-600 dark:text-slate-300">
              Chỉ chủ shop mới mua gói. Liên hệ quản trị viên shop của bạn.
            </Text>
          </View>
        ) : loadError ? (
          <View className="rounded-2xl bg-white p-4 dark:bg-slate-900" style={{ elevation: 2 }}>
            <Text className="text-sm text-red-600 dark:text-red-400">{loadError}</Text>
          </View>
        ) : !storeReady || (catalog.length > 0 && products.length === 0 && !nothingToSell) ? (
          <View className="items-center py-10">
            <ActivityIndicator />
            <Text className="mt-3 text-xs text-slate-500 dark:text-slate-400">Đang tải bảng giá từ App Store…</Text>
          </View>
        ) : groups.length === 0 ? (
          <View className="rounded-2xl bg-white p-4 dark:bg-slate-900" style={{ elevation: 2 }}>
            <Text className="text-sm text-slate-600 dark:text-slate-300">
              App Store chưa có gói nào để mua lúc này. Thử lại sau ít phút.
            </Text>
          </View>
        ) : (
          groups.map((g) => {
            const cycle = selectedCycle[g.planId] ?? g.cycles[0].cycle;
            const entry = g.cycles.find((c) => c.cycle === cycle) ?? g.cycles[0];
            const isCurrent = current?.id === g.planId;
            const busy = buying === entry.productId;
            return (
              <View
                key={g.planId}
                className={`mb-4 rounded-2xl bg-white p-4 dark:bg-slate-900 ${
                  isCurrent ? "border border-emerald-300 dark:border-emerald-500/40" : ""
                }`}
                style={{ elevation: 2 }}
              >
                <View className="flex-row items-center justify-between">
                  <Text className="text-base font-bold text-slate-900 dark:text-slate-100">{g.planName}</Text>
                  {isCurrent ? (
                    <View className="rounded-full bg-emerald-100 px-2 py-0.5 dark:bg-emerald-500/15">
                      <Text className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">Đang dùng</Text>
                    </View>
                  ) : null}
                </View>
                <Text className="mt-1 text-xs text-slate-500 dark:text-slate-400">{limitLine(g)}</Text>

                {/* Kỳ hạn */}
                <View className="mt-3 flex-row flex-wrap gap-2">
                  {g.cycles.map((c) => {
                    const on = c.cycle === cycle;
                    return (
                      <Pressable
                        key={c.productId}
                        onPress={() => {
                          hapticTap();
                          setSelectedCycle((s) => ({ ...s, [g.planId]: c.cycle }));
                        }}
                        className={`rounded-full border px-3 py-1.5 ${
                          on
                            ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/15"
                            : "border-slate-200 dark:border-slate-700"
                        }`}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                      >
                        <Text
                          className={`text-xs font-medium ${
                            on ? "text-emerald-700 dark:text-emerald-300" : "text-slate-600 dark:text-slate-300"
                          }`}
                        >
                          {CYCLE_LABEL[c.cycle]}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <View className="mt-3 flex-row items-end justify-between">
                  <View>
                    <Text className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">
                      {entry.product.displayPrice}
                    </Text>
                    <Text className="text-[11px] text-slate-400 dark:text-slate-500">
                      cho {CYCLE_MONTHS[entry.cycle]} tháng
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => void buy(g)}
                    disabled={busy || buying !== null}
                    className={`flex-row items-center gap-2 rounded-xl px-4 py-2.5 ${
                      busy || buying !== null ? "bg-emerald-300" : "bg-emerald-600 active:bg-emerald-700"
                    }`}
                    accessibilityRole="button"
                  >
                    {busy ? <ActivityIndicator color="#fff" /> : <Ionicons name="logo-apple" size={16} color="#fff" />}
                    <Text className="text-sm font-semibold text-white">{isCurrent ? "Gia hạn" : "Mua gói"}</Text>
                  </Pressable>
                </View>
              </View>
            );
          })
        )}

        {isOwner && storeReady ? (
          <View className="mt-2">
            <Pressable
              onPress={() => void restore()}
              disabled={restoring}
              className="items-center py-3 active:opacity-70"
              accessibilityRole="button"
            >
              {restoring ? (
                <ActivityIndicator />
              ) : (
                <Text className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Khôi phục giao dịch</Text>
              )}
            </Pressable>
            <Text className="px-2 text-center text-[11px] leading-4 text-slate-400 dark:text-slate-500">
              Thanh toán qua tài khoản Apple của bạn. Gói kích hoạt ngay sau khi mua và không tự gia hạn.
              {Platform.OS === "ios" ? " Hóa đơn do Apple gửi." : ""}
            </Text>
            <View className="mt-2 flex-row justify-center gap-4">
              <Pressable onPress={() => void WebBrowser.openBrowserAsync("https://hubsell.vn/terms")}>
                <Text className="text-[11px] text-slate-500 underline dark:text-slate-400">Điều khoản</Text>
              </Pressable>
              <Pressable onPress={() => void WebBrowser.openBrowserAsync("https://hubsell.vn/privacy")}>
                <Text className="text-[11px] text-slate-500 underline dark:text-slate-400">Bảo mật</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
