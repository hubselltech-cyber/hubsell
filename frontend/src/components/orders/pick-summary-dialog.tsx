"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, ImageIcon, Loader2, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CopyIconButton } from "@/components/ui/copy-icon-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  channelFilterToQuery,
  fetchChannels,
  fetchOrderPickSummary,
  type PickSummaryRow,
} from "@/lib/api";
import { CARRIER_OPTIONS } from "@/lib/carrier-meta";
import { CHANNEL_META } from "@/lib/channel-meta";
import { formatNumber } from "@/lib/format";
import { printPickSummary } from "@/lib/print-pick-summary";
import { qk } from "@/lib/query-keys";
import { TEXT_SUB } from "@/lib/typography";
import { useApiQuery } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";

/**
 * POPUP THỐNG KÊ BỐC HÀNG (04/11/2026): kho nhìn một bảng là biết mỗi SKU / sản
 * phẩm phải lấy bao nhiêu, theo đúng bộ lọc đang xem trên bảng đơn.
 * Mặc định hỏa tốc lên đầu (backend xếp); bấm tiêu đề cột để xếp lại.
 */

type Mode = "sku" | "product";
type Sort = { key: "sku" | "qty"; dir: "asc" | "desc" } | null;

type Params = Parameters<typeof fetchOrderPickSummary>[0];

function sortRows(rows: PickSummaryRow[], sort: Sort): PickSummaryRow[] {
  if (!sort) return rows;
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sort.key === "qty") return sign * (a.qty - b.qty);
    // Dòng không có mã luôn xếp cuối ở cả hai chiều
    if (!a.sku || !b.sku) return Number(!a.sku) - Number(!b.sku);
    return sign * a.sku.localeCompare(b.sku, "vi", { numeric: true });
  });
}

