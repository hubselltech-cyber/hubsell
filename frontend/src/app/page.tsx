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
  TrendingUp,
  Coins,
  Receipt,
  Scale,
  type LucideIcon,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
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
  defaultRange,
  formatRangeLabel,
  type DateRange,
} from "@/lib/date-range";
import { toneBySign } from "@/components/dashboard/dashboard-card";
import { ExpensesSection } from "@/components/dashboard/expenses-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  shopLabel,
  type ChannelFilterValue,
} from "@/components/channel-filter";
import { formatVND, formatNumber, formatDateTime } from "@/lib/format";
import { moneyTone, TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

// Màu nền của từng sàn trên biểu đồ tròn
const CHANNEL_COLORS: Record<string, string> = {
  SHOPEE: "#f97316",
  TIKTOK: "#18181b",
  LAZADA: "#3b82f6",
  OFFLINE: "#a1a1aa",
};

// Pha màu với trắng theo tỷ lệ 0..1 (0 = giữ nguyên, 1 = trắng hoàn toàn)
function lighten(hex: string, ratio: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * ratio);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/**
 * Màu cho từng GIAN HÀNG: giữ tông của sàn để nhìn là biết thuộc sàn nào, gian
 * thứ hai trở đi trên cùng sàn thì nhạt dần — nếu để cùng một màu thì hai gian
 * Shopee sẽ là hai lát bánh không phân biệt được.
 */
function shopColors(
  rows: { channelId: string; channelName: string }[]
): Record<string, string> {
  const seen: Record<string, number> = {};
  const colors: Record<string, string> = {};
  for (const r of rows) {
    const index = seen[r.channelName] ?? 0;
    seen[r.channelName] = index + 1;
    const base = CHANNEL_COLORS[r.channelName] ?? "#8b5cf6";
    colors[r.channelId] = index === 0 ? base : lighten(base, Math.min(index * 0.22, 0.66));
  }
  return colors;
}

const PAYMENT_META: Record<string, { label: string; className: string }> = {
  PAID: { label: "Đã thanh toán", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  UNPAID: { label: "Chưa thanh toán", className: "bg-amber-50 text-amber-700 border-amber-200" },
  REFUNDED: { label: "Đã hoàn tiền", className: "bg-rose-50 text-rose-700 border-rose-200" },
};

const SHIPPING_META: Record<string, { label: string; className: string }> = {
  DELIVERED: { label: "Đã giao", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  SHIPPING: { label: "Đang giao", className: "bg-sky-50 text-sky-700 border-sky-200" },
  PENDING: { label: "Chờ xử lý", className: "bg-zinc-50 text-zinc-600 border-zinc-200" },
  CANCELLED: { label: "Đã hủy", className: "bg-rose-50 text-rose-700 border-rose-200" },
};

function MetaBadge({
  meta,
  fallback,
}: {
  meta?: { label: string; className: string };
  fallback: string;
}) {
  if (!meta) return <Badge variant="outline">{fallback}</Badge>;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta.className}`}
    >
      {meta.label}
    </span>
  );
}

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

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [range, setRange] = useState<DateRange>(defaultRange);
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

  const cogsRatio = ratioOfRevenue(analytics?.totalCost);
  const opexRatio = ratioOfRevenue(analytics?.totalOperatingExpense);

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-muted-foreground">
            Bảng điều khiển tổng quan hoạt động kinh doanh của bạn.
          </p>
          <div className="flex flex-wrap items-center gap-2">
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
            Tính trên {analytics ? formatNumber(analytics.deliveredOrderCount) : "—"}{" "}
            đơn hàng có trạng thái <b>Đã giao</b> trong khoảng{" "}
            <b>{formatRangeLabel(range).toLowerCase()}</b>.
          </p>
        </div>

        {/* ===== 4 THẺ HERO — cùng một hàng, cùng độ cao, cùng cỡ số ===== */}
        <Refreshing
          active={loading}
          className={cn(
            "grid grid-cols-1 gap-4 sm:grid-cols-2",
            seesFinancials && "xl:grid-cols-4"
          )}
        >
          <StatCard
            label="Tổng Doanh thu"
            value={analytics ? <Money value={analytics.totalRevenue} /> : "—"}
            icon={TrendingUp}
            valueClassName={HERO_SIZE}
          />
          {seesFinancials && (
            <>
              <StatCard
                label="Tổng Giá vốn"
                value={analytics ? <Money value={analytics.totalCost} /> : "—"}
                icon={Coins}
                valueClassName={HERO_SIZE}
                subtitle={
                  cogsRatio !== undefined ? `${cogsRatio}% doanh thu` : undefined
                }
              />
              <StatCard
                label="Tổng Chi phí hoạt động"
                value={
                  analytics ? <Money value={analytics.totalOperatingExpense} /> : "—"
                }
                icon={Receipt}
                valueClassName={HERO_SIZE}
                subtitle={
                  opexRatio !== undefined ? `${opexRatio}% doanh thu` : undefined
                }
              />
              {(() => {
                const net = analytics?.netProfit ?? 0;
                const margin = ratioOfRevenue(net);
                return (
                  <StatCard
                    label="Lợi nhuận thuần (Net Profit)"
                    value={analytics ? <Money value={net} /> : "—"}
                    icon={Scale}
                    tone={toneBySign(net)}
                    featured
                    valueClassName={HERO_SIZE}
                    subtitle={
                      margin !== undefined
                        ? `Biên ${margin}% doanh thu`
                        : "Sau phí sàn & chi phí"
                    }
                  />
                );
              })()}
            </>
          )}
        </Refreshing>

        {/* ===== TRỰC QUAN TRUNG TÂM — biểu đồ 65% | bóc tách 35% ===== */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[13fr_7fr]">
          <Card>
            <CardHeader>
              <CardTitle>
                {seesFinancials ? "Doanh thu vs Chi phí" : "Doanh thu theo ngày"}
              </CardTitle>
              <CardDescription>
                {seesFinancials
                  ? "Chi phí mỗi ngày = giá vốn hàng đã giao + chi phí vận hành phát sinh trong ngày."
                  : "Doanh thu các đơn Đã giao theo từng ngày."}
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
            <PnlBreakdown analytics={analytics} />
          )}
        </div>

        {/* Quản lý chi phí hoạt động — chỉ chủ shop */}
        {seesFinancials && <ExpensesSection onChanged={load} />}

        {/* Tỷ trọng đơn theo gian hàng + đơn gần đây */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Tỷ lệ đơn theo gian hàng</CardTitle>
              <CardDescription>
                Đóng góp đơn hàng của từng gian hàng (không tính đơn hủy).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-64 w-full">
                {analytics && analytics.ordersByChannel.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={analytics.ordersByChannel.map((c) => ({
                          name: shopLabel(
                            c.channelName as ChannelName,
                            c.shopName
                          ),
                          value: c.count,
                          channelId: c.channelId,
                        }))}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={45}
                        outerRadius={80}
                        paddingAngle={3}
                      >
                        {analytics.ordersByChannel.map((c) => (
                          <Cell
                            key={c.channelId}
                            fill={shopColors(analytics.ordersByChannel)[c.channelId]}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value, name) => [`${value} đơn`, name]}
                      />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="pt-20 text-center text-sm text-muted-foreground">
                    Chưa có dữ liệu đơn hàng.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Đơn hàng gần đây */}
        <Card>
          <CardHeader>
            <CardTitle>Đơn hàng gần đây</CardTitle>
            <CardDescription>
              5 đơn hàng mới nhất
              {seesFinancials
                ? " từ tất cả các gian hàng."
                : " từ gian hàng bạn phụ trách."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Đang tải dữ liệu…
              </p>
            ) : !data || data.recentOrders.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Chưa có đơn hàng nào.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mã đơn</TableHead>
                    <TableHead>Khách hàng</TableHead>
                    <TableHead>Kênh</TableHead>
                    <TableHead>Thanh toán</TableHead>
                    <TableHead>Vận chuyển</TableHead>
                    <TableHead className="text-right">Tổng tiền</TableHead>
                    <TableHead className="text-right">Thời gian</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recentOrders.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="font-medium">{o.orderCode}</TableCell>
                      <TableCell>{o.customerName}</TableCell>
                      <TableCell>
                        <MetaBadge
                          meta={CHANNEL_META[o.channelName]}
                          fallback={o.channelName}
                        />
                      </TableCell>
                      <TableCell>
                        <MetaBadge
                          meta={PAYMENT_META[o.paymentStatus]}
                          fallback={o.paymentStatus}
                        />
                      </TableCell>
                      <TableCell>
                        <MetaBadge
                          meta={SHIPPING_META[o.shippingStatus]}
                          fallback={o.shippingStatus}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Money
                          value={o.totalAmount}
                          className="font-medium text-slate-900"
                        />
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {formatDateTime(o.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Hubsell · Giai đoạn 4 — Báo cáo tài chính & Phân quyền
        </p>
      </div>
    </AppShell>
  );
}
