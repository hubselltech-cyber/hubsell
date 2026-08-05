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
  Search,
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
import { LazadaProfitTable } from "@/components/finance/realized-pnl/LazadaProfitTable";
import { ShopeeProfitTable } from "@/components/finance/realized-pnl/ShopeeProfitTable";
import { TiktokProfitTable } from "@/components/finance/realized-pnl/TiktokProfitTable";
import {
  ApiError,
  fetchRealizedPnl,
  getStoredUser,
  getToken,
  type ChannelFilterQuery,
  type ChannelName,
  type PnlDetailRow,
  type RealizedPnlResponse,
  type ReconciliationStatus,
} from "@/lib/api";
import { canAccessFinance } from "@/lib/permissions";
import { defaultRange, type DateRange } from "@/lib/date-range";
import { exportPnlRows, exportRealizedPnl } from "@/lib/excel";
import { formatNumber } from "@/lib/format";
import { Money } from "@/components/ui/money";
import { moneyTone, TEXT_CARD_TITLE } from "@/lib/typography";
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
  // Tìm theo mã đơn: searchInput là ô gõ, search là giá trị đã debounce 400ms
  // (tránh dội API theo từng phím).
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [data, setData] = useState<RealizedPnlResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [exporting, setExporting] = useState(false);
  // Đơn đang tích chọn — lưu cả object để xuất Excel không cần gọi lại API.
  const [selected, setSelected] = useState<Map<string, PnlDetailRow>>(new Map());

  const platform = TABS.find((t) => t.key === tab)!.platform;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchRealizedPnl({
        range,
        channel: channelOf(platform),
        status,
        lossOnly,
        search,
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
  }, [router, range, platform, status, lossOnly, search, page, pageSize]);

  // Debounce ô tìm kiếm → cập nhật search sau 400ms ngừng gõ, về trang 1.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

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

  // Đổi tab / bộ lọc thì về trang 1 VÀ xóa lựa chọn (tránh lẫn dữ liệu giữa các
  // ngữ cảnh khác nhau — theo yêu cầu quản lý trạng thái).
  function changeTab(t: PnlTab) {
    setTab(t);
    setPage(1);
    setSelected(new Map());
  }
  function changeStatus(s: ReconciliationStatus) {
    setStatus(s);
    setPage(1);
    setSelected(new Map());
  }
  function toggleLossOnly() {
    setLossOnly((v) => !v);
    setPage(1);
    setSelected(new Map());
  }
  function changeRange(r: DateRange) {
    setRange(r);
    setPage(1);
    setSelected(new Map());
  }
  function changePageSize(n: number) {
    setPageSize(n);
    setPage(1);
  }

  async function handleExport() {
    setExporting(true);
    try {
      let count: number;
      if (selected.size > 0) {
        // CÓ tích chọn → chỉ xuất đúng các đơn đã chọn (mọi trang).
        count = exportPnlRows(platform, [...selected.values()]);
      } else {
        // KHÔNG chọn → xuất toàn bộ theo bộ lọc hiện tại (logic cũ).
        count = await exportRealizedPnl({ platform, range, status, lossOnly });
      }
      if (count === 0) {
        toast.info("Không có đơn nào để xuất");
      } else {
        toast.success(
          `Đã xuất ${formatNumber(count)} đơn ra file Excel` +
            (selected.size > 0 ? " (theo lựa chọn)" : "")
        );
      }
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

  // Trạng thái tích chọn suy ra từ Map — áp cho các bảng.
  const selectedIds = new Set(selected.keys());
  const allSelected =
    rows.length > 0 && rows.every((r) => selectedIds.has(r.id));
  const someSelected = rows.some((r) => selectedIds.has(r.id)) && !allSelected;

  /** Tích/bỏ tích một đơn (giữ object để xuất được kể cả khi sang trang khác). */
  function toggleRow(row: PnlDetailRow) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(row.id)) next.delete(row.id);
      else next.set(row.id, row);
      return next;
    });
  }

  /** Chọn/bỏ chọn TẤT CẢ đơn của TRANG hiện tại. */
  function toggleAll() {
    setSelected((prev) => {
      const next = new Map(prev);
      if (rows.every((r) => next.has(r.id))) {
        rows.forEach((r) => next.delete(r.id));
      } else {
        rows.forEach((r) => next.set(r.id, r));
      }
      return next;
    });
  }

  const selectionProps = {
    selectedIds,
    allSelected,
    someSelected,
    onToggle: toggleRow,
    onToggleAll: toggleAll,
  };

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

        {/* ===== FILTER BAR + XUẤT EXCEL =====
            Bộ lọc ngày nằm BÊN PHẢI (yêu cầu chủ shop 05/08 — dễ nhìn hơn);
            bên trái là tìm kiếm mã đơn + các lọc trạng thái. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Tìm mã đơn hàng…"
                aria-label="Tìm kiếm theo mã đơn hàng"
                className="h-9 w-52 rounded-md border bg-background pl-8 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
              />
            </div>
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
                  : "border-rose-200 bg-rose-50 text-red-500 hover:bg-rose-100"
              )}
            >
              <TrendingDown className="size-4" />
              Lợi nhuận âm
            </button>
          </div>
          <div className="flex items-center gap-2">
            <DateRangePicker value={range} onChange={changeRange} disabled={loading} />
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

        {/* ===== TỔNG HỢP THUẾ CỦA KỲ (module Hóa đơn & Thuế) =====
            Trên TOÀN BỘ đơn khớp lọc (mọi trang). Thuế sàn: đơn quyết toán
            dùng số THẬT sàn trích, chưa quyết toán ước tính % cấu hình. */}
        {summary && summary.count > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Card className="shadow-sm">
              <CardContent className="px-4 py-3">
                <p className={TEXT_CARD_TITLE}>Lợi nhuận (trước thuế)</p>
                <p
                  className={cn(
                    "mt-1 text-lg font-semibold tracking-tight",
                    moneyTone(summary.totalProfit)
                  )}
                >
                  <Money value={summary.totalProfit} />
                </p>
              </CardContent>
            </Card>
            <Card className="shadow-sm">
              <CardContent className="px-4 py-3">
                <p className={TEXT_CARD_TITLE}>
                  Thuế sàn TMĐT ({summary.taxSettings.platformTaxPercent}%)
                </p>
                <p className="mt-1 text-lg font-semibold tracking-tight text-slate-600">
                  − <Money value={summary.totalPlatformTax} />
                </p>
              </CardContent>
            </Card>
            <Card className="shadow-sm">
              <CardContent className="px-4 py-3">
                <p className={TEXT_CARD_TITLE}>
                  Thuế bổ sung ({summary.taxSettings.customTaxPercent}%)
                </p>
                <p className="mt-1 text-lg font-semibold tracking-tight text-slate-600">
                  − <Money value={summary.additionalTax} />
                </p>
              </CardContent>
            </Card>
            <Card className="shadow-sm">
              <CardContent className="px-4 py-3">
                <p className={TEXT_CARD_TITLE}>Lợi nhuận ròng sau thuế</p>
                <p
                  className={cn(
                    "mt-1 text-lg font-semibold tracking-tight",
                    moneyTone(summary.totalProfitAfterTax)
                  )}
                >
                  <Money value={summary.totalProfitAfterTax} />
                </p>
              </CardContent>
            </Card>
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
                  <ShopeeProfitTable rows={rows} {...selectionProps} />
                ) : tab === "tiktok" ? (
                  <TiktokProfitTable rows={rows} {...selectionProps} />
                ) : tab === "lazada" ? (
                  <LazadaProfitTable rows={rows} {...selectionProps} />
                ) : (
                  <GenericProfitTable rows={rows} {...selectionProps} />
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
