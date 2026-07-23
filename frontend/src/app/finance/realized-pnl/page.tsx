"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  PackageOpen,
  RefreshCw,
  TrendingDown,
} from "lucide-react";

import { AccessDenied } from "@/components/access-denied";
import { AppShell } from "@/components/app-shell";
import { DateRangePicker } from "@/components/date-range-picker";
import { Refreshing } from "@/components/refreshing";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { GenericProfitTable } from "@/components/finance/realized-pnl/GenericProfitTable";
import { ShopeeProfitTable } from "@/components/finance/realized-pnl/ShopeeProfitTable";
import { TiktokProfitTable } from "@/components/finance/realized-pnl/TiktokProfitTable";
import {
  ApiError,
  fetchRealizedPnl,
  getStoredUser,
  getToken,
  type ChannelFilterQuery,
  type ChannelName,
  type RealizedPnlResponse,
  type ReconciliationStatus,
} from "@/lib/api";
import { canAccessFinance } from "@/lib/permissions";
import { CHANNEL_META } from "@/lib/channel-meta";
import { defaultRange, type DateRange } from "@/lib/date-range";
import { exportRealizedPnl } from "@/lib/excel";
import { formatNumber, formatVND } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

type PnlTab = "overview" | "shopee" | "tiktok" | "lazada";

const TABS: { key: PnlTab; label: string; platform: ChannelName | "ALL" }[] = [
  { key: "overview", label: "Tổng quan Lợi nhuận", platform: "ALL" },
  { key: "shopee", label: "Shopee", platform: "SHOPEE" },
  { key: "tiktok", label: "TikTok Shop", platform: "TIKTOK" },
  { key: "lazada", label: "Lazada", platform: "LAZADA" },
];

const STATUS_TABS: { key: ReconciliationStatus; label: string }[] = [
  { key: "all", label: "Tất cả" },
  { key: "delivered", label: "Giao thành công" },
  { key: "shipping", label: "Đang vận chuyển" },
  { key: "cancelled", label: "Đã hủy / Hoàn trả" },
];

const PAGE_SIZES = [20, 50, 100];

function channelOf(platform: ChannelName | "ALL"): ChannelFilterQuery | undefined {
  return platform === "ALL" ? undefined : { channelName: platform };
}

