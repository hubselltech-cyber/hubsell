"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  PackageCheck,
  RefreshCw,
  Truck,
} from "lucide-react";

import { AccessDenied } from "@/components/access-denied";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/ui/money";
import { MONEY_NEGATIVE, TEXT_NUMBER_MUTED } from "@/lib/typography";
import { cn } from "@/lib/utils";
import { DashboardCard } from "@/components/dashboard/dashboard-card";
import { DateRangePicker } from "@/components/date-range-picker";
import { Refreshing } from "@/components/refreshing";
import { defaultRange, type DateRange } from "@/lib/date-range";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ApiError,
  fetchShippingDiscrepancies,
  getStoredUser,
  getToken,
  updateShippingDisputeStatus,
  type ChannelName,
  type ShippingDiscrepancy,
  type ShippingDisputeStatus,
} from "@/lib/api";
import { canAccessFinance } from "@/lib/permissions";
import { CHANNEL_META } from "@/lib/channel-meta";
import {
  ALL_CHANNELS,
  ChannelFilter,
  shopOnlyName,
  type ChannelFilterValue,
} from "@/components/channel-filter";
import { exportShippingDisputes } from "@/lib/excel";
import { formatNumber, formatDateTime } from "@/lib/format";

const PAGE_SIZE = 20;

// Nhãn & màu badge cho từng trạng thái khiếu nại
const STATUS_META: Record<
  ShippingDisputeStatus,
  { label: string; className: string }
> = {
  CHO_KHIEU_NAI: {
    label: "Chờ khiếu nại",
    className: "bg-amber-50 text-amber-700 border-amber-300",
  },
  DANG_KHIEU_NAI: {
    label: "Đang khiếu nại",
    className: "bg-sky-50 text-sky-800 border-sky-300",
  },
  DA_DOI_SOAT: {
    label: "Đã đối soát",
    className: "bg-emerald-50 text-emerald-800 border-emerald-300",
  },
};

// Bấm nút sẽ chuyển sang trạng thái kế tiếp trong vòng đời khiếu nại
const NEXT_STATUS: Record<ShippingDisputeStatus, ShippingDisputeStatus> = {
  CHO_KHIEU_NAI: "DANG_KHIEU_NAI",
  DANG_KHIEU_NAI: "DA_DOI_SOAT",
  DA_DOI_SOAT: "CHO_KHIEU_NAI",
};

const STATUS_OPTIONS = [
  { value: "", label: "Tất cả trạng thái" },
  { value: "CHO_KHIEU_NAI", label: "Chờ khiếu nại" },
  { value: "DANG_KHIEU_NAI", label: "Đang khiếu nại" },
  { value: "DA_DOI_SOAT", label: "Đã đối soát" },
];

