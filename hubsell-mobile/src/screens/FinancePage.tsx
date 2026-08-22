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
import { fetchAnalytics, fetchCashFlow, fetchPnlSummary } from "@/api/finance";
import { ApiError } from "@/api/client";
import type {
  AnalyticsResponse,
  BreakdownItem,
  CashFlowRow,
  PnlSummary,
} from "@/types/api";
import { RANGE_OPTIONS, rangeFor, type RangeKey } from "@/lib/dates";
import { compactMoney, formatMoney } from "@/lib/format";
import { CHANNEL_LABEL } from "@/lib/labels";
import { StatCard } from "@/components/StatCard";
import { SegmentedTabs } from "@/components/SegmentedTabs";
import { hapticSelect } from "@/lib/haptics";
import { ProfitBarChart } from "@/components/ProfitBarChart";
import { useChannelColors } from "@/components/ChannelDonut";
import { DonutChart } from "@/components/DonutChart";
import { Card } from "@/components/Card";
import { TABULAR } from "@/theme/tokens";
import { useColorScheme } from "nativewind";

/**
 * Trang TÀI CHÍNH — trang 2 của pager Trang chủ (chủ shop).
 * Lọc THỜI GIAN + LỌC SÀN (chốt 13/08, tham khảo Salework) → 4 thẻ chỉ số →
 * THÁC NƯỚC CHI TIẾT dạng accordion (nguồn: /api/finance/analytics, cùng số
 * với web) → donut CƠ CẤU CHI PHÍ → biểu đồ Lãi/Lỗ → tiền theo gian hàng.
 */

const CHANNEL_FILTERS: { key: string; label: string }[] = [
  { key: "", label: "Tất cả sàn" },
  { key: "SHOPEE", label: "Shopee" },
  { key: "LAZADA", label: "Lazada" },
  { key: "TIKTOK", label: "TikTok" },
];

/**
 * Màu cố định cho donut cơ cấu chi phí (khớp key backend). Giá vốn màu navy
 * đậm TÀNG HÌNH trên card tối → dark mode đổi sang trắng ngà (cùng chiêu với
 * màu TikTok trong useChannelColors).
 */
const COST_COLOR_LIGHT: Record<string, string> = {
  cogs: "#0f172a",
  adsSpend: "#f59e0b",
  variable: "#6366f1",
  fixed: "#94a3b8",
};
const COST_COLOR_DARK: Record<string, string> = {
  ...COST_COLOR_LIGHT,
  cogs: "#e2e8f0",
};

