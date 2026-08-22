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
import Animated, { FadeInDown } from "react-native-reanimated";
import Svg, {
  Defs,
  LinearGradient,
  RadialGradient,
  Rect,
  Stop,
} from "react-native-svg";
import { hapticTap } from "@/lib/haptics";
import { fetchPnlSummary } from "@/api/finance";
import { fetchOrders } from "@/api/orders";
import { fetchReturnsSummary } from "@/api/warehouse";
import { ApiError } from "@/api/client";
import type { PnlSummary, ReturnsSummaryResponse } from "@/types/api";
import { rangeFor, yesterdayRange } from "@/lib/dates";
import { compactMoney } from "@/lib/format";
import { useAuth } from "@/auth/AuthContext";
import { useChannelColors } from "@/components/ChannelDonut";
import { DonutChart } from "@/components/DonutChart";
import { DeltaPill } from "@/components/DeltaPill";
import { Card } from "@/components/Card";
import { Sparkline } from "@/components/Sparkline";
import { CHANNEL_LABEL } from "@/lib/labels";
import { RAISED_SHADOW, TABULAR } from "@/theme/tokens";
import type { ChannelName } from "@/types/api";

/**
 * Vị trí sàn FIX CỨNG (chốt 13/08): sàn không có đơn vẫn đứng nguyên chỗ với
 * số 0 — chỉ con số và donut thay đổi, layout không bao giờ nhảy.
 */
const FIXED_CHANNELS: ChannelName[] = ["SHOPEE", "LAZADA", "TIKTOK"];

/**
 * TỔNG QUAN HÔM NAY — trang đầu tiên chủ shop nhìn thấy khi mở app.
 * Trả lời 3 câu hỏi buổi sáng: hôm nay bán được bao nhiêu? bao nhiêu đơn đang
 * ở đâu? kênh nào đang gánh? (+ đơn hoàn nào cần để mắt)
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
  const [summary, setSummary] = useState<PnlSummary | null>(null);
  const [prevSummary, setPrevSummary] = useState<PnlSummary | null>(null);
  const [weekSummary, setWeekSummary] = useState<PnlSummary | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [returns, setReturns] = useState<ReturnsSummaryResponse["summary"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (asRefresh = false) => {
    if (asRefresh) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const { from, to } = rangeFor("today");
      const y = yesterdayRange();
      const w = rangeFor("7d");
      const [pnl, prevPnl, weekPnl, orders, ret] = await Promise.all([
        fetchPnlSummary(from, to),
        // Hôm qua — mốc so sánh cho pill ▲/▼ %
        fetchPnlSummary(y.from, y.to),
        // 7 ngày — sparkline nhịp lãi dưới hero
        fetchPnlSummary(w.from, w.to),
        fetchOrders({ page: 1, pageSize: 1 }),
        fetchReturnsSummary(),
      ]);
      setSummary(pnl.summary);
      setPrevSummary(prevPnl.summary);
      setWeekSummary(weekPnl.summary);
      setCounts(orders.counts);
      setReturns(ret.summary);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Có lỗi xảy ra, kéo xuống thử lại"
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const today = new Date();
  const WEEKDAYS = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];
  const dateLabel = `${WEEKDAYS[today.getDay()]}, ${today.getDate()}/${today.getMonth() + 1}/${today.getFullYear()}`;
  // Số đơn hôm nay + hôm qua theo từng sàn, trên danh sách sàn CỐ ĐỊNH
  const channelRows = FIXED_CHANNELS.map((ch) => ({
    channel: ch,
    count: summary?.byPlatform?.[ch]?.count ?? 0,
    prevCount: prevSummary?.byPlatform?.[ch]?.count ?? 0,
  }));
  const returningTotal = (returns?.AWAITING ?? 0) + (returns?.RECEIVED ?? 0);
  const weekProfits = (weekSummary?.daily ?? []).map((d) => d.profit);
  const [heroSize, setHeroSize] = useState({ w: 0, h: 0 });
  // Bề rộng sparkline = màn hình − padding trang (16×2) − padding hero (20×2)
  const sparkW = Math.min(width, 480) - 72;

  return (
    <ScrollView
      className="flex-1 bg-slate-50 dark:bg-slate-950"
      contentContainerStyle={{ padding: 16, paddingBottom: 96 }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />
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
                    {summary?.count ?? 0} đơn
                  </Text>
                </View>
              </View>
              <View className="mt-5 flex-row">
                <View className="flex-1">
                  <Text className="text-xs text-slate-400">Doanh thu</Text>
                  <Text className="mt-1 text-[28px] font-bold text-white" style={TABULAR}>
                    {compactMoney(summary?.totalNetRevenue ?? 0)}
                  </Text>
                  <View className="mt-2 flex-row">
                    <DeltaPill
                      onDark
                      current={summary?.totalNetRevenue ?? 0}
                      previous={prevSummary?.totalNetRevenue ?? 0}
                    />
                  </View>
                </View>
                <View className="mx-4 w-px bg-white/10" />
                <View className="flex-1">
                  <Text className="text-xs text-slate-400">Lợi nhuận ròng</Text>
                  <Text
                    className={`mt-1 text-[28px] font-bold ${
                      (summary?.totalProfitAfterTax ?? 0) < 0
                        ? "text-red-400"
                        : "text-emerald-300"
                    }`}
                    style={TABULAR}
                  >
                    {compactMoney(summary?.totalProfitAfterTax ?? 0)}
                  </Text>
                  <View className="mt-2 flex-row">
                    <DeltaPill
                      onDark
                      current={summary?.totalProfitAfterTax ?? 0}
                      previous={prevSummary?.totalProfitAfterTax ?? 0}
                    />
                  </View>
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

          {/* Đếm đơn theo trạng thái — bấm vào nhảy sang tab Đơn hàng đã lọc */}
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
                showLegend={false}
                size={150}
                centerLabel={String(summary?.count ?? 0)}
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
                    <DeltaPill current={r.count} previous={r.prevCount} suffix="" />
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
