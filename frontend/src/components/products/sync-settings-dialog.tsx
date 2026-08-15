"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  CloudUpload,
  Loader2,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  ApiError,
  fetchSyncLogs,
  fetchSyncPending,
  fetchSyncSettings,
  syncAllStock,
  updateSyncSettings,
  type InventorySyncLog,
} from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

interface SyncSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Báo hub cập nhật chip trạng thái BẬT/TẮT + số job chờ trên header. */
  onStateChange?: (state: { autoSyncEnabled: boolean; pending: number }) => void;
}

/**
 * CÀI ĐẶT ĐỒNG BỘ TỒN KHO — dialog của hub Hàng hóa (thay trang /warehouse/sync
 * cũ): switch tự động (bật phải qua bước xác nhận inline), tồn an toàn mặc
 * định, nút sync tay toàn bộ kèm tiến độ, và nhật ký các lượt đẩy gần nhất.
 */
export function SyncSettingsDialog({
  open,
  onOpenChange,
  onStateChange,
}: SyncSettingsDialogProps) {
  const [loading, setLoading] = useState(true);
  const [autoSync, setAutoSync] = useState(false);
  const [safetyStock, setSafetyStock] = useState("0");
  const [savedSafety, setSavedSafety] = useState(0);
  const [pending, setPending] = useState(0);
  const [saving, setSaving] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  /** Đang chờ người dùng xác nhận BẬT (bước cảnh báo inline). */
  const [confirmingEnable, setConfirmingEnable] = useState(false);

  const [logs, setLogs] = useState<InventorySyncLog[]>([]);

  const notify = useCallback(
    (enabled: boolean, pend: number) =>
      onStateChange?.({ autoSyncEnabled: enabled, pending: pend }),
    [onStateChange]
  );

  const loadLogs = useCallback(async () => {
    try {
      setLogs(await fetchSyncLogs(30));
    } catch {
      // nhật ký rỗng vẫn dùng được phần cấu hình
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setConfirmingEnable(false);
    (async () => {
      setLoading(true);
      try {
        const s = await fetchSyncSettings();
        setAutoSync(s.autoSyncEnabled);
        setSafetyStock(String(s.safetyStockDefault));
        setSavedSafety(s.safetyStockDefault);
        setPending(s.pendingJobs);
        notify(s.autoSyncEnabled, s.pendingJobs);
      } catch (err) {
        toast.error(
          err instanceof ApiError
            ? err.message
            : "Không tải được cấu hình đồng bộ tồn kho"
        );
      } finally {
        setLoading(false);
      }
      loadLogs();
    })();
  }, [open, loadLogs, notify]);

  // Còn job trong hàng đợi → poll tiến độ + tự làm mới nhật ký.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!open || pending <= 0) return;
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetchSyncPending();
        setPending(r.pending);
        notify(autoSync, r.pending);
        loadLogs();
      } catch {
        // lỗi mạng tạm thời — lần poll sau thử lại
      }
    }, 4000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [open, pending, autoSync, loadLogs, notify]);

  async function saveSettings(data: {
    autoSyncEnabled?: boolean;
    safetyStockDefault?: number;
  }) {
    setSaving(true);
    try {
      const r = await updateSyncSettings(data);
      setAutoSync(r.autoSyncEnabled);
      setSavedSafety(r.safetyStockDefault);
      setSafetyStock(String(r.safetyStockDefault));
      const pend = pending + r.queued;
      if (r.queued > 0) {
        setPending(pend);
        toast.success(
          `Đã lưu và xếp ${formatNumber(r.queued)} SKU vào hàng đợi đồng bộ.`,
          { duration: 6000 }
        );
      } else {
        toast.success("Đã lưu cấu hình đồng bộ tồn kho");
      }
      notify(r.autoSyncEnabled, pend);
      setConfirmingEnable(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không lưu được cấu hình");
    } finally {
      setSaving(false);
    }
  }

  function handleToggle(next: boolean) {
    if (next) {
      setConfirmingEnable(true); // bật phải qua cảnh báo — chưa lưu vội
      return;
    }
    setConfirmingEnable(false);
    void saveSettings({ autoSyncEnabled: false });
  }

  function handleSaveSafety() {
    const n = Number(safetyStock);
    if (!Number.isInteger(n) || n < 0) {
      toast.error("Tồn an toàn phải là số nguyên không âm");
      return;
    }
    void saveSettings({ safetyStockDefault: n });
  }

  async function handleSyncAll() {
    setSyncingAll(true);
    try {
      const r = await syncAllStock();
      if (r.queued === 0) {
        toast.info(
          "Chưa có SKU sàn nào liên kết với kho — sang tab Chờ liên kết để nối trước."
        );
      } else {
        const pend = pending + r.queued;
        setPending(pend);
        notify(autoSync, pend);
        toast.success(
          `Đã xếp ${formatNumber(r.queued)} SKU vào hàng đợi — tồn sẽ đẩy dần lên sàn trong ít phút.`,
          { duration: 6000 }
        );
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không sync được");
    } finally {
      setSyncingAll(false);
    }
  }

  const safetyDirty = Number(safetyStock) !== savedSafety;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CloudUpload className="size-5 text-slate-500" />
            Đồng bộ tồn kho lên sàn
          </DialogTitle>
          <DialogDescription>
            Tồn đẩy lên sàn = Tồn kho − Đang giữ cho đơn chưa chốt − Tồn an
            toàn. Áp dụng cho mọi gian Shopee &amp; Lazada đã liên kết SKU.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Đang tải cấu hình…
          </p>
        ) : (
          <div className="space-y-4">
            {/* ===== SWITCH TỰ ĐỘNG ===== */}
            <div className="rounded-lg border p-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">
                    Tự động đồng bộ — {autoSync ? "đang BẬT" : "đang TẮT"}
                  </p>
                  <p className={TEXT_SUB}>
                    Mọi biến động kho (đơn sàn, nhập/xuất tay, hàng hoàn, Excel)
                    tự đẩy tồn mới lên các sàn.
                  </p>
                </div>
                <Switch
                  checked={autoSync || confirmingEnable}
                  onCheckedChange={handleToggle}
                  disabled={saving}
                  aria-label="Bật/tắt tự động đồng bộ tồn kho"
                />
              </div>

              {confirmingEnable && !autoSync && (
                <div className="mt-3 space-y-2 rounded-md bg-amber-50 p-3">
                  <p className="flex items-start gap-1.5 text-sm text-amber-800">
                    <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                    Từ lúc bật, Hubsell GHI ĐÈ tồn sàn theo số kho vật lý và
                    đồng bộ lại toàn bộ SKU ngay một lượt. Kho đang để 0 thì
                    sản phẩm trên sàn cũng về 0 (hết hàng) — kiểm tra tồn đã
                    nhập đúng trước.
                  </p>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirmingEnable(false)}
                      disabled={saving}
                    >
                      Để sau
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => void saveSettings({ autoSyncEnabled: true })}
                      disabled={saving}
                    >
                      {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                      Tôi hiểu, bật đồng bộ
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* ===== TỒN AN TOÀN + SYNC TAY ===== */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg border p-3">
                <p className="text-sm font-medium">Tồn an toàn mặc định</p>
                <p className={cn(TEXT_SUB, "mt-0.5")}>
                  Số giữ lại KHÔNG bán trên sàn cho mọi SKU — đệm chống bán
                  vượt. Đặt riêng từng SKU ở tab Tồn kho.
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    value={safetyStock}
                    onChange={(e) => setSafetyStock(e.target.value)}
                    className="w-24"
                    aria-label="Tồn an toàn mặc định"
                  />
                  <span className={TEXT_SUB}>chiếc/SKU</span>
                  <Button
                    size="sm"
                    onClick={handleSaveSafety}
                    disabled={saving || !safetyDirty}
                  >
                    Lưu
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border p-3">
                <p className="text-sm font-medium">Đẩy lại toàn bộ ngay</p>
                <p className={cn(TEXT_SUB, "mt-0.5")}>
                  Ghi đè tồn hiện tại lên MỌI SKU đã liên kết — dùng sau kiểm
                  kho hoặc khi nghi tồn sàn lệch.
                </p>
                <div className="mt-2 flex items-center gap-3">
                  <Button size="sm" onClick={handleSyncAll} disabled={syncingAll}>
                    {syncingAll ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <RefreshCw className="size-4" />
                    )}
                    Sync ngay toàn bộ
                  </Button>
                  {pending > 0 && (
                    <span className={cn(TEXT_SUB, "flex items-center gap-1.5")}>
                      <Loader2 className="size-3.5 animate-spin" />
                      còn {formatNumber(pending)} SKU
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* ===== NHẬT KÝ GẦN NHẤT ===== */}
            <div className="rounded-lg border">
              <div className="flex items-center justify-between border-b px-3 py-2">
                <p className="text-sm font-medium">Nhật ký đồng bộ gần nhất</p>
                <Button variant="ghost" size="sm" onClick={() => loadLogs()}>
                  <RefreshCw className="size-4" />
                  Làm mới
                </Button>
              </div>
              {logs.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Chưa có lượt đồng bộ nào.
                </p>
              ) : (
                <div className="max-h-64 overflow-y-auto">
                  {logs.map((l) => (
                    <div
                      key={l.id}
                      className="flex items-center gap-2 border-b px-3 py-2 text-sm last:border-b-0"
                    >
                      {l.status === "SUCCESS" ? (
                        <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
                      ) : (
                        <XCircle className="size-4 shrink-0 text-red-600" />
                      )}
                      <span className="font-mono text-xs">{l.channelSku}</span>
                      <span className={TEXT_SUB}>{l.shopName}</span>
                      <span className="ml-auto whitespace-nowrap tabular-nums">
                        {formatNumber(l.oldQuantity)} → {formatNumber(l.newQuantity)}
                      </span>
                      <span className={cn(TEXT_SUB, "whitespace-nowrap")}>
                        {new Date(l.createdAt).toLocaleTimeString("vi-VN", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
