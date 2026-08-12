"use client";

// BÁO CÁO NHÀ ĐẦU TƯ (GĐ6) — khối cuối trang Tổng quan điều hành, CHỈ chủ nền
// tảng thấy (backend gác requirePlatformAdmin). Các chỉ số nhà đầu tư SaaS soi
// khi thẩm định: tăng trưởng MoM, GMV qua nền tảng, funnel kích hoạt, retention
// cohort, % tăng trưởng tự nhiên, burn. Tính tươi từ dữ liệu thật + xuất Excel
// nhiều sheet mang đi pitch — số chưa có ghi thẳng "chờ thương mại hóa".

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { FileSpreadsheet, Loader2, TrendingUp } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  ApiError,
  fetchInvestorReport,
  type InvestorReportResponse,
} from "@/lib/api";
import { exportInvestorReportToExcel } from "@/lib/excel";
import { StatCard, formatCount, formatMoney } from "./shared";

/** Rút gọn tiền cho trục biểu đồ: 12000000 → "12tr". */
function shortMoney(v: number): string {
  if (v >= 1_000_000_000) return `${Math.round(v / 100_000_000) / 10}tỷ`;
  if (v >= 1_000_000) return `${Math.round(v / 100_000) / 10}tr`;
  if (v >= 1_000) return `${Math.round(v / 1_000)}k`;
  return String(v);
}

/** Funnel 3 bậc: Đăng ký → Kết nối sàn → Có đơn — thanh ngang thu hẹp dần. */
function ActivationFunnel({ funnel }: { funnel: InvestorReportResponse["funnel"] }) {
  const steps = [
    { label: "Đăng ký tài khoản", count: funnel.registered, pct: 100 },
    { label: "Kết nối sàn đầu tiên", count: funnel.connectedChannel, pct: funnel.connectedPct },
    { label: "Có đơn chạy qua hệ thống", count: funnel.hasOrder, pct: funnel.hasOrderPct },
  ];
  return (
    <div className="space-y-2.5">
      {steps.map((s) => (
        <div key={s.label} className="flex items-center gap-3">
          <span className="w-52 shrink-0 text-sm text-slate-700">{s.label}</span>
          <div className="h-6 min-w-0 flex-1 overflow-hidden rounded-md bg-muted">
            <div
              className="flex h-full items-center rounded-md bg-slate-700 px-2"
              style={{ width: `${Math.max(4, Math.min(100, s.pct))}%` }}
            >
              <span className="text-xs font-semibold text-white">
                {formatCount(s.count)}
              </span>
            </div>
          </div>
          <span className="w-14 shrink-0 text-right text-sm font-semibold text-slate-700">
            {s.pct}%
          </span>
        </div>
      ))}
    </div>
  );
}

