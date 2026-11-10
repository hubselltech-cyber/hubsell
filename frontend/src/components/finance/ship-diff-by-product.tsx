"use client";

import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ChevronLeft, ChevronRight, PackageSearch } from "lucide-react";

import { DataTable } from "@/components/data-table/data-table";
import { HintIcon } from "@/components/finance/hint-icon";
import { ShipDiffReasonChip } from "@/components/finance/ship-diff-reason-chip";
import { shopOnlyName, type ChannelFilterValue } from "@/components/shared/channel-filter";
import { Refreshing } from "@/components/shared/refreshing";
import { SortHeader, type SortState } from "@/components/shared/sort-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CopyIconButton } from "@/components/ui/copy-icon-button";
import { Money } from "@/components/ui/money";
import { NativeSelect } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  channelFilterToQuery,
  fetchShipDiffByProduct,
  type ShipDiffProductRow,
  type ShipDiffProductSort,
  type ShipDiffReasonTotal,
} from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { rangeToQuery, type DateRange } from "@/lib/date-range";
import { formatCompactVND, formatNumber } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { SHIPPING_DIFF_REASON_META, type ShippingDiffReason } from "@/lib/shipping-diff-reason";
import { MONEY_NEGATIVE, PRODUCT_NAME_CLAMP, TEXT_SUB } from "@/lib/typography";
import { useApiQuery } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";

/**
 * TRUY THU PHÍ SHIP — THEO SẢN PHẨM (Kiểm toán phí, 10/11/2026; docs
 * DOI-SOAT-PHI-SHIP-NGUYEN-NHAN-KHAO-SAT-31-10.md mục 7).
 *
 * Thẻ "Truy thu phí ship" chỉ nói shop chịu thêm BAO NHIÊU; bảng theo đơn nói ĐƠN NÀO. Bảng này trả
 * lời câu khách hỏi tiếp: SẢN PHẨM NÀO gánh nhiều nhất và VÌ SAO — để biết sửa ở đâu (cân nặng khai
 * báo, đóng gói, giá bán) thay vì dò từng đơn. Cùng nguồn + bộ lọc với thẻ nên tổng cột "Shop chịu
 * thêm" (mọi trang) bằng số trên thẻ.
 *
 * Tiền của đơn nhiều sản phẩm chia theo giá trị dòng (đúng luật của sổ lãi lỗ). Lọc nguyên nhân bằng
 * chip một chạm; phần tách theo nguyên nhân của từng sản phẩm nằm trong ô mở từ cột cuối.
 */
const PAGE_SIZES = [20, 50, 100];

type ReasonFilter = "" | ShippingDiffReason;

const percent = (n: number) => `${n.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`;

function ProductCell({ r }: { r: ShipDiffProductRow }) {
  if (r.unattributed) {
    return (
      <div className="flex items-center gap-2.5">
        <span className="size-10 shrink-0 rounded-md border border-dashed bg-muted/40" />
        <div className="min-w-0">
          <p className="font-medium text-slate-700">Đơn chưa rõ sản phẩm</p>
          <p className={TEXT_SUB}>Đơn cũ hoặc sàn không trả dòng hàng · {CHANNEL_META[r.channelName].label}</p>
        </div>
      </div>
    );
  }
  const shop = shopOnlyName(r.channelName, r.shopName);
  const code = r.itemId ?? r.sku;
  return (
    <div className="flex items-center gap-2.5">
      {r.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={r.imageUrl} alt="" className="size-10 shrink-0 rounded-md border object-cover" />
      ) : (
        <span className="size-10 shrink-0 rounded-md border border-dashed bg-muted/40" />
      )}
      {/* Màn ≤ 1500 px: khối chữ tối đa 16rem để 6 cột vừa 1280 px (sidebar mở) không cuộn ngang; dòng phụ
          tự xuống hàng (mã sản phẩm rớt xuống dòng ba) thay vì ép cột rộng ra. */}
      <div className="min-w-0 max-[1500px]:max-w-[16rem]">
        <p className={cn(PRODUCT_NAME_CLAMP, "font-medium")} title={r.productName}>
          {r.productName || code}
        </p>
        <div className={cn(TEXT_SUB, "mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5")}>
          <span className={cn("shrink-0 rounded-full border px-1.5 py-px text-[11px] font-medium", CHANNEL_META[r.channelName].className)}>
            {CHANNEL_META[r.channelName].label}
          </span>
          {shop && (
            <span className="max-w-[9rem] truncate" title={shop}>
              {shop}
            </span>
          )}
          {code && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <span className="max-w-[11rem] truncate tabular-nums" title={r.itemId ? "Mã sản phẩm trên sàn" : "Mã SKU trên sàn"}>
                {code}
              </span>
              <CopyIconButton value={code} what={r.itemId ? "mã sản phẩm" : "mã SKU"} className="size-4" />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ReasonLine({ r }: { r: ShipDiffReasonTotal }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <ShipDiffReasonChip reason={r.reason} />
      <span className="shrink-0 text-right tabular-nums text-slate-700">
        <Money value={r.amount} />
        <span className={cn(TEXT_SUB, "block")}>{formatNumber(r.orders)} đơn</span>
      </span>
    </div>
  );
}

/** Cột kết luận: nguyên nhân gánh nhiều tiền nhất; trỏ chuột / bấm ra đủ các nguyên nhân + nên làm gì. */
function ReasonCell({ r }: { r: ShipDiffProductRow }) {
  const top = SHIPPING_DIFF_REASON_META[r.topReason];
  const more = r.reasons.length - 1;
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={80}
        render={<button type="button" className="inline-flex cursor-pointer items-center gap-1.5 text-left" aria-label={`Nguyên nhân: ${top.label}`} />}
      >
        <ShipDiffReasonChip reason={r.topReason} />
        {more > 0 && <span className={cn(TEXT_SUB, "shrink-0")}>+{more}</span>}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] gap-2 p-3 text-sm">
        <p className="font-semibold text-slate-900">Tiền ship shop chịu thêm theo nguyên nhân</p>
        <div className="space-y-1.5">
          {r.reasons.map((x) => (
            <ReasonLine key={x.reason} r={x} />
          ))}
        </div>
        <p className="border-t pt-2 text-xs leading-relaxed text-slate-600">
          <b className="font-semibold text-slate-900">{top.label}:</b> {top.hint}
        </p>
      </PopoverContent>
    </Popover>
  );
}

