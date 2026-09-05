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
  PrintOptionsFields,
  readPrintOptions,
  type PrintOptions,
} from "@/components/orders/print-options";
import {
  ApiError,
  bulkConfirmOrders,
  fetchLabelReadiness,
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
 *
 * 05/09 — ĐỢI SÀN CẤP VẬN ĐƠN rồi mới in: Shopee nhận ship_order xong nhưng
 * cấp tracking_number trễ vài giây tới vài chục giây. Trước đây xin PDF ngay
 * nên đơn chưa có mã bị rơi khỏi file (chuẩn bị 4 đơn, in ra 1). Nay sau khi
 * sàn nhận, hộp thoại hỏi /bulk/label-readiness mỗi 2,5s, hiện "đã cấp x/y",
 * đủ rồi mới xin PDF MỘT lần; quá 45s vẫn thiếu thì in phần có, đơn thiếu ở
 * nguyên "Chưa in phiếu" kèm thông báo rõ để in lại sau.
 */

const PREF_PRINT_AFTER = "hubsell.fulfill.printAfter";

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
  const [busy, setBusy] = React.useState<"confirm" | "wait" | "print" | null>(null);
  const [waitProgress, setWaitProgress] = React.useState<{ ready: number; total: number } | null>(null);
  const [printAfter, setPrintAfter] = React.useState(true);
  const [printOpts, setPrintOpts] = React.useState<PrintOptions>({ labels: true, pickList: false });

  const orderIds = React.useMemo(() => orders.map((o) => o.id), [orders]);

  React.useEffect(() => {
    if (!open) return;
    setPrintAfter(readPref(PREF_PRINT_AFTER, true));
    setPrintOpts(readPrintOptions());
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

      if (printAfter && (printOpts.labels || printOpts.pickList) && res.confirmedIds.length > 0) {
        if (printOpts.labels) {
          setBusy("wait");
          await waitForLabelsReady(res.confirmedIds, setWaitProgress);
        }
        setBusy("print");
        await printLabels(res.confirmedIds, printOpts);
      }
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không kết nối được máy chủ");
    } finally {
      setBusy(null);
      setWaitProgress(null);
    }
  }

  const busyLabel =
    busy === "wait"
      ? waitProgress
        ? `Sàn đã cấp vận đơn ${formatNumber(waitProgress.ready)}/${formatNumber(waitProgress.total)}…`
        : "Đang chờ sàn cấp vận đơn…"
      : busy === "print"
        ? "Đang lấy vận đơn…"
        : null;

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

        <div className="space-y-3 border-t pt-3">
          <label className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2">
              <Printer className="size-4 text-muted-foreground" />
              In ngay sau khi sàn xác nhận (khổ A6)
            </span>
            <Switch
              checked={printAfter}
              onCheckedChange={(v) => {
                setPrintAfter(v);
                writePref(PREF_PRINT_AFTER, v);
              }}
            />
          </label>
          {printAfter && <PrintOptionsFields value={printOpts} onChange={setPrintOpts} />}
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
              {busyLabel ?? `Chuẩn bị ${formatNumber(runnableCount)} đơn`}
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

/** Hỏi sàn mỗi nhịp này tới khi mọi đơn có vận đơn. */
const READY_POLL_MS = 2500;
/** Hết kiên nhẫn sau ~45s — in phần đã có, phần thiếu báo rõ để in lại sau. */
const READY_MAX_MS = 45_000;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * ĐỢI sàn cấp vận đơn cho đủ các đơn vừa chuẩn bị (hoặc tới trần thời gian).
 * Trả về id còn thiếu sau khi hết kiên nhẫn (rỗng = đủ). Lỗi mạng ở một nhịp
 * không làm hỏng cả luồng — nhịp sau hỏi lại.
 */
export async function waitForLabelsReady(
  orderIds: string[],
  onProgress?: (p: { ready: number; total: number }) => void
): Promise<{ id: string; orderCode: string; reason?: string }[]> {
  const total = orderIds.length;
  const started = Date.now();
  let pending = orderIds;
  let lastWaiting: { id: string; orderCode: string; reason?: string }[] = [];
  onProgress?.({ ready: 0, total });
  for (;;) {
    try {
      const r = await fetchLabelReadiness(pending);
      lastWaiting = r.waiting;
      const waitingIds = new Set(r.waiting.map((w) => w.id));
      pending = pending.filter((id) => waitingIds.has(id));
      onProgress?.({ ready: total - pending.length, total });
      if (pending.length === 0) return [];
    } catch {
      // nhịp này lỗi (mạng/máy chủ) — giữ nguyên pending, thử lại nhịp sau
    }
    if (Date.now() - started >= READY_MAX_MS) break;
    await wait(READY_POLL_MS);
  }
  if (lastWaiting.length > 0) {
    const list = lastWaiting
      .slice(0, 3)
      .map((w) => w.orderCode)
      .join(", ");
    toast.warning(
      `${formatNumber(lastWaiting.length)} đơn sàn vẫn chưa cấp vận đơn (${list}${lastWaiting.length > 3 ? "…" : ""}) — ` +
        `đơn giữ nguyên "Chưa in phiếu", lọc Chưa in rồi bấm In sau ít phút.`,
      { duration: 10_000 }
    );
  }
  return lastWaiting;
}

/**
 * Lấy PDF theo lựa chọn (vận đơn sàn / phiếu xuất hàng) rồi mở hộp thoại in.
 * Chỉ đánh dấu ĐÃ IN khi có in vận đơn và hộp thoại mở được; đơn sàn chưa cấp
 * vận đơn giữ nguyên "Chưa in" để kho không bỏ sót. Dùng chung cho hộp thoại
 * Chuẩn bị hàng và BulkBar.
 */
export async function printLabels(orderIds: string[], opts: PrintOptions): Promise<void> {
  const { blob, summary } = await fetchOrderLabelsPdf(orderIds, opts);
  const opened = printPdfBlob(blob);
  if (!opened) {
    toast.error("Trình duyệt đã chặn cửa sổ in. Hãy cho phép pop-up cho trang này rồi bấm In lại.");
    return;
  }
  const failed = summary?.failed ?? [];
  if (opts.labels && failed.length > 0) {
    const list = failed
      .slice(0, 3)
      .map((f) => `${f.orderCode}: ${f.reason}`)
      .join("; ");
    toast.warning(
      `${failed.length} đơn chưa có vận đơn của sàn — ${list}${failed.length > 3 ? "…" : ""}`,
      { duration: 9000 }
    );
  }
  let markedPrinted = 0;
  if (opts.labels) {
    // Chỉ in phiếu xuất hàng thì KHÔNG tính là đã in vận đơn
    const failedIds = new Set(summary?.failedIds ?? []);
    const printable = orderIds.filter((id) => !failedIds.has(id));
    if (printable.length > 0) markedPrinted = (await markOrdersPrinted(printable)).markedPrinted;
  }
  toast.success(
    `Đã mở ${formatNumber(summary?.pages ?? 0)} trang để in` +
      (summary && opts.labels ? ` · ${formatNumber(summary.labels)} vận đơn sàn` : "") +
      (markedPrinted > 0 ? ` · đánh dấu ĐÃ IN ${markedPrinted} đơn` : ""),
    { duration: 6000 }
  );
}
