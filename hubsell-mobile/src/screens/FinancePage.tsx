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
import { ProfitBarChart } from "@/components/ProfitBarChart";
import { CHANNEL_COLOR } from "@/components/ChannelDonut";
import { DonutChart } from "@/components/DonutChart";

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

/** Màu cố định cho donut cơ cấu chi phí (khớp key backend). */
const COST_COLOR: Record<string, string> = {
  cogs: "#0f172a",
  adsSpend: "#f59e0b",
  variable: "#6366f1",
  fixed: "#94a3b8",
};

export function FinancePage() {
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
        ? "text-red-500"
        : tone === "result"
          ? amount < 0
            ? "text-red-500"
            : "text-emerald-600"
          : "text-slate-900";
    return (
      <View className="border-t border-slate-100">
        <Pressable
          className="flex-row items-center gap-2.5 py-3 active:opacity-70"
          disabled={!expandable}
          onPress={() => setExpanded(open ? null : id)}
        >
          <Ionicons name={icon} size={15} color="#64748b" />
          <View className="flex-1">
            <Text className="text-[13px] font-semibold text-slate-900">{label}</Text>
            {countHint ? (
              <Text className="text-[10px] text-slate-400">{countHint}</Text>
            ) : null}
          </View>
          <Text className={`text-[13px] font-bold ${amountColor}`}>
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
          <View className="mb-2 rounded-xl bg-slate-50 px-3 py-1">
            {items!.map((it) => (
              <View
                key={it.key}
                className="flex-row items-center justify-between py-1.5"
              >
                <Text className="flex-1 pr-2 text-xs text-slate-600" numberOfLines={1}>
                  {it.label}
                  {typeof it.count === "number" ? ` (${it.count})` : ""}
                </Text>
                <Text
                  className={`text-xs font-semibold ${
                    it.amount < 0 ? "text-emerald-600" : "text-slate-900"
                  }`}
                >
                  {formatMoney(Math.abs(it.amount))}
                </Text>
                <Text className="w-12 text-right text-[10px] text-slate-400">
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
      className="flex-1 bg-slate-50"
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => load(range, channel, true)}
        />
      }
    >
      {/* Bộ chọn khoảng thời gian */}
      <View className="mb-2 flex-row rounded-xl bg-slate-200/70 p-1">
        {RANGE_OPTIONS.map((opt) => (
          <Pressable
            key={opt.key}
            className={`flex-1 items-center rounded-lg py-1.5 ${
              range === opt.key ? "bg-white" : ""
            }`}
            style={range === opt.key ? { elevation: 1 } : undefined}
            onPress={() => setRange(opt.key)}
          >
            <Text
              className={`text-xs font-semibold ${
                range === opt.key ? "text-slate-900" : "text-slate-500"
              }`}
            >
              {opt.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Lọc theo sàn */}
      <View className="mb-4 flex-row gap-2">
        {CHANNEL_FILTERS.map((c) => {
          const active = channel === c.key;
          return (
            <Pressable
              key={c.key || "ALL"}
              className={`flex-row items-center gap-1.5 rounded-full px-3 py-1.5 ${
                active ? "bg-slate-900" : "border border-slate-200 bg-white"
              }`}
              onPress={() => setChannel(c.key)}
            >
              {c.key ? (
                <View
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: CHANNEL_COLOR[c.key] ?? "#94a3b8" }}
                />
              ) : null}
              <Text
                className={`text-xs font-semibold ${
                  active ? "text-white" : "text-slate-600"
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
          <ActivityIndicator size="large" color="#0f172a" />
        </View>
      ) : error ? (
        <View className="items-center rounded-2xl bg-white p-6">
          <Text className="text-center text-sm text-red-500">{error}</Text>
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
            />
            <StatCard
              icon="trending-up-outline"
              label="Lợi nhuận ròng"
              value={analytics?.profit.total ?? 0}
              sub="Sau phí, giá vốn, vận hành"
              tone="signal"
            />
          </View>
          <View className="mb-4 flex-row gap-3">
            <StatCard
              icon="business-outline"
              label="Đã về Bank"
              value={bankTotal}
              sub="30 ngày gần nhất"
            />
            <StatCard
              icon="wallet-outline"
              label="Ví sàn"
              value={walletTotal}
              sub="Số dư thật trên sàn"
            />
          </View>

          {/* THÁC NƯỚC CHI TIẾT — cùng số với web Báo cáo dòng tiền */}
          {analytics ? (
            <View className="mb-4 rounded-2xl bg-white p-4" style={{ elevation: 2 }}>
              <Text className="text-sm font-semibold text-slate-900">
                Chi tiết dòng tiền
              </Text>
              <Text className="mb-1 text-[11px] text-slate-400">
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
            </View>
          ) : null}

          {/* CƠ CẤU CHI PHÍ — % từng khoản */}
          {analytics && analytics.costs.total > 0 ? (
            <View className="mb-4 rounded-2xl bg-white p-4" style={{ elevation: 2 }}>
              <Text className="mb-3 text-sm font-semibold text-slate-900">
                Cơ cấu chi phí
              </Text>
              <DonutChart
                centerLabel={compactMoney(analytics.costs.total)}
                centerSub="tổng chi phí"
                slices={analytics.costs.items
                  .filter((it) => it.amount > 0)
                  .map((it) => ({
                    label: it.label,
                    value: it.amount,
                    color: COST_COLOR[it.key] ?? "#cbd5e1",
                    detail: compactMoney(it.amount),
                  }))}
              />
            </View>
          ) : null}

          {/* Biểu đồ Lãi/Lỗ theo ngày */}
          <View className="mb-4 rounded-2xl bg-white p-4" style={{ elevation: 2 }}>
            <Text className="mb-3 text-sm font-semibold text-slate-900">
              Lãi/Lỗ theo ngày
            </Text>
            <ProfitBarChart data={summary?.daily ?? []} />
          </View>

          {/* Dòng tiền theo gian hàng */}
          <View className="rounded-2xl bg-white p-4" style={{ elevation: 2 }}>
            <Text className="mb-1 text-sm font-semibold text-slate-900">
              Tiền theo gian hàng
            </Text>
            <Text className="mb-3 text-[11px] text-slate-400">
              Ví = số dư THẬT trên sàn · Bank = đã về ngân hàng 30 ngày
            </Text>
            {visibleCashRows.map((r) => (
              <View
                key={r.channelId}
                className="flex-row items-center justify-between border-t border-slate-100 py-2.5"
              >
                <View className="flex-1 pr-2">
                  <Text className="text-sm font-medium text-slate-900" numberOfLines={1}>
                    {r.shopName}
                  </Text>
                  <Text className="text-[11px] text-slate-400">
                    {CHANNEL_LABEL[r.channelName] ?? r.channelName}
                  </Text>
                </View>
                <View className="items-end">
                  <Text className="text-sm font-semibold text-slate-900">
                    Ví {r.walletBalance == null ? "—" : compactMoney(r.walletBalance)}
                  </Text>
                  <Text className="text-[11px] text-emerald-600">
                    Bank {compactMoney(r.withdrawn30d)}
                  </Text>
                </View>
              </View>
            ))}
            {visibleCashRows.length === 0 ? (
              <Text className="py-4 text-center text-sm text-slate-400">
                Không có gian hàng nào trên sàn này
              </Text>
            ) : null}
            <View className="mt-2 border-t border-slate-200 pt-2">
              <Text className="text-right text-[11px] text-slate-400">
                Ví sàn: {formatMoney(walletTotal)} · Doanh thu dự kiến:{" "}
                {formatMoney(expectedTotal)}
              </Text>
            </View>
          </View>
        </>
      )}
    </ScrollView>
  );
}
