"use client";

// ============================================================
// TỔNG QUAN ĐIỀU HÀNH HUBSELL (/admin — lá hq.overview): dashboard của người
// QUẢN LÝ nền tảng — đăng ký mới theo tuần, tỷ lệ đang hoạt động / rời bỏ,
// phân bố trạng thái chăm sóc, gia hạn gói. Các khu tác nghiệp (Khách hàng /
// Kế toán / Marketing / Hệ thống) là các trang RIÊNG trên sidebar — mỗi vai
// một cửa, Sale không bao giờ lạc vào sổ tiền của kế toán.
// ============================================================

import { useCallback } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AppShell } from "@/components/app-shell";
import { AccessDenied } from "@/components/access-denied";
import { Card, CardContent } from "@/components/ui/card";
import {
  fetchPlatformOverview,
  fetchPlatformStats,
  type PlatformOverviewResponse,
  type PlatformStats,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  AdminError,
  AdminPageHeader,
  CARE_STATUS_META,
  StatCard,
  formatCount,
  formatMoney,
  useAdminPage,
} from "./shared";

interface DashboardData {
  overview: PlatformOverviewResponse;
  stats: PlatformStats;
}

/** Phân bố trạng thái chăm sóc — thanh ngang tự vẽ, màu theo CARE_STATUS_META. */
function CareDistribution({ data }: { data: PlatformOverviewResponse }) {
  const total = data.totals.owners || 1;
  return (
    <div className="space-y-2.5">
      {data.careDistribution.map((row) => {
        const meta = CARE_STATUS_META[row.status];
        const pct = Math.round((row.count / total) * 1000) / 10;
        return (
          <div key={row.status} className="flex items-center gap-3">
            <span
              className={cn(
                "inline-flex w-36 shrink-0 items-center justify-center rounded-full border px-2 py-0.5 text-xs font-semibold",
                meta.className
              )}
            >
              {meta.label}
            </span>
            <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-slate-700"
                style={{ width: `${Math.min(100, pct)}%` }}
              />
            </div>
            <span className="w-24 shrink-0 text-right text-sm text-muted-foreground">
              {formatCount(row.count)} · {pct}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function PlatformOverviewPage() {
  const fetcher = useCallback(async (): Promise<DashboardData> => {
    const [overview, stats] = await Promise.all([
      fetchPlatformOverview(),
      fetchPlatformStats(),
    ]);
    return { overview, stats };
  }, []);
  const { data, loading, denied, error, reload } = useAdminPage(fetcher);

  if (denied) {
    return (
      <AppShell>
        <AccessDenied />
      </AppShell>
    );
  }

  const ov = data?.overview;
  const stats = data?.stats;

  return (
    <AppShell>
      <div className="space-y-6">
        <AdminPageHeader
          description="Sức khỏe kinh doanh của nền tảng Hubsell: đăng ký, hoạt động, rời bỏ và gia hạn — số liệu trên TOÀN BỘ hệ thống."
          loading={loading}
          onReload={reload}
        />

        {error && <AdminError message={error} />}

        {loading && !data ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Đang tải dữ liệu…
          </p>
        ) : ov && stats ? (
          <>
            {/* ===== Hàng chỉ số kinh doanh ===== */}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="Chủ shop đã đăng ký"
                value={formatCount(ov.totals.owners)}
                hint={`+${formatCount(ov.totals.newOwners30d)} trong 30 ngày qua`}
              />
              <StatCard
                label="Đang hoạt động (30 ngày)"
                value={`${formatCount(ov.totals.active30d)} · ${ov.totals.activePct}%`}
                hint="Shop có đơn hàng phát sinh trong 30 ngày"
              />
              <StatCard
                label="Nguy cơ rời bỏ / Đã rời bỏ"
                value={`${formatCount(ov.totals.churnRisk)} / ${formatCount(ov.totals.churned)}`}
                hint={`Tỷ lệ rời bỏ ${ov.totals.churnedPct}% — theo trạng thái CSKH đánh dấu`}
              />
              <StatCard
                label="Gia hạn gói (30 ngày)"
                value={formatCount(ov.renewals.count30d)}
                hint={`Tích lũy ${formatCount(ov.renewals.countTotal)} lượt · ${formatMoney(ov.renewals.amountTotal)} — khung demo chờ thương mại hóa`}
              />
            </div>

            {/* ===== Biểu đồ đăng ký 12 tuần + phân bố chăm sóc ===== */}
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardContent className="py-5">
                  <p className="mb-1 text-sm font-semibold">
                    Đăng ký mới theo tuần
                  </p>
                  <p className="mb-4 text-xs text-muted-foreground">
                    12 tuần gần nhất — cột cuối là tuần đang chạy dở.
                  </p>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={ov.signupsByWeek} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 11, fill: "#64748b" }}
                          tickLine={false}
                          axisLine={{ stroke: "#e2e8f0" }}
                        />
                        <YAxis
                          allowDecimals={false}
                          tick={{ fontSize: 11, fill: "#64748b" }}
                          tickLine={false}
                          axisLine={false}
                        />
                        <Tooltip
                          formatter={(value) => [`${value} chủ shop`, "Đăng ký mới"]}
                          labelFormatter={(label) => `Tuần từ ${label}`}
                        />
                        <Bar dataKey="count" fill="#334155" radius={[4, 4, 0, 0]} maxBarSize={28} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="py-5">
                  <p className="mb-1 text-sm font-semibold">
                    Phân bố trạng thái chăm sóc
                  </p>
                  <p className="mb-4 text-xs text-muted-foreground">
                    Theo CRM khu Khách hàng — khách chưa ai chăm sóc tính là
                    &ldquo;Mới đăng ký&rdquo;.
                  </p>
                  <CareDistribution data={ov} />
                </CardContent>
              </Card>
            </div>

            {/* ===== Hàng chỉ số vận hành (từ /stats) ===== */}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="Đơn hàng toàn hệ thống"
                value={formatCount(stats.orders.total)}
                hint={`+${formatCount(stats.orders.last24h)} trong 24 giờ qua`}
              />
              <StatCard
                label="Gian hàng đã kết nối"
                value={formatCount(
                  stats.channelsByPlatform.reduce((s, c) => s + c.count, 0)
                )}
                hint={stats.channelsByPlatform
                  .map((c) => `${c.platform}: ${c.count}`)
                  .join(" · ")}
              />
              <StatCard
                label="Tài khoản nhân viên của các shop"
                value={formatCount(stats.users.totalStaff)}
                hint="Do các chủ shop tự tạo"
              />
              <StatCard
                label="Đăng ký mới 7 ngày"
                value={formatCount(stats.users.newOwners7d)}
                hint={`${formatCount(stats.users.newOwners30d)} trong 30 ngày`}
              />
            </div>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
