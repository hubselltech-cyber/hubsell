"use client";

// ============================================================
// CẢNH BÁO LỆCH TỒN (Inventory Sync Alert)
//
// Hiện trên hub Hàng hóa khi có lượt đẩy tồn lên sàn THẤT BẠI sau khi đã tự
// retry đủ số lần. Anh Trung 05/09: "nói đơn giản là phải làm gì thôi" — mỗi
// thẻ: dòng 1 = việc cần làm (backend đã dịch ra tiếng người), chi tiết kỹ
// thuật gập lại; hai nút: [Đẩy lại] (Hubsell đè số chuẩn lên sàn ngay) và
// [Đã xử lý] (bỏ qua). Nhiều cảnh báo cùng nguyên nhân → [Đã xử lý tất cả].
// Không có cảnh báo nào thì component không render gì (đường yên tĩnh).
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, ChevronDown, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  ApiError,
  fetchSyncAlerts,
  forceSyncStockAlert,
  resolveAllSyncAlerts,
  resolveSyncAlert,
  type InventorySyncAlert,
} from "@/lib/api";
import { formatDateTime, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const SHOW_LIMIT = 8;

export function SyncAlertBanner() {
  const [alerts, setAlerts] = useState<InventorySyncAlert[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [resolvingAll, setResolvingAll] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [detailOpen, setDetailOpen] = useState<Record<string, boolean>>({});

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
    setBusy(alert.id);
    try {
      await resolveSyncAlert(alert.id);
      setAlerts((prev) => prev.filter((a) => a.id !== alert.id));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không cập nhật được cảnh báo");
    } finally {
      setBusy(null);
    }
  }

  async function handleRepush(alert: InventorySyncAlert) {
    setBusy(alert.id);
    try {
      const r = await forceSyncStockAlert(alert.id);
      setAlerts((prev) => prev.filter((a) => a.id !== alert.id));
      toast.success(
        `Đã đẩy ${formatNumber(r.applied)} lên sàn cho SKU ${alert.channelSku ?? ""} — cảnh báo tự đóng.`
      );
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Đẩy lại chưa được — thử lại sau ít phút");
    } finally {
      setBusy(null);
    }
  }

  async function handleResolveAll() {
    setResolvingAll(true);
    try {
      const r = await resolveAllSyncAlerts();
      setAlerts([]);
      toast.success(`Đã bỏ qua ${formatNumber(r.resolved)} cảnh báo.`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không cập nhật được cảnh báo");
    } finally {
      setResolvingAll(false);
    }
  }

  if (alerts.length === 0) return null;

  const visible = showAll ? alerts : alerts.slice(0, SHOW_LIMIT);

  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-4">
      <div className="flex flex-wrap items-center gap-2 text-rose-800">
        <AlertTriangle className="size-4 shrink-0" />
        <p className="text-sm font-semibold">
          {alerts.length === 1
            ? "1 SKU chưa đẩy được tồn lên sàn"
            : `${formatNumber(alerts.length)} SKU chưa đẩy được tồn lên sàn`}
        </p>
        <span className="text-xs text-rose-700/80">
          — số trên sàn có thể đang khác Hubsell. Bấm Đẩy lại, hoặc Đã xử lý để bỏ qua.
        </span>
        {alerts.length > 1 && (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => void handleResolveAll()}
            disabled={resolvingAll}
          >
            {resolvingAll ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Đã xử lý tất cả
          </Button>
        )}
      </div>
      <ul className="mt-3 space-y-2">
        {visible.map((alert) => {
          const [plain, ...rest] = alert.message.split("\n");
          const detail = rest.join("\n").trim();
          const open = detailOpen[alert.id] ?? false;
          return (
            <li
              key={alert.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-rose-100 bg-card p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-800">{plain}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {alert.shopName}
                  {alert.channelSku ? ` · SKU ${alert.channelSku}` : ""}
                  {alert.hubsellAvailable !== null
                    ? ` · Hubsell muốn ${formatNumber(alert.hubsellAvailable)}`
                    : ""}
                  {alert.orderSn ? ` · Đơn ${alert.orderSn}` : ""} · {formatDateTime(alert.createdAt)}
                  {detail && (
                    <button
                      type="button"
                      className="ml-2 inline-flex items-center gap-0.5 underline-offset-2 hover:underline"
                      onClick={() =>
                        setDetailOpen((prev) => ({ ...prev, [alert.id]: !open }))
                      }
                    >
                      chi tiết kỹ thuật
                      <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
                    </button>
                  )}
                </p>
                {open && detail && (
                  <p className="mt-1 break-all rounded bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground">
                    {detail}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                {alert.channelSku && (
                  <Button
                    size="sm"
                    disabled={busy === alert.id}
                    onClick={() => void handleRepush(alert)}
                    title="Hubsell đè số Có thể bán chuẩn lên sàn ngay cho SKU này"
                  >
                    {busy === alert.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <RefreshCw className="size-4" />
                    )}
                    Đẩy lại
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy === alert.id}
                  onClick={() => void handleResolve(alert)}
                >
                  <Check className="size-4" />
                  Đã xử lý
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      {alerts.length > SHOW_LIMIT && (
        <button
          type="button"
          className="mt-2 text-xs text-rose-800 underline-offset-2 hover:underline"
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? "Thu gọn" : `Xem thêm ${formatNumber(alerts.length - SHOW_LIMIT)} cảnh báo`}
        </button>
      )}
    </div>
  );
}