export default function RealizedPnlPage() {
  const router = useRouter();
  const [tab, setTab] = useState<PnlTab>("overview");
  const [range, setRange] = useState<DateRange>(defaultRange);
  const [status, setStatus] = useState<ReconciliationStatus>("all");
  const [lossOnly, setLossOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [data, setData] = useState<RealizedPnlResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [exporting, setExporting] = useState(false);

  const platform = TABS.find((t) => t.key === tab)!.platform;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchRealizedPnl({
        range,
        channel: channelOf(platform),
        status,
        lossOnly,
        page,
        pageSize,
      });
      setData(res);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return;
      }
      if (err instanceof ApiError && err.status === 403) setDenied(true);
    } finally {
      setLoading(false);
    }
  }, [router, range, platform, status, lossOnly, page, pageSize]);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    if (!canAccessFinance(getStoredUser()?.role)) {
      setDenied(true);
      setLoading(false);
      return;
    }
    load();
  }, [load, router]);

  // Đổi tab / bộ lọc / cỡ trang thì về trang 1 (tránh rơi vào trang trống).
  function changeTab(t: PnlTab) {
    setTab(t);
    setPage(1);
  }
  function changeStatus(s: ReconciliationStatus) {
    setStatus(s);
    setPage(1);
  }
  function toggleLossOnly() {
    setLossOnly((v) => !v);
    setPage(1);
  }
  function changeRange(r: DateRange) {
    setRange(r);
    setPage(1);
  }
  function changePageSize(n: number) {
    setPageSize(n);
    setPage(1);
  }

  async function handleExport() {
    setExporting(true);
    try {
      const count = await exportRealizedPnl({ platform, range, status, lossOnly });
      if (count === 0) toast.info("Không có đơn nào (theo bộ lọc) để xuất");
      else toast.success(`Đã xuất ${formatNumber(count)} đơn ra file Excel`);
    } catch {
      toast.error("Không xuất được file Excel");
    } finally {
      setExporting(false);
    }
  }

  if (denied) {
    return (
      <AppShell>
        <AccessDenied />
      </AppShell>
    );
  }

  const rows = data?.rows ?? [];
  const summary = data?.summary;

  return (
    <AppShell>
      <div className="space-y-5 pb-10">
        <p className="text-muted-foreground">
          Đối soát lãi/lỗ thực hiện của từng đơn, chi tiết hóa toàn bộ chi phí sàn
          theo cấu trúc dữ liệu thực tế của mỗi kênh.
        </p>

        {/* ===== TAB LỚN THEO SÀN ===== */}
        <div role="tablist" className="flex flex-wrap gap-1 border-b">
          {TABS.map((t) => {
            const active = tab === t.key;
            const count = summary && active ? summary.count : undefined;
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={active}
                onClick={() => changeTab(t.key)}
                className={cn(
                  "-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                )}
              >
                {t.label}
                {count !== undefined && count > 0 && (
                  <span className="rounded-full bg-primary px-1.5 py-0.5 text-xs font-semibold text-primary-foreground tabular-nums">
                    {formatNumber(count)}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ===== FILTER BAR + XUẤT EXCEL ===== */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <DateRangePicker value={range} onChange={changeRange} disabled={loading} />
            <div className="flex flex-wrap gap-1.5">
              {STATUS_TABS.map((s) => {
                const active = status === s.key;
                return (
                  <button
                    key={s.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => changeStatus(s.key)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
            {/* Bộ lọc nhanh: chỉ hiện đơn LỖ (lợi nhuận thực tế < 0) */}
            <button
              type="button"
              aria-pressed={lossOnly}
              onClick={toggleLossOnly}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                lossOnly
                  ? "border-rose-500 bg-rose-500 text-white"
                  : "border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100"
              )}
            >
              <TrendingDown className="size-4" />
              Lợi nhuận âm
            </button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={cn("size-4", loading && "animate-spin")} />
              Làm mới
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={exporting || loading}
            >
              {exporting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Download className="size-4" />
              )}
              Xuất file Excel
            </Button>
          </div>
        </div>

        {/* ===== TỔNG QUAN: dải chỉ số + lãi/lỗ theo sàn ===== */}
        {tab === "overview" && summary && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Số đơn" value={formatNumber(summary.count)} />
            <StatCard
              label="Đã đối soát"
              value={formatNumber(summary.settledCount)}
              tone="text-emerald-600"
            />
            <StatCard
              label="Doanh thu ròng"
              value={formatVND(summary.totalNetRevenue)}
            />
            <StatCard
              label="Tổng Lãi/Lỗ"
              value={`${summary.totalProfit < 0 ? "− " : ""}${formatVND(
                Math.abs(summary.totalProfit)
              )}`}
              tone={summary.totalProfit >= 0 ? "text-emerald-600" : "text-rose-600"}
            />
          </div>
        )}
        {tab === "overview" && summary && (
          <div className="flex flex-wrap gap-2">
            {Object.entries(summary.byPlatform).map(([ch, v]) => {
              const meta = CHANNEL_META[ch as ChannelName];
              return (
                <span
                  key={ch}
                  className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm"
                >
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold",
                      meta?.className
                    )}
                  >
                    {meta?.label ?? ch}
                  </span>
                  <span className="text-muted-foreground">
                    {formatNumber(v.count)} đơn ·{" "}
                    <b className={v.profit >= 0 ? "text-emerald-600" : "text-rose-600"}>
                      {v.profit < 0 ? "− " : ""}
                      {formatVND(Math.abs(v.profit))}
                    </b>
                  </span>
                </span>
              );
            })}
          </div>
        )}

        {/* ===== BẢNG THEO TAB ===== */}
        <Card className="shadow-sm">
          <CardContent className="p-0">
            {loading && rows.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Đang tải dữ liệu…
              </p>
            ) : rows.length === 0 ? (
              <div className="py-14 text-center text-sm text-muted-foreground">
                <PackageOpen className="mx-auto mb-2 size-8" />
                Không có đơn hàng nào khớp bộ lọc.
              </div>
            ) : (
              <Refreshing active={loading}>
                {tab === "shopee" ? (
                  <ShopeeProfitTable rows={rows} />
                ) : tab === "tiktok" ? (
                  <TiktokProfitTable rows={rows} />
                ) : (
                  <GenericProfitTable rows={rows} />
                )}
              </Refreshing>
            )}
          </CardContent>
        </Card>

        {/* ===== PHÂN TRANG ===== */}
        {data && rows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Hiển thị</span>
              <NativeSelect
                className="w-20"
                aria-label="Số dòng mỗi trang"
                value={String(pageSize)}
                onChange={(e) => changePageSize(Number(e.target.value))}
              >
                {PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </NativeSelect>
              <span className="text-sm text-muted-foreground">
                dòng/trang · {formatNumber(data.total)} đơn · trang {data.page}/
                {Math.max(1, data.pageCount)}
              </span>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="size-4" />
                Trang trước
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= data.pageCount || loading}
                onClick={() => setPage((p) => p + 1)}
              >
                Trang sau
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground">
          Hubsell Finance · Lãi/Lỗ Thực Hiện
        </p>
      </div>
    </AppShell>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <p className={cn(TEXT_SUB)}>{label}</p>
      <p className={cn("mt-0.5 text-lg font-bold text-slate-900", tone)}>{value}</p>
    </div>
  );
}
