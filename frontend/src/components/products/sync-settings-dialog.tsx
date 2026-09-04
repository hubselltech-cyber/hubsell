"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  CloudUpload,
  Loader2,
  RefreshCw,
  ScanSearch,
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
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import {
  ApiError,
  fetchSyncLogs,
  fetchSyncPending,
  fetchSyncSettings,
  previewChannelSync,
  reconcileChannelSync,
  setChannelSyncEnabled,
  syncAllStock,
  updateSyncSettings,
  type InitialStockMode,
  type InventorySyncLog,
  type SyncChannel,
  type SyncPreview,
} from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { formatNumber } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

export interface SyncHeaderState {
  /** Số gian đang bật / tổng gian Shopee+Lazada đang hoạt động. */
  enabledCount: number;
  totalChannels: number;
  pending: number;
}

interface SyncSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Báo hub cập nhật chip trạng thái + số job chờ trên header. */
  onStateChange?: (state: SyncHeaderState) => void;
}

const INITIAL_MODE_LABEL: Record<InitialStockMode, string> = {
  SUM: "Cộng tồn mọi gian (mỗi gian một phần hàng riêng)",
  MAX: "Lấy số lớn nhất một gian (các gian cùng bán một lô hàng)",
  NONE: "Không gieo — tôi tự nhập tồn rồi bấm Sync",
};

function fmtTime(iso: string | null | undefined) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * CÀI ĐẶT ĐỒNG BỘ TỒN KHO — theo TỪNG GIAN (mô hình trung tâm điều tiết):
 * gạt công tắc một gian → Hubsell đọc tồn thật trên sàn, đặt cạnh số "Có thể
 * bán" sẽ đẩy để chủ shop duyệt từng SKU rồi mới bật. Kèm tồn an toàn mặc
 * định, cách gieo tồn ban đầu, nút đẩy lại toàn bộ và nhật ký.
 */
