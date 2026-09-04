"use client";

import * as React from "react";
import { toast } from "sonner";
import { AlertTriangle, Loader2, PackageCheck, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import {
  ApiError,
  bulkConfirmOrders,
  fetchOrderLabelsPdf,
  fetchShippingOptions,
  markOrdersPrinted,
  type FulfillChoice,
  type Order,
  type ShippingOptionGroup,
} from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { formatNumber } from "@/lib/format";
import { printPdfBlob } from "@/lib/print-labels";
import { cn } from "@/lib/utils";

/**
 * HỘP THOẠI "CHUẨN BỊ HÀNG" — sắp xếp vận chuyển THẬT trên sàn (04/09)
 *
 * Mô phỏng đúng thao tác seller đang làm trên Seller Center nhưng gộp nhiều
 * gian một lần: mỗi gian một khối chọn "shipper tới lấy" / "tự mang bưu cục"
 * + địa chỉ + khung giờ (Shopee); Lazada sàn tự sắp theo cài đặt gian nên chỉ
 * hiện ghi chú. Lựa chọn lần trước của gian được backend điền sẵn → lần sau
 * chỉ cần bấm một nút.
 *
 * Sau khi sàn OK, mặc định mở luôn hộp thoại in vận đơn A6 (anh Trung chốt);
 * ai muốn in sau thì tắt công tắc — trạng thái nhớ trong localStorage.
 */

const PREF_PRINT_AFTER = "hubsell.fulfill.printAfter";
const PREF_PICK_LIST = "hubsell.fulfill.pickList";

function readPref(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // trình duyệt chặn storage — bỏ qua
  }
}

/** Dựng lựa chọn ban đầu cho một gian từ mặc định đã lưu + danh sách sàn trả. */
function initialChoice(g: ShippingOptionGroup): FulfillChoice {
  const method =
    g.defaults?.method && g.methods.includes(g.defaults.method)
      ? g.defaults.method
      : (g.methods[0] ?? "PICKUP");
  const addr =
    g.pickupAddresses.find((a) => a.id === g.defaults?.addressId) ??
    g.pickupAddresses.find((a) => a.isDefault) ??
    g.pickupAddresses[0];
  const branch =
    g.dropoffBranches.find((b) => b.id === g.defaults?.branchId) ?? g.dropoffBranches[0];
  return {
    method,
    addressId: addr?.id,
    pickupTimeId: addr?.timeSlots[0]?.id,
    branchId: branch?.id,
  };
}

