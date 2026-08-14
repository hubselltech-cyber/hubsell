import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useRouter, type Href } from "expo-router";
import Animated, { FadeInDown } from "react-native-reanimated";
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
import { CHANNEL_LABEL } from "@/lib/labels";
import type { ChannelName } from "@/types/api";

/**
 * Màu thương hiệu theo LOGO Hubsell thật (chữ H xanh lá gradient + mũi tên
 * đi lên — frontend/public/logo-hubsell.png), KHÔNG phải cam CTA landing.
 */
const BRAND = "#10b981";

/**
 * Vị trí sàn FIX CỨNG (chốt 13/08): sàn không có đơn vẫn đứng nguyên chỗ với
 * số 0 — chỉ con số và donut thay đổi, layout không bao giờ nhảy.
 */
const FIXED_CHANNELS: ChannelName[] = ["SHOPEE", "LAZADA", "TIKTOK"];

/**
 * TỔNG QUAN HÔM NAY — trang đầu tiên chủ shop nhìn thấy khi mở app.
 * Trả lời 3 câu hỏi buổi sáng: hôm nay bán được bao nhiêu? bao nhiêu đơn đang
 * ở đâu? kênh nào đang gánh? (+ đơn hoàn nào cần để mắt)
 */

const STATUS_TILES: { key: string; label: string; color: string }[] = [
  { key: "PENDING", label: "Chờ xử lý", color: "text-amber-600 dark:text-amber-400" },
  { key: "SHIPPING", label: "Đang giao", color: "text-indigo-600 dark:text-indigo-400" },
  { key: "DELIVERED", label: "Đã giao", color: "text-emerald-600 dark:text-emerald-400" },
  { key: "CANCELLED", label: "Hủy/Hoàn", color: "text-red-500 dark:text-red-400" },
];