export function SyncSettingsDialog({
  open,
  onOpenChange,
  onStateChange,
}: SyncSettingsDialogProps) {
  const [loading, setLoading] = useState(true);
  const [channels, setChannels] = useState<SyncChannel[]>([]);
  const [safetyStock, setSafetyStock] = useState("0");
  const [savedSafety, setSavedSafety] = useState(0);
  const [lowStock, setLowStock] = useState("0");
  const [savedLowStock, setSavedLowStock] = useState(0);
  const [initialMode, setInitialMode] = useState<InitialStockMode>("SUM");
  const [pending, setPending] = useState(0);
  const [saving, setSaving] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [reconcilingId, setReconcilingId] = useState<string | null>(null);

  // Màn so sánh của gian đang chờ bật.
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [preview, setPreview] = useState<SyncPreview | "loading" | null>(null);
  const [enabling, setEnabling] = useState(false);

  const [logs, setLogs] = useState<InventorySyncLog[]>([]);

  const notify = useCallback(
    (chs: SyncChannel[], pend: number) =>
      onStateChange?.({
        enabledCount: chs.filter((c) => c.stockSyncEnabled).length,
        totalChannels: chs.length,
        pending: pend,
      }),
    [onStateChange]
  );

  const loadLogs = useCallback(async () => {
    try {
      setLogs(await fetchSyncLogs(30));
    } catch {
      // nhật ký rỗng vẫn dùng được phần cấu hình
    }
  }, []);

  const loadSettings = useCallback(async () => {
    const s = await fetchSyncSettings();
    setChannels(s.channels);
    setSafetyStock(String(s.safetyStockDefault));
    setSavedSafety(s.safetyStockDefault);
    setLowStock(String(s.lowStockDefault));
    setSavedLowStock(s.lowStockDefault);
    setInitialMode(s.initialStockMode);
    setPending(s.pendingJobs);
    notify(s.channels, s.pendingJobs);
  }, [notify]);

  useEffect(() => {
    if (!open) return;
    setPreviewId(null);
    setPreview(null);
    (async () => {
      setLoading(true);
      try {
        await loadSettings();
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
  }, [open, loadSettings, loadLogs]);

  // Còn job trong hàng đợi → poll tiến độ + tự làm mới nhật ký.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!open || pending <= 0) return;
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetchSyncPending();
        setPending(r.pending);
        notify(channels, r.pending);
        loadLogs();
      } catch {
        // lỗi mạng tạm thời — lần poll sau thử lại
      }
    }, 4000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [open, pending, channels, loadLogs, notify]);

  // ---------- Bật / tắt theo gian ----------

  async function openPreview(channel: SyncChannel) {
    setPreviewId(channel.id);
    setPreview("loading");
    try {
      setPreview(await previewChannelSync(channel.id));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không đọc được tồn từ sàn");
      setPreviewId(null);
      setPreview(null);
    }
  }

  function closePreview() {
    setPreviewId(null);
    setPreview(null);
  }

  async function confirmEnable(channel: SyncChannel) {
    setEnabling(true);
    try {
      const r = await setChannelSyncEnabled(channel.id, true);
      const next = channels.map((c) =>
        c.id === channel.id
          ? { ...c, stockSyncEnabled: true, stockSyncEnabledAt: new Date().toISOString() }
          : c
      );
      setChannels(next);
      const pend = pending + r.queued;
      setPending(pend);
      notify(next, pend);
      toast.success(
        `Đã bật đồng bộ cho "${channel.shopName}" — ${formatNumber(r.queued)} SKU đang được đẩy về khớp Hubsell.`,
        { duration: 6000 }
      );
      closePreview();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không bật được đồng bộ");
    } finally {
      setEnabling(false);
    }
  }

  async function disable(channel: SyncChannel) {
    setSaving(true);
    try {
      await setChannelSyncEnabled(channel.id, false);
      const next = channels.map((c) =>
        c.id === channel.id ? { ...c, stockSyncEnabled: false } : c
      );
      setChannels(next);
      notify(next, pending);
      toast.success(`Đã tắt đồng bộ cho "${channel.shopName}".`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không tắt được đồng bộ");
    } finally {
      setSaving(false);
    }
  }

  function handleToggle(channel: SyncChannel, next: boolean) {
    if (next) {
      void openPreview(channel); // bật phải qua màn so sánh — chưa lưu vội
      return;
    }
    if (previewId === channel.id) {
      closePreview();
      return;
    }
    void disable(channel);
  }

  async function handleReconcile(channel: SyncChannel) {
    setReconcilingId(channel.id);
    try {
      const r = await reconcileChannelSync(channel.id);
      setChannels((prev) =>
        prev.map((c) =>
          c.id === channel.id
            ? {
                ...c,
                lastReconcileAt: new Date().toISOString(),
                lastReconcileMismatch: r.mismatched,
              }
            : c
        )
      );
      if (r.mismatched === 0) {
        toast.success(
          `"${channel.shopName}": ${formatNumber(r.scanned)} SKU khớp hoàn toàn với Hubsell.`
        );
      } else {
        const pend = pending + r.queued;
        setPending(pend);
        notify(channels, pend);
        toast.warning(
          `"${channel.shopName}": ${formatNumber(r.mismatched)}/${formatNumber(r.scanned)} SKU lệch — ${
            r.queued > 0 ? "đã xếp đẩy lại số đúng." : "gian đang tắt nên không đẩy."
          }`,
          { duration: 7000 }
        );
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không đối soát được");
    } finally {
      setReconcilingId(null);
    }
  }

  // ---------- Cấu hình chung ----------

  async function saveSettings(data: {
    safetyStockDefault?: number;
    initialStockMode?: InitialStockMode;
    lowStockDefault?: number;
  }) {
    setSaving(true);
    try {
      const r = await updateSyncSettings(data);
      setSavedSafety(r.safetyStockDefault);
      setSafetyStock(String(r.safetyStockDefault));
      setSavedLowStock(r.lowStockDefault);
      setLowStock(String(r.lowStockDefault));
      setInitialMode(r.initialStockMode);
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
      notify(channels, pend);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không lưu được cấu hình");
    } finally {
      setSaving(false);
    }
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
        notify(channels, pend);
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

  function handleSaveLowStock() {
    const n = Number(lowStock);
    if (!Number.isInteger(n) || n < 0) {
      toast.error("Ngưỡng cảnh báo phải là số nguyên không âm (0 = tắt)");
      return;
    }
    void saveSettings({ lowStockDefault: n });
  }

  const safetyDirty = Number(safetyStock) !== savedSafety;
  const lowStockDirty = Number(lowStock) !== savedLowStock;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-[min(52rem,calc(100%-2rem))]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CloudUpload className="size-5 text-slate-500" />
            Đồng bộ tồn kho lên sàn
          </DialogTitle>
          <DialogDescription>
            Hubsell là trung tâm điều tiết: một SKU kho nối nhiều gian, mọi gian
            luôn hiện cùng một số <b>Có thể bán</b> = Tồn − Đang giữ − Tồn an
            toàn. Gian nào bán, mọi gian còn lại và kho cùng trừ. Bật riêng từng
            gian sau khi duyệt màn so sánh.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Đang tải cấu hình…
          </p>
        ) : (
          <div className="space-y-4">
            {/* ===== GIAN HÀNG ===== */}
            <div className="rounded-lg border">
              <div className="flex items-center justify-between border-b px-3 py-2">
                <p className="text-sm">Gian hàng đang nối</p>
                {pending > 0 && (
                  <span className={cn(TEXT_SUB, "flex items-center gap-1.5")}>
                    <Loader2 className="size-3.5 animate-spin" />
                    còn {formatNumber(pending)} SKU đang đẩy
                  </span>
                )}
              </div>
              {channels.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Chưa có gian Shopee/Lazada nào đang hoạt động — kết nối gian ở
                  mục Kênh bán hàng trước.
                </p>
              ) : (
                channels.map((c) => {
                  const meta = CHANNEL_META[c.channelName];
                  const isPreviewing = previewId === c.id;
                  return (
                    <div key={c.id} className="border-b last:border-b-0">
                      <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${meta?.className ?? ""}`}
                        >
                          {meta?.label ?? c.channelName}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm">{c.shopName}</p>
                          <p className={TEXT_SUB}>
                            {formatNumber(c.linkedCount)} SKU đã nối
                            {c.stockSyncEnabled && c.stockSyncEnabledAt
                              ? ` · bật từ ${fmtTime(c.stockSyncEnabledAt)}`
                              : ""}
                            {c.lastReconcileAt
                              ? ` · đối soát ${fmtTime(c.lastReconcileAt)}: ${
                                  c.lastReconcileMismatch
                                    ? `${formatNumber(c.lastReconcileMismatch)} SKU lệch, đã sửa`
                                    : "khớp hết"
                                }`
                              : ""}
                          </p>
                        </div>
                        {c.stockSyncEnabled && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void handleReconcile(c)}
                            disabled={reconcilingId === c.id}
                            title="Đọc tồn thật trên sàn, SKU lệch thì đẩy lại ngay"
                          >
                            {reconcilingId === c.id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <ScanSearch className="size-4" />
                            )}
                            Đối soát ngay
                          </Button>
                        )}
                        <span
                          className={cn(
                            "text-xs font-medium",
                            c.stockSyncEnabled ? "text-emerald-700" : "text-muted-foreground"
                          )}
                        >
                          {c.stockSyncEnabled ? "BẬT" : "TẮT"}
                        </span>
                        <Switch
                          checked={c.stockSyncEnabled || isPreviewing}
                          onCheckedChange={(v) => handleToggle(c, v)}
                          disabled={saving || enabling || !c.connected}
                          aria-label={`Bật/tắt đồng bộ tồn cho ${c.shopName}`}
                        />
                      </div>

                      {isPreviewing && (
                        <PreviewPanel
                          channel={c}
                          preview={preview}
                          enabling={enabling}
                          onCancel={closePreview}
                          onConfirm={() => void confirmEnable(c)}
                        />
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* ===== TỒN AN TOÀN + SYNC TAY ===== */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg border p-3">
                <p className="text-sm">Tồn an toàn mặc định</p>
                <p className={cn(TEXT_SUB, "mt-0.5")}>
                  Số giữ lại KHÔNG bán trên sàn cho mọi SKU — đệm chống bán
                  vượt khi nhiều gian nổ đơn sát nhau. Đặt riêng từng SKU ở tab
                  Tồn kho.
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
                <p className="text-sm">Đẩy lại toàn bộ ngay</p>
                <p className={cn(TEXT_SUB, "mt-0.5")}>
                  Ghi đè Có thể bán lên MỌI SKU đã nối của MỌI gian (kể cả gian
                  đang tắt) — dùng sau kiểm kho hoặc khi nghi tồn sàn lệch.
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
                </div>
              </div>
            </div>

            {/* ===== NGƯỠNG CẢNH BÁO SẮP HẾT HÀNG ===== */}
            <div className="rounded-lg border p-3">
              <p className="text-sm">Ngưỡng cảnh báo sắp hết hàng (mặc định)</p>
              <p className={cn(TEXT_SUB, "mt-0.5")}>
                Tồn khả dụng (tồn − đang giữ) của SKU rơi xuống ≤ số này là báo
                chuông và đẩy thẻ lên Trung tâm điều hành; nhập kho vượt ngưỡng
                thì thẻ tự đóng. Đặt riêng từng SKU bằng nút chuông ở tab Tồn kho.
                0 = tắt.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={lowStock}
                  onChange={(e) => setLowStock(e.target.value)}
                  className="w-24"
                  aria-label="Ngưỡng cảnh báo sắp hết hàng mặc định"
                />
                <span className={TEXT_SUB}>chiếc/SKU</span>
                <Button
                  size="sm"
                  onClick={handleSaveLowStock}
                  disabled={saving || !lowStockDirty}
                >
                  Lưu
                </Button>
              </div>
            </div>

            {/* ===== GIEO TỒN BAN ĐẦU ===== */}
            <div className="rounded-lg border p-3">
              <p className="text-sm">Tồn ban đầu khi nối SKU sàn vào SKU kho đang tồn 0</p>
              <p className={cn(TEXT_SUB, "mt-0.5")}>
                Chỉ áp cho SKU kho chưa nhập tồn. Nếu các gian đang cùng niêm yết
                MỘT lô hàng thì cộng tổng sẽ đếm trùng rồi đẩy số ảo lên mọi gian
                — chọn “lớn nhất một gian”.
              </p>
              <NativeSelect
                className="mt-2 max-w-md"
                value={initialMode}
                onChange={(e) =>
                  void saveSettings({ initialStockMode: e.target.value as InitialStockMode })
                }
                disabled={saving}
                aria-label="Cách gieo tồn ban đầu"
              >
                {(Object.keys(INITIAL_MODE_LABEL) as InitialStockMode[]).map((m) => (
                  <option key={m} value={m}>
                    {INITIAL_MODE_LABEL[m]}
                  </option>
                ))}
              </NativeSelect>
            </div>

            {/* ===== NHẬT KÝ GẦN NHẤT ===== */}
            <div className="rounded-lg border">
              <div className="flex items-center justify-between border-b px-3 py-2">
                <p className="text-sm">Nhật ký đồng bộ gần nhất</p>
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
                      title={l.message ?? undefined}
                    >
                      {l.status === "SUCCESS" ? (
                        <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
                      ) : (
                        <XCircle className="size-4 shrink-0 text-red-600" />
                      )}
                      <span className="font-mono text-xs">{l.channelSku}</span>
                      <span className={cn(TEXT_SUB, "truncate")}>{l.shopName}</span>
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

// ---------- MÀN SO SÁNH TRƯỚC KHI BẬT ----------

function PreviewPanel({
  channel,
  preview,
  enabling,
  onCancel,
  onConfirm,
}: {
  channel: SyncChannel;
  preview: SyncPreview | "loading" | null;
  enabling: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!preview || preview === "loading") {
    return (
      <p className={cn(TEXT_SUB, "flex items-center gap-2 px-3 pb-3")}>
        <Loader2 className="size-3.5 animate-spin" />
        Đang đọc tồn thật từ {channel.shopName}…
      </p>
    );
  }

  const s = preview.summary;
  const changes = s.up + s.down;
  const stateLabel = (it: SyncPreview["items"][number]) =>
    it.state === "match"
      ? "khớp"
      : it.state === "unknown"
        ? "sàn không trả số"
        : it.state === "up"
          ? "tăng"
          : it.hubsell === 0
            ? "VỀ 0"
            : "giảm";

  return (
    <div className="mx-3 mb-3 space-y-2 rounded-md border bg-muted/30 p-3">
      <p className="text-sm">
        Sau khi bật, Hubsell sẽ ghi đè số <b>Có thể bán</b> lên{" "}
        {formatNumber(s.total)} SKU của gian này
        {preview.refreshed ? "" : " (không đọc được sàn lúc này — số sàn là số cũ)"}
        :
      </p>
      <div className="flex flex-wrap gap-1.5 text-xs">
        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700">
          {formatNumber(s.match)} khớp
        </span>
        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-800">
          {formatNumber(changes)} sẽ đổi số
        </span>
        {s.willZero > 0 && (
          <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-red-700">
            {formatNumber(s.willZero)} về 0 dù sàn còn hàng
          </span>
        )}
        {s.unknown > 0 && (
          <span className="rounded-full border px-2 py-0.5 text-muted-foreground">
            {formatNumber(s.unknown)} sàn không trả số
          </span>
        )}
        {s.unlinked > 0 && (
          <span className="rounded-full border px-2 py-0.5 text-muted-foreground">
            {formatNumber(s.unlinked)} SKU sàn chưa nối — không bị đụng
          </span>
        )}
      </div>

      {s.willZero > 0 && (
        <p className="flex items-start gap-1.5 rounded-md bg-red-50 p-2 text-sm text-red-800">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          {formatNumber(s.willZero)} SKU sẽ hết hàng trên sàn vì kho Hubsell
          đang để 0. Nếu kho thật còn hàng, hãy Để sau, nhập tồn ở tab Tồn kho
          rồi bật lại.
        </p>
      )}
      {preview.refreshError && (
        <p className="flex items-start gap-1.5 text-xs text-amber-700">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {preview.refreshError}
        </p>
      )}

      {preview.items.length > 0 && (
        <div className="max-h-56 overflow-auto rounded-md border bg-background">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium">SKU kho</th>
                <th className="px-2 py-1.5 text-left font-medium">SKU sàn</th>
                <th className="px-2 py-1.5 text-right font-medium">Tồn</th>
                <th className="px-2 py-1.5 text-right font-medium">Giữ</th>
                <th className="px-2 py-1.5 text-right font-medium">An toàn</th>
                <th className="px-2 py-1.5 text-right font-medium">Sàn đang có</th>
                <th className="px-2 py-1.5 text-right font-medium">→ Sẽ đẩy</th>
                <th className="px-2 py-1.5 text-left font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {preview.items.map((it) => (
                <tr
                  key={it.channelSku}
                  className={cn(
                    "border-t",
                    it.state === "down" && it.hubsell === 0 && "bg-red-50/60",
                    it.state === "match" && "text-muted-foreground"
                  )}
                >
                  <td className="px-2 py-1 font-mono">{it.skuCode}</td>
                  <td className="px-2 py-1 font-mono">{it.channelSku}</td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {formatNumber(it.quantityInStock)}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {it.holdQuantity ? formatNumber(it.holdQuantity) : "–"}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {it.safetyStock ? formatNumber(it.safetyStock) : "–"}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {it.onChannel === null ? "?" : formatNumber(it.onChannel)}
                  </td>
                  <td className="px-2 py-1 text-right font-semibold tabular-nums">
                    {formatNumber(it.hubsell)}
                  </td>
                  <td
                    className={cn(
                      "px-2 py-1 whitespace-nowrap",
                      it.state === "down" && it.hubsell === 0
                        ? "font-medium text-red-700"
                        : it.state === "match"
                          ? "text-emerald-700"
                          : "text-amber-700"
                    )}
                  >
                    {stateLabel(it)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {preview.truncated && (
            <p className={cn(TEXT_SUB, "px-2 py-1.5")}>
              Chỉ hiện 500 SKU đầu (lệch xếp trước) — tổng {formatNumber(s.total)}.
            </p>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={enabling}>
          Để sau
        </Button>
        <Button size="sm" onClick={onConfirm} disabled={enabling || s.total === 0}>
          {enabling ? <Loader2 className="size-4 animate-spin" /> : null}
          {s.total === 0
            ? "Chưa có SKU nào nối"
            : `Bật & đẩy ${formatNumber(s.total)} SKU`}
        </Button>
      </div>
    </div>
  );
}
