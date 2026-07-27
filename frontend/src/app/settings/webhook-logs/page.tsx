"use client";

// ============================================================
// NHẬT KÝ WEBHOOK & ĐỐI SOÁT (bảng shopee_webhook_logs) — CHỈ Quản trị.
//
// Trang nội bộ cho admin/dev soi hàng đợi bền: sự kiện push Shopee (code 3/4/5)
// và job đối soát tồn (code 100) — tìm theo mã đơn/SKU, lọc theo trạng thái,
// bấm một dòng để xem payload JSON thô mà không phải vào DB tra tay.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCcw, Search } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
  fetchWebhookLogs,
  getToken,
  type ShopeeWebhookLogRow,
  type WebhookLogsResponse,
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type StatusFilter = "" | ShopeeWebhookLogRow["status"];

const STATUS_META: Record<
  ShopeeWebhookLogRow["status"],
  { label: string; className: string }
> = {
  PENDING: { label: "Chờ xử lý", className: "border-slate-200 bg-slate-50 text-slate-600" },
  PROCESSING: { label: "Đang chạy", className: "border-sky-200 bg-sky-50 text-sky-700" },
  VERIFYING: { label: "Đang đối soát", className: "border-amber-200 bg-amber-50 text-amber-700" },
  SUCCESS: { label: "Thành công", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  FAILED: { label: "Thất bại", className: "border-rose-200 bg-rose-50 text-rose-700" },
};

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "", label: "Tất cả" },
  { key: "PENDING", label: "PENDING" },
  { key: "VERIFYING", label: "VERIFYING" },
  { key: "SUCCESS", label: "SUCCESS" },
  { key: "FAILED", label: "FAILED" },
];

/** Nhãn loại job theo eventCode (100 = job đối soát nội bộ, còn lại là push Shopee). */
function eventLabel(code: number): string {
  switch (code) {
    case 3:
      return "Webhook vận chuyển (3)";
    case 4:
      return "Webhook đơn hàng (4)";
    case 5:
      return "Webhook uỷ quyền (5)";
    case 100:
      return "Đối soát tồn kho";
    default:
      return `Webhook (code ${code})`;
  }
}

/** Payload là JSON stringify — in đẹp để dev đọc; hỏng thì trả nguyên văn. */
function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export default function WebhookLogsPage() {
  const router = useRouter();
  const [data, setData] = useState<WebhookLogsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("");
  const [detail, setDetail] = useState<ShopeeWebhookLogRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchWebhookLogs({ q: search, status, limit: 100 }));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return;
      }
      if (err instanceof ApiError && err.status === 409) return; // chưa có kênh
      setError(
        err instanceof ApiError
          ? err.message // gồm cả 403 "Chỉ Quản trị..." cho tài khoản nhân viên
          : "Chưa kết nối được máy chủ (backend). Hãy chắc chắn backend đang chạy ở cổng 4000."
      );
    } finally {
      setLoading(false);
    }
  }, [search, status, router]);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    load();
  }, [load, router]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput.trim());
  }

  const items = data?.items ?? [];
  const counts = data?.counts ?? {};

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-muted-foreground">
            Hàng đợi bền của luồng Shopee: sự kiện webhook và job đối soát tồn
            kho. Bấm vào một dòng để xem payload JSON thô — trang nội bộ dành
            cho Quản trị/kỹ thuật khi cần debug.
          </p>
          <Button variant="outline" onClick={load} disabled={loading}>
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCcw className="size-4" />
            )}
            Tải lại
          </Button>
        </div>

        {/* Tìm kiếm + lọc trạng thái */}
        <div className="flex flex-wrap items-center gap-3">
          <form onSubmit={handleSearch} className="flex max-w-md flex-1 gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Tìm theo mã đơn (order_sn) hoặc mã SKU…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>
            <Button type="submit" variant="secondary">
              Tìm
            </Button>
          </form>
          <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200/80 bg-card p-1">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.key || "all"}
                type="button"
                onClick={() => setStatus(f.key)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  status === f.key
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                )}
              >
                {f.label}
                {f.key && counts[f.key] !== undefined && (
                  <span className="ml-1 text-[10px] opacity-70">
                    {counts[f.key]}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            {error ? (
              <p className="py-10 text-center text-sm text-amber-700">{error}</p>
            ) : loading ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Đang tải dữ liệu…
              </p>
            ) : items.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {search || status
                  ? "Không có bản ghi nào khớp bộ lọc."
                  : "Hàng đợi trống — chưa nhận sự kiện webhook nào."}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Thời gian</TableHead>
                    <TableHead>Loại</TableHead>
                    <TableHead>Mã đơn / SKU</TableHead>
                    <TableHead>Shop ID</TableHead>
                    <TableHead className="text-center">Trạng thái</TableHead>
                    <TableHead className="text-center">Lượt</TableHead>
                    <TableHead>Lỗi gần nhất</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((row) => (
                    <TableRow
                      key={row.id}
                      className="cursor-pointer"
                      onClick={() => setDetail(row)}
                    >
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {formatDateTime(row.createdAt)}
                      </TableCell>
                      <TableCell className="text-sm">{eventLabel(row.eventCode)}</TableCell>
                      <TableCell className="font-mono text-sm">
                        {row.orderSn ?? "—"}
                      </TableCell>
                      <TableCell className="font-mono text-sm text-muted-foreground">
                        {row.shopId || "—"}
                      </TableCell>
                      <TableCell className="text-center">
                        <span
                          className={cn(
                            "inline-flex items-center justify-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                            STATUS_META[row.status].className
                          )}
                        >
                          {STATUS_META[row.status].label}
                        </span>
                      </TableCell>
                      <TableCell className="text-center text-sm">{row.attempts}</TableCell>
                      <TableCell className="max-w-[240px] truncate text-sm text-rose-600">
                        {row.lastError ?? ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Xem nhanh payload JSON thô của một bản ghi */}
      <Dialog open={detail !== null} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="sm:max-w-2xl">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {eventLabel(detail.eventCode)}
                  {detail.orderSn ? ` — ${detail.orderSn}` : ""}
                </DialogTitle>
                <DialogDescription>
                  Nhận lúc {formatDateTime(detail.createdAt)} · {detail.attempts} lượt xử lý
                  {detail.processedAt
                    ? ` · xong lúc ${formatDateTime(detail.processedAt)}`
                    : detail.nextRetryAt
                      ? ` · hẹn lại lúc ${formatDateTime(detail.nextRetryAt)}`
                      : ""}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                    Payload (request)
                  </p>
                  <pre className="max-h-72 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-relaxed">
                    {prettyJson(detail.payload)}
                  </pre>
                </div>
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                    Kết quả xử lý (response/log)
                  </p>
                  <pre
                    className={cn(
                      "max-h-40 overflow-auto rounded-lg border p-3 font-mono text-xs leading-relaxed",
                      detail.lastError
                        ? "border-rose-200 bg-rose-50 text-rose-700"
                        : "border-emerald-200 bg-emerald-50 text-emerald-700"
                    )}
                  >
                    {detail.lastError ??
                      (detail.status === "SUCCESS"
                        ? "Xử lý thành công, không có lỗi."
                        : "Chưa có lỗi ghi nhận.")}
                  </pre>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
