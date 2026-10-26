import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  fetchAnalytics,
  fetchCashFlow,
  refreshCashFlow,
  fetchOverview,
} from "@/api/finance";
import { ApiError, isPlanLockedError } from "@/api/client";
import { PlanLockedCard } from "@/components/PlanLockedCard";
import type {
  AnalyticsResponse,
  BreakdownItem,
  CashFlowRow,
  OverviewAnalytics,
} from "@/types/api";
import { defaultRange, previousRange, type DateRange } from "@/lib/dates";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import { compactMoney, formatMoney, groupVN } from "@/lib/format";
import { CHANNEL_LABEL } from "@/lib/labels";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { ShopFilterField, type ShopScope } from "@/components/ShopFilter";
import { fetchChannels } from "@/api/channels";
import type { ChannelListItem } from "@/types/api";
import { hapticTap } from "@/lib/haptics";
import { DonutChart } from "@/components/DonutChart";
import { ReceiptIcon } from "@/components/ReceiptIcon";
import { BreakdownTile } from "@/components/BreakdownTile";
import { WaterfallChart, type WaterfallStep } from "@/components/WaterfallChart";
import { Card } from "@/components/Card";
import { CashByShopTable } from "@/components/CashByShopTable";
import { TABULAR } from "@/theme/tokens";

/**
 * Trang TÀI CHÍNH — trang 2 của pager Trang chủ (chủ shop). Anh Trung 03/10
 * chốt: đúng các khối của web, chỉ đổi bố cục dọc cho điện thoại:
 *   1. 4 THẺ của Báo cáo dòng tiền web (/api/finance/analytics): Tổng giá trị
 *      SP · Doanh thu · Chi phí · Lợi nhuận ròng tạm tính — bấm thẻ bung khoản con.
 *   2. BÓC TÁCH DÒNG TIỀN — thác nước như Tổng quan web (/api/analytics):
 *      Tổng giá trị SP → Giá vốn → Chi phí sàn → Thuế sàn → Ads → Vận hành → Lãi ròng
 *      (cột đầu là giá trị đơn khách đặt, 23/10 anh chốt KHÔNG gọi là Doanh thu).
 *   3. CƠ CẤU CHI PHÍ — donut 12 khoản đúng nhãn/màu Tổng quan web, donut
 *      TRÊN, chú thích DƯỚI.
 *   4. Tiền theo gian hàng (giữ nguyên). Lãi/Lỗ theo ngày đã bỏ (03/10).
 * Mọi bề rộng đo theo màn hình thật (flex + onLayout), không px cố định.
 * Lọc gian hàng (23/10/2026): ô ShopFilterField mở hộp trượt chọn sàn / đúng
 * một gian — backend nhận ?channelName / ?channelId (lib/channel-filter.ts).
 */

const ALL_SHOPS: ShopScope = { channelName: "", channelId: "" };

type TileKey = "gross" | "revenue" | "costs" | "profit";

/** % thay đổi so kỳ trước; kỳ trước = 0 thì không so được → null (như web). */
function deltaOf(cur: number, prev: number | undefined): number | null {
  return prev == null || prev === 0 ? null : ((cur - prev) / Math.abs(prev)) * 100;
}
/** Tỷ trọng %: chia cho 0 → 0 (kỳ trống hiện 0% thay vì NaN). */
function share(part: number, whole: number): number {
  return whole === 0 ? 0 : (part / whole) * 100;
}

/**
 * Cơ cấu chi phí — 12 khoản ĐÚNG nhãn + màu của CostStructure trên Tổng quan
 * web: 8 bucket sàn khấu trừ (platformFeeBreakdown) + giá vốn + Ads + 2 nhóm
 * vận hành. Σ = totalPlatformFee + totalCost + totalOperatingExpense.
 */
