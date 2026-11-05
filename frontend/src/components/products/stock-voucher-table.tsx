"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Printer, Search } from "lucide-react";

import { DateRangePicker } from "@/components/shared/date-range-picker";
import { Refreshing } from "@/components/shared/refreshing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchStockVouchers, getStoredUser, stockVoucherPrintUrl, type StockVoucherType } from "@/lib/api";
import type { DateRange } from "@/lib/date-range";
import { formatDateTime, formatNumber } from "@/lib/format";
import { canSeeFinancials } from "@/lib/permissions";
import { qk } from "@/lib/query-keys";
import { TEXT_SUB } from "@/lib/typography";
import { useApiQuery } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";

/**
 * TAB "PHIẾU KHO" của Tổng kho (05/11/2026, docs/QUAN-LY-KHO-TAI-CAU-TRUC.md mục 4): mỗi lần ghi
 * Phiếu nhiều mã là một chứng từ có số (PN-/PX-yyMMdd-XXXX), tra lại và in lại được. Khác tab
 * Nhật ký kho (từng bút toán): đây là cấp PHIẾU — kế toán hỏi "phiếu số mấy, ai lập, bao nhiêu
 * tiền" thì vào đây. In = mở bản A4 ở tab mới (in trong trình duyệt, không PDF backend).
 */

type TypeFilter = "" | StockVoucherType;
const TYPE_CHIPS: { key: TypeFilter; label: string }[] = [
  { key: "", label: "Tất cả" },
  { key: "IMPORT", label: "Phiếu nhập" },
  { key: "EXPORT", label: "Phiếu xuất" },
];
const TYPE_META: Record<StockVoucherType, { label: string; className: string }> = {
  IMPORT: { label: "Nhập kho", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  EXPORT: { label: "Xuất kho", className: "border-rose-200 bg-rose-50 text-rose-700" },
};
const PAGE_SIZES = [20, 50, 100];

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

export function openVoucherPrint(id: string) {
  window.open(stockVoucherPrintUrl(id), "_blank", "noopener");
}

export function StockVoucherTable({ showLocation = false }: { showLocation?: boolean }) {
  const seesCost = canSeeFinancials(getStoredUser());
  const [range, setRange] = useState<DateRange | null>(null);
  const [type, setType] = useState<TypeFilter>("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const params = {
    type: type || undefined,
    q: search || undefined,
    from: range ? dayStartIso(range.from) : undefined,
    to: range ? dayEndIso(range.to) : undefined,
    page,
    pageSize,
  };
  const vq = useApiQuery({ queryKey: qk.stockVouchers(params), queryFn: () => fetchStockVouchers(params) });
  const rows = vq.data?.items ?? [];
  const pageCount = vq.data?.pageCount ?? 0;
  const loading = vq.refreshing;
  const filtersActive = Boolean(range || type || search);

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  return (
    <div className="space-y-3">
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
                type === c.key ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form onSubmit={submitSearch} className="relative">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input className="h-8 w-56 pl-8 text-sm" placeholder="Tìm số phiếu hoặc lý do…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
          </form>
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

      <div className="overflow-hidden rounded-lg border bg-card">
        {vq.error ? (
          <p className="py-8 text-center text-sm text-amber-700">{vq.error}</p>
        ) : vq.loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Đang tải phiếu kho…</p>
        ) : rows.length === 0 ? (
          <div className="space-y-1 py-8 text-center text-sm text-muted-foreground">
            <p>{filtersActive ? "Không có phiếu nào khớp bộ lọc." : "Chưa có phiếu kho nào."}</p>
            {!filtersActive && (
              <p className={TEXT_SUB}>
                Lập ở Nhập – Xuất – Kiểm kê › Phiếu nhiều mã. Mỗi lần ghi là một số phiếu, in được ngay và in lại ở đây. Nhập / xuất nhanh
                từng SKU trên bảng không lập phiếu.
              </p>
            )}
          </div>
        ) : (
          <Refreshing active={loading}>
            <div className="max-h-[calc(100dvh-16rem)] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead className="w-40">Số phiếu</TableHead>
                    <TableHead className="w-36">Thời gian</TableHead>
                    <TableHead className="w-28">Loại</TableHead>
                    <TableHead>Lý do</TableHead>
                    {showLocation && <TableHead className="w-32">Vị trí</TableHead>}
                    <TableHead className="w-20 text-right">Số mã</TableHead>
                    <TableHead className="w-24 text-right">Số lượng</TableHead>
                    {seesCost && (
                      <TableHead className="w-32 text-right" title="Σ số lượng × giá vốn mặc định lúc lập">
                        Giá trị
                      </TableHead>
                    )}
                    <TableHead className="w-36">Người lập</TableHead>
                    <TableHead className="w-16 text-right">In</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const meta = TYPE_META[r.type];
                    return (
                      <TableRow key={r.id} className="cursor-pointer" onClick={() => openVoucherPrint(r.id)}>
                        <TableCell className="font-mono text-xs font-medium text-foreground">{r.code}</TableCell>
                        <TableCell className="text-xs text-muted-foreground tabular-nums">{formatDateTime(r.createdAt)}</TableCell>
                        <TableCell>
                          <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-xs font-medium", meta.className)}>{meta.label}</span>
                        </TableCell>
                        <TableCell className="max-w-[28rem] truncate text-sm" title={r.reason}>
                          {r.reason}
                        </TableCell>
                        {showLocation && <TableCell className="text-sm text-muted-foreground">{r.locationName ?? "—"}</TableCell>}
                        <TableCell className="text-right tabular-nums">{formatNumber(r.lineCount)}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{formatNumber(r.totalQuantity)}</TableCell>
                        {seesCost && (
                          <TableCell className="text-right tabular-nums">{r.totalCost != null ? <Money value={r.totalCost} /> : "—"}</TableCell>
                        )}
                        <TableCell className="text-sm text-muted-foreground">{r.createdByName ?? "—"}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            title={`In phiếu ${r.code}`}
                            aria-label={`In phiếu ${r.code}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              openVoucherPrint(r.id);
                            }}
                          >
                            <Printer className="size-4" />
                          </Button>
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

      {rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
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
              phiếu/trang · {formatNumber(vq.data?.total ?? 0)} phiếu · trang {page}/{Math.max(1, pageCount)}
            </span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="size-4" />
              Trang trước
            </Button>
            <Button variant="outline" size="sm" disabled={page >= pageCount || loading} onClick={() => setPage((p) => p + 1)}>
              Trang sau
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
