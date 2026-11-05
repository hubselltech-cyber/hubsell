"use client";

import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatNumber } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

import type { StockSyncChange } from "./shared";

/** Số dòng đổi số hiện trong hộp — còn lại gom vào một dòng "…và N phân loại nữa". */
const MAX_LINES = 8;

/**
 * HỘP XÁC NHẬN BẬT ĐỒNG BỘ TỒN (06/11/2026) — chỉ hiện khi bật mà số trên sàn sẽ ĐỔI: bật là kho
 * ghi đè tồn sàn, khách phải thấy số cũ → số mới trước (luật "cảnh báo, không khóa cứng"). Số trên
 * sàn đã bằng số kho thì bật thẳng, không hỏi.
 */
export function StockSyncConfirmDialog({
  open,
  title,
  total,
  changes,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  /** Tên sản phẩm / "N sản phẩm đã chọn". */
  title: string;
  /** Tổng số phân loại sắp bật (gồm cả dòng không đổi số). */
  total: number;
  changes: StockSyncChange[];
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const toZero = changes.filter((c) => c.to === 0).length;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !busy) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Bật đồng bộ tồn — {formatNumber(changes.length)} phân loại sẽ đổi số trên sàn</DialogTitle>
          <DialogDescription>
            {/* Khoảng trắng sau số phải viết {" "}: đoạn chữ có ký tự thực thể (&ldquo;) bị trình dịch cắt mất khoảng trắng đầu (đo 06/11: "3phân loại"). */}
            {title}. Bật xong, tồn trên sàn của {formatNumber(total)}{" "}
            phân loại đi theo số “có thể bán” của Tổng kho.
          </DialogDescription>
        </DialogHeader>

        <ul className="max-h-64 divide-y overflow-y-auto rounded-lg border text-sm">
          {changes.slice(0, MAX_LINES).map((c) => (
            <li key={c.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-1.5">
              <span className="min-w-0">
                <span className="block truncate" title={c.label}>
                  {c.label}
                </span>
                <span className={cn(TEXT_SUB, "block truncate")} title={`${c.shopName} · SKU kho ${c.skuCode}`}>
                  {c.shopName} · SKU kho <span className="font-mono">{c.skuCode}</span>
                </span>
              </span>
              <span className="whitespace-nowrap tabular-nums">
                sàn <b>{formatNumber(c.from)}</b> → <b className={c.to === 0 ? "text-red-700" : undefined}>{formatNumber(c.to)}</b>
              </span>
            </li>
          ))}
          {changes.length > MAX_LINES && (
            <li className={cn(TEXT_SUB, "px-3 py-1.5")}>…và {formatNumber(changes.length - MAX_LINES)} phân loại nữa cũng đổi số.</li>
          )}
        </ul>

        {toZero > 0 && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {formatNumber(toZero)} phân loại sẽ về <b>0</b> và hiện hết hàng trên sàn. Nếu kho chưa kiểm xong, hãy nhập tồn ở Tổng kho trước rồi mới bật.
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Hủy
          </Button>
          <Button onClick={onConfirm} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            Bật đồng bộ
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