function Thumb({ row }: { row: PickSummaryRow }) {
  if (!row.imageUrl) {
    return (
      <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <ImageIcon className="size-4" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={row.imageUrl}
      alt=""
      loading="lazy"
      className="size-10 shrink-0 rounded-md object-cover ring-1 ring-foreground/10"
    />
  );
}

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  align,
  firstDir,
}: {
  label: string;
  sortKey: "sku" | "qty";
  sort: Sort;
  onSort: (s: Sort) => void;
  align?: "right";
  firstDir: "asc" | "desc";
}) {
  const active = sort?.key === sortKey;
  const nextDir = active && sort.dir === firstDir ? (firstDir === "asc" ? "desc" : "asc") : firstDir;
  return (
    <button
      type="button"
      onClick={() => onSort({ key: sortKey, dir: nextDir })}
      className={cn(
        "inline-flex items-center gap-1 font-medium transition-colors hover:text-foreground",
        align === "right" && "ml-auto",
        active && "text-foreground"
      )}
    >
      {label}
      {active && (sort.dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
    </button>
  );
}

function SkuCell({ row }: { row: PickSummaryRow }) {
  if (row.sku) {
    return (
      <div className="flex min-w-0 items-center gap-1">
        <span className="min-w-0 break-all font-mono text-[13px]">{row.sku}</span>
        <CopyIconButton value={row.sku} what="mã SKU" />
      </div>
    );
  }
  if ((row.skuCount ?? 0) > 1) {
    return <span className="text-muted-foreground">{formatNumber(row.skuCount!)} SKU</span>;
  }
  return <span className="text-muted-foreground">Không có SKU</span>;
}

/** Trang chỉ gắn hộp này lúc mở, nên mỗi lần mở đều gọi API và quay về thứ tự hỏa tốc trước. */
export function PickSummaryDialog({
  onClose,
  params,
  scopeLabel,
}: {
  onClose: () => void;
  params: Params;
  /** Tên chip đang lọc, để kho biết bảng này đang tính cho nhóm đơn nào. */
  scopeLabel: string;
}) {
  const [mode, setMode] = useState<Mode>("sku");
  const [sort, setSort] = useState<Sort>(null);

  const query = useApiQuery({
    queryKey: qk.ordersPickSummary({ ...params, channel: channelFilterToQuery(params.channel) }),
    queryFn: () => fetchOrderPickSummary(params),
    // Kho vừa in thêm đơn là số đổi: mở popup lúc nào cũng tính lại
    staleTime: 0,
  });

  // Cùng khóa cache với ô chọn gian, thường đã có sẵn nên không tốn thêm lượt gọi
  const channelsQ = useApiQuery({
    queryKey: qk.channels(),
    queryFn: () => fetchChannels(),
    staleTime: 5 * 60_000,
  });

  const data = query.data;
  const rows = sortRows((mode === "sku" ? data?.bySku : data?.byProduct) ?? [], sort);

  // Tên nhóm đơn + các bộ lọc đang bật: tờ in không có thanh lọc nên phải ghi rõ.
  const scope = [
    scopeLabel,
    params.channel?.channelId
      ? channelsQ.data?.find((c) => c.id === params.channel?.channelId)?.shopName
      : params.channel?.channelName && CHANNEL_META[params.channel.channelName]?.label,
    CARRIER_OPTIONS.find((o) => o.value === params.carrier)?.label.replace("⚡ ", ""),
    params.orderType === "single" && "Đơn 1 sản phẩm",
    params.orderType === "multi" && "Đơn nhiều sản phẩm",
    params.cancelRequested && "Khách xin hủy",
    params.search?.trim() && `Từ khóa "${params.search.trim()}"`,
  ]
    .filter(Boolean)
    .join(" · ");

  // Bản in luôn theo SKU, không phụ thuộc tab đang xem; giữ thứ tự seller đang xếp.
  function handleExport() {
    if (!data) return;
    printPickSummary({
      scope,
      orders: data.totals.orders,
      totalQty: data.totals.qty,
      expressQty: data.totals.expressQty,
      rows: sortRows(data.bySku, sort),
    });
  }

  const tabs: { key: Mode; label: string; count?: number }[] = [
    { key: "sku", label: "Theo SKU", count: data?.totals.skuCount },
    { key: "product", label: "Theo sản phẩm", count: data?.totals.productCount },
  ];

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="flex max-h-[calc(100dvh-4rem)] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Phiếu nhặt hàng</DialogTitle>
          <DialogDescription>
            {scope}
            {data && (
              <>
                {" · "}
                <b className="text-foreground">{formatNumber(data.totals.orders)} đơn</b>
                {" · cần lấy "}
                <b className="text-foreground">{formatNumber(data.totals.qty)} sản phẩm</b>
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {data && data.totals.expressQty > 0 && (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 font-medium text-rose-700 dark:border-rose-800 dark:bg-rose-950/30">
            ⚡ Có {formatNumber(data.totals.expressQty)} sản phẩm thuộc đơn hỏa tốc, lấy trước.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {tabs.map((t) => {
            const active = mode === t.key;
            return (
              <button
                key={t.key}
                type="button"
                aria-pressed={active}
                onClick={() => setMode(t.key)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-medium transition-colors",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {t.label}
                {t.count !== undefined && (
                  <span className="tabular-nums opacity-70">{formatNumber(t.count)}</span>
                )}
              </button>
            );
          })}
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            disabled={!data || data.bySku.length === 0}
            onClick={handleExport}
            title="In bảng theo SKU gồm 3 cột: mã SKU, tên sản phẩm, số lượng"
          >
            <Printer className="size-4" />
            Xuất phiếu nhặt hàng
          </Button>
        </div>

        {query.loading ? (
          <p className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Đang cộng số lượng…
          </p>
        ) : query.error ? (
          <p className="py-12 text-center text-rose-600">{query.error}</p>
        ) : rows.length === 0 ? (
          <p className="py-12 text-center text-muted-foreground">
            Không có sản phẩm nào cần lấy trong nhóm đơn này.
          </p>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
            {/* Điện thoại: mã SKU xuống dưới tên để cột Số lượng luôn thấy, không phải cuộn ngang */}
            <table className="w-full table-fixed border-collapse">
              <thead className="sticky top-0 z-10 bg-muted text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Sản phẩm</th>
                  <th className="hidden w-[34%] px-3 py-2 sm:table-cell">
                    <SortHeader label="Mã SKU" sortKey="sku" sort={sort} onSort={setSort} firstDir="asc" />
                  </th>
                  <th className="w-24 px-3 py-2 text-right">
                    <SortHeader
                      label="Số lượng"
                      sortKey="qty"
                      sort={sort}
                      onSort={setSort}
                      align="right"
                      firstDir="desc"
                    />
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.sku ?? ""}|${r.name}`} className="border-t align-middle">
                    <td className="px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <Thumb row={r} />
                        <div className="min-w-0">
                          <p className="line-clamp-2 break-words" title={r.name}>
                            {r.name}
                          </p>
                          <div className="mt-0.5 sm:hidden">
                            <SkuCell row={r} />
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-3 py-2 sm:table-cell">
                      <SkuCell row={r} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <p className="text-base font-semibold tabular-nums">{formatNumber(r.qty)}</p>
                      {r.expressQty > 0 && (
                        <p
                          className={cn(TEXT_SUB, "font-medium text-rose-600")}
                          title={`${formatNumber(r.expressQty)} sản phẩm thuộc đơn hỏa tốc`}
                        >
                          ⚡ {formatNumber(r.expressQty)}
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