export function ArrangeShipmentDialog({
  open,
  onOpenChange,
  orders,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Đơn Chờ xử lý đang được chọn. */
  orders: Order[];
  /** Gọi sau khi xong (để bảng tải lại + bỏ chọn). */
  onDone: () => void;
}) {
  const [loading, setLoading] = React.useState(false);
  const [groups, setGroups] = React.useState<ShippingOptionGroup[]>([]);
  const [choices, setChoices] = React.useState<Record<string, FulfillChoice>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<"confirm" | "print" | null>(null);
  const [printAfter, setPrintAfter] = React.useState(true);
  const [pickList, setPickList] = React.useState(true);

  const orderIds = React.useMemo(() => orders.map((o) => o.id), [orders]);

  React.useEffect(() => {
    if (!open) return;
    setPrintAfter(readPref(PREF_PRINT_AFTER, true));
    setPickList(readPref(PREF_PICK_LIST, true));
    let cancelled = false;
    setLoading(true);
    setError(null);
    setGroups([]);
    fetchShippingOptions(orderIds)
      .then((res) => {
        if (cancelled) return;
        setGroups(res.groups);
        const init: Record<string, FulfillChoice> = {};
        for (const g of res.groups) {
          if (g.mode === "PLATFORM" && g.methods.length > 0) init[g.channelId] = initialChoice(g);
        }
        setChoices(init);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Không hỏi được sàn");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const runnable = groups.filter((g) => g.mode === "PLATFORM" || g.mode === "INTERNAL");
  const runnableCount = runnable.reduce((s, g) => s + g.orderCount, 0);
  const blockedCount = groups
    .filter((g) => g.mode !== "PLATFORM" && g.mode !== "INTERNAL")
    .reduce((s, g) => s + g.orderCount, 0);

  function setChoice(channelId: string, patch: Partial<FulfillChoice>) {
    setChoices((prev) => ({ ...prev, [channelId]: { ...prev[channelId], ...patch } }));
  }

  async function handleConfirm() {
    setBusy("confirm");
    try {
      // Chỉ gửi đơn của các gian chạy được — gian lỗi/giữ chỗ bỏ ngoài
      const runnableIds = new Set(runnable.map((g) => g.channelId));
      const ids = orders.filter((o) => runnableIds.has(o.channelId)).map((o) => o.id);
      const res = await bulkConfirmOrders(ids, choices);

      const failedText =
        res.failed.length > 0
          ? ` · ${res.failed.length} đơn sàn từ chối: ${res.failed
              .slice(0, 3)
              .map((f) => `${f.orderCode} (${f.reason})`)
              .join("; ")}${res.failed.length > 3 ? "…" : ""}`
          : "";
      const skippedText = res.skipped.length > 0 ? ` · bỏ qua ${res.skipped.length}` : "";
      if (res.confirmed > 0) {
        toast.success(`Đã chuẩn bị ${formatNumber(res.confirmed)} đơn trên sàn${skippedText}${failedText}`, {
          duration: 8000,
        });
      } else {
        toast.error(`Không chuẩn bị được đơn nào${failedText}`, { duration: 8000 });
      }
      for (const n of res.notes ?? []) toast.info(`${n.orderCode}: ${n.note}`, { duration: 7000 });

      if (printAfter && res.confirmedIds.length > 0) {
        setBusy("print");
        await printLabels(res.confirmedIds, pickList);
      }
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không kết nối được máy chủ");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Chuẩn bị hàng · {formatNumber(orders.length)} đơn</DialogTitle>
          <DialogDescription>
            Hubsell sẽ báo sàn <b>sắp xếp vận chuyển</b> cho từng đơn (như bấm trên Seller
            Center). Sàn nhận rồi thì không hoàn tác được.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Đang hỏi sàn phương án vận chuyển…
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <p>{error}</p>
          </div>
        )}

        {!loading && !error && (
          <div className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
            {groups.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Không có đơn nào đang Chờ xử lý trong lựa chọn.
              </p>
            )}
            {groups.map((g) => (
              <GroupCard
                key={g.channelId}
                group={g}
                choice={choices[g.channelId]}
                onChange={(patch) => setChoice(g.channelId, patch)}
              />
            ))}
          </div>
        )}

        <div className="space-y-2 border-t pt-3">
          <label className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2">
              <Printer className="size-4 text-muted-foreground" />
              In vận đơn ngay sau khi sàn xác nhận (khổ A6)
            </span>
            <Switch
              checked={printAfter}
              onCheckedChange={(v) => {
                setPrintAfter(v);
                writePref(PREF_PRINT_AFTER, v);
              }}
            />
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">Kèm phiếu nhặt hàng Hubsell cho kho</span>
            <Switch
              checked={pickList}
              disabled={!printAfter}
              onCheckedChange={(v) => {
                setPickList(v);
                writePref(PREF_PICK_LIST, v);
              }}
            />
          </label>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {blockedCount > 0 && `${formatNumber(blockedCount)} đơn sẽ bỏ qua (xem ghi chú)`}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy !== null}>
              Hủy
            </Button>
            <Button onClick={handleConfirm} disabled={busy !== null || loading || runnableCount === 0}>
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <PackageCheck className="size-4" />
              )}
              {busy === "print" ? "Đang lấy vận đơn…" : `Chuẩn bị ${formatNumber(runnableCount)} đơn`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Khối lựa chọn của một gian hàng. */
function GroupCard({
  group: g,
  choice,
  onChange,
}: {
  group: ShippingOptionGroup;
  choice?: FulfillChoice;
  onChange: (patch: Partial<FulfillChoice>) => void;
}) {
  const meta = CHANNEL_META[g.channelName];
  const address = g.pickupAddresses.find((a) => a.id === choice?.addressId);
  const tone =
    g.mode === "ERROR"
      ? "border-rose-200 bg-rose-50/60"
      : g.mode === "UNSUPPORTED"
        ? "border-amber-200 bg-amber-50/60"
        : "border-border";

  return (
    <div className={cn("rounded-lg border p-3", tone)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span className={cn("rounded-md border px-1.5 py-0.5 text-xs", meta.className)}>
            {meta.label}
          </span>
          {g.shopName}
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatNumber(g.orderCount)} đơn
        </span>
      </div>

      {g.mode === "PLATFORM" && g.methods.length > 0 && choice && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-2">
            {g.methods.includes("PICKUP") && (
              <MethodPill
                active={choice.method === "PICKUP"}
                onClick={() => onChange({ method: "PICKUP" })}
                label="Shipper tới lấy"
              />
            )}
            {g.methods.includes("DROPOFF") && (
              <MethodPill
                active={choice.method === "DROPOFF"}
                onClick={() => onChange({ method: "DROPOFF" })}
                label="Tự mang ra bưu cục"
              />
            )}
          </div>
          {choice.method === "PICKUP" && g.pickupAddresses.length > 0 && (
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">Địa chỉ lấy hàng</Label>
              <NativeSelect
                value={choice.addressId ?? ""}
                onChange={(e) => {
                  const next = g.pickupAddresses.find((a) => a.id === e.target.value);
                  onChange({ addressId: e.target.value, pickupTimeId: next?.timeSlots[0]?.id });
                }}
              >
                {g.pickupAddresses.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
          {choice.method === "PICKUP" && address && address.timeSlots.length > 0 && (
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">Khung giờ lấy hàng</Label>
              <NativeSelect
                value={choice.pickupTimeId ?? ""}
                onChange={(e) => onChange({ pickupTimeId: e.target.value })}
              >
                {address.timeSlots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
          {choice.method === "PICKUP" && g.pickupAddresses.length === 0 && (
            <p className="text-xs text-rose-600">
              Gian chưa có địa chỉ lấy hàng trên sàn — thêm ở Seller Center rồi thử lại.
            </p>
          )}
          {choice.method === "DROPOFF" && g.dropoffBranches.length > 0 && (
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">Bưu cục gửi</Label>
              <NativeSelect
                value={choice.branchId ?? ""}
                onChange={(e) => onChange({ branchId: e.target.value })}
              >
                {g.dropoffBranches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
        </div>
      )}

      {g.note && (
        <p
          className={cn(
            "mt-2 text-xs",
            g.mode === "ERROR" ? "text-rose-700" : g.mode === "UNSUPPORTED" ? "text-amber-700" : "text-muted-foreground"
          )}
        >
          {g.note}
        </p>
      )}
    </div>
  );
}

function MethodPill({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      {label}
    </button>
  );
}

/**
 * Lấy PDF vận đơn + phiếu nhặt cho các đơn rồi mở hộp thoại in; chỉ đánh dấu
 * ĐÃ IN khi hộp thoại mở được và đơn có phiếu (đơn sàn chưa cấp vận đơn giữ
 * nguyên "Chưa in" để kho không bỏ sót). Dùng chung cho hộp thoại và BulkBar.
 */
export async function printLabels(orderIds: string[], includePickList: boolean): Promise<void> {
  const { blob, summary } = await fetchOrderLabelsPdf(orderIds, { labels: true, pickList: includePickList });
  const opened = printPdfBlob(blob);
  if (!opened) {
    toast.error("Trình duyệt đã chặn cửa sổ in. Hãy cho phép pop-up cho trang này rồi bấm In lại.");
    return;
  }
  const failedCodes = new Set((summary?.failed ?? []).map((f) => f.orderCode));
  if (failedCodes.size > 0) {
    const list = (summary?.failed ?? [])
      .slice(0, 3)
      .map((f) => `${f.orderCode}: ${f.reason}`)
      .join("; ");
    toast.warning(
      `${failedCodes.size} đơn chưa có vận đơn của sàn — ${list}${failedCodes.size > 3 ? "…" : ""}`,
      { duration: 9000 }
    );
  }
  // Đơn sàn chưa cấp vận đơn giữ nguyên "Chưa in" — chỉ đánh dấu đơn có phiếu thật
  const failedIds = new Set(summary?.failedIds ?? []);
  const printable = orderIds.filter((id) => !failedIds.has(id));
  const marked =
    printable.length > 0 ? await markOrdersPrinted(printable) : { markedPrinted: 0 };
  toast.success(
    `Đã mở ${formatNumber(summary?.pages ?? 0)} trang để in` +
      (summary ? ` · ${formatNumber(summary.labels)} vận đơn sàn` : "") +
      (marked.markedPrinted > 0 ? ` · đánh dấu ĐÃ IN ${marked.markedPrinted} đơn` : ""),
    { duration: 6000 }
  );
}
