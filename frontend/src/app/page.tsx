"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Package,
  ShoppingCart,
  Store,
  Wallet,
  RefreshCw,
  AlertTriangle,
  ChevronRight,
  TrendingUp,
  Receipt,
  Scale,
  type LucideIcon,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AccessDenied } from "@/components/access-denied";
import { AppShell } from "@/components/app-shell";
import { Money } from "@/components/ui/money";
import { StatCard } from "@/components/dashboard/stat-card";
import { DateRangePicker } from "@/components/date-range-picker";
import { Refreshing } from "@/components/refreshing";
import {
  formatRangeLabel,
  matchPreset,
  RANGE_PRESETS,
  type DateRange,
} from "@/lib/date-range";
import { toneBySign } from "@/components/dashboard/dashboard-card";
import { CommandCenter } from "@/components/dashboard/command-center";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  fetchAnalytics,
  fetchDashboardSummary,
  getStoredUser,
  getToken,
  ApiError,
  type AnalyticsResponse,
  type ChannelName,
  type DashboardSummary,
} from "@/lib/api";
import { canAccessDashboard, canSeeFinancials } from "@/lib/permissions";
import { CHANNEL_META } from "@/lib/channel-meta";
import {
  ALL_CHANNELS,
  ChannelFilter,
  type ChannelFilterValue,
} from "@/components/channel-filter";
import { formatVND, formatNumber } from "@/lib/format";
import { moneyTone, TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

// Màu nền của từng sàn trên biểu đồ tròn
const CHANNEL_COLORS: Record<string, string> = {
  SHOPEE: "#f97316",
  TIKTOK: "#18181b",
  LAZADA: "#3b82f6",
  OFFLINE: "#a1a1aa",
};

/** Cỡ số Hero riêng của Dashboard — 4 thẻ trên một hàng nên nhỏ hơn mặc định. */
const HERO_SIZE = "text-xl font-bold";


/** Một ô chỉ số tích luỹ dạng viên thuốc trên thanh trạng thái. */
function StatusPill({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-2 rounded-lg border border-slate-200/80 bg-card px-3 py-1.5">
      <Icon className="size-4 shrink-0 text-slate-400" strokeWidth={2} />
      <span className={TEXT_SUB}>{label}</span>
      <span className="text-sm font-semibold text-slate-900">{value}</span>
    </span>
  );
}

/**
 * SƠ ĐỒ BÓC TÁCH DÒNG TIỀN
 *
 * Xếp dọc theo đúng thứ tự tiền bị bào mòn: doanh thu gộp trừ dần từng khoản
 * cho tới lợi nhuận ròng. Đọc từ trên xuống là thấy ngay khoản nào ăn nhiều
 * nhất — thứ mà bốn thẻ Hero rời rạc không nói được.
 */
function PnlBreakdown({ analytics }: { analytics: AnalyticsResponse }) {
  const adsExpense = analytics.expensesByCategory
    .filter((e) => e.category === "ADS")
    .reduce((sum, e) => sum + e.amount, 0);
  const otherExpense = analytics.totalOperatingExpense - adsExpense;

  const steps = [
    { key: "cogs", label: "Giá vốn hàng bán", amount: analytics.totalCost },
    { key: "fee", label: "Phí sàn", amount: analytics.totalPlatformFee },
    { key: "ads", label: "Chi phí quảng cáo", amount: adsExpense },
    { key: "other", label: "Chi phí vận hành khác", amount: otherExpense },
  ].filter((st) => st.amount !== 0);

  const net = analytics.netProfit;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bóc tách dòng tiền</CardTitle>
        <CardDescription>
          Doanh thu bị bào mòn qua từng khoản cho tới lợi nhuận ròng.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Điểm xuất phát */}
        <div className="flex items-baseline justify-between gap-3">
          <span className={TEXT_SUB}>Doanh thu gộp</span>
          <Money
            value={analytics.totalRevenue}
            className="text-lg font-semibold text-slate-900"
          />
        </div>

        {/* Các khoản trừ dần — thụt lề và có vạch dọc để thấy đây là nhánh con */}
        <div className="mt-2 space-y-0 border-l border-slate-200 pl-4">
          {steps.map((st) => (
            <div
              key={st.key}
              className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-2.5 last:border-b-0"
            >
              <span className="flex items-baseline gap-1.5 text-sm text-slate-600">
                <span className="text-slate-400">−</span>
                {st.label}
              </span>
              <Money
                value={st.amount}
                className="shrink-0 text-sm font-normal text-slate-600"
              />
            </div>
          ))}
        </div>

        {/* Kết luận */}
        <div className="mt-3 flex items-baseline justify-between gap-3 border-t pt-3">
          <span className="text-sm font-medium text-slate-900">
            Lợi nhuận ròng
          </span>
          <Money
            value={net}
            className={cn("text-lg font-bold", moneyTone(net))}
          />
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * NHÃN TĂNG/GIẢM so với kỳ trước liền kề.
 * previous = null nghĩa là đang xem toàn bộ lịch sử — không có kỳ trước để so.
 */
function DeltaChip({
  current,
  previous,
  compareLabel,
}: {
  current: number;
  previous: number | null | undefined;
  compareLabel: string;
}) {
  if (previous == null) return null;
  // Kỳ trước bằng 0 thì mọi phép chia % đều vô nghĩa — nói thẳng bằng chữ
  if (previous === 0) {
    return (
      <span className={TEXT_SUB}>
        {current > 0 ? `Kỳ trước: 0 · ${compareLabel}` : `Bằng ${compareLabel}`}
      </span>
    );
  }
  const pct = Math.round(((current - previous) / previous) * 1000) / 10;
  const up = pct >= 0;
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={cn(
          "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium",
          up ? "bg-emerald-50 text-emerald-500" : "bg-rose-50 text-red-500"
        )}
      >
        {up ? "▲" : "▼"} {Math.abs(pct)}%
      </span>
      <span className={TEXT_SUB}>{compareLabel}</span>
    </span>
  );
}

