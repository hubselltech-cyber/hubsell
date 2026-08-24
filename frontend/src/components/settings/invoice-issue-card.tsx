"use client";

/**
 * XUẤT HÓA ĐƠN CHO ĐƠN HÀNG — panel HÀNG CHỜ + TỰ ĐỘNG.
 *
 * Bản LÀM LẠI THEO HƯỚNG THAO TÁC 24/08 (anh Trung yêu cầu: khu này người dùng
 * thao tác nhiều, phải dễ bấm và không rối — khác các trang thiên hiển thị):
 *
 *   · TAB LỌC theo đối soát (Tất cả / Đã đối soát / Chờ đối soát) — lọc phía
 *     server, số đếm trên tab là số TOÀN hàng chờ nên không nhảy khi đổi tab.
 *   · Ô TÌM MÃ ĐƠN lọc nhanh trong 50 đơn đang hiện (client-side).
 *   · THANH HÀNH ĐỘNG chỉ hiện KHI ĐÃ TICK: số đơn + tổng tiền + nút Xuất —
 *     không còn nút mờ (disabled) chiếm chỗ lúc chưa chọn gì.
 *   · Đã BỎ cảnh báo liên kết SKU kho sau mã đơn (chốt 24/08: hàng chờ chỉ
 *     dựa trạng thái đơn, không dính kho tổng vật lý).
 *   · Chưa cấu hình kết nối → callout dẫn sang tab Cấu hình (prop onOpenConfig).
 *   · TỰ ĐỘNG (kiểu Salework): công tắc worker 15 phút, đơn ĐÃ GIAO + ĐÃ ĐỐI
 *     SOÁT. Backend xử lý tuần tự (MISA cấp số liên tục), tối đa 50 đơn/lần.
 *   · Vẫn giữ ô nhập mã đơn cho trường hợp xuất một đơn ngoài danh sách.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  ReceiptText,
  RefreshCcw,
  Search,
  Settings2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
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
  fetchInvoiceQueue,
  issueInvoice,
  issueInvoicesBulk,
  setInvoiceAutoIssue,
  type InvoiceQueueFilter,
  type InvoiceQueueResponse,
} from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { TABLE_HEAD_EMPHASIS, TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/** "2026-08-23T..." → "23/08" gọn cho cột ngày đặt. */
function shortDate(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}`;
}

export function InvoiceIssueCard({
  /** Mở tab Cấu hình kết nối (callout khi chưa cấu hình xong). */
  onOpenConfig,
}: {
  onOpenConfig?: () => void;
}) {
  const [queue, setQueue] = useState<InvoiceQueueResponse | null>(null);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [filter, setFilter] = useState<InvoiceQueueFilter>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false); // đang xuất (lẻ hoặc hàng loạt)
  const [savingAuto, setSavingAuto] = useState(false);
  const [issueCode, setIssueCode] = useState("");

  const loadQueue = useCallback(async (f: InvoiceQueueFilter) => {
    setLoadingQueue(true);
    try {
      const r = await fetchInvoiceQueue(f);
      setQueue(r);
      // Bỏ tick những đơn đã rời hàng chờ / rời tab đang xem.
      setSelected((prev) => {
        const alive = new Set(r.rows.map((x) => x.orderCode));
        return new Set([...prev].filter((c) => alive.has(c)));
      });
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) {
        toast.error("Không tải được hàng chờ xuất hóa đơn");
      }
    } finally {
      setLoadingQueue(false);
    }
  }, []);

  useEffect(() => {
    void loadQueue(filter);
  }, [loadQueue, filter]);

  async function handleToggleAuto(enabled: boolean) {
    setSavingAuto(true);
    try {
      const r = await setInvoiceAutoIssue(enabled);
      setQueue((q) => (q ? { ...q, autoIssueEnabled: r.autoIssueEnabled } : q));
      toast.success(
        r.autoIssueEnabled
          ? "Đã BẬT tự động phát hành — đơn đã giao & đã đối soát sẽ được xuất mỗi 15 phút."
          : "Đã tắt tự động phát hành."
      );
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Không lưu được cài đặt tự động"
      );
    } finally {
      setSavingAuto(false);
    }
  }

  /** Xuất một danh sách mã đơn (dùng cho cả nút dòng lẫn thanh hàng loạt). */
  async function issueMany(orderCodes: string[]) {
    if (orderCodes.length === 0 || busy) return;
    setBusy(true);
    try {
      const r = await issueInvoicesBulk(orderCodes);
      if (r.failed === 0) {
        toast.success(
          `Đã phát hành ${r.issued} hóa đơn — xem và tải PDF tại Lịch sử & Báo cáo thuế.`
        );
      } else {
        const firstErr = r.results.find((x) => !x.ok);
        toast.warning(
          `Phát hành ${r.issued} hóa đơn, ${r.failed} đơn lỗi${firstErr?.error ? ` (${firstErr.error})` : ""} — chi tiết tại Lịch sử & Báo cáo thuế.`
        );
      }
      void loadQueue(filter);
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.message
          ? err.message
          : "Phát hành hóa đơn thất bại"
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleIssueManual() {
    const orderCode = issueCode.trim();
    if (!orderCode || busy) return;
    setBusy(true);
    try {
      const res = await issueInvoice(orderCode);
      toast.success(
        `Đã phát hành hóa đơn số ${res.log.invoiceNo ?? "?"} cho đơn ${orderCode}.`
      );
      setIssueCode("");
      void loadQueue(filter);
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.message
          ? err.message
          : "Phát hành hóa đơn thất bại"
      );
      void loadQueue(filter);
    } finally {
      setBusy(false);
    }
  }

  const allRows = useMemo(() => queue?.rows ?? [], [queue]);
  /** Lọc nhanh theo mã đơn trong 50 đơn đang hiện. */
  const rows = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return allRows;
    return allRows.filter((r) => r.orderCode.toUpperCase().includes(q));
  }, [allRows, search]);

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.orderCode));
  const selectedRows = allRows.filter((r) => selected.has(r.orderCode));
  const selectedSum = selectedRows.reduce((s, r) => s + r.totalAmount, 0);

  const total = queue?.total ?? 0;
  const settledTotal = queue?.settledTotal ?? 0;
  const TABS: Array<{ key: InvoiceQueueFilter; label: string; count: number }> = [
    { key: "all", label: "Tất cả", count: total },
    { key: "yes", label: "Đã đối soát", count: settledTotal },
    { key: "no", label: "Chờ đối soát", count: total - settledTotal },
  ];

  return (
    <Card className="shadow-sm">
      <CardContent className="pt-5">
        {/* ---- Header + công tắc tự động ---- */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <ReceiptText className="size-4 text-slate-500" />
              <h3 className="text-sm font-semibold text-slate-900">
                Xuất hóa đơn cho đơn hàng
              </h3>
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                Thí điểm
              </span>
            </div>
            <p className={TEXT_SUB}>
              Đơn <b>đã giao thành công</b> chưa có hóa đơn tự vào hàng chờ —
              tick chọn rồi xuất, hoặc bật tự động.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-slate-200/80 px-3 py-2">
            <div className="mr-1">
              <Label htmlFor="auto-issue-toggle" className="cursor-pointer text-xs font-semibold">
                Tự động phát hành
              </Label>
              <p className="text-[11px] text-muted-foreground">
                Khi đơn đã giao &amp; sàn đã đối soát
              </p>
            </div>
            {savingAuto ? (
              <Loader2 className="size-4 animate-spin text-slate-400" />
            ) : (
              <Switch
                id="auto-issue-toggle"
                checked={queue?.autoIssueEnabled ?? false}
                onCheckedChange={(v) => void handleToggleAuto(v)}
                disabled={queue === null}
              />
            )}
          </div>
        </div>

        {/* ---- Nhắc cấu hình khi chưa đủ điều kiện phát hành ---- */}
        {queue !== null && !queue.configured && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
            <span>
              Chưa đủ cấu hình để phát hành — cần <b>tài khoản meInvoice</b> và{" "}
              <b>ký hiệu hóa đơn</b>.
            </span>
            {onOpenConfig && (
              <Button size="sm" variant="outline" onClick={onOpenConfig}>
                <Settings2 className="size-3.5" />
                Mở Cấu hình kết nối
              </Button>
            )}
          </div>
        )}

        {/* ---- Tab lọc theo đối soát ---- */}
        <div
          role="tablist"
          aria-label="Lọc hàng chờ theo trạng thái đối soát"
          className="mt-4 flex flex-wrap gap-1 border-b"
        >
          {TABS.map((t) => {
            const active = filter === t.key;
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(t.key)}
                className={cn(
                  "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                )}
              >
                {t.label}
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[11px] tabular-nums",
                    active
                      ? "bg-primary/10 text-primary"
                      : "bg-slate-100 text-slate-500"
                  )}
                >
                  {t.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* ---- Thanh công cụ: tìm mã đơn + làm mới ---- */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm mã đơn trong danh sách…"
              className="h-8 w-60 pl-8 text-sm"
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void loadQueue(filter)}
            disabled={loadingQueue}
          >
            <RefreshCcw className={cn("size-3.5", loadingQueue && "animate-spin")} />
            Làm mới
          </Button>
          <span className={TEXT_SUB}>
            {queue && allRows.length < (filter === "all" ? total : filter === "yes" ? settledTotal : total - settledTotal)
              ? `Hiện ${allRows.length} đơn mới nhất`
              : ""}
          </span>
        </div>

        {/* ---- Thanh hành động hàng loạt — chỉ hiện khi đã tick ---- */}
        {selected.size > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-blue-200 bg-blue-50/70 px-3 py-2">
            <span className="text-sm font-medium text-slate-800">
              Đã chọn {selected.size} đơn ·{" "}
              <Money value={selectedSum} className="font-semibold" />
            </span>
            <Button size="sm" onClick={() => void issueMany([...selected])} disabled={busy}>
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Đang xuất tuần tự…
                </>
              ) : (
                <>
                  <ReceiptText className="size-4" />
                  Xuất {selected.size} hóa đơn
                </>
              )}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelected(new Set())}
              disabled={busy}
            >
              <X className="size-3.5" />
              Bỏ chọn
            </Button>
          </div>
        )}

        {/* ---- Bảng hàng chờ ---- */}
        <div className="mt-3">
          {loadingQueue && !queue ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Đang tải hàng chờ…
            </div>
          ) : rows.length === 0 ? (
            <p className="rounded-lg bg-slate-50 py-6 text-center text-sm text-muted-foreground">
              {search.trim()
                ? "Không có đơn nào khớp mã đang tìm."
                : "Không còn đơn nào chờ xuất hóa đơn 🎉"}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className={TABLE_HEAD_EMPHASIS}>
                  <TableRow>
                    <TableHead className="w-8">
                      <input
                        type="checkbox"
                        aria-label="Chọn tất cả"
                        className="size-3.5 accent-blue-600"
                        checked={allSelected}
                        onChange={(e) =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            for (const r of rows) {
                              if (e.target.checked) next.add(r.orderCode);
                              else next.delete(r.orderCode);
                            }
                            return next;
                          })
                        }
                      />
                    </TableHead>
                    <TableHead>Mã đơn</TableHead>
                    <TableHead>Gian hàng</TableHead>
                    <TableHead>Khách</TableHead>
                    <TableHead>Ngày đặt</TableHead>
                    <TableHead className="text-right">Tổng tiền</TableHead>
                    <TableHead>Đối soát</TableHead>
                    <TableHead className="text-right">Thao tác</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const meta = CHANNEL_META[r.channelName];
                    const checked = selected.has(r.orderCode);
                    return (
                      <TableRow
                        key={r.orderCode}
                        data-state={checked ? "selected" : undefined}
                        className={cn(checked && "bg-blue-50/40")}
                      >
                        <TableCell>
                          <input
                            type="checkbox"
                            aria-label={`Chọn đơn ${r.orderCode}`}
                            className="size-3.5 accent-blue-600"
                            checked={checked}
                            onChange={(e) =>
                              setSelected((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(r.orderCode);
                                else next.delete(r.orderCode);
                                return next;
                              })
                            }
                          />
                        </TableCell>
                        <TableCell className="font-medium">{r.orderCode}</TableCell>
                        <TableCell>
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.className}`}
                          >
                            {r.shopName}
                          </span>
                        </TableCell>
                        <TableCell className="text-slate-600">{r.customerName}</TableCell>
                        <TableCell className="text-slate-600">
                          {shortDate(r.orderedAt)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Money value={r.totalAmount} />
                        </TableCell>
                        <TableCell>
                          {r.isSettled ? (
                            <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                              Đã đối soát
                            </span>
                          ) : (
                            <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                              Chờ đối soát
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void issueMany([r.orderCode])}
                            disabled={busy}
                          >
                            Xuất
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {/* ---- Xuất theo mã đơn ngoài danh sách ---- */}
        <div className="mt-4 border-t border-slate-100 pt-4">
          <p className={cn(TEXT_SUB, "mb-2")}>
            Khách yêu cầu hóa đơn cho đơn chưa vào hàng chờ (chưa giao xong, đơn
            cũ…)? Xuất theo mã:
          </p>
          <div className="flex max-w-md gap-2">
            <Input
              value={issueCode}
              onChange={(e) => setIssueCode(e.target.value)}
              placeholder="Mã đơn hàng, VD 2508230ABCDEF"
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleIssueManual();
              }}
            />
            <Button
              variant="outline"
              onClick={() => void handleIssueManual()}
              disabled={busy || issueCode.trim() === ""}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : "Phát hành"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