export function ShipDiffByProduct({ channel, range }: { channel: ChannelFilterValue; range: DateRange | null }) {
  const [pageSize, setPageSize] = useState(20);
  const [sort, setSort] = useState<SortState<ShipDiffProductSort>>({ key: "amount", dir: "desc" });
  const [reason, setReason] = useState<ReasonFilter>("");
  // Trang hiện tại gắn với bộ lọc của trang cha: đổi gian / khoảng ngày là về trang 1, không cần effect.
  const filterKey = JSON.stringify([channelFilterToQuery(channel), rangeToQuery(range ?? undefined)]);
  const [paging, setPaging] = useState({ filterKey, page: 1 });
  const page = paging.filterKey === filterKey ? paging.page : 1;
  const setPage = (p: number) => setPaging({ filterKey, page: p });

  const params = { page, pageSize, sort: sort.key, dir: sort.dir, reason };
  const q = useApiQuery({
    queryKey: qk.shipDiffByProduct({ ...params, filterKey }),
    queryFn: () => fetchShipDiffByProduct({ ...params, channel, range: range ?? undefined }),
  });
  const rows = q.data?.items ?? [];
  const summary = q.data?.summary;
  const pageCount = q.data?.pageCount ?? 0;
  const loading = q.refreshing;

  const onSort = (s: SortState<ShipDiffProductSort>) => {
    setSort(s);
    setPaging({ filterKey, page: 1 });
  };
  const columns: ColumnDef<ShipDiffProductRow>[] = [
    {
      id: "product",
      meta: { label: "Sản phẩm" },
      header: "Sản phẩm",
      cell: ({ row }) => <ProductCell r={row.original} />,
    },
    {
      id: "amount",
      meta: { label: "Shop chịu thêm", align: "right" },
      header: () => (
        <SortHeader
          label="Shop chịu thêm"
          sortKey="amount"
          sort={sort}
          onSort={onSort}
          align="right"
          title="Phí ship của các đơn có sản phẩm này mà shop phải chịu ngoài phần khách trả + sàn trợ. Đơn nhiều sản phẩm chia theo giá trị từng dòng."
        />
      ),
      cell: ({ row }) => (
        <span className={cn("font-semibold", MONEY_NEGATIVE)}>
          <Money value={row.original.amount} />
        </span>
      ),
    },
    {
      id: "orders",
      meta: { label: "Đơn lệch", align: "right" },
      header: () => (
        <SortHeader label="Đơn lệch" sortKey="orders" sort={sort} onSort={onSort} align="right" title="Số đơn có sản phẩm này bị shop chịu thêm phí ship" />
      ),
      cell: ({ row }) => formatNumber(row.original.orders),
    },
    {
      id: "avg",
      meta: { label: "Trung bình mỗi đơn", align: "right" },
      header: () => (
        <SortHeader label="TB mỗi đơn" sortKey="avg" sort={sort} onSort={onSort} align="right" title="Shop chịu thêm ÷ số đơn lệch" />
      ),
      cell: ({ row }) => (
        <span className="text-slate-700">
          <Money value={row.original.avgPerOrder} />
        </span>
      ),
    },
    {
      id: "rate",
      meta: { label: "Tỷ lệ đơn lệch", align: "right" },
      header: () => (
        <span className="inline-flex items-center gap-1">
          Tỷ lệ đơn lệch
          <HintIcon hint="Số đơn lệch ÷ tổng đơn của sản phẩm trong cùng khoảng ngày (không tính đơn hủy trước khi gửi). Tỷ lệ cao bất thường so với sản phẩm khác là dấu hiệu nên xem lại cân nặng / kích thước khai báo hoặc cách đóng gói." />
        </span>
      ),
      cell: ({ row }) =>
        row.original.rate === null || row.original.totalOrders === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <>
            <span className="text-slate-700">{percent(row.original.rate)}</span>
            <span className={cn(TEXT_SUB, "block whitespace-nowrap")}>
              {formatNumber(row.original.orders)} / {formatNumber(row.original.totalOrders)} đơn
            </span>
          </>
        ),
    },
    {
      id: "reason",
      meta: { label: "Nguyên nhân chính" },
      header: "Nguyên nhân chính",
      cell: ({ row }) => <ReasonCell r={row.original} />,
    },
  ];

  // Chip lọc xếp theo TIỀN (như bảng) và in tiền rút gọn: thứ khách cần thấy là nguyên nhân nào tốn nhất;
  // số đơn nằm ở tooltip. Số trên chip không theo bộ lọc nguyên nhân đang chọn.
  const reasonTotals = summary?.reasons ?? [];
  const chips: { key: ReasonFilter; label: string; amount: number; title?: string; claimable?: boolean }[] = [
    { key: "", label: "Tất cả", amount: reasonTotals.reduce((s, r) => s + r.amount, 0) },
    ...reasonTotals.map((r) => ({
      key: r.reason,
      label: SHIPPING_DIFF_REASON_META[r.reason].label,
      amount: r.amount,
      claimable: r.claimable,
      title: `${formatNumber(r.orders)} đơn · ${formatNumber(r.amount)} ₫
${SHIPPING_DIFF_REASON_META[r.reason].hint}`,
    })),
  ];

  return (
    <div className="space-y-3">
      {chips.length > 1 && (
        <div role="radiogroup" aria-label="Lọc theo nguyên nhân" className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => {
            const active = reason === c.key;
            return (
              <button
                key={c.key || "all"}
                type="button"
                role="radio"
                aria-checked={active}
                title={c.title}
                onClick={() => {
                  setReason(c.key);
                  setPage(1);
                }}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-slate-200 bg-card text-slate-600 hover:border-slate-300 hover:text-slate-900"
                )}
              >
                {c.claimable !== undefined && (
                  <span className={cn("size-1.5 rounded-full", active ? "bg-current opacity-70" : c.claimable ? "bg-teal-500" : "bg-slate-400")} aria-hidden />
                )}
                {c.label}
                <span className={cn("tabular-nums", active ? "opacity-80" : "text-slate-400")}>{formatCompactVND(c.amount)}</span>
              </button>
            );
          })}
        </div>
      )}

      <Card className="shadow-sm">
        <CardContent className="p-0">
          {q.error ? (
            <p className="py-10 text-center text-sm text-amber-700">{q.error}</p>
          ) : q.loading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Đang gom theo sản phẩm…</p>
          ) : rows.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <PackageSearch className="mx-auto mb-2 size-8" />
              {reason
                ? "Không có sản phẩm nào bị lệch phí ship vì nguyên nhân này trong bộ lọc đang chọn."
                : "Không có sản phẩm nào khiến shop chịu thêm phí ship trong bộ lọc đang chọn."}
            </div>
          ) : (
            <Refreshing active={loading}>
              <DataTable
                tableId="fee-audit-ship-product"
                columns={columns}
                data={rows}
                getRowId={(r) => r.key}
                toolbar={
                  <span>
                    {formatNumber(summary?.productCount ?? 0)} sản phẩm · {formatNumber(summary?.orders ?? 0)} đơn lệch · shop chịu thêm{" "}
                    <span className="font-semibold text-slate-900">
                      <Money value={summary?.totalAmount ?? 0} />
                    </span>
                  </span>
                }
              />
            </Refreshing>
          )}
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Hiển thị</span>
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
              sản phẩm/trang · trang {page}/{Math.max(1, pageCount)}
            </span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>
              <ChevronLeft className="size-4" />
              Trang trước
            </Button>
            <Button variant="outline" size="sm" disabled={page >= pageCount || loading} onClick={() => setPage(page + 1)}>
              Trang sau
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
