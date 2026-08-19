"use client";

import { useEffect, useState } from "react";
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
  Cell,
  Pie,
  PieChart,
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
import {
  PnlWaterfall,
  PnlWaterfallFooter,
  type WaterfallStep,
} from "@/components/dashboard/pnl-waterfall";
import { ChannelShareCard } from "@/components/dashboard/channel-share-card";
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
  type AnalyticsResponse,
} from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { useApiQuery } from "@/lib/use-api-query";
import { canAccessDashboard, canSeeFinancials } from "@/lib/permissions";
import {
  ALL_CHANNELS,
  ChannelFilter,
  type ChannelFilterValue,
} from "@/components/channel-filter";
import { formatVND, formatNumber } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

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
 * BÓC TÁCH DÒNG TIỀN — THÁC NƯỚC (Waterfall)
 *
 * Doanh thu gộp bị "xén" dần qua từng khoản theo đúng thứ tự nghiệp vụ P&L
 * (Giá vốn → Sàn khấu trừ → Quảng cáo → Vận hành) cho tới cột chốt Lợi nhuận
 * ròng — cùng thứ tự với Báo cáo dòng tiền để hai trang đọc giống nhau.
 * Số liệu nguyên xi từ analytics (SSOT computePnlRow); gross − Σ khoản = net
 * đúng từng đồng vì net truyền thẳng từ backend chứ không tự cộng lại ở đây.
 */
