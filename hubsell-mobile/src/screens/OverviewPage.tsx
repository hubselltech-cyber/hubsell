import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useRouter, type Href } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import Animated, { FadeInDown } from "react-native-reanimated";
import Svg, {
  Defs,
  LinearGradient,
  RadialGradient,
  Rect,
  Stop,
} from "react-native-svg";
import { hapticTap } from "@/lib/haptics";
import { fetchOverview } from "@/api/finance";
import { fetchOrders } from "@/api/orders";
import { fetchReturnsSummary } from "@/api/warehouse";
import { ApiError } from "@/api/client";
import type { ChannelName, OverviewAnalytics, ReturnsSummaryResponse } from "@/types/api";
import { rangeFor } from "@/lib/dates";
import { compactMoney } from "@/lib/format";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import { useAuth } from "@/auth/AuthContext";
import { useChannelColors } from "@/theme/channel-colors";
import { DonutChart } from "@/components/DonutChart";
import { DeltaPill } from "@/components/DeltaPill";
import { Card } from "@/components/Card";
import { Sparkline } from "@/components/Sparkline";
import { CHANNEL_LABEL } from "@/lib/labels";
import { RAISED_SHADOW, TABULAR } from "@/theme/tokens";

/**
 * Vị trí sàn FIX CỨNG (chốt 13/08): sàn không có đơn vẫn đứng nguyên chỗ với
 * số 0 — chỉ con số và donut thay đổi, layout không bao giờ nhảy.
 */
const FIXED_CHANNELS: ChannelName[] = ["SHOPEE", "LAZADA", "TIKTOK"];

/** Trang Kênh bán trên web app — nơi duy nhất uỷ quyền gian hàng (OAuth sàn). */
const CONNECT_CHANNEL_URL = "https://app.hubsell.tech/channels";

/**
 * TỔNG QUAN HÔM NAY — trang đầu tiên chủ shop nhìn thấy khi mở app.
 * Trả lời 3 câu hỏi buổi sáng: hôm nay bán được bao nhiêu? bao nhiêu đơn đang
 * ở đâu? kênh nào đang gánh? (+ đơn hoàn nào cần để mắt)
 *
 * NGUỒN SỐ = GET /api/analytics?from=hôm nay&to=hôm nay — ĐÚNG endpoint
 * và đúng kỳ của Tổng quan web (frontend/src/app/page.tsx), nên Doanh thu /
 * số đơn / Lợi nhuận dự kiến khớp web từng đồng. Trước 03/10 trang này đọc
 * /realized-pnl (Lãi/Lỗ THỰC HIỆN — chỉ đơn đã giao/đã quyết toán) nên số
 * luôn thấp hơn web và không có đơn mới trong ngày (anh Trung phát hiện khi
 * dùng thử APK).
 *
 * Hero "Kết quả hôm nay" là BAND TỐI navy + glow mint — cùng bộ nhận diện với
 * orb Trợ lý và band tối landing (chốt 21/08), giữ nguyên ở cả hai theme.
 */

const STATUS_TILES: { key: string; label: string; color: string; dot: string }[] = [
  { key: "PENDING", label: "Chờ xử lý", color: "text-amber-600 dark:text-amber-400", dot: "#f59e0b" },
  { key: "SHIPPING", label: "Đang giao", color: "text-indigo-600 dark:text-indigo-400", dot: "#6366f1" },
  { key: "DELIVERED", label: "Đã giao", color: "text-emerald-600 dark:text-emerald-400", dot: "#10b981" },
  { key: "CANCELLED", label: "Hủy/Hoàn", color: "text-red-500 dark:text-red-400", dot: "#ef4444" },
];

/**
 * Nền hero: gradient navy sâu + vầng glow mint mờ góc phải. Kích thước SVG
 * lấy từ onLayout của card — width/height "100%" của RN-SVG đo sai khi card
 * đổi cỡ theo nội dung (đã dính trên nút quét trang Kho).
 */
function HeroBackdrop({ width, height }: { width: number; height: number }) {
  if (width <= 0 || height <= 0) return null;
  return (
    <Svg width={width} height={height} style={{ position: "absolute" }}>
      <Defs>
        <LinearGradient id="hero-bg" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#0b1626" />
          <Stop offset="1" stopColor="#122036" />
        </LinearGradient>
        <RadialGradient id="hero-glow" cx="85%" cy="0%" r="70%">
          <Stop offset="0" stopColor="#34d399" stopOpacity={0.22} />
          <Stop offset="1" stopColor="#34d399" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width={width} height={height} fill="url(#hero-bg)" />
      <Rect x="0" y="0" width={width} height={height} fill="url(#hero-glow)" />
    </Svg>
  );
}

