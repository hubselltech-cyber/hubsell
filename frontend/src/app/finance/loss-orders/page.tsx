"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  PackageX,
  Receipt,
  RefreshCw,
  TrendingDown,
} from "lucide-react";

import { AccessDenied } from "@/components/access-denied";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  fetchLossOrders,
  getStoredUser,
  getToken,
  type ChannelName,
  type LossOrder,
} from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { formatVND, formatNumber, formatDateTime } from "@/lib/format";

export default function LossOrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<LossOrder[]>([]);
  const [analyzedCount, setAnalyzedCount] = useState(0);
  const [lossCount, setLossCount] = useState(0);
  const [warningCount, setWarningCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchLossOrders();
      setOrders(res.orders);
      setAnalyzedCount(res.analyzedCount);
      setLossCount(res.lossCount);
      setWarningCount(res.warningCount);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return;
      }
      if (err instanceof ApiError && err.status === 403) {
        setDenied(true);
        return;
      }
      // 409 (chưa có kênh) — AppShell overlay xử lý
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    if (getStoredUser()?.role === "STAFF") {
      setDenied(true);
      setLoading(false);
      return;
    }
    load();
  }, [load, router]);

  if (denied) {
    return (
      <AppShell>
        <AccessDenied />
      </AppShell>
    );
  }

  const totalLoss = orders
    .filter((o) => o.isLoss)
    .reduce((s, o) => s + o.profit, 0);

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-muted-foreground">
            Quét {formatNumber(analyzedCount)} đơn <b>Đã giao</b> — phát hiện đơn có
            Doanh thu ≤ Giá vốn để chủ shop đối soát.
          </p>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
            Quét lại
          </Button>
        </div>

        {/* Thẻ cảnh báo tổng */}
        {!loading && (lossCount > 0 || warningCount > 0) && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {lossCount > 0 && (
              <Card className="border-rose-300 bg-rose-50/60">
                <CardContent className="flex items-center gap-4 p-5">
                  <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-700">
                    <TrendingDown className="size-6" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-rose-800">
                      Phát hiện {formatNumber(lossCount)} đơn hàng bán lỗ
                    </p>
                    <p className="text-xl font-bold leading-tight text-rose-700 break-words">
                      {formatVND(totalLoss)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Tổng số tiền lỗ từ các đơn này.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
            {warningCount > 0 && (
              <Card className="border-amber-300 bg-amber-50/70">
                <CardContent className="flex items-center gap-4 p-5">
                  <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                    <AlertTriangle className="size-6" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-amber-800">
                      {formatNumber(warningCount)} đơn chưa cấu hình giá vốn
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Số liệu lãi/lỗ của các đơn này chưa chính xác. Vào{" "}
                      <Link
                        href="/finance/cost-prices"
                        className="font-medium text-primary hover:underline"
                      >
                        Cấu hình Giá vốn
                      </Link>{" "}
                      để nhập.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        <Card>
          <CardContent className="p-0">
            {loading ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Đang quét đơn hàng…
              </p>
            ) : orders.length === 0 ? (
              <div className="py-12 text-center">
                <CheckCircle2 className="mx-auto mb-3 size-10 text-emerald-500" />
                <p className="font-medium text-emerald-700">
                  Tuyệt vời! Không có đơn hàng nào bị lỗ.
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Tất cả {formatNumber(analyzedCount)} đơn Đã giao đều có lãi.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mã đơn</TableHead>
                    <TableHead>Khách hàng</TableHead>
                    <TableHead>Kênh</TableHead>
                    <TableHead className="text-right">Doanh thu</TableHead>
                    <TableHead className="text-right">Phí sàn</TableHead>
                    <TableHead className="text-right">Giá vốn</TableHead>
                    <TableHead className="text-right">Lãi / Lỗ</TableHead>
                    <TableHead className="text-right">Thời gian</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((o) => {
                    const meta = CHANNEL_META[o.channelName as ChannelName];
                    return (
                      <TableRow key={o.id}>
                        <TableCell className="font-medium">
                          <span className="flex items-center gap-1.5">
                            {o.isLoss && (
                              <AlertTriangle className="size-4 shrink-0 text-rose-500" />
                            )}
                            {o.orderCode}
                          </span>
                          {/* Nhãn bóc tách LÝ DO LỖ */}
                          {o.lossReason === "COST" && (
                            <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-rose-300 bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-800">
                              <PackageX className="size-3" />
                              Lỗ do Giá vốn
                            </span>
                          )}
                          {o.lossReason === "FEE" && (
                            <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-orange-300 bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800">
                              <Receipt className="size-3" />
                              Lỗ do Chi phí sàn
                            </span>
                          )}
                          {o.warning && (
                            <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                              <AlertTriangle className="size-3" />
                              Chưa cấu hình giá vốn
                            </span>
                          )}
                        </TableCell>
                        <TableCell>{o.customerName}</TableCell>
                        <TableCell>
                          {meta ? (
                            <span
                              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta.className}`}
                            >
                              {meta.label}
                            </span>
                          ) : (
                            <Badge variant="outline">{o.channelName}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatVND(o.revenue)}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {o.platformFee > 0 ? `− ${formatVND(o.platformFee)}` : "—"}
                          <span className="block text-xs">
                            {o.isSettled ? "(quyết toán)" : "(tạm tính)"}
                          </span>
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {formatVND(o.cost)}
                        </TableCell>
                        <TableCell
                          className={`text-right text-base font-bold ${
                            o.isLoss ? "text-rose-600" : "text-emerald-600"
                          }`}
                        >
                          {formatVND(o.profit)}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {formatDateTime(o.createdAt)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Hubsell Finance · Cảnh báo đơn lỗ — giá vốn lấy theo snapshot tại thời
          điểm bán (costPriceAtSale)
        </p>
      </div>
    </AppShell>
  );
}
