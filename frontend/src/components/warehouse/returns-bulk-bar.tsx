"use client";

import * as React from "react";
import { toast } from "sonner";
import { Loader2, PackageCheck, PackageOpen, PackageX } from "lucide-react";

import { BulkBar } from "@/components/data-table/bulk-bar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ApiError,
  bulkDamagedReturns,
  bulkInboundReturns,
  bulkReceiveReturns,
  type Order,
} from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Đơn còn thao tác hàng loạt được: chưa nhập kho, chưa báo hỏng. */
export function isReturnBulkSelectable(o: Pick<Order, "returnStatus">): boolean {
  return o.returnStatus === "AWAITING" || o.returnStatus === "RECEIVED";
}

/** Lý do báo hỏng — chọn một, nối vào ghi chú của đơn. */
const DAMAGE_REASONS = ["Hỏng / vỡ", "Thiếu hàng", "Bị tráo hàng", "Mất, kiện không về"] as const;

type Busy = "receive" | "inbound" | "damaged" | null;

/**
 * THANH THAO TÁC HÀNG LOẠT của Đối soát đơn hoàn (13/11/2026).
 *
 * Anh Trung chốt: tích theo từng trang, tích bao nhiêu tác động bấy nhiêu đơn.
 * Ba nút bám ba việc của kho; mỗi nút ghi sẵn SỐ ĐƠN nó xử lý được và tự khóa
 * khi bằng 0 (cùng luật thanh hàng loạt của trang Đơn hàng):
 *   Nhận hàng      — đơn Chờ hàng về → Đã nhận · chờ nhập kho
 *   Nhập kho       — đơn Đã nhận (và Chờ hàng về, có hỏi lại) → cộng tồn
 *   Báo hỏng / mất — không cộng tồn; giá vốn thành "Thất thu hàng mất/hỏng"
 */
