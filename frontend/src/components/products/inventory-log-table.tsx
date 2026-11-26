"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, ClipboardList, Search } from "lucide-react";

import { DateRangePicker } from "@/components/shared/date-range-picker";
import { Refreshing } from "@/components/shared/refreshing";
import { LossReportDialog } from "@/components/products/loss-report-dialog";
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

/**
 * LOẠI DÒNG chi tiết của shop cách ON_HAND (kho chuẩn quốc tế, 20/11/2026) — theo `kind` máy chủ ghi.
 * Dòng không có `kind` (ghi trước 20/11, hoặc nhập / xuất tay) dùng nhãn theo `type` như cũ.
 */
const LOG_KIND_META: Record<string, { label: string; className: string }> = {
  RESERVE: { label: "Giữ cho đơn", className: "border-amber-200 bg-amber-50 text-amber-800" },
  SHIP: { label: "Xuất cho đơn", className: "border-rose-200 bg-rose-50 text-rose-700" },
  RELEASE: { label: "Nhả giữ (hủy)", className: "border-slate-200 bg-slate-50 text-slate-700" },
  RELEASE_INACTIVE: { label: "Thôi giữ", className: "border-slate-200 bg-slate-50 text-slate-700" },
  RETURN: { label: "Nhận hàng hoàn", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  STOCKTAKE: { label: "Kiểm kê", className: "border-amber-200 bg-amber-50 text-amber-800" },
  SET: { label: "Sửa số", className: "border-amber-200 bg-amber-50 text-amber-800" },
  // Lý do nhập / xuất tay theo danh sách (lát 4, lib/stock-reason.ts).
  RECEIVED: { label: "Nhập hàng", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  RETURN_RESTOCK: { label: "Hàng hoàn nhập lại", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  OFFLINE_SALE: { label: "Bán ngoài sàn", className: "border-rose-200 bg-rose-50 text-rose-700" },
  DAMAGED: { label: "Hỏng", className: "border-rose-200 bg-rose-50 text-rose-700" },
  LOST: { label: "Mất / thất lạc", className: "border-rose-200 bg-rose-50 text-rose-700" },
  GIFT: { label: "Tặng / nội bộ", className: "border-rose-200 bg-rose-50 text-rose-700" },
  CORRECTION: { label: "Sửa sai số", className: "border-amber-200 bg-amber-50 text-amber-800" },
};

/** Một ô "ngăn số": phần đổi (có dấu, tô màu) ở trên, số sau bút toán ở dưới. */
function Compartment({ change, after }: { change: number | null; after: number | null | undefined }) {
  return (
    <div className="text-right tabular-nums">
      {change !== null && change !== 0 ? (
        <p className={cn("text-sm font-semibold", change > 0 ? "text-emerald-700" : "text-rose-700")}>
          {change > 0 ? "+" : "−"}
          {formatNumber(Math.abs(change))}
        </p>
      ) : (
        <p className="text-sm text-slate-400">·</p>
      )}
      <p className={TEXT_SUB}>{after === null || after === undefined ? "—" : formatNumber(after)}</p>
    </div>
  );
}

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
  // Hộp báo cáo "Hàng hỏng, mất & chênh kiểm kê" (lát 4) — chỉ ở tab toàn shop.
  const [lossOpen, setLossOpen] = useState(false);

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
  // Shop cách ON_HAND (kho chuẩn quốc tế): mỗi dòng ba ngăn Đang giữ · Có thể bán · Tồn kho.
  const threeCells = logsQ.data?.stockModel === "ON_HAND";
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
          {!compact && !productId && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLossOpen(true)}
              title="Cộng hàng hỏng, mất, chênh kiểm kê và sửa số theo lý do trong một kỳ"
            >
              <ClipboardList className="size-4" />
              <span className="hidden min-[1400px]:inline">Hỏng, mất &amp; kiểm kê</span>
            </Button>
          )}
        </div>
      </div>
      {!compact && !productId && <LossReportDialog open={lossOpen} onOpenChange={setLossOpen} />}

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
                    {threeCells ? (
                      <>
                        <TableHead
                          className="w-20 text-right"
                          title="Hàng đã có đơn, còn trong kho. Trên: phần đổi ở bút toán này; dưới: số sau bút toán."
                        >
                          Đang giữ
                        </TableHead>
                        <TableHead
                          className="w-24 text-right"
                          title="Hàng chưa có đơn đã chốt giữ (chưa trừ tồn an toàn và đơn chưa thanh toán). Trên: phần đổi; dưới: số sau bút toán."
                        >
                          Có thể bán
                        </TableHead>
                        <TableHead
                          className="w-20 text-right"
                          title="Hàng thực có trong kho. Trên: phần đổi ở bút toán này; dưới: số sau bút toán."
                        >
                          Tồn kho
                        </TableHead>
                      </>
                    ) : (
                      <>
                        <TableHead className="w-24 text-right">Thay đổi</TableHead>
                        <TableHead className="w-20 text-right" title="Tồn tổng của SKU ngay sau bút toán">
                          Tồn sau
                        </TableHead>
                      </>
                    )}
                    {showLocation && <TableHead className="w-32">Vị trí</TableHead>}
                    <TableHead className="w-32">Loại</TableHead>
                    <TableHead>Lý do</TableHead>
                    <TableHead className="w-44">Đơn hàng</TableHead>
                    <TableHead className="w-36">Người làm</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const meta =
                      (threeCells && r.kind ? LOG_KIND_META[r.kind] : undefined) ??
                      LOG_TYPE_META[r.type] ??
                      LOG_TYPE_META.SYNC;
                    const positive = r.changeQuantity > 0;
                    // Dòng có đủ ba ngăn (ghi từ 20/11/2026). Chuyển vị trí không đổi hàng trong kho.
                    const hasCells = r.onHandAfter !== null && r.onHandAfter !== undefined;
                    const onHandChange =
                      r.type === "TRANSFER" ? null : r.changeQuantity + (r.heldChange ?? 0);
                    const chMeta = r.order ? CHANNEL_META[r.order.channelName] : null;
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap text-sm tabular-nums text-slate-700">
                          {formatDateTime(r.createdAt)}
                        </TableCell>
                        {!productId && (
                          <TableCell>
                            <p className="max-w-[16rem] truncate font-mono text-sm" title={r.skuCode}>
                              {r.skuCode}
                            </p>
                            <p className={cn(TEXT_SUB, "max-w-[16rem] truncate")} title={r.productName}>
                              {r.productName}
                            </p>
                          </TableCell>
                        )}
                        {threeCells ? (
                          <>
                            <TableCell>
                              {hasCells ? (
                                <Compartment change={r.heldChange ?? 0} after={r.heldAfter} />
                              ) : (
                                <p className={cn(TEXT_SUB, "text-right")}>—</p>
                              )}
                            </TableCell>
                            <TableCell>
                              <Compartment change={r.changeQuantity} after={r.balanceAfter} />
                            </TableCell>
                            <TableCell>
                              {hasCells ? (
                                <Compartment change={onHandChange} after={r.onHandAfter} />
                              ) : (
                                <p className={cn(TEXT_SUB, "text-right")}>—</p>
                              )}
                            </TableCell>
                          </>
                        ) : (
                          <>
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
                          </>
                        )}
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
                        {/* Lý do xuống tối đa 2 dòng trong ô 15rem (20/11/2026): ô cũ rộng tới 24rem một dòng làm
                            bảng cuộn ngang; thu lại để ba cột số của cách "hàng trong kho" không làm bảng rộng thêm. */}
                        <TableCell className="text-sm text-slate-700">
                          <span
                            className="line-clamp-2 min-w-[10rem] max-w-[15rem] whitespace-normal"
                            title={r.reason ?? ""}
                          >
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
              dòng/trang ·{" "}
              {data?.totalCapped ? (
                // Máy chủ chỉ lật tới 10.000 dòng gần nhất của bộ lọc (trần đếm, 26/11/2026) — nói rõ cách xem cũ hơn.
                <span title="Bảng lật tới 10.000 dòng gần nhất. Muốn xem cũ hơn, chọn khoảng ngày hoặc tìm theo mã.">
                  {formatNumber(data.total)}+ dòng
                </span>
              ) : (
                <>{formatNumber(data?.total ?? 0)} dòng</>
              )}{" "}
              · trang {page}/{Math.max(1, pageCount)}
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
