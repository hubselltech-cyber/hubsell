"use client";

import * as React from "react";
import { Loader2, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * TÙY CHỌN IN — dùng chung cho nút "In vận đơn" và hộp thoại Chuẩn bị hàng.
 *
 * Anh Trung 04/09 (sau khi test đơn thật): đừng mặc định in kèm phiếu xuất
 * hàng — shop bán 1-2 món mỗi đơn thấy tốn giấy. Seller tự tích thứ mình cần:
 *   [x] Vận đơn của sàn      (dán kiện — shipper quét)
 *   [ ] Phiếu xuất hàng      (kho nhặt hàng — đơn nhiều SKU)
 * Lựa chọn nhớ trong localStorage của máy đó.
 */

export interface PrintOptions {
  labels: boolean;
  pickList: boolean;
}

const PREF_KEY = "hubsell.print.options";
const DEFAULTS: PrintOptions = { labels: true, pickList: false };

export function readPrintOptions(): PrintOptions {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (!raw) return DEFAULTS;
    const o = JSON.parse(raw) as Partial<PrintOptions>;
    return {
      labels: typeof o.labels === "boolean" ? o.labels : DEFAULTS.labels,
      pickList: typeof o.pickList === "boolean" ? o.pickList : DEFAULTS.pickList,
    };
  } catch {
    return DEFAULTS;
  }
}

export function writePrintOptions(opts: PrintOptions) {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(opts));
  } catch {
    // trình duyệt chặn storage — bỏ qua
  }
}

/** Hai ô tích: vận đơn / phiếu xuất hàng. */
export function PrintOptionsFields({
  value,
  onChange,
  disabled,
}: {
  value: PrintOptions;
  onChange: (next: PrintOptions) => void;
  disabled?: boolean;
}) {
  const row = (
    key: keyof PrintOptions,
    title: string,
    hint: string
  ) => (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
        value[key] ? "border-primary/40 bg-primary/5" : "border-border hover:bg-muted/50",
        disabled && "cursor-not-allowed opacity-60"
      )}
    >
      <input
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 accent-primary"
        checked={value[key]}
        disabled={disabled}
        onChange={(e) => {
          const next = { ...value, [key]: e.target.checked };
          onChange(next);
          writePrintOptions(next);
        }}
      />
      <span className="grid gap-0.5 text-sm">
        <span className="font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
  return (
    <div className="grid gap-2">
      {row("labels", "Vận đơn của sàn", "Tem A6 chính chủ có mã vạch/QR để dán kiện, shipper quét được.")}
      {row(
        "pickList",
        "Phiếu xuất hàng",
        "Phiếu A6 của Hubsell cho kho nhặt hàng: mã đơn có mã vạch, SKU và số lượng. Nên bật với đơn nhiều sản phẩm."
      )}
    </div>
  );
}

/** Hộp thoại nhỏ khi bấm "In vận đơn" trên thanh xử lý hàng loạt. */
export function PrintOptionsDialog({
  open,
  onOpenChange,
  count,
  withoutLabel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Số đơn sẽ in. */
  count: number;
  /** Số đơn chưa chuẩn bị (không có vận đơn sàn). */
  withoutLabel: number;
  onConfirm: (opts: PrintOptions) => Promise<void>;
}) {
  const [opts, setOpts] = React.useState<PrintOptions>(DEFAULTS);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open) setOpts(readPrintOptions());
  }, [open]);

  const nothing = !opts.labels && !opts.pickList;

  async function handle() {
    setBusy(true);
    try {
      await onConfirm(opts);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>In {formatNumber(count)} đơn</DialogTitle>
          <DialogDescription>
            Chọn loại phiếu cần in. Cả hai đều khổ A6, in liền một lượt.
            {withoutLabel > 0 &&
              ` ${formatNumber(withoutLabel)} đơn chưa chuẩn bị hàng nên chỉ có phiếu xuất hàng.`}
          </DialogDescription>
        </DialogHeader>
        <PrintOptionsFields value={opts} onChange={setOpts} disabled={busy} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Hủy
          </Button>
          <Button onClick={handle} disabled={busy || nothing}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />}
            In
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