export function OverviewPage({ goWarehouse }: { goWarehouse: () => void }) {
  const { user } = useAuth();
  const channelColors = useChannelColors();
  const router = useRouter();
  const [summary, setSummary] = useState<PnlSummary | null>(null);
  const [prevSummary, setPrevSummary] = useState<PnlSummary | null>(null);
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
      const [pnl, prevPnl, orders, ret] = await Promise.all([
        fetchPnlSummary(from, to),
        // Hôm qua — mốc so sánh cho pill ▲/▼ %
        fetchPnlSummary(y.from, y.to),
        fetchOrders({ page: 1, pageSize: 1 }),
        fetchReturnsSummary(),
      ]);
      setSummary(pnl.summary);
      setPrevSummary(prevPnl.summary);
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
  const dateLabel = `${today.getDate()}/${today.getMonth() + 1}/${today.getFullYear()}`;
  // Số đơn hôm nay + hôm qua theo từng sàn, trên danh sách sàn CỐ ĐỊNH
  const channelRows = FIXED_CHANNELS.map((ch) => ({
    channel: ch,
    count: summary?.byPlatform?.[ch]?.count ?? 0,
    prevCount: prevSummary?.byPlatform?.[ch]?.count ?? 0,
  }));
  const returningTotal = (returns?.AWAITING ?? 0) + (returns?.RECEIVED ?? 0);

  return (
    <ScrollView
      className="flex-1 bg-slate-50 dark:bg-slate-950"
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />
      }
    >
      <Text className="text-base font-semibold text-slate-900 dark:text-slate-100">
        Xin chào, {user?.fullName ?? "chủ shop"} 👋
      </Text>
      <Text className="mb-4 text-xs text-slate-500 dark:text-slate-400">Hôm nay {dateLabel}</Text>

      {loading ? (
        <View className="items-center py-16">
          <ActivityIndicator size="large" color="#64748b" />
        </View>
      ) : error ? (
        <View className="items-center rounded-2xl bg-white dark:bg-slate-900 p-6">
          <Text className="text-center text-sm text-red-500 dark:text-red-400">{error}</Text>
        </View>
      ) : (
        <>
          {/* Kết quả hôm nay — bố cục 2 CỘT Doanh thu | Lợi nhuận (chốt 13/08:
              bản gộp một dòng bị chê lộn xộn), logo thật làm nhận diện.
              Các khối vào trang so le 60ms — đủ thấy nhịp, không đủ gây chờ. */}
          <Animated.View entering={FadeInDown.duration(280)}>
          <View className="mb-3 rounded-2xl bg-white dark:bg-slate-900 p-5" style={{ elevation: 2 }}>
            <View className="flex-row items-center gap-2">
              {/* PNG logo nền trắng vuông — bo góc + viền mảnh kiểu app icon
                  cho khỏi thành ô trắng thô trên card tối (góp ý 14/08) */}
              <Image
                source={require("@/assets/images/logo-hubsell.png")}
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 7,
                  borderWidth: 1,
                  borderColor: "#e2e8f0",
                }}
                contentFit="contain"
              />
              <Text className="flex-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                Kết quả hôm nay
              </Text>
              <Text className="text-xs text-slate-400 dark:text-slate-500">
                {summary?.count ?? 0} đơn
              </Text>
            </View>
            <View className="mt-4 flex-row">
              <View className="flex-1">
                <Text className="text-xs text-slate-500 dark:text-slate-400">Doanh thu</Text>
                <Text className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">
                  {compactMoney(summary?.totalNetRevenue ?? 0)}
                </Text>
                <View className="mt-2 flex-row">
                  <DeltaPill
                    current={summary?.totalNetRevenue ?? 0}
                    previous={prevSummary?.totalNetRevenue ?? 0}
                  />
                </View>
              </View>
              <View className="mx-4 w-px bg-slate-100 dark:bg-slate-800" />
              <View className="flex-1">
                <Text className="text-xs text-slate-500 dark:text-slate-400">Lợi nhuận ròng</Text>
                <Text
                  className={`mt-1 text-2xl font-bold ${
                    (summary?.totalProfitAfterTax ?? 0) < 0
                      ? "text-red-500 dark:text-red-400"
                      : "text-emerald-600 dark:text-emerald-400"
                  }`}
                >
                  {compactMoney(summary?.totalProfitAfterTax ?? 0)}
                </Text>
                <View className="mt-2 flex-row">
                  <DeltaPill
                    current={summary?.totalProfitAfterTax ?? 0}
                    previous={prevSummary?.totalProfitAfterTax ?? 0}
                  />
                </View>
              </View>
            </View>
          </View>
          </Animated.View>

          {/* Đếm đơn theo trạng thái — bấm vào nhảy sang tab Đơn hàng đã lọc */}
          <Animated.View
            entering={FadeInDown.duration(280).delay(60)}
            className="mb-3 flex-row gap-2"
          >
            {STATUS_TILES.map((t) => (
              <Pressable
                key={t.key}
                className="flex-1 items-center rounded-2xl bg-white dark:bg-slate-900 py-3 active:opacity-70"
                style={{ elevation: 1 }}
                onPress={() => {
                  hapticTap();
                  router.push(`/(admin)/orders?status=${t.key}` as Href);
                }}
              >
                <Text className={`text-lg font-bold ${t.color}`}>
                  {counts[t.key] ?? 0}
                </Text>
                <Text className="text-[10px] text-slate-500 dark:text-slate-400">{t.label}</Text>
              </Pressable>
            ))}
          </Animated.View>

          {/* Tỷ trọng kênh hôm nay — vị trí sàn CỐ ĐỊNH, chỉ số nhảy */}
          <Animated.View entering={FadeInDown.duration(280).delay(120)}>
          <View className="mb-3 rounded-2xl bg-white dark:bg-slate-900 p-4" style={{ elevation: 2 }}>
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
                  >
                    {r.count} đơn
                  </Text>
                  <DeltaPill current={r.count} previous={r.prevCount} suffix="" />
                </View>
              ))}
            </View>
          </View>
          </Animated.View>

          {/* Đơn hoàn cần để mắt — bấm sang trang Kho */}
          <Animated.View entering={FadeInDown.duration(280).delay(180)}>
          <Pressable
            className="flex-row items-center gap-3 rounded-2xl bg-white dark:bg-slate-900 p-4 active:opacity-70"
            style={{ elevation: 2 }}
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
          </Pressable>
          </Animated.View>
        </>
      )}
    </ScrollView>
  );
}
