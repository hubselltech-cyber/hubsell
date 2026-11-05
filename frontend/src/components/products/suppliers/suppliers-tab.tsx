"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Download, Loader2, Pencil, Plus, Search, X } from "lucide-react";

import { DateRangePicker } from "@/components/shared/date-range-picker";
import { Refreshing } from "@/components/shared/refreshing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { Segmented } from "@/components/ui/segmented";
import { ApiError, fetchSuppliers, getStoredUser, type SupplierRow } from "@/lib/api";
import type { DateRange } from "@/lib/date-range";
import { exportPurchaseStatsToExcel, exportSuppliersToExcel } from "@/lib/excel";
import { formatDateTime, formatNumber } from "@/lib/format";
import { canSeeFinancials } from "@/lib/permissions";
import { qk } from "@/lib/query-keys";
import { TEXT_SUB } from "@/lib/typography";
import { useApiQuery, useInvalidate } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";

import { PurchaseByProduct } from "./purchase-by-product";
import { SortHeader, type SortState } from "./sort-header";
import { SupplierFormDialog } from "./supplier-form-dialog";

/**
 * TAB "NHÀ CUNG CẤP" của Tổng kho (05/11/2026, docs/QUAN-LY-KHO-TAI-CAU-TRUC.md mục 5) = BÁO CÁO NHẬP HÀNG
 * đọc từ phiếu nhập (anh Trung: "đây là phần thống kê thôi, phiếu nhập cũng đơn giản"). Hai góc nhìn như
 * Sapo: Theo nhà cung cấp (kiêm danh bạ — thêm / sửa tại đây; bấm một dòng sang Phiếu kho đã lọc theo
 * nhà đó để đối chiếu) và Theo sản phẩm (giá từng nhà + giá nhập trung bình, chỉ người thấy tài chính).
 * Chung: tìm, khoảng ngày chuẩn, xuất Excel. KHÔNG có công nợ, KHÔNG tự đổi giá vốn.
 */
type View = "suppliers" | "products";
type SupplierSort = "name" | "vouchers" | "quantity" | "value" | "last";

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

