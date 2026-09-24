"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";

import { DateRangePicker } from "@/components/shared/date-range-picker";
import { Refreshing } from "@/components/shared/refreshing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchInventoryLogs, type InventoryLogType } from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import type { DateRange } from "@/lib/date-range";
import { formatDateTime, formatNumber } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { TEXT_SUB } from "@/lib/typography";
import { useApiQuery } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";

/**
 * NHẬT KÝ KHO (24/09/2026) — một bảng dùng cho hai chỗ: tab "Nhật ký kho" toàn
 * shop và hộp "Lịch sử" của một SKU (truyền `productId`, cột sản phẩm ẩn).
 *
 * Trả lời câu "vì sao tồn đổi": mỗi dòng nói rõ ĐỐI TƯỢNG (mã SKU), số thay
 * đổi, LOẠI, LÝ DO, đơn gây ra (mã + gian), và AI LÀM — tay ghi tên người,
 * tự động ghi "Hệ thống" (khẩu vị anh Trung: lịch sử phải nêu đối tượng + lý do,
 * thủ công / tự động phân biệt rõ).
 */

const PAGE_SIZES = [20, 50, 100];

type TypeFilter = "" | InventoryLogType;

const TYPE_CHIPS: { key: TypeFilter; label: string }[] = [
  { key: "", label: "Tất cả" },
  { key: "IMPORT", label: "Nhập kho" },
  { key: "EXPORT", label: "Xuất kho" },
  { key: "SYNC", label: "Đơn hàng & sàn" },
  { key: "ADJUST", label: "Điều chỉnh" },
  { key: "TRANSFER", label: "Chuyển vị trí" },
];

