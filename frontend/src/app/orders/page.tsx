"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  PackageOpen,
  Pencil,
} from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  fetchChannels,
  fetchOrders,
  getToken,
  updateOrderStatus,
  type Channel,
  type Order,
} from "@/lib/api";
import { exportAllOrders } from "@/lib/excel";
import { CHANNEL_META } from "@/lib/channel-meta";
import { formatVND, formatNumber, formatDateTime } from "@/lib/format";

const PAGE_SIZE = 20;

const STATUS_META: Record<string, { label: string; className: string }> = {
  PENDING: { label: "Chờ xử lý", className: "bg-zinc-100 text-zinc-600 border-zinc-200" },
  SHIPPING: { label: "Đang giao", className: "bg-sky-100 text-sky-700 border-sky-200" },
  DELIVERED: { label: "Đã giao", className: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  CANCELLED: { label: "Đã hủy", className: "bg-rose-100 text-rose-700 border-rose-200" },
};

const PAYMENT_META: Record<string, { label: string; className: string }> = {
  PAID: { label: "Đã thanh toán", className: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  UNPAID: { label: "Chưa thanh toán", className: "bg-amber-100 text-amber-700 border-amber-200" },
  REFUNDED: { label: "Đã hoàn tiền", className: "bg-rose-100 text-rose-700 border-rose-200" },
};

function MetaBadge({
  meta,
  fallback,
}: {
  meta?: { label: string; className: string };
  fallback: string;
}) {
  if (!meta) return <Badge variant="outline">{fallback}</Badge>;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta.className}`}
    >
      {meta.label}
    </span>
  );
}

// ---------- Dialog cập nhật trạng thái ----------

function UpdateStatusDialog({
  order,
  open,
  onOpenChange,
  onDone,
}: {
  order: Order;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const [newStatus, setNewStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Các trạng thái có thể chuyển tới (trừ trạng thái hiện tại)
  const options = ["PENDING", "SHIPPING", "DELIVERED", "CANCELLED"].filter(
    (s) => s !== order.shippingStatus
  );

  useEffect(() => {
    if (open) setNewStatus(options[0] ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order.id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newStatus) return;
    setSubmitting(true);
    try {
      const res = await updateOrderStatus(order.id, newStatus);
      if (newStatus === "CANCELLED" && res.restored.length > 0) {
        toast.success(
          `Đã hủy đơn ${order.orderCode}. Hoàn kho: ${res.restored
            .map((r) => `${r.productName} +${r.restoredQuantity} (còn ${r.newQuantity})`)
            .join("; ")}`,
          { duration: 7000 }
        );
      } else if (newStatus === "CANCELLED") {
        toast.success(
          `Đã hủy đơn ${order.orderCode}. (Đơn này không có log trừ kho nên không cần hoàn kho.)`,
          { duration: 6000 }
        );
      } else {
        toast.success(
          `Đơn ${order.orderCode} → ${STATUS_META[newStatus]?.label ?? newStatus}`
        );
      }
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không kết nối được máy chủ");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Cập nhật trạng thái đơn {order.orderCode}</DialogTitle>
          <DialogDescription>
            Trạng thái hiện tại:{" "}
            {STATUS_META[order.shippingStatus]?.label ?? order.shippingStatus} ·
            Khách: {order.customerName}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="new-status">Chuyển sang trạng thái</Label>
            <NativeSelect
              id="new-status"
              value={newStatus}
              onChange={(e) => setNewStatus(e.target.value)}
            >
              {options.map((s) => (
                <option key={s} value={s}>
                  {STATUS_META[s]?.label ?? s}
                </option>
              ))}
            </NativeSelect>
          </div>

          {newStatus === "CANCELLED" && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <p>
                Hủy đơn sẽ <b>tự động cộng hoàn lại tồn kho</b> cho các sản phẩm
                gốc mà đơn này đã trừ, và ghi vào lịch sử kho. Đơn đã hủy không
                thể đổi trạng thái nữa.
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Đóng
            </Button>
            <Button
              type="submit"
              disabled={submitting || !newStatus}
              className={
                newStatus === "CANCELLED" ? "bg-rose-600 hover:bg-rose-700" : ""
              }
            >
              {submitting && <Loader2 className="size-4 animate-spin" />}
              Xác nhận
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Trang chính ----------

export default function OrdersPage() {
  const router = useRouter();

  const [items, setItems] = useState<Order[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [total, setTotal] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [channelFilter, setChannelFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [editing, setEditing] = useState<Order | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchOrders({
        page,
        pageSize: PAGE_SIZE,
        shippingStatus: statusFilter || undefined,
        channelId: channelFilter || undefined,
      });
      setItems(res.items);
      setTotal(res.total);
      setPageCount(res.pageCount);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return;
      }
      if (err instanceof ApiError && err.status === 409) return; // chưa có kênh — overlay xử lý
      toast.error("Không tải được danh sách đơn hàng");
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, channelFilter, router]);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    fetchChannels()
      .then(setChannels)
      .catch(() => {});
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleExport() {
    setExporting(true);
    try {
      const count = await exportAllOrders({
        shippingStatus: statusFilter || undefined,
        channelId: channelFilter || undefined,
      });
      if (count === 0) {
        toast.info("Không có đơn hàng nào (theo bộ lọc) để xuất");
      } else {
        toast.success(`Đã xuất ${count} đơn hàng ra file Excel`);
      }
    } catch {
      toast.error("Không xuất được file Excel");
    } finally {
      setExporting(false);
    }
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-muted-foreground">
            Toàn bộ đơn hàng gom về từ tất cả các kênh ({formatNumber(total)} đơn).
          </p>
          <Button variant="outline" onClick={handleExport} disabled={exporting}>
            {exporting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            Xuất Excel Đơn Hàng
          </Button>
        </div>

        {/* Bộ lọc */}
        <div className="flex flex-wrap items-end gap-4">
          <div className="grid w-44 gap-1.5">
            <Label htmlFor="filter-status" className="text-xs text-muted-foreground">
              Trạng thái vận chuyển
            </Label>
            <NativeSelect
              id="filter-status"
              value={statusFilter}
              onChange={(e) => {
                setPage(1);
                setStatusFilter(e.target.value);
              }}
            >
              <option value="">Tất cả trạng thái</option>
              <option value="PENDING">Chờ xử lý</option>
              <option value="SHIPPING">Đang giao</option>
              <option value="DELIVERED">Đã giao</option>
              <option value="CANCELLED">Đã hủy</option>
            </NativeSelect>
          </div>
          <div className="grid w-44 gap-1.5">
            <Label htmlFor="filter-channel" className="text-xs text-muted-foreground">
              Kênh bán hàng
            </Label>
            <NativeSelect
              id="filter-channel"
              value={channelFilter}
              onChange={(e) => {
                setPage(1);
                setChannelFilter(e.target.value);
              }}
            >
              <option value="">Tất cả kênh</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {CHANNEL_META[c.channelName].label}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            {loading ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Đang tải dữ liệu…
              </p>
            ) : items.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                <PackageOpen className="mx-auto mb-2 size-8" />
                Không có đơn hàng nào khớp bộ lọc.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mã đơn</TableHead>
                    <TableHead>Khách hàng</TableHead>
                    <TableHead>Kênh</TableHead>
                    <TableHead>Thanh toán</TableHead>
                    <TableHead>Vận chuyển</TableHead>
                    <TableHead className="text-right">Tổng tiền</TableHead>
                    <TableHead className="text-right">Thời gian</TableHead>
                    <TableHead className="text-center">Thao tác</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="font-medium">{o.orderCode}</TableCell>
                      <TableCell>{o.customerName}</TableCell>
                      <TableCell>
                        <MetaBadge
                          meta={CHANNEL_META[o.channel.channelName]}
                          fallback={o.channel.channelName}
                        />
                      </TableCell>
                      <TableCell>
                        <MetaBadge
                          meta={PAYMENT_META[o.paymentStatus]}
                          fallback={o.paymentStatus}
                        />
                      </TableCell>
                      <TableCell>
                        <MetaBadge
                          meta={STATUS_META[o.shippingStatus]}
                          fallback={o.shippingStatus}
                        />
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatVND(o.totalAmount)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {formatDateTime(o.createdAt)}
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={o.shippingStatus === "CANCELLED"}
                          onClick={() => setEditing(o)}
                        >
                          <Pencil className="size-3.5" />
                          Cập nhật trạng thái
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
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
          Hubsell · Giai đoạn 4 — Quản lý đơn hàng tập trung
        </p>
      </div>

      {editing && (
        <UpdateStatusDialog
          order={editing}
          open={true}
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
          onDone={load}
        />
      )}
    </AppShell>
  );
}
