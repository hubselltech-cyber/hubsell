"use client";

import { Fragment, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

import { Refreshing } from "@/components/shared/refreshing";
import { Button } from "@/components/ui/button";
import { CopyIconButton } from "@/components/ui/copy-icon-button";
import { Money } from "@/components/ui/money";
import { NativeSelect } from "@/components/ui/native-select";
import { fetchPurchaseStatsByProduct, type PurchaseStatProduct, type PurchaseStatSort, type PurchaseStatSupplier } from "@/lib/api";
import { formatDayVN } from "@/lib/date-range";
import { formatNumber } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { TEXT_SUB } from "@/lib/typography";
import { useApiQuery } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";

import { SortHeader, type SortState } from "./sort-header";

/**
 * GIÁ NHẬP THEO SẢN PHẨM — góc nhìn thứ hai của tab Nhà cung cấp (ý anh Trung 05/11: gõ một sản phẩm →
 * giá từng nhà cung cấp + "Giá trung bình" để khách TỰ nhập giá vốn nếu muốn; docs mục 5).
 *
 * Bảng hai tầng, CÙNG MỘT BỘ CỘT CÓ TÊN cho cả hai: dòng SKU (tổng) và, khi bấm ▸, mỗi nhà cung cấp một
 * dòng — Số phiếu · Số lượng · Giá gần nhất · Giá nhập TB. Nhà có giá gần nhất thấp nhất tô xanh ở dòng
 * con. Anh Trung xem local 05/11: hàng viên "nhà A 47.000 · nhà B 48.900 · +4" trên dòng SKU là lặp lại
 * phần bên dưới ("mình đã tô xanh bên dưới rồi") → bỏ, "nhường không gian để ghi rõ các phần như số
 * lượng". KHÔNG làm "NCC 1 … NCC N" thành N cột: 10 nhà là 10 cột tràn màn mà đa số ô trống (khảo sát
 * 5.6: Sapo / MISA / Zoho / Odoo đều xếp nhà cung cấp thành dòng).
 *
 * Giá nhập TB = bình quân THEO SỐ LƯỢNG trên các dòng phiếu có giá, trong khoảng ngày đang chọn.
 * Chỉ để tham khảo + sao chép: máy KHÔNG tự đổi giá vốn.
 */
const PAGE_SIZES = [20, 50, 100];

function supplierLabel(s: PurchaseStatSupplier): string {
  return s.supplierName ?? "Chưa ghi nhà cung cấp";
}

/** Nhà có giá gần nhất thấp nhất — chỉ tô khi có từ 2 nhà có giá (một nhà thì không có gì để so). */
function cheapestKey(list: PurchaseStatSupplier[]): string | null {
  const priced = list.filter((s) => s.lastPrice != null);
  if (priced.length < 2) return null;
  const best = priced.reduce((a, b) => ((b.lastPrice as number) < (a.lastPrice as number) ? b : a));
  return best.supplierId ?? "";
}

/** Lần nhập CÓ GIÁ gần đây nhất của SKU (bất kể nhà nào) — "giá gần nhất" của dòng tổng. */
function latestPriced(list: PurchaseStatSupplier[]): PurchaseStatSupplier | null {
  const priced = list.filter((s) => s.lastPrice != null && s.lastPriceAt);
  if (priced.length === 0) return null;
  return priced.reduce((a, b) => (new Date(b.lastPriceAt as string).getTime() > new Date(a.lastPriceAt as string).getTime() ? b : a));
}

export function PurchaseByProduct({ search, from, to }: { search: string; from?: string; to?: string }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sort, setSort] = useState<SortState<PurchaseStatSort>>({ key: "recent", dir: "desc" });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const params = { search: search || undefined, from, to, page, pageSize, sort: sort.key, dir: sort.dir };
  const q = useApiQuery({ queryKey: qk.purchaseStats(params), queryFn: () => fetchPurchaseStatsByProduct(params) });
  const rows = q.data?.items ?? [];
  const pageCount = q.data?.pageCount ?? 0;
  const loading = q.refreshing;

  function toggle(id: string) {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function changeSort(s: SortState<PurchaseStatSort>) {
    setSort(s);
    setPage(1);
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-lg border bg-card">
        {q.error ? (
          <p className="py-8 text-center text-sm text-amber-700">{q.error}</p>
        ) : q.loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Đang tải giá nhập…</p>
        ) : rows.length === 0 ? (
          <div className="space-y-1 py-8 text-center text-sm text-muted-foreground">
            <p>{search || from || to ? "Không có sản phẩm nào khớp bộ lọc." : "Chưa có phiếu nhập nào."}</p>
            {!(search || from || to) && (
              <p className={TEXT_SUB}>
                Lập ở Nhập – Xuất – Kiểm kê › Phiếu nhiều mã. Ghi Nhà cung cấp và Giá nhập trên phiếu thì bảng này tự có số.
              </p>
            )}
          </div>
        ) : (
          <Refreshing active={loading}>
            <div className="max-h-[calc(100dvh-16rem)] overflow-auto">
              <table className="w-full min-w-[900px] table-fixed text-sm">
                <thead className="sticky top-0 z-10 bg-card">
                  <tr className={cn(TEXT_SUB, "border-b text-left")}>
                    <th className="px-3 py-2.5 font-medium">Sản phẩm · Nhà cung cấp</th>
                    <th className="w-[72px] px-2 py-2.5 text-right font-medium">Số phiếu</th>
                    <th className="w-24 px-2 py-2.5 text-right">
                      <SortHeader label="Số lượng" sortKey="quantity" sort={sort} onSort={changeSort} align="right" title="Tổng số lượng đã nhập trong khoảng ngày" />
                    </th>
                    <th className="w-32 px-2 py-2.5 text-right font-medium" title="Giá của lần nhập có ghi giá gần đây nhất">
                      Giá gần nhất
                    </th>
                    <th className="w-32 px-2 py-2.5 text-right">
                      <SortHeader
                        label="Giá nhập TB"
                        sortKey="avg"
                        sort={sort}
                        onSort={changeSort}
                        align="right"
                        title="Bình quân theo số lượng trên các dòng phiếu có giá, trong khoảng ngày đang chọn"
                      />
                    </th>
                    <th className="w-36 px-3 py-2.5 text-right font-medium" title="Giá vốn đang cấu hình cho SKU — máy không tự đổi theo giá nhập">
                      Giá vốn đang dùng
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <ProductRows key={r.productId} r={r} open={expanded.has(r.productId)} onToggle={() => toggle(r.productId)} />
                  ))}
                </tbody>
              </table>
            </div>
          </Refreshing>
        )}
      </div>

      {rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <NativeSelect
              className="w-20"
              aria-label="Số sản phẩm mỗi trang"
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
              sản phẩm/trang · {formatNumber(q.data?.total ?? 0)} sản phẩm · trang {page}/{Math.max(1, pageCount)}
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

/** Ô "Giá gần nhất": giá + ngày nhập ở dòng phụ; chưa có giá thì gạch + ngày nhập gần nhất. */
function LastPriceCell({ price, at, fallbackAt, best }: { price: number | null; at: string | null; fallbackAt: string; best?: boolean }) {
  return (
    <>
      {price != null ? (
        <span className={cn("font-medium", best && "text-emerald-700")}>
          <Money value={price} />
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      )}
      <div className={TEXT_SUB}>nhập {formatDayVN(new Date(price != null && at ? at : fallbackAt))}</div>
    </>
  );
}

function ProductRows({ r, open, onToggle }: { r: PurchaseStatProduct; open: boolean; onToggle: () => void }) {
  const best = cheapestKey(r.suppliers);
  const latest = latestPriced(r.suppliers);
  const count = r.suppliers.length;
  return (
    <Fragment>
      <tr className="border-t align-middle">
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              className="flex shrink-0 items-center gap-2.5"
              onClick={onToggle}
              aria-expanded={open}
              aria-label={`${open ? "Thu" : "Xem"} từng nhà cung cấp của ${r.skuCode}`}
            >
              <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", !open && "-rotate-90")} />
              {r.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.imageUrl} alt="" className="size-10 shrink-0 rounded-md border object-cover" />
              ) : (
                <span className="size-10 shrink-0 rounded-md border border-dashed bg-muted/40" />
              )}
            </button>
            <div className="min-w-0 flex-1">
              <button type="button" className="block w-full truncate text-left font-medium" title={r.productName} onClick={onToggle}>
                {r.productName}
              </button>
              <div className={cn(TEXT_SUB, "flex min-w-0 items-center gap-1")}>
                <span className="min-w-0 select-all truncate font-mono">{r.skuCode}</span>
                <CopyIconButton value={r.skuCode} what="mã SKU" className="size-4" />
                {r.variantName && <span className="min-w-0 truncate">· {r.variantName}</span>}
                <button type="button" className="shrink-0 hover:text-foreground" onClick={onToggle}>
                  · {formatNumber(count)} nhà cung cấp
                </button>
              </div>
            </div>
          </div>
        </td>
        <td className="px-2 py-2.5 text-right tabular-nums">{formatNumber(r.voucherCount)}</td>
        <td className="px-2 py-2.5 text-right font-medium tabular-nums">{formatNumber(r.totalQuantity)}</td>
        <td className="px-2 py-2.5 text-right tabular-nums" title={latest ? `Lần nhập có giá gần đây nhất: ${supplierLabel(latest)}` : undefined}>
          <LastPriceCell price={latest?.lastPrice ?? null} at={latest?.lastPriceAt ?? null} fallbackAt={r.lastImportAt} />
        </td>
        <td className="px-2 py-2.5 text-right tabular-nums">
          {r.avgPrice != null ? (
            <span className="inline-flex items-center justify-end gap-1 font-semibold">
              <Money value={r.avgPrice} />
              <CopyIconButton value={String(r.avgPrice)} what="giá nhập trung bình" className="size-4" />
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
          {r.avgPrice != null && r.pricedQuantity < r.totalQuantity && (
            <div className={TEXT_SUB} title="Giá trung bình chỉ tính trên các dòng phiếu có ghi giá nhập">
              {formatNumber(r.pricedQuantity)} chiếc có giá
            </div>
          )}
          {r.avgPrice == null && <div className={TEXT_SUB}>chưa ghi giá</div>}
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums">
          <CostCell cost={r.costPrice} avg={r.avgPrice} />
        </td>
      </tr>
      {open &&
        r.suppliers.map((s) => {
          const isBest = best !== null && (s.supplierId ?? "") === best;
          return (
            <tr key={s.supplierId ?? "none"} className="border-t border-dashed bg-muted/20 align-middle">
              <td className="py-1.5 pl-[4.25rem] pr-2">
                <span className="flex min-w-0 items-center gap-2">
                  <span className={cn("min-w-0 truncate", !s.supplierName && "text-muted-foreground")} title={supplierLabel(s)}>
                    {supplierLabel(s)}
                  </span>
                  {isBest && <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-px text-[11px] font-medium text-emerald-700">rẻ nhất</span>}
                </span>
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">{formatNumber(s.voucherCount)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{formatNumber(s.quantity)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">
                <LastPriceCell price={s.lastPrice} at={s.lastPriceAt} fallbackAt={s.lastImportAt} best={isBest} />
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">{s.avgPrice != null ? <Money value={s.avgPrice} /> : <span className="text-muted-foreground">—</span>}</td>
              <td />
            </tr>
          );
        })}
    </Fragment>
  );
}

/** Giá vốn đang dùng + so với giá nhập trung bình — một dòng kết luận ngắn, không tự sửa gì. */
function CostCell({ cost, avg }: { cost: number | null; avg: number | null }) {
  if (cost == null || cost <= 0) {
    return (
      <>
        <span className="text-muted-foreground">Chưa có</span>
        <div className="text-xs text-amber-700">chưa nhập giá vốn</div>
      </>
    );
  }
  const diff = avg != null ? cost - avg : null;
  return (
    <>
      <Money value={cost} />
      {diff != null &&
        (diff === 0 ? (
          <div className="text-xs text-emerald-700">khớp giá nhập</div>
        ) : diff < 0 ? (
          <div className="text-xs text-amber-700">thấp hơn {formatNumber(-diff)}</div>
        ) : (
          <div className={TEXT_SUB}>cao hơn {formatNumber(diff)}</div>
        ))}
    </>
  );
}