export function ReturnsBulkBar({
  selected,
  onClear,
  onDone,
}: {
  selected: Order[];
  onClear: () => void;
  /** Gọi sau khi xử lý xong để trang tải lại danh sách */
  onDone: () => void;
}) {
  const [busy, setBusy] = React.useState<Busy>(null);
  const [damageOpen, setDamageOpen] = React.useState(false);
  const [reason, setReason] = React.useState<string>("");
  const [note, setNote] = React.useState("");

  const awaiting = selected.filter((o) => o.returnStatus === "AWAITING");
  const received = selected.filter((o) => o.returnStatus === "RECEIVED");
  const processable = [...awaiting, ...received];
  const units = processable.reduce(
    (sum, o) => sum + (o.items ?? []).reduce((s, l) => s + l.quantity, 0),
    0
  );

  /** Câu báo kết quả chung: "đã xử lý X · bỏ qua Y". */
  function report(done: string, processed: number, skipped: number) {
    if (processed === 0) {
      toast.info("Không đơn nào còn ở trạng thái xử lý được — danh sách đã làm mới");
    } else {
      toast.success(
        `${done} ${formatNumber(processed)} đơn` +
          (skipped > 0 ? ` · bỏ qua ${formatNumber(skipped)} đơn đã xử lý trước đó` : ""),
        { duration: 6000 }
      );
    }
  }

  async function run(kind: Exclude<Busy, null>, job: () => Promise<void>, failMessage: string) {
    setBusy(kind);
    try {
      await job();
      onClear();
      onDone();
    } catch (err) {
      // Lỗi thì GIỮ lựa chọn để bấm lại được.
      toast.error(err instanceof ApiError ? err.message : failMessage);
    } finally {
      setBusy(null);
    }
  }

  function handleReceive() {
    if (awaiting.length === 0) return;
    void run(
      "receive",
      async () => {
        const res = await bulkReceiveReturns(awaiting.map((o) => o.id));
        report("Đã nhận hàng", res.processed, res.skipped);
      },
      "Không ghi nhận được đơn hoàn"
    );
  }

  function handleInbound() {
    if (processable.length === 0) return;
    // Cảnh báo, không khóa cứng: đơn chưa quét nhận vẫn nhập kho được (đi tắt),
    // nhưng người bấm phải biết mình đang cộng tồn cho kiện chưa xác nhận về tay.
    if (
      awaiting.length > 0 &&
      !window.confirm(
        `${formatNumber(awaiting.length)} đơn đang “Chờ hàng về” (chưa quét nhận). Nhập kho sẽ cộng tồn cho cả các đơn này.\n\nVẫn nhập kho ${formatNumber(processable.length)} đơn?`
      )
    ) {
      return;
    }
    void run(
      "inbound",
      async () => {
        const res = await bulkInboundReturns(processable.map((o) => o.id));
        if (res.processed === 0 && res.failed.length === 0) {
          report("Đã nhập kho", 0, res.skipped);
        } else {
          toast.success(
            `Đã nhập kho ${formatNumber(res.processed)} đơn · cộng ${formatNumber(
              res.restockedUnits
            )} sản phẩm vào tồn kho` +
              (res.skipped > 0 ? ` · bỏ qua ${formatNumber(res.skipped)} đơn đã xử lý trước đó` : ""),
            { duration: 8000 }
          );
        }
        if (res.failed.length > 0) {
          toast.error(
            `${formatNumber(res.failed.length)} đơn lỗi, chưa nhập được: ${res.failed
              .map((f) => f.orderCode)
              .join(", ")}`,
            { duration: 10000 }
          );
        }
      },
      "Không nhập kho hàng loạt được"
    );
  }

  function handleDamaged() {
    if (processable.length === 0) return;
    void run(
      "damaged",
      async () => {
        const res = await bulkDamagedReturns(
          processable.map((o) => o.id),
          reason || undefined,
          note.trim() || undefined
        );
        report("Đã báo hỏng / mất", res.processed, res.skipped);
        setDamageOpen(false);
      },
      "Không báo hỏng được"
    );
  }

  return (
    <>
      <BulkBar count={selected.length} unitLabel="đơn" onClear={onClear}>
        <Button
          size="sm"
          variant="secondary"
          onClick={handleReceive}
          disabled={busy !== null || awaiting.length === 0}
          title={
            awaiting.length === 0
              ? "Chỉ đơn đang Chờ hàng về mới nhận hàng được"
              : "Ghi nhận kiện đã về tay — chưa cộng tồn kho"
          }
        >
          {busy === "receive" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <PackageCheck className="size-4" />
          )}
          Nhận hàng ({formatNumber(awaiting.length)})
        </Button>

        <Button
          size="sm"
          variant="secondary"
          onClick={handleInbound}
          disabled={busy !== null || processable.length === 0}
          title="Hàng nguyên vẹn — cộng lại tồn kho"
        >
          {busy === "inbound" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <PackageOpen className="size-4" />
          )}
          Nhập kho ({formatNumber(processable.length)})
        </Button>

        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setReason("");
            setNote("");
            setDamageOpen(true);
          }}
          disabled={busy !== null || processable.length === 0}
          title="Hàng hỏng / mất / bị tráo — không cộng tồn, giá vốn tính vào Thất thu hàng mất/hỏng"
        >
          <PackageX className="size-4" />
          Báo hỏng / mất ({formatNumber(processable.length)})
        </Button>
      </BulkBar>

      <Dialog open={damageOpen} onOpenChange={(o) => busy === null && setDamageOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Báo hỏng / mất {formatNumber(processable.length)} đơn</DialogTitle>
            <DialogDescription>
              {formatNumber(units)} sản phẩm · không cộng lại tồn kho · giá vốn tính vào{" "}
              <b>Thất thu hàng mất/hỏng</b>.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Label>Lý do</Label>
            <div className="flex flex-wrap gap-2">
              {DAMAGE_REASONS.map((r) => {
                const active = reason === r;
                return (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setReason(active ? "" : r)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {r}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="bulk-damage-note">Ghi chú</Label>
            <Input
              id="bulk-damage-note"
              placeholder="VD: lô hàng hoàn ngày 13/11, hộp bẹp…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDamageOpen(false)} disabled={busy !== null}>
              Hủy
            </Button>
            <Button
              onClick={handleDamaged}
              disabled={busy !== null}
              className="bg-rose-600 text-white hover:bg-rose-700"
            >
              {busy === "damaged" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <PackageX className="size-4" />
              )}
              Báo hỏng {formatNumber(processable.length)} đơn
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