export function FinancePage() {
  const channelColors = useChannelColors();
  const { colorScheme } = useColorScheme();
  const COST_COLOR =
    colorScheme === "dark" ? COST_COLOR_DARK : COST_COLOR_LIGHT;
  const [range, setRange] = useState<RangeKey>("30d");
  const [channel, setChannel] = useState("");
  const [summary, setSummary] = useState<PnlSummary | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsResponse["breakdown"] | null>(null);
  const [cashRows, setCashRows] = useState<CashFlowRow[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(
    async (rangeKey: RangeKey, channelName: string, asRefresh = false) => {
      if (asRefresh) setRefreshing(true);
      else setLoading(true);
      setError("");
      try {
        const { from, to } = rangeFor(rangeKey);
        const [pnl, ana, cash] = await Promise.all([
          fetchPnlSummary(from, to, channelName || undefined),
          fetchAnalytics(from, to, channelName || undefined),
          fetchCashFlow(),
        ]);
        setSummary(pnl.summary);
        setAnalytics(ana.breakdown);
        setCashRows(cash.rows);
      } catch (err) {
        setError(
          err instanceof ApiError ? err.message : "Có lỗi xảy ra, kéo xuống thử lại"
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );

  useEffect(() => {
    void load(range, channel);
  }, [range, channel, load]);

  // Lọc sàn áp cả vào bảng tiền theo gian hàng (client-side — rows đã có sàn)
  const visibleCashRows = (cashRows ?? []).filter(
    (r) => !channel || r.channelName === channel
  );
  // Ví sàn null (sàn không có ví) không đóng góp vào tổng.
  const walletTotal = visibleCashRows.reduce(
    (s, r) => s + (r.walletBalance ?? 0),
    0
  );
  const bankTotal = visibleCashRows.reduce((s, r) => s + r.withdrawn30d, 0);
  const expectedTotal = visibleCashRows.reduce((s, r) => s + r.totalExpected, 0);

  /** Một tầng của thác nước — CÓ items thì bấm bung chi tiết, không thì tĩnh. */
  const WaterfallRow = ({
    id,
    icon,
    label,
    amount,
    tone,
    items,
    countHint,
  }: {
    id: string;
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    amount: number;
    tone: "neutral" | "minus" | "result";
    items?: BreakdownItem[];
    countHint?: string;
  }) => {
    const expandable = !!items && items.length > 0;
    const open = expandable && expanded === id;
    const amountColor =
      tone === "minus"
        ? "text-red-500 dark:text-red-400"
        : tone === "result"
          ? amount < 0
            ? "text-red-500 dark:text-red-400"
            : "text-emerald-600 dark:text-emerald-400"
          : "text-slate-900 dark:text-slate-100";
    // Thanh tỷ lệ so với TỔNG GIÁ TRỊ SẢN PHẨM — liếc độ dài là thấy khoản
    // nào đang ăn bao nhiêu phần miếng bánh, không cần đọc số
    const frac = Math.min(
      1,
      Math.abs(amount) / Math.max(analytics?.gross.total ?? 0, 1)
    );
    const barColor =
      tone === "minus"
        ? "#f87171"
        : tone === "result"
          ? amount < 0
            ? "#f87171"
            : "#34d399"
          : "#94a3b8";
    return (
      <View className="border-t border-slate-100 dark:border-slate-800">
        <Pressable
          className="flex-row items-center gap-2.5 py-3 active:opacity-70"
          disabled={!expandable}
          onPress={() => setExpanded(open ? null : id)}
        >
          <Ionicons name={icon} size={15} color="#64748b" />
          <View className="flex-1">
            <Text className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">{label}</Text>
            {countHint ? (
              <Text className="text-[10px] text-slate-400 dark:text-slate-500">{countHint}</Text>
            ) : null}
            <View className="mt-1.5 h-[3px] w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <View
                className="h-full rounded-full"
                style={{ width: `${Math.max(frac * 100, 1.5)}%`, backgroundColor: barColor }}
              />
            </View>
          </View>
          <Text className={`text-[13px] font-bold ${amountColor}`} style={TABULAR}>
            {tone === "minus" && amount > 0 ? "−" : ""}
            {compactMoney(amount)}
          </Text>
          {expandable ? (
            <Ionicons
              name={open ? "chevron-up" : "chevron-down"}
              size={14}
              color="#cbd5e1"
            />
          ) : null}
        </Pressable>
        {open ? (
          <View className="mb-2 rounded-xl bg-slate-50 dark:bg-slate-950 px-3 py-1">
            {items!.map((it) => (
              <View
                key={it.key}
                className="flex-row items-center justify-between py-1.5"
              >
                <Text className="flex-1 pr-2 text-xs text-slate-600 dark:text-slate-300" numberOfLines={1}>
                  {it.label}
                  {typeof it.count === "number" ? ` (${it.count})` : ""}
                </Text>
                <Text
                  className={`text-xs font-semibold ${
                    it.amount < 0 ? "text-emerald-600 dark:text-emerald-400" : "text-slate-900 dark:text-slate-100"
                  }`}
                  style={TABULAR}
                >
                  {formatMoney(Math.abs(it.amount))}
                </Text>
                <Text
                  className="w-12 text-right text-[10px] text-slate-400 dark:text-slate-500"
                  style={TABULAR}
                >
                  {Math.abs(it.percent).toFixed(1).replace(".", ",")}%
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <ScrollView
      className="flex-1 bg-slate-50 dark:bg-slate-950"
      contentContainerStyle={{ padding: 16, paddingBottom: 96 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => load(range, channel, true)}
        />
      }
    >
      {/* Bộ chọn khoảng thời gian */}
      <SegmentedTabs
        className="mb-2"
        options={RANGE_OPTIONS}
        value={range}
        onChange={setRange}
      />

      {/* Lọc theo sàn */}
      <View className="mb-4 flex-row gap-2">
        {CHANNEL_FILTERS.map((c) => {
          const active = channel === c.key;
          return (
            <Pressable
              key={c.key || "ALL"}
              className={`flex-row items-center gap-1.5 rounded-full px-3 py-1.5 ${
                active ? "bg-slate-900 dark:bg-slate-100" : "border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
              }`}
              onPress={() => {
                if (!active) hapticSelect();
                setChannel(c.key);
              }}
            >
              {c.key ? (
                <View
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: channelColors[c.key] ?? "#94a3b8" }}
                />
              ) : null}
              <Text
                className={`text-xs font-semibold ${
                  active ? "text-white dark:text-slate-900" : "text-slate-600 dark:text-slate-300"
                }`}
              >
                {c.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

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
          {/* 4 thẻ chỉ số — 2 thẻ đầu CÙNG NGUỒN với thác nước bên dưới
              (analytics = web Báo cáo dòng tiền); trộn nguồn Lãi/Lỗ vào đây
              là hai con số "Doanh thu" lệch nhau ngay trên một màn hình. */}
          <View className="mb-3 flex-row gap-3">
            <StatCard
              icon="cash-outline"
              label="Doanh thu"
              value={analytics?.revenue.total ?? 0}
              sub={`${analytics?.gross.orderCount ?? 0} đơn trong kỳ`}
              tint="emerald"
            />
            <StatCard
              icon="trending-up-outline"
              label="Lợi nhuận ròng"
              value={analytics?.profit.total ?? 0}
              sub="Sau phí, giá vốn, vận hành"
              tone="signal"
              tint="emerald"
            />
          </View>
          <View className="mb-4 flex-row gap-3">
            <StatCard
              icon="business-outline"
              label="Đã về Bank"
              value={bankTotal}
              sub="30 ngày gần nhất"
              tint="sky"
            />
            <StatCard
              icon="wallet-outline"
              label="Ví sàn"
              value={walletTotal}
              sub="Số dư thật trên sàn"
              tint="violet"
            />
          </View>

          {/* THÁC NƯỚC CHI TIẾT — cùng số với web Báo cáo dòng tiền */}
          {analytics ? (
            <Card className="mb-4 p-4">
              <Text className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Chi tiết dòng tiền
              </Text>
              <Text className="mb-1 text-[11px] text-slate-400 dark:text-slate-500">
                Bấm từng dòng để xem bóc tách
              </Text>
              {/* Dòng TĨNH — chi tiết các khoản khấu trừ chỉ nằm ở dòng "Sàn
                  khấu trừ" ngay dưới (13/08: hai dòng từng bung trùng 1 list) */}
              <WaterfallRow
                id="gross"
                icon="pricetags-outline"
                label="Tổng giá trị sản phẩm"
                amount={analytics.gross.total}
                tone="neutral"
                countHint={`${analytics.gross.orderCount} đơn hoạt động · giá trị trước khấu trừ`}
              />
              <WaterfallRow
                id="deduction"
                icon="remove-circle-outline"
                label="Sàn khấu trừ (phí, thuế, voucher…)"
                amount={analytics.gross.totalDeduction}
                tone="minus"
                items={analytics.gross.items}
              />
              <WaterfallRow
                id="revenue"
                icon="cash-outline"
                label="Doanh thu thực tế"
                amount={analytics.revenue.total}
                tone="neutral"
                items={analytics.revenue.items}
              />
              <WaterfallRow
                id="costs"
                icon="cart-outline"
                label="Chi phí (giá vốn, ads, vận hành)"
                amount={analytics.costs.total}
                tone="minus"
                items={analytics.costs.items}
              />
              <WaterfallRow
                id="profit"
                icon="trophy-outline"
                label="Lợi nhuận ròng"
                amount={analytics.profit.total}
                tone="result"
                items={analytics.profit.items}
              />
            </Card>
          ) : null}

          {/* CƠ CẤU CHI PHÍ — donut (anh Trung chốt 22/08: tròn dễ nhìn hơn
              thác chảy) + chú giải BÓC CHI TIẾT từng khoản: giá vốn/Ads theo
              sàn, chi phí nhập tay theo danh mục (backend costs.items[].items) */}
          {analytics && analytics.costs.total > 0 ? (
            <Card className="mb-4 p-4">
              <Text className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
                Cơ cấu chi phí
              </Text>
              <DonutChart
                centerLabel={compactMoney(analytics.costs.total)}
                centerSub="tổng chi phí"
                showLegend={false}
                slices={analytics.costs.items
                  .filter((it) => it.amount > 0)
                  .map((it) => ({
                    label: it.label,
                    value: it.amount,
                    color: COST_COLOR[it.key] ?? "#cbd5e1",
                  }))}
              />
              <View className="mt-4">
                {analytics.costs.items
                  .filter((it) => it.amount > 0)
                  .map((it) => (
                    <View
                      key={it.key}
                      className="border-t border-slate-100 py-2 dark:border-slate-800"
                    >
                      <View className="flex-row items-center gap-2">
                        <View
                          className="h-2.5 w-2.5 rounded-full"
                          style={{
                            backgroundColor: COST_COLOR[it.key] ?? "#cbd5e1",
                          }}
                        />
                        <Text
                          className="flex-1 text-xs font-semibold text-slate-800 dark:text-slate-200"
                          numberOfLines={1}
                        >
                          {it.label}
                        </Text>
                        <Text
                          className="text-xs font-semibold text-slate-900 dark:text-slate-100"
                          style={TABULAR}
                        >
                          {compactMoney(it.amount)}
                        </Text>
                        <Text
                          className="w-10 text-right text-xs font-semibold text-slate-500 dark:text-slate-400"
                          style={TABULAR}
                        >
                          {Math.round(it.percent)}%
                        </Text>
                      </View>
                      {/* Dòng con bóc tách — % tính trên chính khoản cha */}
                      {(it.items ?? []).map((sub) => (
                        <View
                          key={sub.key}
                          className="mt-1 flex-row items-center gap-2 pl-[18px]"
                        >
                          <Text
                            className="flex-1 text-[11px] text-slate-500 dark:text-slate-400"
                            numberOfLines={1}
                          >
                            {sub.label}
                          </Text>
                          <Text
                            className="text-[11px] text-slate-600 dark:text-slate-300"
                            style={TABULAR}
                          >
                            {compactMoney(sub.amount)}
                          </Text>
                          <Text
                            className="w-10 text-right text-[11px] text-slate-400 dark:text-slate-500"
                            style={TABULAR}
                          >
                            {Math.round(sub.percent)}%
                          </Text>
                        </View>
                      ))}
                    </View>
                  ))}
              </View>
            </Card>
          ) : null}

          {/* Biểu đồ Lãi/Lỗ theo ngày */}
          <Card className="mb-4 p-4">
            <Text className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
              Lãi/Lỗ theo ngày
            </Text>
            <ProfitBarChart data={summary?.daily ?? []} />
          </Card>

          {/* Dòng tiền theo gian hàng */}
          <Card className="p-4">
            <Text className="mb-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
              Tiền theo gian hàng
            </Text>
            <Text className="mb-3 text-[11px] text-slate-400 dark:text-slate-500">
              Ví = số dư THẬT trên sàn · Bank = đã về ngân hàng 30 ngày
            </Text>
            {visibleCashRows.map((r) => (
              <View
                key={r.channelId}
                className="flex-row items-center justify-between border-t border-slate-100 dark:border-slate-800 py-2.5"
              >
                <View className="flex-1 pr-2">
                  <Text className="text-sm font-medium text-slate-900 dark:text-slate-100" numberOfLines={1}>
                    {r.shopName}
                  </Text>
                  <Text className="text-[11px] text-slate-400 dark:text-slate-500">
                    {CHANNEL_LABEL[r.channelName] ?? r.channelName}
                    {r.disconnected ? " · Đã ngắt" : ""}
                  </Text>
                </View>
                <View className="items-end">
                  <Text
                    className="text-sm font-semibold text-slate-900 dark:text-slate-100"
                    style={TABULAR}
                  >
                    Ví {r.walletBalance == null ? "—" : compactMoney(r.walletBalance)}
                  </Text>
                  <Text
                    className="text-[11px] text-emerald-600 dark:text-emerald-400"
                    style={TABULAR}
                  >
                    Bank {compactMoney(r.withdrawn30d)}
                  </Text>
                </View>
              </View>
            ))}
            {visibleCashRows.length === 0 ? (
              <Text className="py-4 text-center text-sm text-slate-400 dark:text-slate-500">
                Không có gian hàng nào trên sàn này
              </Text>
            ) : null}
            <View className="mt-2 border-t border-slate-200 dark:border-slate-700 pt-2">
              <Text
                className="text-right text-[11px] text-slate-400 dark:text-slate-500"
                style={TABULAR}
              >
                Ví sàn: {formatMoney(walletTotal)} · Doanh thu dự kiến:{" "}
                {formatMoney(expectedTotal)}
              </Text>
            </View>
          </Card>
        </>
      )}
    </ScrollView>
  );
}
