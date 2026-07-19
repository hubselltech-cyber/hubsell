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
  PiggyBank,
  Receipt,
  Scale,
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
  PAID: { label: "Đã thanh toán", className: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  UNPAID: { label: "Chưa thanh toán", className: "bg-amber-100 text-amber-700 border-amber-200" },
  REFUNDED: { label: "Đã hoàn tiền", className: "bg-rose-100 text-rose-700 border-rose-200" },
};

const SHIPPING_META: Record<string, { label: string; className: string }> = {
  DELIVERED: { label: "Đã giao", className: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  SHIPPING: { label: "Đang giao", className: "bg-sky-100 text-sky-700 border-sky-200" },
  PENDING: { label: "Chờ xử lý", className: "bg-zinc-100 text-zinc-600 border-zinc-200" },
  CANCELLED: { label: "Đã hủy", className: "bg-rose-100 text-rose-700 border-rose-200" },
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
  const grossMargin = ratioOfRevenue(analytics?.grossProfit);
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

        {/* Trạng thái lỗi kết nối */}
        {error && (
          <Card className="border-amber-300 bg-amber-50">
            <CardContent className="flex items-start gap-3 p-5">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" />
              <div className="space-y-1 text-sm">
                <p className="font-medium text-amber-800">{error}</p>
                <p className="text-amber-700">
                  Bấm đúp file{" "}
                  <code className="rounded bg-amber-100 px-1">start-backend.bat</code>{" "}
                  trong thư mục dự án, sau đó bấm “Làm mới”.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Thẻ thống kê chung — số liệu tích luỹ, cố ý KHÔNG theo bộ lọc ngày:
            "Sản phẩm: 17" hay "Kênh bán: 4" là trạng thái hiện tại của shop,
            cắt theo khoảng thời gian sẽ thành vô nghĩa. */}
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Hiện trạng shop</h2>
          <p className="text-sm text-muted-foreground">
            Số liệu tích luỹ toàn thời gian — không đổi theo bộ lọc ngày.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Doanh thu (đã thanh toán)"
            value={data ? formatVND(data.totalRevenue) : "—"}
            icon={Wallet}
            tone="positive"
            colorValue
          />
          <StatCard
            label="Tổng đơn hàng"
            value={data ? formatNumber(data.orderCount) : "—"}
            icon={ShoppingCart}
            tone="info"
          />
          <StatCard
            label="Sản phẩm"
            value={data ? formatNumber(data.productCount) : "—"}
            icon={Package}
            tone="accent"
          />
          <StatCard
            label="Kênh bán"
            value={data ? formatNumber(data.channelCount) : "—"}
            icon={Store}
            tone="neutral"
          />
        </div>

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

        <Refreshing
          active={loading}
          className={cn(
            "grid grid-cols-1 gap-4",
            seesFinancials && "sm:grid-cols-3"
          )}
        >
          <StatCard
            label="Tổng Doanh thu"
            value={analytics ? formatVND(analytics.totalRevenue) : "—"}
            icon={TrendingUp}
            tone="positive"
            colorValue
          />
          {seesFinancials && (
            <>
              <StatCard
                label="Tổng Giá vốn"
                value={analytics ? formatVND(analytics.totalCost) : "—"}
                icon={Coins}
                tone="negative"
                colorValue
                subtitle={
                  cogsRatio !== undefined ? `${cogsRatio}% doanh thu` : undefined
                }
              />
              <StatCard
                label="Lợi nhuận gộp"
                value={analytics ? formatVND(analytics.grossProfit) : "—"}
                icon={PiggyBank}
                tone={analytics ? toneBySign(analytics.grossProfit) : "neutral"}
                colorValue
                subtitle={
                  grossMargin !== undefined
                    ? `Biên lợi nhuận gộp ${grossMargin}%`
                    : undefined
                }
              />
            </>
          )}
        </Refreshing>

        {/* Chi phí hoạt động + Lợi nhuận thuần — chỉ chủ shop */}
        {seesFinancials && analytics?.operatingExpenseIsShopWide && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Đang lọc theo một gian hàng. Chi phí hoạt động (mặt bằng, lương,
            marketing…) được ghi nhận ở cấp toàn shop nên vẫn là con số của cả
            shop — Lợi nhuận thuần bên dưới{" "}
            <strong>chưa phải lãi riêng của gian hàng này</strong>. Doanh thu,
            giá vốn và lợi nhuận gộp thì đã lọc đúng theo gian.
          </p>
        )}
        {seesFinancials && (
        <Refreshing active={loading} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <StatCard
            label="Tổng Chi phí hoạt động"
            value={analytics ? formatVND(analytics.totalOperatingExpense) : "—"}
            icon={Receipt}
            tone="negative"
            colorValue
            subtitle={
              opexRatio !== undefined ? `${opexRatio}% doanh thu` : undefined
            }
          />

          {/* Lợi nhuận thuần — khối cảnh báo tối cao, được phủ nền theo lãi/lỗ */}
          {(() => {
            const net = analytics?.netProfit ?? 0;
            const margin = ratioOfRevenue(net);
            return (
              <StatCard
                label="Lợi nhuận thuần (Net Profit)"
                value={analytics ? formatVND(net) : "—"}
                icon={Scale}
                tone={toneBySign(net)}
                featured
                subtitle={`= Lợi nhuận gộp − Chi phí hoạt động${
                  margin !== undefined ? ` · biên ${margin}% doanh thu` : ""
                }`}
              />
            );
          })()}
        </Refreshing>
        )}

        {/* Quản lý chi phí hoạt động — chỉ chủ shop */}
        {seesFinancials && <ExpensesSection onChanged={load} />}

        {/* 2 biểu đồ */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle>Doanh thu theo ngày</CardTitle>
              <CardDescription>
                14 ngày gần nhất (đơn Đã giao).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-64 w-full">
                {analytics && (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={analytics.revenueByDay}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" fontSize={12} tickLine={false} />
                      <YAxis
                        fontSize={12}
                        tickLine={false}
                        width={70}
                        tickFormatter={(v: number) =>
                          v >= 1_000_000
                            ? `${(v / 1_000_000).toFixed(1)}tr`
                            : `${Math.round(v / 1000)}k`
                        }
                      />
                      <Tooltip
                        formatter={(value) => [formatVND(Number(value)), "Doanh thu"]}
                      />
                      <Bar
                        dataKey="revenue"
                        fill="#10b981"
                        radius={[4, 4, 0, 0]}
                        maxBarSize={32}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
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
                      <TableCell className="text-right font-medium">
                        {formatVND(o.totalAmount)}
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