export const LOG_TYPE_META: Record<InventoryLogType, { label: string; className: string }> = {
  IMPORT: { label: "Nhập kho", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  EXPORT: { label: "Xuất kho", className: "border-rose-200 bg-rose-50 text-rose-700" },
  SYNC: { label: "Đơn hàng & sàn", className: "border-slate-200 bg-slate-50 text-slate-700" },
  ADJUST: { label: "Điều chỉnh", className: "border-amber-200 bg-amber-50 text-amber-800" },
  TRANSFER: { label: "Chuyển vị trí", className: "border-sky-200 bg-sky-50 text-sky-800" },
};

function dayStartIso(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString();
}
function dayEndIso(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x.toISOString();
}

export function InventoryLogTable({
  productId,
  /** Hộp lịch sử một SKU: bảng gọn, không ô tìm SKU. */
  compact = false,
  /** Shop đang dùng vị trí chứa hàng → hiện cột Vị trí. */
  showLocation = false,
}: {
  productId?: string;
  compact?: boolean;
  showLocation?: boolean;
}) {
  const [range, setRange] = useState<DateRange | null>(null);
  const [type, setType] = useState<TypeFilter>("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const params = {
    productId,
    from: range ? dayStartIso(range.from) : undefined,
    to: range ? dayEndIso(range.to) : undefined,
    type: type || undefined,
    q: search || undefined,
    page,
    pageSize,
  };
  const logsQ = useApiQuery({
    queryKey: qk.inventoryLogs(params),
    queryFn: () => fetchInventoryLogs(params),
  });
  const data = logsQ.data;
  const rows = data?.items ?? [];
  const pageCount = data?.pageCount ?? 0;
  const loading = logsQ.refreshing;

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  const filtersActive = Boolean(range || type || search);

  return (
    <div className="space-y-3">
      {/* ===== BỘ LỌC: chip loại một chạm + khoảng ngày chuẩn + tìm SKU ===== */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {TYPE_CHIPS.map((c) => (
            <button
              key={c.key || "all"}
              type="button"
              aria-pressed={type === c.key}
              onClick={() => {
                setType(c.key);
                setPage(1);
              }}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                type === c.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!compact && !productId && (
            <form onSubmit={submitSearch} className="relative">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-8 w-56 pl-8 text-sm"
                placeholder="Tìm mã SKU hoặc tên…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </form>
          )}
          <DateRangePicker
            allowAll
            value={range}
            onChange={(r) => {
              setRange(r);
              setPage(1);
            }}
            disabled={loading}
          />
        </div>
      </div>

      {/* ===== BẢNG ===== */}
      <div className="overflow-hidden rounded-lg border bg-card">
        {logsQ.error ? (
          <p className="py-8 text-center text-sm text-amber-700">{logsQ.error}</p>
        ) : logsQ.loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Đang tải nhật ký…</p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {filtersActive
              ? "Không có biến động nào khớp bộ lọc."
              : productId
                ? "SKU này chưa có biến động tồn kho nào."
                : "Chưa có biến động tồn kho nào. Nhập hàng, đơn sàn trừ kho hay sửa tồn đều ghi vào đây."}
          </p>
        ) : (
          <Refreshing active={loading}>
            <div className={cn("overflow-auto", compact ? "max-h-[60vh]" : "max-h-[calc(100dvh-16rem)]")}>
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead className="w-36">Thời gian</TableHead>
                    {!productId && <TableHead>Sản phẩm</TableHead>}
                    <TableHead className="w-24 text-right">Thay đổi</TableHead>
                    <TableHead className="w-20 text-right" title="Tồn tổng của SKU ngay sau bút toán">
                      Tồn sau
                    </TableHead>
                    {showLocation && <TableHead className="w-32">Vị trí</TableHead>}
                    <TableHead className="w-32">Loại</TableHead>
                    <TableHead>Lý do</TableHead>
                    <TableHead className="w-44">Đơn hàng</TableHead>
                    <TableHead className="w-36">Người làm</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const meta = LOG_TYPE_META[r.type] ?? LOG_TYPE_META.SYNC;
                    const positive = r.changeQuantity > 0;
                    const chMeta = r.order ? CHANNEL_META[r.order.channelName] : null;
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap text-sm tabular-nums text-slate-700">
                          {formatDateTime(r.createdAt)}
                        </TableCell>
                        {!productId && (
                          <TableCell>
                            <p className="font-mono text-sm">{r.skuCode}</p>
                            <p className={cn(TEXT_SUB, "max-w-[16rem] truncate")} title={r.productName}>
                              {r.productName}
                            </p>
                          </TableCell>
                        )}
                        <TableCell
                          className={cn(
                            "text-right text-sm font-semibold tabular-nums",
                            positive ? "text-emerald-700" : "text-rose-700"
                          )}
                        >
                          {positive ? "+" : "−"}
                          {formatNumber(Math.abs(r.changeQuantity))}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums text-slate-700">
                          {r.balanceAfter === null || r.balanceAfter === undefined
                            ? "—"
                            : formatNumber(r.balanceAfter)}
                        </TableCell>
                        {showLocation && (
                          <TableCell className="text-sm">
                            {r.location ? (
                              <span className="truncate" title={r.location.name}>
                                {r.location.name}
                              </span>
                            ) : (
                              <span className={TEXT_SUB}>—</span>
                            )}
                          </TableCell>
                        )}
                        <TableCell>
                          <span
                            className={cn(
                              "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
                              meta.className
                            )}
                          >
                            {meta.label}
                          </span>
                        </TableCell>
                        <TableCell className="max-w-[24rem] text-sm text-slate-700">
                          <span className="line-clamp-2" title={r.reason ?? ""}>
                            {r.reason ?? "—"}
                          </span>
                        </TableCell>
                        <TableCell>
                          {r.order ? (
                            <>
                              <p className="font-mono text-xs">{r.order.orderCode}</p>
                              <p className={cn(TEXT_SUB, "truncate")}>
                                {chMeta?.label ?? r.order.channelName} · {r.order.shopName}
                              </p>
                            </>
                          ) : (
                            <span className={TEXT_SUB}>—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.actor ? (
                            <span className="truncate" title={r.actor.name}>
                              {r.actor.name}
                            </span>
                          ) : (
                            <span className={TEXT_SUB}>Hệ thống</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </Refreshing>
        )}
      </div>

      {/* ===== PHÂN TRANG ===== */}
      {rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Hiển thị</span>
            <NativeSelect
              className="w-20"
              aria-label="Số dòng mỗi trang"
              value={String(pageSize)}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </NativeSelect>
            <span className="text-sm text-muted-foreground">
              dòng/trang · {formatNumber(data?.total ?? 0)} dòng · trang {page}/{Math.max(1, pageCount)}
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
              disabled={page >= pageCount || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Trang sau
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