export function OverviewPage({ goWarehouse }: { goWarehouse: () => void }) {
  const { user } = useAuth();
  const channelColors = useChannelColors();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [analytics, setAnalytics] = useState<OverviewAnalytics | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [returns, setReturns] = useState<ReturnsSummaryResponse["summary"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  // Shop vừa đăng ký, chưa uỷ quyền gian nào → backend trả 409 NO_CHANNEL cho
  // mọi API số liệu. Hiện thẻ hướng dẫn thay vì câu lỗi thô.
  const [noChannel, setNoChannel] = useState(false);

  /**
   * mode: "first" = lần đầu (spinner thay nội dung) · "pull" = kéo xuống (vòng
   * xoay RefreshControl) · "silent" = tải NỀN (giữ nguyên số cũ trên màn, chỉ
   * thay khi có số mới — như web refetch ngầm, không nháy).
   */
  const load = useCallback(async (mode: "first" | "pull" | "silent" = "first") => {
    if (mode === "pull") setRefreshing(true);
    else if (mode === "first") setLoading(true);
    if (mode !== "silent") setError("");
    try {
      const { from, to } = rangeFor("today");
      const [ana, orders, ret] = await Promise.all([
        // Một lượt lấy đủ: số hôm nay + kỳ trước (hôm qua) để tính ▲/▼ +
        // trend 14 ngày cho sparkline + đơn theo sàn cho donut.
        fetchOverview(from, to),
        fetchOrders({ page: 1, pageSize: 1 }),
        fetchReturnsSummary(),
      ]);
      setAnalytics(ana);
      setCounts(orders.counts);
      setReturns(ret.summary);
      setError("");
      setNoChannel(false);
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.status === 409 &&
        (err.body as { code?: string } | null)?.code === "NO_CHANNEL"
      ) {
        setNoChannel(true);
        return;
      }
      // Tải nền hỏng (mất mạng chốc lát) thì giữ số cũ, không đẩy lỗi che màn.
      if (mode !== "silent") {
        setError(
          err instanceof ApiError ? err.message : "Có lỗi xảy ra, kéo xuống thử lại"
        );
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load("first");
  }, [load]);

  // Số tươi như web: tải lại nền khi app quay lại foreground, khi tab được
  // focus lại và định kỳ mỗi 60s (web: staleTime 30s + refetch on focus).
  useAutoRefresh(() => void load("silent"));

  const today = new Date();
  const WEEKDAYS = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];
  const dateLabel = `${WEEKDAYS[today.getDay()]}, ${today.getDate()}/${today.getMonth() + 1}/${today.getFullYear()}`;
  // Số đơn + doanh thu hôm nay theo từng SÀN (gộp các gian cùng sàn — như
  // ChannelShareCard web), trên danh sách sàn CỐ ĐỊNH
  const byPlatform = new Map<string, { count: number; revenue: number }>();
  for (const r of analytics?.ordersByChannel ?? []) {
    const cur = byPlatform.get(r.channelName) ?? { count: 0, revenue: 0 };
    byPlatform.set(r.channelName, {
      count: cur.count + r.count,
      revenue: cur.revenue + r.revenue,
    });
  }
  const channelRows = FIXED_CHANNELS.map((ch) => ({
    channel: ch,
    count: byPlatform.get(ch)?.count ?? 0,
    revenue: byPlatform.get(ch)?.revenue ?? 0,
  }));
  const returningTotal = (returns?.AWAITING ?? 0) + (returns?.RECEIVED ?? 0);
  const revenue = analytics?.totalRevenue ?? 0;
  const netProfit = analytics?.netProfit ?? 0;
  const prevRevenue = analytics?.previous?.totalRevenue ?? 0;
  // Biên lợi nhuận — kỳ trước không trả netProfit nên thẻ lãi hiện biên thay
  // vì ▲/▼ (đúng như thẻ "Lợi nhuận dự kiến" trên web).
  const margin = revenue > 0 ? Math.round((netProfit / revenue) * 1000) / 10 : null;
  const missingCostOrders = analytics?.missingCost?.orderCount ?? 0;
  // Sparkline lãi/ngày = doanh thu − chi phí trên trend 14 ngày (cùng công
  // thức sparkline dưới thẻ KPI web); lấy 7 ngày cuối cho nhịp dễ đọc trên
  // màn hẹp.
  const weekProfits = (analytics?.trend ?? [])
    .slice(-7)
    .map((d) => d.revenue - (d.cost ?? 0));
  const [heroSize, setHeroSize] = useState({ w: 0, h: 0 });
  // Bề rộng sparkline = màn hình − padding trang (16×2) − padding hero (20×2)
  const sparkW = Math.min(width, 480) - 72;

  return (
    <ScrollView
      className="flex-1 bg-slate-50 dark:bg-slate-950"
      contentContainerStyle={{ padding: 16, paddingBottom: 96 }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => load("pull")} />
      }
    >
      <Text className="text-base font-semibold text-slate-900 dark:text-slate-100">
        Xin chào, {user?.fullName ?? "chủ shop"} 👋
      </Text>
      <Text className="mb-4 text-xs text-slate-500 dark:text-slate-400">{dateLabel}</Text>

      {loading ? (
        <View className="items-center py-16">
          <ActivityIndicator size="large" color="#64748b" />
        </View>
      ) : noChannel ? (
        <Card className="items-center p-6">
          <View className="mb-3 h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 dark:bg-emerald-500/15">
            <Ionicons name="storefront-outline" size={28} color="#059669" />
          </View>
          <Text className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Chưa có gian hàng nào
          </Text>
          <Text className="mt-1.5 text-center text-xs leading-5 text-slate-500 dark:text-slate-400">
            Kết nối Shopee, Lazada hoặc TikTok Shop trên bản web (mục Kênh bán) —
            đơn hàng và số liệu sẽ tự về app, không cần cài gì thêm.
          </Text>
          <Pressable
            className="mt-4 rounded-xl bg-slate-900 px-5 py-3 active:opacity-80 dark:bg-slate-700"
            onPress={() => {
              hapticTap();
              void WebBrowser.openBrowserAsync(CONNECT_CHANNEL_URL);
            }}
          >
            <Text className="text-sm font-semibold text-white">Kết nối gian hàng trên web</Text>
          </Pressable>
          <Pressable className="mt-3" onPress={() => void load("first")} hitSlop={8}>
            <Text className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
              Đã kết nối xong, tải lại
            </Text>
          </Pressable>
        </Card>
      ) : error ? (
        <Card className="items-center p-6">
          <Text className="text-center text-sm text-red-500 dark:text-red-400">{error}</Text>
        </Card>
      ) : (
        <>
          {/* HERO Kết quả hôm nay — band tối cả hai theme, bố cục 2 CỘT
              Doanh thu | Lợi nhuận (chốt 13/08), sparkline lãi 7 ngày dưới đáy.
              Các khối vào trang so le 60ms — đủ thấy nhịp, không đủ gây chờ. */}
          <Animated.View entering={FadeInDown.duration(280)}>
            <View
              className="mb-3 overflow-hidden rounded-3xl border border-white/10 bg-[#0b1626] p-5"
              style={RAISED_SHADOW}
              onLayout={(e) =>
                setHeroSize({
                  w: e.nativeEvent.layout.width,
                  h: e.nativeEvent.layout.height,
                })
              }
            >
              <HeroBackdrop width={heroSize.w} height={heroSize.h} />
              <View className="flex-row items-center gap-2">
                {/* PNG logo nền trắng vuông — bo góc kiểu app icon trên band tối */}
                <Image
                  source={require("@/assets/images/logo-hubsell.png")}
                  style={{ width: 26, height: 26, borderRadius: 7 }}
                  contentFit="contain"
                />
                <Text className="flex-1 text-sm font-semibold text-white">
                  Kết quả hôm nay
                </Text>
                <View className="rounded-full bg-white/10 px-2.5 py-1">
                  <Text className="text-[11px] font-semibold text-emerald-300" style={TABULAR}>
                    {analytics?.activeOrderCount ?? 0} đơn
                  </Text>
                </View>
              </View>
              <View className="mt-5 flex-row">
                <View className="flex-1">
                  <Text className="text-xs text-slate-400">Doanh thu</Text>
                  <Text className="mt-1 text-[28px] font-bold text-white" style={TABULAR}>
                    {compactMoney(revenue)}
                  </Text>
                  <View className="mt-2 flex-row">
                    <DeltaPill onDark current={revenue} previous={prevRevenue} />
                  </View>
                </View>
                <View className="mx-4 w-px bg-white/10" />
                <View className="flex-1">
                  <Text className="text-xs text-slate-400">Lợi nhuận dự kiến</Text>
                  <Text
                    className={`mt-1 text-[28px] font-bold ${
                      netProfit < 0 ? "text-red-400" : "text-emerald-300"
                    }`}
                    style={TABULAR}
                  >
                    {compactMoney(netProfit)}
                  </Text>
                  <Text className="mt-2 text-[10px] text-slate-400" style={TABULAR}>
                    {missingCostOrders > 0
                      ? `${missingCostOrders} đơn chưa có giá vốn`
                      : margin !== null
                        ? `Biên lợi nhuận ${String(margin).replace(".", ",")}%`
                        : "Sau giá vốn, phí sàn & chi phí"}
                  </Text>
                </View>
              </View>
              {weekProfits.length >= 2 ? (
                <View className="mt-4 border-t border-white/10 pt-3">
                  <View className="mb-1 flex-row items-center justify-between">
                    <Text className="text-[10px] text-slate-400">
                      Nhịp lãi 7 ngày gần nhất
                    </Text>
                    <Text className="text-[10px] font-semibold text-emerald-300" style={TABULAR}>
                      {compactMoney(weekProfits.reduce((s, v) => s + v, 0))}
                    </Text>
                  </View>
                  <Sparkline
                    data={weekProfits}
                    width={sparkW}
                    height={40}
                    color="#34d399"
                    gradientId="hero-spark"
                  />
                </View>
              ) : null}
            </View>
          </Animated.View>

          {/* Đếm đơn theo trạng thái — TOÀN BỘ đơn đang ở từng bước (không
              theo ngày), khớp số đếm tab Đơn hàng; bấm vào nhảy sang tab đã lọc */}
          <Animated.View
            entering={FadeInDown.duration(280).delay(60)}
            className="mb-3 flex-row gap-2"
          >
            {STATUS_TILES.map((t) => (
              <Card
                key={t.key}
                className="flex-1 items-center py-3"
                onPress={() => {
                  hapticTap();
                  router.push(`/(admin)/orders?status=${t.key}` as Href);
                }}
              >
                <View className="flex-row items-center gap-1.5">
                  <View
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: t.dot }}
                  />
                  <Text className={`text-lg font-bold ${t.color}`} style={TABULAR}>
                    {counts[t.key] ?? 0}
                  </Text>
                </View>
                <Text className="text-[10px] text-slate-500 dark:text-slate-400">{t.label}</Text>
              </Card>
            ))}
          </Animated.View>

          {/* Tỷ trọng kênh hôm nay — vị trí sàn CỐ ĐỊNH, chỉ số nhảy */}
          <Animated.View entering={FadeInDown.duration(280).delay(120)}>
            <Card className="mb-3 p-4">
              <Text className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
                Tỷ trọng kênh hôm nay
              </Text>
              <DonutChart
                size={150}
                centerLabel={String(analytics?.activeOrderCount ?? 0)}
                centerSub="đơn hôm nay"
                slices={channelRows.map((r) => ({
                  label: CHANNEL_LABEL[r.channel],
                  value: r.count,
                  color: channelColors[r.channel] ?? "#94a3b8",
                }))}
              />
              <View className="mt-4">
                {/* Cụm số đứng NGAY CẠNH tên sàn — không kéo giãn hai đầu màn
                    hình bắt mắt người dùng nhảy qua nhảy lại (góp ý 13/08) */}
                {channelRows.map((r) => (
                  <View
                    key={r.channel}
                    className="flex-row items-center gap-3 border-t border-slate-100 dark:border-slate-800 py-2.5"
                  >
                    <View
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: channelColors[r.channel] ?? "#94a3b8" }}
                    />
                    <Text className="w-16 text-[13px] font-medium text-slate-700 dark:text-slate-300">
                      {CHANNEL_LABEL[r.channel]}
                    </Text>
                    <Text
                      className={`w-14 text-[13px] font-bold ${
                        r.count > 0 ? "text-slate-900 dark:text-slate-100" : "text-slate-300 dark:text-slate-600"
                      }`}
                      style={TABULAR}
                    >
                      {r.count} đơn
                    </Text>
                    <Text
                      className="flex-1 text-right text-[12px] text-slate-500 dark:text-slate-400"
                      style={TABULAR}
                    >
                      {r.count > 0 ? compactMoney(r.revenue) : ""}
                    </Text>
                  </View>
                ))}
              </View>
            </Card>
          </Animated.View>

          {/* Đơn hoàn cần để mắt — bấm sang trang Kho */}
          <Animated.View entering={FadeInDown.duration(280).delay(180)}>
            <Card
              className="flex-row items-center gap-3 p-4"
              onPress={() => {
                hapticTap();
                goWarehouse();
              }}
            >
              <View className="h-11 w-11 items-center justify-center rounded-xl bg-amber-100 dark:bg-amber-500/15">
                <Ionicons name="arrow-undo-outline" size={20} color="#d97706" />
              </View>
              <View className="flex-1">
                <Text className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {returningTotal} đơn hoàn đang xử lý
                </Text>
                <Text className="text-[11px] text-slate-500 dark:text-slate-400">
                  {returns?.AWAITING ?? 0} chờ về kho · {returns?.RECEIVED ?? 0} chờ
                  nhập kho
                  {returns && returns.overdue > 0
                    ? ` · ${returns.overdue} QUÁ HẠN`
                    : ""}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
            </Card>
          </Animated.View>
        </>
      )}
    </ScrollView>
  );
}
