"use client";

// ============================================================
// CẢNH BÁO LỆCH TỒN (Inventory Sync Alert)
//
// Hiện trên trang Kho hàng khi có lượt đẩy tồn kho lên sàn THẤT BẠI sau khi đã
// tự retry đủ số lần — nghĩa là tồn trên sàn ĐANG SAI so với Hubsell, chủ shop
// phải chỉnh tay trên Seller Center kẻo bán vượt/bị sàn phạt vì hết hàng ảo.
// Không có cảnh báo nào thì component không render gì (đường yên tĩnh).
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  ApiError,
  fetchSyncAlerts,
  resolveSyncAlert,
  type InventorySyncAlert,
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";

export function SyncAlertBanner() {
  const [alerts, setAlerts] = useState<InventorySyncAlert[]>([]);
  const [resolving, setResolving] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setAlerts(await fetchSyncAlerts());
    } catch (err) {
      // Trang Kho vẫn phải dùng được khi API cảnh báo lỗi — chỉ im lặng bỏ qua
      // (401/409 đã có overlay/redirect của trang xử lý).
      if (err instanceof ApiError) return;
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleResolve(alert: InventorySyncAlert) {
    setResolving(alert.id);
    try {
      await resolveSyncAlert(alert.id);
      setAlerts((prev) => prev.filter((a) => a.id !== alert.id));
      toast.success("Đã đánh dấu cảnh báo là xử lý xong");
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Không cập nhật được cảnh báo"
      );
    } finally {
      setResolving(null);
    }
  }

  if (alerts.length === 0) return null;

  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-4">
      <div className="flex items-center gap-2 text-rose-800">
        <AlertTriangle className="size-4 shrink-0" />
        <p className="text-sm font-semibold">
          Lệch tồn kho với sàn — {alerts.length} cảnh báo cần xử lý tay
        </p>
      </div>
      <ul className="mt-3 space-y-2">
        {alerts.map((alert) => (
          <li
            key={alert.id}
            className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-rose-100 bg-white p-3"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm text-slate-800">{alert.message}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {alert.shopName}
                {alert.channelSku ? ` · SKU ${alert.channelSku}` : ""}
                {alert.orderSn ? ` · Đơn ${alert.orderSn}` : ""} ·{" "}
                {formatDateTime(alert.createdAt)}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={resolving === alert.id}
              onClick={() => handleResolve(alert)}
            >
              {resolving === alert.id ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Check className="size-4" />
              )}
              Đã xử lý
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