export function SuppliersTab({ onOpenVouchers }: { onOpenVouchers: (supplier: { id: string; name: string }) => void }) {
  const invalidate = useInvalidate();
  const [seesCost] = useState(() => canSeeFinancials(getStoredUser()));
  const [view, setView] = useState<View>("suppliers");
  const [range, setRange] = useState<DateRange | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SupplierRow | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const from = range ? dayStartIso(range.from) : undefined;
  const to = range ? dayEndIso(range.to) : undefined;

  function changeView(v: View) {
    setView(v);
    setSearchInput("");
    setSearch("");
  }

  async function exportExcel() {
    setExporting(true);
    try {
      if (view === "suppliers") {
        const res = await fetchSuppliers({ search: search || undefined, from, to });
        if (res.items.length === 0) toast.error("Chưa có nhà cung cấp nào để xuất");
        else exportSuppliersToExcel(res.items, seesCost);
      } else {
        const n = await exportPurchaseStatsToExcel({ search: search || undefined, from, to });
        if (n === 0) toast.error("Chưa có dòng nhập nào để xuất");
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không xuất được tệp");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {seesCost ? (
          <Segmented
            ariaLabel="Góc nhìn báo cáo nhập hàng"
            value={view}
            onChange={changeView}
            items={[
              { key: "suppliers", label: "Theo nhà cung cấp" },
              { key: "products", label: "Theo sản phẩm" },
            ]}
          />
        ) : (
          <span />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-8 w-60 pl-8 pr-8 text-sm"
              placeholder={view === "suppliers" ? "Tìm tên nhà cung cấp…" : "Tìm tên hoặc mã SKU…"}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            {searchInput && (
              <button
                type="button"
                aria-label="Xóa từ khóa"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setSearchInput("")}
              >
                <X className="size-4" />
              </button>
            )}
          </div>
          <DateRangePicker allowAll value={range} onChange={setRange} />
          <Button variant="outline" disabled={exporting} onClick={() => void exportExcel()} title="Xuất bảng đang xem ra tệp .xlsx">
            {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            Xuất Excel
          </Button>
          {view === "suppliers" && (
            <Button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus className="size-4" />
              Thêm nhà cung cấp
            </Button>
          )}
        </div>
      </div>

      {view === "suppliers" ? (
        <SupplierList
          search={search}
          from={from}
          to={to}
          seesCost={seesCost}
          onOpenVouchers={onOpenVouchers}
          onEdit={(s) => {
            setEditing(s);
            setFormOpen(true);
          }}
        />
      ) : (
        <PurchaseByProduct key={`${search}|${from ?? ""}|${to ?? ""}`} search={search} from={from} to={to} />
      )}

      <SupplierFormDialog open={formOpen} onOpenChange={setFormOpen} supplier={editing} onSaved={() => void invalidate(qk.suppliersAll(), qk.purchaseStatsAll())} />
    </div>
  );
}

function SupplierList({
  search,
  from,
  to,
  seesCost,
  onOpenVouchers,
  onEdit,
}: {
  search: string;
  from?: string;
  to?: string;
  seesCost: boolean;
  onOpenVouchers: (supplier: { id: string; name: string }) => void;
  onEdit: (s: SupplierRow) => void;
}) {
  const [sort, setSort] = useState<SortState<SupplierSort>>({ key: "last", dir: "desc" });
  const params = { search: search || undefined, from, to };
  const q = useApiQuery({ queryKey: qk.suppliers(params), queryFn: () => fetchSuppliers(params) });
  const data = q.data;

  const rows = useMemo(() => {
    const list = [...(data?.items ?? [])];
    const val = (s: SupplierRow): number | string | null =>
      sort.key === "name"
        ? s.name.toLowerCase()
        : sort.key === "vouchers"
          ? s.voucherCount
          : sort.key === "quantity"
            ? s.totalQuantity
            : sort.key === "value"
              ? s.totalValue
              : s.lastImportAt;
    // Giá trị không có (chưa nhập lần nào / chưa có giá) luôn xếp cuối ở cả hai chiều.
    list.sort((a, b) => {
      const x = val(a);
      const y = val(b);
      if (x == null && y == null) return a.name.localeCompare(b.name, "vi");
      if (x == null) return 1;
      if (y == null) return -1;
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "vi");
      return (sort.dir === "asc" ? c : -c) || a.name.localeCompare(b.name, "vi");
    });
    return list;
  }, [data, sort]);

  const unassigned = data?.unassigned;

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-lg border bg-card">
        {q.error ? (
          <p className="py-8 text-center text-sm text-amber-700">{q.error}</p>
        ) : q.loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Đang tải nhà cung cấp…</p>
        ) : rows.length === 0 ? (
          <div className="space-y-1 py-8 text-center text-sm text-muted-foreground">
            <p>{search ? "Không có nhà cung cấp nào khớp từ khóa." : "Chưa có nhà cung cấp nào."}</p>
            {!search && <p className={TEXT_SUB}>Thêm tại đây, hoặc cứ gõ tên ở ô Nhà cung cấp khi lập phiếu nhập — tên mới tự lưu vào danh bạ.</p>}
          </div>
        ) : (
          <Refreshing active={q.refreshing}>
            <div className="max-h-[calc(100dvh-16rem)] overflow-auto">
              <table className="w-full min-w-[820px] table-fixed text-sm">
                <thead className="sticky top-0 z-10 bg-card">
                  <tr className={cn(TEXT_SUB, "border-b text-left")}>
                    <th className="px-3 py-2.5">
                      <SortHeader label="Nhà cung cấp" sortKey="name" sort={sort} onSort={setSort} firstDir="asc" />
                    </th>
                    <th className="w-24 px-2 py-2.5 text-right">
                      <SortHeader label="Số phiếu" sortKey="vouchers" sort={sort} onSort={setSort} align="right" />
                    </th>
                    <th className="w-28 px-2 py-2.5 text-right">
                      <SortHeader label="Số lượng" sortKey="quantity" sort={sort} onSort={setSort} align="right" />
                    </th>
                    {seesCost && (
                      <th className="w-36 px-2 py-2.5 text-right">
                        <SortHeader
                          label="Giá trị nhập"
                          sortKey="value"
                          sort={sort}
                          onSort={setSort}
                          align="right"
                          title="Σ số lượng × giá nhập trên các dòng phiếu có ghi giá"
                        />
                      </th>
                    )}
                    <th className="w-40 px-2 py-2.5">
                      <SortHeader label="Lần nhập gần nhất" sortKey="last" sort={sort} onSort={setSort} />
                    </th>
                    <th className="w-14 px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr
                      key={s.id}
                      className="cursor-pointer border-t align-middle hover:bg-muted/40"
                      title="Xem các phiếu nhập của nhà cung cấp này"
                      onClick={() => onOpenVouchers({ id: s.id, name: s.name })}
                    >
                      <td className="px-3 py-2.5">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="min-w-0 truncate font-medium" title={s.name}>
                            {s.name}
                          </span>
                          {!s.isActive && <span className="shrink-0 rounded-full border px-2 py-px text-xs text-slate-500">Ngừng dùng</span>}
                        </div>
                        {(s.phone || s.taxCode || s.note) && (
                          <div className={cn(TEXT_SUB, "truncate")} title={[s.phone, s.taxCode ? `MST ${s.taxCode}` : null, s.note].filter(Boolean).join(" · ")}>
                            {[s.phone, s.taxCode ? `MST ${s.taxCode}` : null, s.note].filter(Boolean).join(" · ")}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums">{formatNumber(s.voucherCount)}</td>
                      <td className="px-2 py-2.5 text-right font-medium tabular-nums">{formatNumber(s.totalQuantity)}</td>
                      {seesCost && (
                        <td className="px-2 py-2.5 text-right tabular-nums">
                          {s.totalValue != null ? <Money value={s.totalValue} /> : <span className="text-muted-foreground">—</span>}
                        </td>
                      )}
                      <td className="px-2 py-2.5 text-xs tabular-nums text-muted-foreground">{s.lastImportAt ? formatDateTime(s.lastImportAt) : "—"}</td>
                      <td className="px-3 py-2.5 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          title={`Sửa ${s.name}`}
                          aria-label={`Sửa ${s.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onEdit(s);
                          }}
                        >
                          <Pencil className="size-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Refreshing>
        )}
      </div>
      {unassigned && unassigned.voucherCount > 0 && (
        <p className={TEXT_SUB}>
          Còn {formatNumber(unassigned.voucherCount)} phiếu nhập ({formatNumber(unassigned.totalQuantity)} chiếc) chưa ghi nhà cung cấp — bổ sung bằng nút sửa
          trên từng phiếu ở tab Phiếu kho.
        </p>
      )}
    </div>
  );
}