function costSegments(a: OverviewAnalytics) {
  const adsExpense = (a.expensesByCategory ?? [])
    .filter((e) => e.category === "ADS")
    .reduce((sum, e) => sum + e.amount, 0);
  const fee = a.platformFeeBreakdown;
  return [
    { key: "service", label: "Phí nền tảng (CĐ, thanh toán, dịch vụ)", amount: fee?.service ?? 0, color: "#f97316" },
    { key: "affiliate", label: "Phí tiếp thị liên kết", amount: fee?.affiliate ?? 0, color: "#f59e0b" },
    { key: "tax", label: "Thuế sàn TMĐT (GTGT + TNCN)", amount: fee?.tax ?? 0, color: "#ef4444" },
    { key: "refund", label: "Tiền hoàn trả khách", amount: fee?.refund ?? 0, color: "#f43f5e" },
    { key: "voucher", label: "Voucher trợ giá của shop", amount: fee?.voucher ?? 0, color: "#ec4899" },
    { key: "shippingDiff", label: "Chênh lệch phí vận chuyển", amount: fee?.shippingDiff ?? 0, color: "#14b8a6" },
    { key: "adWallet", label: "Nạp ví quảng cáo sàn", amount: fee?.adWallet ?? 0, color: "#6366f1" },
    { key: "feeOther", label: "Khấu trừ khác của sàn", amount: fee?.other ?? 0, color: "#94a3b8" },
    { key: "cogs", label: "Giá vốn hàng bán (COGS)", amount: a.totalCost ?? 0, color: "#3b82f6" },
    { key: "ads", label: "Chi phí quảng cáo", amount: adsExpense, color: "#8b5cf6" },
    { key: "varops", label: "Chi phí Biến đổi Vận hành", amount: a.operatingVariableExpense ?? 0, color: "#10b981" },
    { key: "fixops", label: "Chi phí Cố định Vận hành", amount: a.operatingFixedExpense ?? 0, color: "#a16207" },
  ].filter((s) => s.amount !== 0);
}

/** Các bậc thác nước — đúng thứ tự + công thức của PnlBreakdown web. */
function waterfallSteps(a: OverviewAnalytics): WaterfallStep[] {
  const adsExpense = (a.expensesByCategory ?? [])
    .filter((e) => e.category === "ADS")
    .reduce((sum, e) => sum + e.amount, 0);
  const operatingExpense = (a.totalOperatingExpense ?? 0) - adsExpense;
  const fee = a.totalPlatformFee ?? 0;
  const tax = a.totalPlatformTax ?? 0;
  // KHUYẾN MÃI = voucher shop tự bỏ (platformFeeBreakdown.voucher) tách thành bậc
  // riêng ngay sau cột giá trị SP để khách thấy tiền TRƯỚC / SAU khuyến mãi (góp ý
  // khách 22/10, anh chốt 23/10 tối); Chi phí sàn bỏ phần này ra khỏi để không trừ đôi.
  const promo = a.platformFeeBreakdown?.voucher ?? 0;
  return [
    { key: "promo", short: "Khuyến mãi", amount: promo, hue: "rose" },
    { key: "cogs", short: "Giá vốn", amount: a.totalCost ?? 0, hue: "rose" },
    { key: "fee", short: "Chi phí", amount: fee - tax - promo, hue: "rose" },
    { key: "tax", short: "Thuế sàn", amount: tax, hue: "rose" },
    { key: "ads", short: "Ads", amount: adsExpense, hue: "amber" },
    { key: "ops", short: "Vận hành", amount: operatingExpense, hue: "amber" },
    ...(a.missingCost && a.missingCost.orderCount > 0
      ? [{ key: "missingCost", short: "Thiếu vốn", amount: a.missingCost.excludedProfit, hue: "amber" as const }]
      : []),
    // Thu vận hành khác = bậc CỘNG (amount âm → chart vẽ "+" xanh); thuế bổ sung
    // dự phòng = bậc trừ cuối — y web, để Lãi ròng dưới thác = thẻ Lợi nhuận
    // (26/10/2026). amount 0 thì chart tự bỏ bậc.
    { key: "income", short: "Thu khác", amount: -(a.operatingIncome ?? 0), hue: "amber" },
    { key: "provisionTax", short: "Thuế DP", amount: a.additionalTax ?? 0, hue: "amber" },
  ];
}

/**
 * Danh sách khoản con của một thẻ (bung dưới lưới 4 thẻ).
 * - deductions: nhóm khấu trừ (thẻ Giá trị SP) — "−" đỏ, trợ giá "+" xanh.
 * - signed: cột LỢI NHUẬN — khoản có thể ÂM (Lợi nhuận thực tế = lãi đơn đã
 *   đối soát − Ads − vận hành; kỳ chưa có đơn đối soát thì âm đúng bằng Ads).
 *   Trước 26/10 app in Math.abs không dấu → khách thấy 66.894 + 173.826 ≠ 107k
 *   tưởng lệch số; web in "+ / −" + tô màu theo dấu (breakdown-card colorBySign).
 */