/** Bảng cohort retention — ô đậm dần theo % còn hoạt động. */
function RetentionCohorts({ retention }: { retention: InvestorReportResponse["retention"] }) {
  const maxOffsets = Math.max(...retention.map((c) => c.activePct.length));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="py-1.5 pr-3 font-medium">Cohort đăng ký</th>
            <th className="px-2 py-1.5 text-center font-medium">Quy mô</th>
            {Array.from({ length: maxOffsets }, (_, k) => (
              <th key={k} className="px-2 py-1.5 text-center font-medium">
                M{k}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {retention.map((c) => (
            <tr key={c.month} className="border-t">
              <td className="py-1.5 pr-3 font-medium">{c.label}</td>
              <td className="px-2 py-1.5 text-center text-muted-foreground">
                {formatCount(c.size)}
              </td>
              {Array.from({ length: maxOffsets }, (_, k) => {
                const p = c.activePct[k];
                return (
                  <td key={k} className="px-1 py-1">
                    {p === undefined ? null : p === null ? (
                      <span className="block text-center text-xs text-muted-foreground">—</span>
                    ) : (
                      <span
                        className="block rounded px-1 py-1 text-center text-xs font-semibold text-emerald-950"
                        style={{ backgroundColor: `rgba(16,185,129,${0.12 + (p / 100) * 0.55})` }}
                      >
                        {p}%
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted-foreground">
        Mk = % cohort còn CÓ ĐƠN qua hệ thống sau k tháng kể từ khi đăng ký.
        &ldquo;—&rdquo; = cohort chưa có thành viên.
      </p>
    </div>
  );
}

export function InvestorReport() {
  const [report, setReport] = useState<InvestorReportResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await fetchInvestorReport());
    } catch (err) {
      // 403 (không phải chủ nền tảng) hay lỗi mạng: khối tự ẩn, không phá
      // phần dashboard bên trên.
      if (!(err instanceof ApiError && err.status === 403)) {
        toast.error("Không tải được Báo cáo nhà đầu tư");
      }
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  if (loading && !report) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Đang tổng hợp Báo cáo nhà đầu tư…
      </p>
    );
  }
  if (!report) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-6">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold">
            <TrendingUp className="size-4" />
            Báo cáo nhà đầu tư
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-500">
              chỉ chủ nền tảng
            </span>
          </p>
          <p className="text-xs text-muted-foreground">
            Tính tươi từ dữ liệu thật mỗi lần mở — không phải soạn tay trước
            buổi pitch. Số chưa có ghi rõ, không vẽ.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            exportInvestorReportToExcel(report);
            toast.success("Đã xuất Báo cáo nhà đầu tư ra Excel (6 sheet)");
          }}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <FileSpreadsheet className="size-4" />
          )}
          Xuất Excel
        </Button>
      </div>

      {/* ===== Thẻ chỉ số hiệu quả tăng trưởng ===== */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Tăng trưởng tự nhiên (viral)"
          value={`${report.viral.pctOfSignups}%`}
          hint={`${formatCount(report.viral.totalReferred)} đăng ký qua chương trình giới thiệu`}
        />
        <StatCard
          label="MAU 30 ngày (đăng nhập)"
          value={formatCount(report.activity.mau30d)}
          hint={`Theo dõi hoạt động từ ${report.activity.trackedSince} — đủ tin cậy sau 30 ngày`}
        />
        <StatCard
          label="Chi trung bình/tháng (burn)"
          value={formatMoney(report.burn.avgMonthlyBurn)}
          hint="Bình quân các tháng có phát sinh trên sổ quỹ"
        />
        <StatCard
          label="MRR / ARPU"
          value={`${formatMoney(report.revenue.mrr)} / ${formatMoney(report.revenue.arpu)}`}
          hint={report.revenue.note}
        />
      </div>

      {/* ===== Funnel kích hoạt ===== */}
      <Card>
        <CardContent className="py-5">
          <p className="mb-1 text-sm font-semibold">Funnel kích hoạt</p>
          <p className="mb-4 text-xs text-muted-foreground">
            Đăng ký 100 người thì bao nhiêu người thật sự dùng — chỉ số nhà đầu
            tư hỏi ngay sau con số đăng ký.
          </p>
          <ActivationFunnel funnel={report.funnel} />
        </CardContent>
      </Card>

      {/* ===== Đăng ký 12 tháng + GMV 12 tháng ===== */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="py-5">
            <p className="mb-1 text-sm font-semibold">Đăng ký mới theo tháng</p>
            <p className="mb-4 text-xs text-muted-foreground">
              12 tháng — di chuột xem tăng trưởng MoM %.
            </p>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={report.signupsByMonth} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={{ stroke: "#e2e8f0" }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
                  <Tooltip
                    formatter={(value) => [`${value} chủ shop`, "Đăng ký mới"]}
                    labelFormatter={(label, payload) => {
                      const mom = payload?.[0]?.payload?.momPct;
                      return `Tháng ${label}${mom !== null && mom !== undefined ? ` · MoM ${mom > 0 ? "+" : ""}${mom}%` : ""}`;
                    }}
                  />
                  <Bar dataKey="count" fill="#334155" radius={[4, 4, 0, 0]} maxBarSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-5">
            <p className="mb-1 text-sm font-semibold">GMV chảy qua nền tảng</p>
            <p className="mb-4 text-xs text-muted-foreground">
              Tổng giá trị đơn hàng hệ thống xử lý cho các shop — GMV hôm nay là
              doanh thu phí ngày mai.
            </p>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={report.gmvByMonth} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={{ stroke: "#e2e8f0" }} />
                  <YAxis tickFormatter={shortMoney} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
                  <Tooltip
                    formatter={(value) => [formatMoney(Number(value)), "GMV"]}
                    labelFormatter={(label, payload) => {
                      const mom = payload?.[0]?.payload?.momPct;
                      return `Tháng ${label}${mom !== null && mom !== undefined ? ` · MoM ${mom > 0 ? "+" : ""}${mom}%` : ""}`;
                    }}
                  />
                  <Bar dataKey="gmv" fill="#0f766e" radius={[4, 4, 0, 0]} maxBarSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ===== Retention cohort ===== */}
      <Card>
        <CardContent className="py-5">
          <p className="mb-1 text-sm font-semibold">Retention theo cohort</p>
          <p className="mb-4 text-xs text-muted-foreground">
            Thứ nhà đầu tư SaaS soi kỹ nhất — một đường retention phẳng đáng giá
            hơn mọi lời quảng cáo.
          </p>
          <RetentionCohorts retention={report.retention} />
        </CardContent>
      </Card>
    </div>
  );
}