export default function ShippingAlertsPage() {
  const router = useRouter();

  const [items, setItems] = useState<ShippingDiscrepancy[]>([]);
  const [summary, setSummary] = useState({
    totalOrders: 0,
    totalDiscrepancy: 0,
    pendingCount: 0,
  });
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [channel, setChannel] = useState<ChannelFilterValue>(ALL_CHANNELS);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [range, setRange] = useState<DateRange>(defaultRange);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchShippingDiscrepancies({
        page,
        pageSize: PAGE_SIZE,
        channel,
        status: status || undefined,
        range,
      });
      setItems(res.items);
      setSummary(res.summary);
      setPageCount(res.pageCount);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return;
      }
      if (err instanceof ApiError && err.status === 403) {
        setDenied(true);
        return;
      }
      // 409 (chưa có kênh) — AppShell overlay xử lý
    } finally {
      setLoading(false);
    }
  }, [page, channel, status, router, range]);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    // Đối soát tiền với sàn: chỉ Chủ shop
    if (!canAccessFinance(getStoredUser()?.role)) {
      setDenied(true);
      setLoading(false);
      return;
    }
    load();
  }, [load, router]);

  // Đổi trạng thái nhanh sang bước kế tiếp
  async function handleQuickStatus(o: ShippingDiscrepancy) {
    const next = NEXT_STATUS[o.status];
    setUpdatingId(o.id);
    try {
      await updateShippingDisputeStatus(o.id, next);
      toast.success(
        `${o.orderCode}: ${STATUS_META[o.status].label} → ${STATUS_META[next].label}`
      );
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không đổi được trạng thái");
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const count = await exportShippingDisputes({ channel });
      if (count === 0) {
        toast.info("Không có đơn nào ở trạng thái “Chờ khiếu nại” để xuất");
      } else {
        toast.success(`Đã xuất ${count} đơn ra file khiếu nại gửi sàn`);
      }
    } catch {
      toast.error("Không xuất được file khiếu nại");
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

  // Bao nhiêu % số đơn lệch vẫn đang chờ khiếu nại
  const pendingRatio =
    summary.totalOrders > 0
      ? Math.round((summary.pendingCount / summary.totalOrders) * 1000) / 10
      : undefined;

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-muted-foreground">
            Các đơn bị sàn trừ phí vận chuyển cao hơn mức đã báo — xuất danh sách để
            khiếu nại đòi lại tiền.
          </p>
          <div className="flex flex-wrap gap-2">
            <DateRangePicker value={range} onChange={setRange} disabled={loading} />
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
              Quét lại
            </Button>
            <Button
              onClick={handleExport}
              disabled={exporting}
              className="bg-teal-600 text-white hover:bg-teal-700"
            >
              {exporting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Download className="size-4" />
              )}
              Xuất file khiếu nại sàn
            </Button>
          </div>
        </div>

        {/* 2 thẻ chỉ số */}
        <Refreshing active={loading} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <DashboardCard
            title="Tổng số đơn lệch"
            value={formatNumber(summary.totalOrders)}
            icon={Truck}
            tone="info"
            subtitle={`${formatNumber(summary.pendingCount)} đơn chờ khiếu nại${
              pendingRatio !== undefined ? ` (${pendingRatio}%)` : ""
            }`}
          />

          <DashboardCard
            title="Tổng số tiền cần đòi lại"
            value={<Money value={summary.totalDiscrepancy} />}
            icon={PackageCheck}
            tone="negative"
            featured /* ← chỉ số cốt lõi của trang đối soát ship */
            subtitle="Số tiền sàn đã trừ vượt mức báo trước"
          />
        </Refreshing>

        {/* Bộ lọc */}
        <div className="flex flex-wrap items-end gap-4">
          <div className="grid w-56 gap-1.5">
            <Label className="text-xs text-muted-foreground">Gian hàng</Label>
            <ChannelFilter
              value={channel}
              onChange={(v) => {
                setPage(1);
                setChannel(v);
              }}
            />
          </div>
          <div className="grid w-48 gap-1.5">
            <Label htmlFor="filter-status" className="text-xs text-muted-foreground">
              Trạng thái khiếu nại
            </Label>
            <NativeSelect
              id="filter-status"
              value={status}
              onChange={(e) => {
                setPage(1);
                setStatus(e.target.value);
              }}
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            {loading ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Đang quét đơn hàng…
              </p>
            ) : items.length === 0 ? (
              <div className="py-14 text-center">
                <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-teal-50">
                  <CheckCircle2 className="size-9 text-teal-600" />
                </div>
                <p className="text-lg font-semibold text-teal-700">
                  Tuyệt vời! Không có đơn nào bị lệch phí vận chuyển.
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Sàn đang trừ phí ship đúng như đã báo.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mã đơn hàng</TableHead>
                    <TableHead>Sàn</TableHead>
                    <TableHead className="text-right">Ngày quyết toán</TableHead>
                    <TableHead className="text-right">Phí dự kiến</TableHead>
                    <TableHead className="text-right">Phí thực tế</TableHead>
                    <TableHead className="text-right">Chênh lệch</TableHead>
                    <TableHead className="text-center">Trạng thái</TableHead>
                    <TableHead className="text-center">Thao tác</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((o) => {
                    const meta = CHANNEL_META[o.channelName as ChannelName];
                    const st = STATUS_META[o.status];
                    const next = NEXT_STATUS[o.status];
                    return (
                      <TableRow key={o.id}>
                        <TableCell className="font-medium">{o.orderCode}</TableCell>
                        <TableCell>
                          <span
                            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta.className}`}
                          >
                            {meta.label}
                          </span>
                          {shopOnlyName(o.channelName as ChannelName, o.shopName) && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {shopOnlyName(o.channelName as ChannelName, o.shopName)}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {o.settledAt ? formatDateTime(o.settledAt) : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <Money
                            value={o.shippingFeeQuoted}
                            className={TEXT_NUMBER_MUTED}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Money
                            value={o.shippingFeeActual}
                            className={TEXT_NUMBER_MUTED}
                          />
                        </TableCell>
                        <TableCell
                          className={cn("text-right font-semibold", MONEY_NEGATIVE)}
                        >
                          <Money value={o.discrepancy} />
                        </TableCell>
                        <TableCell className="text-center">
                          <span
                            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${st.className}`}
                          >
                            {st.label}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={updatingId === o.id}
                            onClick={() => handleQuickStatus(o)}
                            title={`Chuyển sang: ${STATUS_META[next].label}`}
                          >
                            {updatingId === o.id ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <RefreshCw className="size-3.5" />
                            )}
                            → {STATUS_META[next].label}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Phân trang */}
        {pageCount > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Trang {page} / {pageCount}
            </p>
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
                disabled={page >= pageCount || loading}
                onClick={() => setPage((p) => p + 1)}
              >
                Trang sau
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground">
          Hubsell Finance · Đối soát & khiếu nại chênh lệch phí vận chuyển
        </p>
      </div>
    </AppShell>
  );
}