function BreakdownItems({
  items,
  deductions = false,
  signed = false,
}: {
  items: BreakdownItem[];
  deductions?: boolean;
  signed?: boolean;
}) {
  if (items.length === 0) {
    return (
      <Text className="py-3 text-center text-xs text-slate-400 dark:text-slate-500">
        Không có khoản nào trong kỳ
      </Text>
    );
  }
  // Nhóm khấu trừ có ≥ 2 dòng 0 ₫ → gom một dòng "N khoản khác" như web
  // (kỳ trống không còn 9 dòng "− 0 ₫ 0,0%").
  const zeroCount = deductions ? items.filter((i) => i.amount === 0).length : 0;
  const shown = zeroCount >= 2 ? items.filter((i) => i.amount !== 0) : items;
  return (
    <View>
      {shown.map((it) => (
        <View key={it.key} className="border-t border-slate-100 dark:border-slate-800 py-2">
          <View className="flex-row items-center gap-2">
            <Text className="flex-1 text-xs text-slate-700 dark:text-slate-300" numberOfLines={2}>
              {it.label}
              {typeof it.count === "number" ? ` · ${groupVN(it.count)} đơn` : ""}
            </Text>
            <Text
              className={`text-xs font-semibold ${
                deductions
                  ? it.amount < 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-500 dark:text-red-400"
                  : signed && it.amount < 0
                    ? "text-red-500 dark:text-red-400"
                    : signed && it.amount > 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-slate-900 dark:text-slate-100"
              }`}
              style={TABULAR}
            >
              {deductions ? (it.amount < 0 ? "+" : "−") : signed ? (it.amount < 0 ? "−" : "+") : ""}
              {formatMoney(Math.abs(it.amount))}
            </Text>
            {/* min-w thay w cố định: biên kiểu "−6689,4%" (1 đơn đối soát nhỏ,
                chi phí lớn) không bị gãy 2 dòng; % âm luôn có dấu (trợ giá sàn
                −2,5% cũng như web). */}
            <Text className="min-w-[44px] shrink-0 text-right text-[10px] text-slate-400 dark:text-slate-500" style={TABULAR}>
              {it.percent < 0 ? "−" : ""}
              {Math.abs(it.percent).toFixed(1).replace(".", ",")}%
            </Text>
          </View>
          {(it.items ?? []).map((sub) => (
            <View key={sub.key} className="mt-1 flex-row items-center gap-2 pl-3">
              <Text className="flex-1 text-[11px] text-slate-500 dark:text-slate-400" numberOfLines={1}>
                {sub.label}
              </Text>
              <Text className="text-[11px] text-slate-600 dark:text-slate-300" style={TABULAR}>
                {compactMoney(sub.amount)}
              </Text>
              <Text className="w-11 text-right text-[10px] text-slate-400 dark:text-slate-500" style={TABULAR}>
                {Math.round(sub.percent)}%
              </Text>
            </View>
          ))}
        </View>
      ))}
      {zeroCount >= 2 ? (
        <View className="flex-row items-center gap-2 border-t border-slate-100 dark:border-slate-800 py-2">
          <Text className="flex-1 text-xs text-slate-400 dark:text-slate-500">
            {zeroCount} khoản khác
          </Text>
          <Text className="text-xs font-semibold text-slate-400 dark:text-slate-500" style={TABULAR}>
            − 0 ₫
          </Text>
          <Text className="min-w-[44px] shrink-0 text-right text-[10px] text-slate-400 dark:text-slate-500" style={TABULAR}>
            0,0%
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export function FinancePage() {
  const [range, setRange] = useState<DateRange>(defaultRange);
  const [scope, setScope] = useState<ShopScope>(ALL_SHOPS);
  const [channels, setChannels] = useState<ChannelListItem[]>([]);
  const [breakdown, setBreakdown] = useState<AnalyticsResponse["breakdown"] | null>(null);
  const [prevBreakdown, setPrevBreakdown] = useState<AnalyticsResponse["breakdown"] | null>(null);
  const [overview, setOverview] = useState<OverviewAnalytics | null>(null);
  const [cashRows, setCashRows] = useState<CashFlowRow[] | null>(null);
  const [openTile, setOpenTile] = useState<TileKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  // Gói bị khóa (403 PLAN_LOCKED) → thẻ khóa thay ô lỗi, giữ câu backend.
  const [planLocked, setPlanLocked] = useState<string | null>(null);
  // Số thứ tự lượt tải — đổi kỳ/sàn liên tiếp thì chỉ lượt MỚI NHẤT được ghi.
  const reqSeq = useRef(0);

  // asRefresh: true = kéo xuống (vòng xoay) · "silent" = tải nền giữ số cũ.
  // DS gian hàng cho ô lọc — đổi rất hiếm, nạp 1 lần.
  useEffect(() => {
    fetchChannels()
      .then(setChannels)
      .catch(() => {});
  }, []);

  const load = useCallback(
    async ({ from, to }: DateRange, shop: ShopScope, asRefresh: boolean | "silent" = false) => {
      const seq = ++reqSeq.current;
      if (asRefresh === true) setRefreshing(true);
      else if (!asRefresh) setLoading(true);
      if (asRefresh !== "silent") setError("");
      try {
        const prev = previousRange(from, to);
        const ch = { channelName: shop.channelName || undefined, channelId: shop.channelId || undefined };
        const [ana, prevAna, ov, cash] = await Promise.all([
          // 4 thẻ = Báo cáo dòng tiền web; kỳ trước cho pill ▲/▼
          fetchAnalytics(from, to, ch),
          fetchAnalytics(prev.from, prev.to, ch).catch(() => null),
          // Thác nước + cơ cấu chi phí = Tổng quan web
          fetchOverview(from, to, ch),
          // Kéo số ví/đang giao mới nhất từ sàn rồi mới đọc bảng — như web mở bảng
          // Tiền theo gian hàng; kéo lỗi vẫn đọc số cron gần nhất.
          refreshCashFlow()
            .catch(() => null)
            .then(() => fetchCashFlow()),
        ]);
        if (seq !== reqSeq.current) return; // đã có lượt tải mới hơn
        setBreakdown(ana.breakdown);
        setPrevBreakdown(prevAna?.breakdown ?? null);
        setOverview(ov);
        setCashRows(cash.rows);
        setPlanLocked(null);
      } catch (err) {
        if (seq !== reqSeq.current) return;
        if (isPlanLockedError(err)) {
          // Khóa giữa phiên (hết ân hạn khi app đang mở) cũng phải hiện — kể cả tải nền.
          setPlanLocked(err.message);
          return;
        }
        if (asRefresh === "silent") return; // tải nền hỏng thì giữ số cũ
        setError(
          err instanceof ApiError ? err.message : "Có lỗi xảy ra, kéo xuống thử lại"
        );
      } finally {
        if (seq === reqSeq.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    void load(range, scope);
  }, [range, scope, load]);

  // Cùng nhịp làm mới nền với Tổng quan (foreground / focus / 60s).
  useAutoRefresh(() => void load(range, scope, "silent"));

  // Lọc gian áp cả vào bảng tiền theo gian hàng (client-side — rows đã có sàn + id)
  const visibleCashRows = (cashRows ?? []).filter((r) =>
    scope.channelId ? r.channelId === scope.channelId : !scope.channelName || r.channelName === scope.channelName
  );

  const b = breakdown;
  const pb = prevBreakdown;
  const segments = overview ? costSegments(overview) : [];
  // Khoản ÂM (sàn bù lại) không vẽ lát nhưng VẪN trừ vào tổng — tâm donut
  // khớp thẻ "Tổng chi phí" từng đồng (như web 16/09).
  const costSlices = segments.filter((s) => s.amount > 0);
  const costTotal = segments.reduce((sum, s) => sum + s.amount, 0);
  const steps = overview ? waterfallSteps(overview) : [];
  const gross = overview?.totalRevenue ?? 0;
  const net = overview?.netProfit ?? 0;
  const netMargin = gross > 0 ? Math.round((net / gross) * 1000) / 10 : null;

  const toggleTile = (k: TileKey) => {
    hapticTap();
    setOpenTile((cur) => (cur === k ? null : k));
  };

  return (
    <ScrollView
      className="flex-1 bg-slate-50 dark:bg-slate-950"
      contentContainerStyle={{ padding: 16, paddingBottom: 96 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => load(range, scope, true)}
        />
      }
    >
      {/* Một hàng hai ô chia đôi (anh chốt 23/10 chiều): gian hàng TRƯỚC, ngày SAU —
          nhãn ngắn, không chiếm hai hàng. Mỗi ô bấm mở hộp trượt riêng. */}
      <View className="mb-4 flex-row gap-2">
        <ShopFilterField mode="scope" compact className="flex-1" channels={channels} value={scope} onChange={setScope} />
        <DateRangeFilter compact className="flex-1" value={range} onChange={setRange} />
      </View>

      {loading ? (
        <View className="items-center py-16">
          <ActivityIndicator size="large" color="#64748b" />
        </View>
      ) : planLocked ? (
        <PlanLockedCard message={planLocked} onRetry={() => void load(range, scope)} />
      ) : error ? (
        <View className="items-center rounded-2xl bg-white dark:bg-slate-900 p-6">
          <Text className="text-center text-sm text-red-500 dark:text-red-400">{error}</Text>
        </View>
      ) : (
        <>
          {/* ===== 1. BỐN THẺ BÁO CÁO DÒNG TIỀN (y web, lưới 2×2) ===== */}
          {b ? (
            <>
              <View className="mb-3 flex-row gap-3">
                <BreakdownTile
                  title="Tổng giá trị sản phẩm"
                  total={b.gross.total}
                  subtitle={`${groupVN(b.gross.orderCount)} đơn (chưa trừ chi phí)`}
                  delta={deltaOf(b.gross.total, pb?.gross.total)}
                  icon="bag-handle-outline"
                  tint="sky"
                  open={openTile === "gross"}
                  onPress={() => toggleTile("gross")}
                />
                <BreakdownTile
                  title="Doanh thu"
                  total={b.revenue.total}
                  share={{ percent: share(b.revenue.total, b.gross.total), label: "trên giá trị SP" }}
                  delta={deltaOf(b.revenue.total, pb?.revenue.total)}
                  icon="wallet-outline"
                  tint="emerald"
                  open={openTile === "revenue"}
                  onPress={() => toggleTile("revenue")}
                />
              </View>
              <View className="mb-3 flex-row gap-3">
                <BreakdownTile
                  title="Chi phí"
                  total={b.costs.total}
                  share={{ percent: share(b.costs.total, b.revenue.total), label: "trên doanh thu" }}
                  delta={deltaOf(b.costs.total, pb?.costs.total)}
                  deltaInverted
                  negative
                  icon="receipt-outline"
                  renderIcon={(color, size) => <ReceiptIcon size={size} color={color} />}
                  tint="red"
                  open={openTile === "costs"}
                  onPress={() => toggleTile("costs")}
                />
                <BreakdownTile
                  title="Lợi nhuận ròng tạm tính"
                  total={b.profit.total}
                  // Khách 22/10 thấy "biên ròng 25,7%" ở thẻ và "biên 16,2%" dưới thác nước
                  // tưởng lệch: thẻ chia cho DOANH THU, thác chia cho GIÁ TRỊ SP → ghi rõ mẫu số.
                  share={{ percent: share(b.profit.total, b.revenue.total), label: "trên doanh thu" }}
                  delta={deltaOf(b.profit.total, pb?.profit.total)}
                  icon="scale-outline"
                  tint="emerald"
                  colorBySign
                  featured
                  open={openTile === "profit"}
                  onPress={() => toggleTile("profit")}
                />
              </View>
              {/* Khoản con của thẻ đang mở — bung DƯỚI lưới để 4 thẻ không lệch cỡ */}
              {openTile ? (
                <Card className="mb-4 px-4 pb-2 pt-3">
                  <View className="mb-1 flex-row items-center justify-between">
                    <Text className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {openTile === "gross"
                        ? "Sàn khấu trừ trên giá trị sản phẩm"
                        : openTile === "revenue"
                          ? "Doanh thu theo trạng thái"
                          : openTile === "costs"
                            ? "Chi phí theo khoản"
                            : "Lợi nhuận theo khoản"}
                    </Text>
                    <Pressable onPress={() => setOpenTile(null)} hitSlop={8}>
                      <Ionicons name="close" size={16} color="#94a3b8" />
                    </Pressable>
                  </View>
                  <BreakdownItems
                    items={b[openTile].items}
                    deductions={openTile === "gross"}
                    signed={openTile === "profit"}
                  />
                  {openTile === "gross" ? (
                    <Text className="mt-1 text-[11px] text-slate-500 dark:text-slate-400" style={TABULAR}>
                      Tổng sàn khấu trừ:{" "}
                      <Text className="font-bold text-red-500 dark:text-red-400">
                        − {formatMoney(b.gross.totalDeduction)}
                      </Text>
                    </Text>
                  ) : null}
                  {openTile === "profit" && b.profit.missingCost && b.profit.missingCost.orderCount > 0 ? (
                    <Text className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                      {groupVN(b.profit.missingCost.orderCount)} đơn chưa có giá vốn nên không được tính vào lợi nhuận. % mỗi dòng là biên lợi nhuận trên dòng tiền tương ứng, không phải tỷ trọng.
                    </Text>
                  ) : null}
                </Card>
              ) : null}
            </>
          ) : null}

          {/* ===== 2. BÓC TÁCH DÒNG TIỀN — thác nước như Tổng quan web ===== */}
          {overview ? (
            <Card className="mb-4 p-4">
              <Text className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Bóc tách dòng tiền
              </Text>
              <Text className="mb-3 text-[11px] text-slate-400 dark:text-slate-500">
                Giá trị sản phẩm bị sàn, giá vốn và chi phí bào mòn tới lợi nhuận ròng.
              </Text>
              {gross <= 0 && net === 0 ? (
                <Text className="py-8 text-center text-sm text-slate-400 dark:text-slate-500">
                  Chưa có đơn nào trong kỳ này.
                </Text>
              ) : (
                <WaterfallChart gross={gross} steps={steps} net={net} />
              )}
              {/* Dòng chốt sổ: tên + biên xếp DỌC bên trái để số bên phải không
                  bao giờ phải xuống dòng, kể cả màn 320px */}
              <View className="mt-3 flex-row items-center justify-between gap-3 border-t border-slate-100 dark:border-slate-800 pt-3">
                <View className="flex-1">
                  <Text className="text-sm text-slate-900 dark:text-slate-100">Lợi nhuận ròng</Text>
                  {netMargin !== null ? (
                    <Text className="text-xs text-slate-400 dark:text-slate-500" style={TABULAR}>
                      biên {String(netMargin).replace(".", ",")}% trên giá trị SP
                    </Text>
                  ) : null}
                </View>
                <Text
                  className={`shrink-0 text-lg font-bold ${
                    net < 0 ? "text-red-500 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"
                  }`}
                  style={TABULAR}
                  numberOfLines={1}
                >
                  {formatMoney(net)}
                </Text>
              </View>
            </Card>
          ) : null}

          {/* ===== 3. CƠ CẤU CHI PHÍ — donut TRÊN, chú thích DƯỚI (y web) ===== */}
          {overview ? (
            <Card className="mb-4 p-4">
              <Text className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Cơ cấu chi phí
              </Text>
              <Text className="mb-3 text-[11px] text-slate-400 dark:text-slate-500">
                Tỷ lệ % các khoản chi trong kỳ.
              </Text>
              {costTotal <= 0 ? (
                <Text className="py-8 text-center text-sm text-slate-400 dark:text-slate-500">
                  Chưa ghi nhận khoản chi nào trong kỳ này.
                </Text>
              ) : (
                <>
                  <DonutChart
                    centerLabel={compactMoney(costTotal)}
                    centerSub="tổng chi"
                    slices={costSlices.map((s) => ({
                      label: s.label,
                      value: s.amount,
                      color: s.color,
                    }))}
                  />
                  <View className="mt-4">
                    {segments.map((s) => {
                      const pct = Math.round((s.amount / costTotal) * 1000) / 10;
                      return (
                        <View
                          key={s.key}
                          className="flex-row items-center gap-2.5 border-t border-slate-100 dark:border-slate-800 py-2"
                        >
                          <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                          <Text className="flex-1 text-xs text-slate-800 dark:text-slate-200" numberOfLines={1}>
                            {s.label}
                            {s.amount < 0 ? (
                              <Text className="text-slate-400 dark:text-slate-500"> (sàn bù lại)</Text>
                            ) : null}
                          </Text>
                          <Text
                            className={`text-xs ${
                              s.amount < 0 ? "text-emerald-600 dark:text-emerald-400" : "text-slate-600 dark:text-slate-300"
                            }`}
                            style={TABULAR}
                          >
                            {compactMoney(s.amount)}
                          </Text>
                          <Text
                            className="w-12 text-right text-xs font-semibold text-slate-900 dark:text-slate-100"
                            style={TABULAR}
                          >
                            {String(pct).replace(".", ",")}%
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                </>
              )}
            </Card>
          ) : null}

          {/* ===== 4. Tiền theo gian hàng — components/CashByShopTable.tsx ===== */}
          <CashByShopTable rows={visibleCashRows} />
        </>
      )}
    </ScrollView>
  );
}

