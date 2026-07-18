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
  type DashboardSummary,
} from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { formatVND, formatNumber, formatDateTime } from "@/lib/format";

// Màu biểu đồ tròn cho từng kênh
const CHANNEL_COLORS: Record<string, string> = {
  SHOPEE: "#f97316",
  TIKTOK: "#18181b",
  LAZADA: "#3b82f6",
  OFFLINE: "#a1a1aa",
};

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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summary, stats] = await Promise.all([
        fetchDashboardSummary(),
        fetchAnalytics(),
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
  }, [router]);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    // Nhân viên không được xem Dashboard tài chính
    if (getStoredUser()?.role === "STAFF") {
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

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-muted-foreground">
            Bảng điều khiển tổng quan hoạt động kinh doanh của bạn.
          </p>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
            Làm mới
          </Button>
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

        {/* Thẻ thống kê chung */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Doanh thu (đã thanh toán)"
            value={data ? formatVND(data.totalRevenue) : "—"}
            icon={Wallet}
            accentClass="bg-emerald-100 text-emerald-700"
          />
          <StatCard
            label="Tổng đơn hàng"
            value={data ? formatNumber(data.orderCount) : "—"}
            icon={ShoppingCart}
            accentClass="bg-sky-100 text-sky-700"
          />
          <StatCard
            label="Sản phẩm"
            value={data ? formatNumber(data.productCount) : "—"}
            icon={Package}
            accentClass="bg-violet-100 text-violet-700"
          />
          <StatCard
            label="Kênh bán"
            value={data ? formatNumber(data.channelCount) : "—"}
            icon={Store}
            accentClass="bg-orange-100 text-orange-700"
          />
        </div>

        {/* ===== BÁO CÁO TÀI CHÍNH (đơn Đã giao) ===== */}
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            Báo cáo tài chính
          </h2>
          <p className="text-sm text-muted-foreground">
            Tính trên {analytics ? formatNumber(analytics.deliveredOrderCount) : "—"}{" "}
            đơn hàng có trạng thái <b>Đã giao</b>.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            label="Tổng Doanh thu"
            value={analytics ? formatVND(analytics.totalRevenue) : "—"}
            icon={TrendingUp}
            accentClass="bg-emerald-100 text-emerald-700"
          />
          <StatCard
            label="Tổng Giá vốn"
            value={analytics ? formatVND(analytics.totalCost) : "—"}
            icon={Coins}
            accentClass="bg-amber-100 text-amber-700"
          />
          <StatCard
            label="Lợi nhuận gộp"
            value={analytics ? formatVND(analytics.grossProfit) : "—"}
            icon={PiggyBank}
            accentClass="bg-violet-100 text-violet-700"
          />
        </div>

        {/* Chi phí hoạt động + Lợi nhuận thuần */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <StatCard
            label="Tổng Chi phí hoạt động"
            value={analytics ? formatVND(analytics.totalOperatingExpense) : "—"}
            icon={Receipt}
            accentClass="bg-rose-100 text-rose-700"
          />

          {/* Lợi nhuận thuần — nổi bật, đổi màu theo lãi/lỗ */}
          {(() => {
            const net = analytics?.netProfit ?? 0;
            const positive = net >= 0;
            return (
              <Card
                className={
                  positive
                    ? "border-emerald-300 bg-emerald-50/60"
                    : "border-rose-300 bg-rose-50/60"
                }
              >
                <CardContent className="flex items-center gap-4 p-5">
                  <div
                    className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${
                      positive
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-rose-100 text-rose-700"
                    }`}
                  >
                    <Scale className="size-6" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-muted-foreground">
                      Lợi nhuận thuần (Net Profit)
                    </p>
                    <p
                      className={`truncate text-2xl font-bold tracking-tight ${
                        positive ? "text-emerald-700" : "text-rose-700"
                      }`}
                    >
                      {analytics ? formatVND(net) : "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      = Lợi nhuận gộp − Chi phí hoạt động
                    </p>
                  </div>
                </CardContent>
              </Card>
            );
          })()}
        </div>

        {/* Quản lý chi phí hoạt động */}
        <ExpensesSection onChanged={load} />

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
              <CardTitle>Tỷ lệ đơn theo kênh</CardTitle>
              <CardDescription>
                Đóng góp đơn hàng giữa các kênh (không tính đơn hủy).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-64 w-full">
                {analytics && analytics.ordersByChannel.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={analytics.ordersByChannel.map((c) => ({
                          name:
                            CHANNEL_META[c.channelName as keyof typeof CHANNEL_META]
                              ?.label ?? c.channelName,
                          value: c.count,
                          channelName: c.channelName,
                        }))}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={45}
                        outerRadius={80}
                        paddingAngle={3}
                      >
                        {analytics.ordersByChannel.map((c) => (
                          <Cell
                            key={c.channelName}
                            fill={CHANNEL_COLORS[c.channelName] ?? "#8b5cf6"}
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
            <CardDescription>5 đơn hàng mới nhất từ tất cả các kênh.</CardDescription>
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
                      <TableCell className="text-right text-sm text-muted-foreground">
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