/** Một ô trạng thái trong phễu — thuần hiển thị để liếc nhanh, không bấm được. */
function PipelineStep({
  label,
  count,
  countClassName,
}: {
  label: string;
  count: number;
  countClassName?: string;
}) {
  return (
    <div className="flex min-w-24 flex-col items-center gap-0.5 px-3 py-2">
      <span
        className={cn(
          "text-lg font-semibold text-slate-900",
          countClassName
        )}
      >
        {formatNumber(count)}
      </span>
      <span className={cn(TEXT_SUB, "whitespace-nowrap")}>{label}</span>
    </div>
  );
}

/**
 * PHỄU VẬN HÀNH ĐƠN HÀNG — đọc từ trái sang phải theo vòng đời đơn,
 * hai ô cảnh báo (hoàn / hủy) tách riêng bên phải.
 */
function PipelineStrip({ pipeline }: { pipeline: AnalyticsResponse["pipeline"] }) {
  const steps = [
    { key: "PENDING", label: "Chờ xác nhận" },
    { key: "PROCESSED", label: "Đang xử lý" },
    { key: "SHIPPING", label: "Đang giao" },
    { key: "DELIVERED", label: "Thành công" },
  ] as const;
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-x-1 gap-y-2 p-3">
        {steps.map((st, i) => (
          <div key={st.key} className="flex items-center gap-1">
            {i > 0 && (
              <ChevronRight className="size-4 shrink-0 text-slate-300" />
            )}
            <PipelineStep label={st.label} count={pipeline[st.key]} />
          </div>
        ))}

        {/* Nhóm cảnh báo — chỉ nhuộm màu khi thật sự có đơn cần xử lý */}
        <div className="ml-auto flex items-center gap-1 border-l border-slate-200 pl-2">
          <PipelineStep
            label="⚠️ Hoàn / Trả hàng"
            count={pipeline.RETURNING}
            countClassName={pipeline.RETURNING > 0 ? "text-amber-600" : ""}
          />
          <PipelineStep
            label="🚫 Đơn hủy"
            count={pipeline.CANCELLED}
            countClassName={pipeline.CANCELLED > 0 ? "text-red-500" : ""}
          />
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * TỶ TRỌNG KÊNH BÁN — thanh xếp chồng ngang + danh sách theo SÀN.
 * Gom về cấp nền tảng (Shopee, TikTok…) thay vì xé lẻ từng gian hàng: đây là
 * khối liếc nhanh, hai gian Shopee cộng làm một là đủ; muốn soi từng gian đã
 * có bộ lọc gian hàng ở đầu trang.
 */
function MarketplaceShare({ analytics }: { analytics: AnalyticsResponse }) {
  const byPlatform = new Map<string, { revenue: number; count: number }>();
  for (const r of analytics.ordersByChannel) {
    const cur = byPlatform.get(r.channelName) ?? { revenue: 0, count: 0 };
    cur.revenue += r.revenue;
    cur.count += r.count;
    byPlatform.set(r.channelName, cur);
  }
  const rows = [...byPlatform.entries()]
    .map(([channelName, v]) => ({ channelName, ...v }))
    .sort((a, b) => b.revenue - a.revenue);
  const total = rows.reduce((sum, r) => sum + r.revenue, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tỷ trọng kênh bán hàng</CardTitle>
        <CardDescription>
          Giá trị đơn phát sinh trong kỳ theo từng gian hàng (không tính đơn hủy
          và đơn đang hoàn/trả).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 || total === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">
            Chưa có đơn nào trong kỳ này.
          </p>
        ) : (
          <>
            {/* Thanh xếp chồng: nhìn một phát là thấy sàn nào đang gánh */}
            <div className="flex h-3 w-full overflow-hidden rounded-full">
              {rows.map((r) => (
                <div
                  key={r.channelName}
                  style={{
                    width: `${Math.max((r.revenue / total) * 100, 1)}%`,
                    backgroundColor: CHANNEL_COLORS[r.channelName] ?? "#8b5cf6",
                  }}
                />
              ))}
            </div>

            <div className="mt-4">
              {rows.map((r) => {
                const pctShare = Math.round((r.revenue / total) * 1000) / 10;
                return (
                  <div
                    key={r.channelName}
                    className="flex items-center gap-3 border-b border-slate-100 py-2.5 last:border-b-0"
                  >
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{
                        backgroundColor:
                          CHANNEL_COLORS[r.channelName] ?? "#8b5cf6",
                      }}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-900">
                      {CHANNEL_META[r.channelName as ChannelName]?.label ??
                        r.channelName}
                    </span>
                    <span className={cn(TEXT_SUB, "shrink-0")}>
                      {formatNumber(r.count)} đơn
                    </span>
                    <Money
                      value={r.revenue}
                      className="w-28 shrink-0 text-right text-sm text-slate-900"
                    />
                    <span className="w-14 shrink-0 text-right text-sm font-semibold text-slate-900">
                      {pctShare}%
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  // Command Center mở ra là thấy HÔM NAY — câu hỏi đầu ngày của chủ shop là
  // "hôm nay đang chạy thế nào", không phải bức tranh 30 ngày
  const [range, setRange] = useState<DateRange>(() =>
    RANGE_PRESETS.find((p) => p.key === "today")!.resolve()
  );
  const [channel, setChannel] = useState<ChannelFilterValue>(ALL_CHANNELS);
  // SALES xem được doanh thu và sản lượng, nhưng không được biết giá vốn hay lãi.
  // Backend đã cắt các trường đó khỏi phản hồi; ở đây bỏ luôn thẻ để không hiện "—".
  const seesFinancials = canSeeFinancials(getStoredUser()?.role);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summary, stats] = await Promise.all([
        fetchDashboardSummary(),
        fetchAnalytics(range, channel),
      ]);
      setData(summary);
      setAnalytics(stats);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return;
      }
      if (err instanceof ApiError && err.status === 403) {
        setDenied(true);
        return;
      }
      if (err instanceof ApiError && err.status === 409) return; // chưa có kênh — overlay xử lý
      setError(
        "Chưa kết nối được máy chủ (backend). Hãy chắc chắn backend đang chạy ở cổng 4000."
      );
    } finally {
      setLoading(false);
    }
  }, [router, range, channel]);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    // Kho không có việc gì ở Tổng quan; SALES vào được nhưng bị cắt chỉ số tài chính
    if (!canAccessDashboard(getStoredUser()?.role)) {
      setDenied(true);
      setLoading(false);
      return;
    }
    load();
  }, [load, router]);

  if (denied) {
    return (
      <AppShell>
        <AccessDenied />
      </AppShell>
    );
  }

  // Tỷ trọng so với doanh thu — dùng vẽ thanh tiến trình trên các thẻ chỉ số.
  // undefined khi chưa có doanh thu để không vẽ thanh rỗng gây hiểu nhầm.
  const ratioOfRevenue = (part: number | undefined) =>
    analytics && analytics.totalRevenue > 0 && part !== undefined
      ? Math.round((part / analytics.totalRevenue) * 1000) / 10
      : undefined;

  // TOÀN BỘ tiền đi ra trong kỳ: giá vốn + phí sàn + chi phí vận hành
  const totalExpense = analytics
    ? analytics.totalCost +
      analytics.totalPlatformFee +
      analytics.totalOperatingExpense
    : 0;
  // Tỷ trọng chi phí trên doanh thu — doanh thu bằng 0 thì tỷ lệ vô nghĩa → null
  const costRatio =
    analytics && seesFinancials && analytics.totalRevenue > 0
      ? Math.round((totalExpense / analytics.totalRevenue) * 1000) / 10
      : null;

  // Nhãn động theo phím nhanh đang chọn: xem "Hôm nay" thì thẻ ghi đúng như
  // vậy và mốc so sánh là "hôm qua" — chủ shop khỏi phải tự luận ra kỳ trước
  const presetKey = matchPreset(range)?.key;
  const revenueLabel =
    presetKey === "today"
      ? "Doanh thu hôm nay"
      : presetKey === "yesterday"
        ? "Doanh thu hôm qua"
        : "Doanh thu";
  const compareLabel =
    presetKey === "today" ? "so với hôm qua" : "so với kỳ trước";

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-muted-foreground">
            Bảng điều khiển tổng quan hoạt động kinh doanh của bạn.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {/* Phím tắt 4 khoảng hay dùng nhất; khoảng khác đã có DateRangePicker */}
            <div className="flex items-center gap-1 rounded-lg border border-slate-200/80 bg-card p-1">
              {RANGE_PRESETS.filter((preset) =>
                ["today", "yesterday", "last7", "last30"].includes(preset.key)
              ).map((preset) => {
                const active = matchPreset(range)?.key === preset.key;
                return (
                  <button
                    key={preset.key}
                    type="button"
                    onClick={() => setRange(preset.resolve())}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-sm font-medium transition-colors",
                      active
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                    )}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
            <ChannelFilter value={channel} onChange={setChannel} />
            <DateRangePicker value={range} onChange={setRange} disabled={loading} />
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
              Làm mới
            </Button>
          </div>
        </div>

        {/* THANH TRẠNG THÁI — số liệu tích luỹ toàn thời gian, KHÔNG đổi theo bộ
            lọc ngày. Trước đây chiếm 4 thẻ lớn ngang màn hình; chúng chỉ là số
            tham chiếu nên thu về dạng pill, nhường chỗ cho dữ liệu tài chính. */}
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill
            icon={Wallet}
            label="Doanh thu đã thanh toán"
            value={data ? <Money value={data.totalRevenue} /> : "—"}
          />
          <StatusPill
            icon={ShoppingCart}
            label="Tổng đơn"
            value={data ? formatNumber(data.orderCount) : "—"}
          />
          <StatusPill
            icon={Package}
            label="Sản phẩm"
            value={data ? formatNumber(data.productCount) : "—"}
          />
          <StatusPill
            icon={Store}
            label="Gian hàng"
            value={data ? formatNumber(data.channelCount) : "—"}
          />
          <span className={cn(TEXT_SUB, "ml-1")}>
            Số liệu tích luỹ toàn thời gian
          </span>
        </div>

        {/* Trạng thái lỗi kết nối */}
        {error && (
          <Card className="border-amber-300 bg-amber-50">
            <CardContent className="flex items-start gap-3 p-5">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" />
              <div className="space-y-1 text-sm">
                <p className="font-medium text-amber-700">{error}</p>
                <p className="text-amber-700">
                  Bấm đúp file{" "}
                  <code className="rounded bg-amber-50 px-1">start-backend.bat</code>{" "}
                  trong thư mục dự án, sau đó bấm “Làm mới”.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ===== BÁO CÁO TÀI CHÍNH (đơn Đã giao) ===== */}
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            {seesFinancials ? "Báo cáo tài chính" : "Báo cáo bán hàng"}
          </h2>
          <p className="text-sm text-muted-foreground">
            Tính trên {analytics ? formatNumber(analytics.activeOrderCount) : "—"}{" "}
            đơn phát sinh (không tính đơn hủy & hoàn/trả) trong khoảng{" "}
            <b>{formatRangeLabel(range).toLowerCase()}</b>.
          </p>
        </div>

        {/* ===== TẦNG 1: HIỆU SUẤT TÀI CHÍNH — 4 thẻ cùng hàng, kèm delta ===== */}
        <Refreshing
          active={loading}
          className={cn(
            "grid grid-cols-1 gap-4 sm:grid-cols-2",
            seesFinancials && "xl:grid-cols-4"
          )}
        >
          <StatCard
            label={revenueLabel}
            value={analytics ? <Money value={analytics.totalRevenue} /> : "—"}
            icon={TrendingUp}
            valueClassName={HERO_SIZE}
            subtitle={
              analytics && (
                <DeltaChip
                  current={analytics.totalRevenue}
                  previous={analytics.previous?.totalRevenue ?? null}
                  compareLabel={compareLabel}
                />
              )
            }
          />
          <StatCard
            label="Đơn hàng"
            value={analytics ? formatNumber(analytics.orderCount) : "—"}
            icon={ShoppingCart}
            valueClassName={HERO_SIZE}
            subtitle={
              analytics && (
                <DeltaChip
                  current={analytics.orderCount}
                  previous={analytics.previous?.orderCount ?? null}
                  compareLabel={compareLabel}
                />
              )
            }
          />
          {seesFinancials && (
            <>
              <StatCard
                label="Tổng Chi phí"
                value={analytics ? <Money value={totalExpense} /> : "—"}
                icon={Receipt}
                valueClassName={HERO_SIZE}
                subtitle={
                  costRatio === null
                    ? "Giá vốn + phí sàn + chi phí vận hành"
                    : `Chiếm ${costRatio}% doanh thu`
                }
              />
              {(() => {
                const net = analytics?.netProfit ?? 0;
                const margin = ratioOfRevenue(net);
                return (
                  <StatCard
                    label="Lợi nhuận dự kiến"
                    value={analytics ? <Money value={net} /> : "—"}
                    icon={Scale}
                    tone={toneBySign(net)}
                    featured
                    valueClassName={HERO_SIZE}
                    subtitle={
                      margin !== undefined
                        ? `Biên lợi nhuận ${margin}%`
                        : "Sau giá vốn, phí sàn & chi phí"
                    }
                  />
                );
              })()}
            </>
          )}
        </Refreshing>

        {/* ===== TẦNG 2: PHỄU VẬN HÀNH ĐƠN HÀNG ===== */}
        {analytics && (
          <Refreshing active={loading}>
            <PipelineStrip pipeline={analytics.pipeline} />
          </Refreshing>
        )}

        {/* ===== TẦNG 3: TỶ TRỌNG KÊNH 60% | BÓC TÁCH DÒNG TIỀN 40% ===== */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[3fr_2fr]">
          {analytics && <MarketplaceShare analytics={analytics} />}
          {seesFinancials && analytics && (
            <PnlBreakdown analytics={analytics} />
          )}
        </div>

        {/* Nhịp dòng tiền theo ngày — hữu ích nhất khi xem khoảng 7/30 ngày */}
          <Card>
            <CardHeader>
              <CardTitle>
                {seesFinancials ? "Doanh thu vs Chi phí" : "Doanh thu theo ngày"}
              </CardTitle>
              <CardDescription>
                {seesFinancials
                  ? "Chi phí mỗi ngày = giá vốn đơn phát sinh + chi phí vận hành ghi nhận trong ngày."
                  : "Giá trị đơn phát sinh theo từng ngày (không tính đơn hủy)."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-72 w-full">
                {analytics && (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={analytics.revenueByDay}>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke="#e2e8f0"
                      />
                      <XAxis
                        dataKey="label"
                        fontSize={12}
                        tickLine={false}
                        axisLine={{ stroke: "#e2e8f0" }}
                        stroke="#64748b"
                      />
                      <YAxis
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                        stroke="#64748b"
                        width={56}
                        tickFormatter={(v: number) =>
                          v >= 1_000_000
                            ? `${(v / 1_000_000).toFixed(1)}tr`
                            : `${Math.round(v / 1000)}k`
                        }
                      />
                      <Tooltip
                        cursor={{ fill: "#f1f5f9" }}
                        formatter={(value, name) => [
                          formatVND(Number(value)),
                          name === "revenue" ? "Doanh thu" : "Chi phí",
                        ]}
                      />
                      <Bar
                        dataKey="revenue"
                        name="revenue"
                        fill="#10b981"
                        radius={[4, 4, 0, 0]}
                        maxBarSize={28}
                      />
                      {seesFinancials && (
                        <Bar
                          dataKey="cost"
                          name="cost"
                          fill="#cbd5e1"
                          radius={[4, 4, 0, 0]}
                          maxBarSize={28}
                        />
                      )}
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
              {seesFinancials && (
                <div className={cn(TEXT_SUB, "mt-3 flex items-center gap-4")}>
                  <span className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-sm bg-emerald-500" />
                    Doanh thu
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-sm bg-slate-300" />
                    Chi phí
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

        {/* ===== OPERATIONS COMMAND CENTER — thay khối Chi phí + Đơn gần đây =====
            Tính năng đóng gói riêng trong components/dashboard/command-center/
            (cách ly lỗi). Chỉ hiện với chủ shop — nhân viên xem Dashboard rút gọn. */}
        {seesFinancials && <CommandCenter />}

        <p className="text-center text-xs text-muted-foreground">
          Hubsell · Giai đoạn 4 — Báo cáo tài chính & Phân quyền
        </p>
      </div>
    </AppShell>
  );
}