function PnlBreakdown({ analytics }: { analytics: AnalyticsResponse }) {
  const adsExpense = analytics.expensesByCategory
    .filter((e) => e.category === "ADS")
    .reduce((sum, e) => sum + e.amount, 0);
  // Vận hành = cố định + biến đổi (ngoài quảng cáo) — gộp 1 cột để 6 cột vừa
  // khít card 5/12; tách nhỏ hơn nữa thì nhãn trục X không còn chỗ.
  const operatingExpense = analytics.totalOperatingExpense - adsExpense;

  const steps: WaterfallStep[] = [
    { key: "cogs", label: "Giá vốn hàng bán (COGS)", short: "Giá vốn", amount: analytics.totalCost, hue: "rose" },
    // TOÀN BỘ khoản sàn giữ lại: phí + thuế sàn + voucher/xu + chênh lệch VC
    // (= Giá trị đơn − "Tổng tiền" sàn báo, cùng thước đo Báo cáo dòng tiền)
    { key: "fee", label: "Sàn khấu trừ (phí, thuế, voucher)", short: "Phí sàn", amount: analytics.totalPlatformFee, hue: "rose" },
    { key: "ads", label: "Chi phí quảng cáo", short: "Ads", amount: adsExpense, hue: "amber" },
    { key: "ops", label: "Chi phí vận hành (cố định + biến đổi)", short: "Vận hành", amount: operatingExpense, hue: "amber" },
  ];

  return (
    <Card className="h-full lg:col-span-5">
      <CardHeader>
        <CardTitle>Bóc tách dòng tiền</CardTitle>
        <CardDescription>
          Doanh thu bị bào mòn qua từng khoản tới lợi nhuận ròng.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <PnlWaterfall
          gross={analytics.totalRevenue}
          steps={steps}
          net={analytics.netProfit}
        />
        <PnlWaterfallFooter net={analytics.netProfit} gross={analytics.totalRevenue} />
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
 * CƠ CẤU CHI PHÍ — donut bóc tách theo ĐÚNG các dòng khấu trừ của Báo cáo
 * dòng tiền (7 bucket sàn từ platformFeeBreakdown) + giá vốn + 3 nhóm chi phí
 * vận hành. Σ mọi mảnh = totalPlatformFee + totalCost + totalOperatingExpense
 * — luôn khớp từng đồng với thẻ "Tổng Chi phí"; khoản 0 đồng tự ẩn.
 */
function CostStructure({ analytics }: { analytics: AnalyticsResponse }) {
  const adsExpense = analytics.expensesByCategory
    .filter((e) => e.category === "ADS")
    .reduce((sum, e) => sum + e.amount, 0);
  const fee = analytics.platformFeeBreakdown;

  const segments = [
    // ---- Sàn khấu trừ: cùng nhãn với thẻ "Tổng giá trị SP" bên Dòng tiền ----
    { key: "service", label: "Phí nền tảng (CĐ, thanh toán, dịch vụ)", amount: fee.service, color: "#f97316" },
    { key: "affiliate", label: "Phí tiếp thị liên kết", amount: fee.affiliate, color: "#f59e0b" },
    { key: "tax", label: "Thuế sàn TMĐT (GTGT + TNCN)", amount: fee.tax, color: "#ef4444" },
    { key: "refund", label: "Tiền hoàn trả khách", amount: fee.refund, color: "#f43f5e" },
    { key: "voucher", label: "Voucher trợ giá của shop", amount: fee.voucher, color: "#ec4899" },
    { key: "shippingDiff", label: "Chênh lệch phí vận chuyển", amount: fee.shippingDiff, color: "#14b8a6" },
    { key: "adWallet", label: "Nạp ví quảng cáo sàn", amount: fee.adWallet, color: "#6366f1" },
    { key: "feeOther", label: "Khấu trừ khác của sàn", amount: fee.other, color: "#94a3b8" },
    // ---- Ngoài sàn ----
    { key: "cogs", label: "Giá vốn hàng bán (COGS)", amount: analytics.totalCost, color: "#3b82f6" },
    { key: "ads", label: "Quảng cáo Ads (nhập tay)", amount: adsExpense, color: "#8b5cf6" },
    { key: "varops", label: "Chi phí Biến đổi Vận hành", amount: analytics.operatingVariableExpense, color: "#10b981" },
    { key: "fixops", label: "Chi phí Cố định Vận hành", amount: analytics.operatingFixedExpense, color: "#a16207" },
  ].filter((s) => s.amount > 0);
  const total = segments.reduce((sum, s) => sum + s.amount, 0);

  return (
    <Card className="h-full lg:col-span-5">
      <CardHeader>
        <CardTitle>Cơ cấu Chi phí</CardTitle>
        <CardDescription>Tỷ lệ % các khoản chi trong kỳ.</CardDescription>
      </CardHeader>
      <CardContent>
        {total <= 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">
            Chưa ghi nhận khoản chi nào trong kỳ này.
          </p>
        ) : (
          /* Donut TRÁI — chú thích PHẢI: 6 khoản xếp dọc dưới donut sẽ đè bẹp
             biểu đồ, đặt cạnh nhau thì donut giữ nguyên cỡ dù thêm khoản mới.
             Màn hẹp (mobile) tự gãy về xếp dọc, donut căn giữa. */
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-5">
            <div className="relative size-44 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={segments}
                    dataKey="amount"
                    nameKey="label"
                    innerRadius="62%"
                    outerRadius="92%"
                    paddingAngle={2}
                    strokeWidth={0}
                  >
                    {segments.map((s) => (
                      <Cell key={s.key} fill={s.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value, name) => [formatVND(Number(value)), name]}
                  />
                </PieChart>
              </ResponsiveContainer>
              {/* Tâm donut: tổng chi của kỳ — đỡ phải cộng nhẩm các mảnh */}
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className={TEXT_SUB}>Tổng chi</span>
                <Money
                  value={total}
                  className="text-sm font-semibold text-slate-900"
                />
              </div>
            </div>

            {/* Chú thích: số tiền + tỷ trọng từng khoản */}
            <div className="w-full min-w-0 flex-1">
              {segments.map((s) => {
                const pct = Math.round((s.amount / total) * 1000) / 10;
                return (
                  <div
                    key={s.key}
                    className="flex items-center gap-2.5 border-b border-slate-100 py-2 last:border-b-0"
                  >
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: s.color }}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-900">
                      {s.label}
                    </span>
                    <Money
                      value={s.amount}
                      className="shrink-0 text-right text-sm text-slate-600"
                    />
                    <span className="w-12 shrink-0 text-right text-sm font-semibold text-slate-900">
                      {pct}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  // Command Center mở ra là thấy HÔM NAY — câu hỏi đầu ngày của chủ shop là
  // "hôm nay đang chạy thế nào", không phải bức tranh 30 ngày
  const [range, setRange] = useState<DateRange>(() =>
    RANGE_PRESETS.find((p) => p.key === "today")!.resolve()
  );
  const [channel, setChannel] = useState<ChannelFilterValue>(ALL_CHANNELS);
  // SALES xem được doanh thu và sản lượng, nhưng không được biết giá vốn hay lãi.
  // Backend đã cắt các trường đó khỏi phản hồi; ở đây bỏ luôn thẻ để không hiện "—".
  const seesFinancials = canSeeFinancials(getStoredUser());
  // Kho không có việc gì ở Tổng quan; SALES vào được nhưng bị cắt chỉ số tài chính
  const allowed = canAccessDashboard(getStoredUser());

  useEffect(() => {
    if (!getToken()) router.replace("/login");
  }, [router]);

  // Hai khối số của trang nằm trong cache React Query: quay lại Tổng quan là
  // thấy ngay số cũ, refetch chạy ngầm phía sau (401/403/409 hook tự xử).
  const summaryQ = useApiQuery({
    queryKey: qk.dashboardSummary(),
    queryFn: fetchDashboardSummary,
    enabled: allowed,
  });
  const analyticsQ = useApiQuery({
    queryKey: qk.analytics(range, channel),
    queryFn: () => fetchAnalytics(range, channel),
    enabled: allowed,
  });

  const data = summaryQ.data ?? null;
  const analytics = analyticsQ.data ?? null;
  // loading nghĩa "đang tính lại" (lần đầu LẪN nền) — điều khiển Refreshing,
  // nút Làm mới và icon xoay, giữ nguyên ngữ nghĩa cũ của trang.
  const loading = summaryQ.refreshing || analyticsQ.refreshing;
  const error = analyticsQ.error ?? summaryQ.error;
  const denied = !allowed || summaryQ.denied || analyticsQ.denied;

  // Chỉ dùng cho nút "Làm mới" — không cần useCallback vì không effect nào phụ thuộc.
  const load = () => {
    summaryQ.refetch();
    analyticsQ.refetch();
  };

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

  // ĐƯỜNG SÓNG 14 NGÀY dưới 4 thẻ KPI — chuỗi trend từ backend (14 ngày liền
  // trước tính đến cuối kỳ lọc, nên xem "Hôm nay" vẫn có sóng). Màu theo ngữ
  // nghĩa: tăng/lãi → emerald, giảm/lỗ → rose, chi phí → amber (luôn là tiền ra).
  const trend = analytics?.trend ?? [];
  const sparkRevenue = trend.map((p) => p.revenue);
  const sparkOrders = trend.map((p) => p.orders);
  const sparkCost = trend.map((p) => p.cost ?? 0);
  const sparkProfit = trend.map((p) => p.revenue - (p.cost ?? 0));
  const deltaTone = (current: number, previous: number | null | undefined) =>
    previous != null && current < previous ? "negative" : "positive";

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
            sparkline={
              analytics
                ? {
                    data: sparkRevenue,
                    tone: deltaTone(
                      analytics.totalRevenue,
                      analytics.previous?.totalRevenue
                    ),
                  }
                : undefined
            }
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
            sparkline={
              analytics
                ? {
                    data: sparkOrders,
                    tone: deltaTone(
                      analytics.orderCount,
                      analytics.previous?.orderCount
                    ),
                  }
                : undefined
            }
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
                sparkline={
                  analytics ? { data: sparkCost, tone: "warning" } : undefined
                }
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
                    sparkline={
                      analytics
                        ? { data: sparkProfit, tone: deltaTone(net, 0) }
                        : undefined
                    }
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

        {/* ===== TẦNG 3: TỶ TRỌNG KÊNH 7 cột | BÓC TÁCH DÒNG TIỀN 5 cột =====
            CÙNG lưới 12 cột chia 7/5 với Tầng 4 bên dưới — vạch ngăn dọc của
            hai hàng gióng thẳng nhau, không còn lệch 3fr/2fr vs 7/5. */}
        <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-12">
          {analytics && (
            <ChannelShareCard
              analytics={analytics}
              className={seesFinancials ? "lg:col-span-7" : "lg:col-span-12"}
            />
          )}
          {seesFinancials && analytics && (
            <PnlBreakdown analytics={analytics} />
          )}
        </div>

        {/* ===== TẦNG 4: NHỊP DÒNG TIỀN 7 cột | CƠ CẤU CHI PHÍ 5 cột =====
            Mobile xếp dọc 1 cột; SALES không thấy chart tròn nên chart cột
            giãn đủ 12 cột. */}
        <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-12">
          <Card
            className={cn(
              "h-full",
              seesFinancials ? "lg:col-span-7" : "lg:col-span-12"
            )}
          >
            <CardHeader>
              <CardTitle>
                {seesFinancials ? "Doanh thu vs Chi phí" : "Doanh thu theo ngày"}
              </CardTitle>
              <CardDescription>
                {seesFinancials
                  ? "Chi phí mỗi ngày = giá vốn + sàn khấu trừ của đơn phát sinh + chi phí vận hành trong ngày."
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

          {seesFinancials && analytics && (
            <CostStructure analytics={analytics} />
          )}
        </div>

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
