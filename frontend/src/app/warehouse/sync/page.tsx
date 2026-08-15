"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CheckCircle2,
  CloudUpload,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Vault,
  XCircle,
} from "lucide-react";

import { AccessDenied } from "@/components/access-denied";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
  fetchSyncLogs,
  fetchSyncPending,
  fetchSyncSettings,
  getStoredUser,
  getToken,
  syncAllStock,
  updateSyncSettings,
  type InventorySyncLog,
} from "@/lib/api";
import { canManageShop } from "@/lib/permissions";
import { formatNumber } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * ĐỒNG BỘ TỒN KHO ĐA SÀN — trang cấu hình của CHỦ SHOP.
 *
 * Switch autoSync = trao cho Hubsell quyền GHI ĐÈ tồn sàn (Shopee + Lazada)
 * mỗi khi kho biến động, nên bật phải qua hộp thoại xác nhận nói rõ hệ quả.
 * Tồn an toàn mặc định giữ lại một lớp đệm không bán; nút [Sync ngay toàn bộ]
 * đẩy tay bất kể switch. Bảng dưới là nhật ký từng lượt đẩy (audit).
 */
export default function WarehouseSyncPage() {
  const router = useRouter();

  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(true);

  const [autoSync, setAutoSync] = useState(false);
  const [safetyStock, setSafetyStock] = useState("0");
  const [savedSafety, setSavedSafety] = useState(0);
  const [pending, setPending] = useState(0);
  const [saving, setSaving] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const [logs, setLogs] = useState<InventorySyncLog[]>([]);
  const [logFilter, setLogFilter] = useState<"" | "SUCCESS" | "FAILED">("");

  const loadLogs = useCallback(async () => {
    try {
      setLogs(await fetchSyncLogs(100));
    } catch {
      // bảng nhật ký rỗng vẫn dùng được phần cấu hình
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    if (!canManageShop(getStoredUser())) {
      setDenied(true);
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const s = await fetchSyncSettings();
        setAutoSync(s.autoSyncEnabled);
        setSafetyStock(String(s.safetyStockDefault));
        setSavedSafety(s.safetyStockDefault);
        setPending(s.pendingJobs);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.replace("/login");
          return;
        }
        if (err instanceof ApiError && err.status === 403) {
          setDenied(true);
          return;
        }
        toast.error("Không tải được cấu hình đồng bộ tồn kho");
      } finally {
        setLoading(false);
      }
      loadLogs();
    })();
  }, [router, loadLogs]);

  // Còn job trong hàng đợi → poll tiến độ + tự làm mới nhật ký; hết thì thôi.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (pending <= 0 || denied) return;
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetchSyncPending();
        setPending(r.pending);
        loadLogs();
      } catch {
        // lỗi mạng tạm thời — lần poll sau thử lại
      }
    }, 4000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [pending, denied, loadLogs]);

  /** Bật switch phải qua xác nhận; tắt thì lưu thẳng. */
  function handleToggle(next: boolean) {
    if (next) {
      setConfirmOpen(true);
      return;
    }
    void saveSettings({ autoSyncEnabled: false });
  }

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
      if (r.queued > 0) {
        setPending((p) => p + r.queued);
        toast.success(
          `Đã lưu cấu hình và xếp ${formatNumber(r.queued)} SKU vào hàng đợi đồng bộ.`,
          { duration: 6000 }
        );
      } else {
        toast.success("Đã lưu cấu hình đồng bộ tồn kho");
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không lưu được cấu hình");
    } finally {
      setSaving(false);
      setConfirmOpen(false);
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
          "Chưa có SKU sàn nào liên kết với kho vật lý — vào trang Liên kết sản phẩm để nối trước."
        );
      } else {
        setPending((p) => p + r.queued);
        toast.success(
          `Đã xếp ${formatNumber(r.queued)} SKU vào hàng đợi — tồn sẽ được đẩy dần lên sàn trong ít phút.`,
          { duration: 6000 }
        );
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không sync được");
    } finally {
      setSyncingAll(false);
    }
  }

  if (denied) {
    return (
      <AppShell>
        <AccessDenied />
      </AppShell>
    );
  }

  const visibleLogs = logFilter ? logs.filter((l) => l.status === logFilter) : logs;
  const safetyDirty = Number(safetyStock) !== savedSafety;

  return (
    <AppShell>
      <div className="space-y-5">
        <p className="text-muted-foreground">
          Tồn khả dụng đẩy lên sàn = Tồn kho vật lý − Đang giữ cho đơn chưa chốt −
          Tồn an toàn. Áp dụng cho mọi gian Shopee &amp; Lazada đã liên kết SKU
          (TikTok sẽ bổ sung sau).
        </p>

        {loading ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Đang tải cấu hình…
          </p>
        ) : (
          <>
            <div className="grid gap-4 lg:grid-cols-2">
              {/* ===== SWITCH TỰ ĐỘNG ===== */}
              <Card className="shadow-sm">
                <CardHeader className="border-b pb-3">
                  <CardTitle className="flex items-center gap-2">
                    <CloudUpload className="size-5 text-slate-500" />
                    Tự động đồng bộ tồn đa sàn
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 pt-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium">
                        {autoSync ? "Đang BẬT" : "Đang TẮT"}
                      </p>
                      <p className={TEXT_SUB}>
                        Mọi biến động kho (đơn sàn, nhập/xuất tay, nhập hàng hoàn,
                        Excel) tự đẩy tồn khả dụng mới lên các sàn.
                      </p>
                    </div>
                    <Switch
                      checked={autoSync}
                      onCheckedChange={handleToggle}
                      disabled={saving}
                      aria-label="Bật/tắt tự động đồng bộ tồn kho"
                    />
                  </div>
                  {!autoSync && (
                    <p
                      className={cn(
                        TEXT_SUB,
                        "flex items-start gap-1.5 rounded-md bg-amber-50 px-2.5 py-2 text-amber-700"
                      )}
                    >
                      <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
                      Đang tắt: tồn sàn chỉ thay đổi khi bấm “Sync ngay toàn bộ”
                      hoặc “Cập nhật tồn” trên từng cảnh báo lệch tồn.
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* ===== TỒN AN TOÀN ===== */}
              <Card className="shadow-sm">
                <CardHeader className="border-b pb-3">
                  <CardTitle className="flex items-center gap-2">
                    <Vault className="size-5 text-slate-500" />
                    Tồn an toàn mặc định
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 pt-4">
                  <p className={TEXT_SUB}>
                    Số lượng GIỮ LẠI không bán trên sàn cho MỌI SKU — lớp đệm chống
                    bán vượt khi nhiều sàn nổ đơn sát nhau. Đặt riêng cho từng SKU
                    trong trang Kho vật lý (để trống là dùng số này).
                  </p>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      value={safetyStock}
                      onChange={(e) => setSafetyStock(e.target.value)}
                      className="w-28"
                      aria-label="Tồn an toàn mặc định"
                    />
                    <span className={TEXT_SUB}>chiếc / SKU</span>
                    <Button
                      size="sm"
                      onClick={handleSaveSafety}
                      disabled={saving || !safetyDirty}
                    >
                      {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                      Lưu
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* ===== SYNC TAY + TIẾN ĐỘ ===== */}
            <Card className="shadow-sm">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Đẩy lại toàn bộ tồn kho ngay</p>
                  <p className={TEXT_SUB}>
                    Ghi đè tồn khả dụng hiện tại của Hubsell lên MỌI SKU đã liên
                    kết — dùng sau khi kiểm kho hoặc khi nghi tồn sàn bị lệch.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {pending > 0 && (
                    <span
                      className={cn(
                        TEXT_SUB,
                        "flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1"
                      )}
                    >
                      <Loader2 className="size-3.5 animate-spin" />
                      Còn {formatNumber(pending)} SKU trong hàng đợi
                    </span>
                  )}
                  <Button onClick={handleSyncAll} disabled={syncingAll}>
                    {syncingAll ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <RefreshCw className="size-4" />
                    )}
                    Sync ngay toàn bộ
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* ===== NHẬT KÝ SYNC ===== */}
            <Card className="shadow-sm">
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 border-b pb-3">
                <CardTitle>Nhật ký đồng bộ tồn kho</CardTitle>
                <div className="flex items-center gap-2">
                  {(
                    [
                      ["", "Tất cả"],
                      ["SUCCESS", "Thành công"],
                      ["FAILED", "Thất bại"],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key || "all"}
                      type="button"
                      aria-pressed={logFilter === key}
                      onClick={() => setLogFilter(key)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                        logFilter === key
                          ? "border-primary bg-primary text-primary-foreground"
                          : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      {label}
                    </button>
                  ))}
                  <Button variant="outline" size="sm" onClick={() => loadLogs()}>
                    <RefreshCw className="size-4" />
                    Làm mới
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {visibleLogs.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    Chưa có lượt đồng bộ nào{logFilter ? " khớp bộ lọc" : ""}.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Thời gian</TableHead>
                        <TableHead>Gian hàng</TableHead>
                        <TableHead>SKU sàn</TableHead>
                        <TableHead className="text-right">Tồn cũ</TableHead>
                        <TableHead className="text-right">Tồn mới</TableHead>
                        <TableHead>Kết quả</TableHead>
                        <TableHead>Chi tiết</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleLogs.map((l, index) => (
                        <TableRow
                          key={l.id}
                          className={cn(index % 2 === 1 && "bg-muted/40")}
                        >
                          <TableCell className="whitespace-nowrap text-sm">
                            {new Date(l.createdAt).toLocaleString("vi-VN")}
                          </TableCell>
                          <TableCell className="text-sm">{l.shopName}</TableCell>
                          <TableCell className="font-mono text-sm">
                            {l.channelSku}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatNumber(l.oldQuantity)}
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {formatNumber(l.newQuantity)}
                          </TableCell>
                          <TableCell>
                            {l.status === "SUCCESS" ? (
                              <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600">
                                <CheckCircle2 className="size-4" />
                                Thành công
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-sm font-medium text-red-600">
                                <XCircle className="size-4" />
                                Thất bại
                              </span>
                            )}
                          </TableCell>
                          <TableCell
                            className={cn(TEXT_SUB, "max-w-md truncate")}
                            title={l.message ?? undefined}
                          >
                            {l.message ?? "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </>
        )}

        <p className="text-center text-xs text-muted-foreground">
          Hubsell · Đồng bộ tồn kho vật lý → đa sàn
        </p>
      </div>

      {/* ===== XÁC NHẬN BẬT AUTO-SYNC ===== */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="size-5 text-amber-500" />
              Bật tự động đồng bộ tồn kho?
            </DialogTitle>
            <DialogDescription>
              Từ lúc bật, Hubsell là nguồn tồn kho duy nhất: tồn khả dụng trên
              MỌI gian Shopee &amp; Lazada đã liên kết SKU sẽ bị GHI ĐÈ theo số
              của kho vật lý, và toàn bộ SKU được đồng bộ lại ngay một lượt.
            </DialogDescription>
          </DialogHeader>
          <p className="rounded-md bg-amber-50 px-2.5 py-2 text-sm text-amber-700">
            Kiểm tra tồn kho vật lý đã nhập ĐÚNG trước khi bật — kho đang để 0
            thì sản phẩm trên sàn cũng về 0 (hết hàng).
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={saving}
            >
              Để sau
            </Button>
            <Button
              onClick={() => void saveSettings({ autoSyncEnabled: true })}
              disabled={saving}
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              Tôi hiểu, bật đồng bộ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
