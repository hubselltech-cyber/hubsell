"use client";

import { useRef, useState } from "react";
import { FileSpreadsheet, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ApiError, importAmsReport, type AmsImportResult } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * IMPORT "BÁO CÁO CHUYỂN ĐỔI" TTLK NGƯỜI BÁN — nguồn danh tính KOC-theo-đơn
 * DUY NHẤT hiện có (API seller không trả creator từng đơn).
 *
 * Đường lấy file: web Seller Center → Hệ thống TTLK dành cho Người bán →
 * Báo cáo chuyển đổi → Xuất dữ liệu (chỉ bản WEB có nút xuất, app không có).
 * Backend dò cột linh hoạt (mã đơn / đối tác / hoa hồng), tự tạo hồ sơ KOC
 * theo tên đối tác chưa có, chạy lại cùng file không sinh trùng.
 */
export function ImportAmsDialog({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AmsImportResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function pick(f: File | null) {
    if (f && !/\.(xlsx|xls|csv)$/i.test(f.name)) {
      toast.error("Chỉ nhận file Excel (.xlsx/.xls) hoặc .csv");
      return;
    }
    setFile(f);
    setResult(null);
  }

  async function handleImport() {
    if (!file || busy) return;
    setBusy(true);
    try {
      const r = await importAmsReport(file);
      setResult(r);
      if (r.matched > 0) {
        toast.success(
          `Đã gán ${formatNumber(r.matched)} đơn cho KOC` +
            (r.partnersCreated > 0 ? ` · tạo mới ${r.partnersCreated} hồ sơ KOC` : "")
        );
        onDone();
      } else {
        toast.warning("Không khớp được đơn nào — xem chi tiết bên dưới");
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Import thất bại");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setFile(null);
          setResult(null);
        }
      }}
    >
      <DialogTrigger render={<Button variant="outline" />}>
        <Upload className="size-4" />
        Import báo cáo TTLK
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import Báo cáo chuyển đổi TTLK</DialogTitle>
          <DialogDescription>
            Xuất file từ <b>web Seller Center → Hệ thống Tiếp Thị Liên Kết dành
            cho Người bán → Báo cáo chuyển đổi → Xuất dữ liệu</b> rồi thả vào
            đây. Hubsell khớp mã đơn với đơn đã đồng bộ để biết đơn nào của KOC
            nào — hoa hồng thật vẫn lấy từ đối soát, file chỉ cấp danh tính.
          </DialogDescription>
        </DialogHeader>

        <div
          className={cn(
            "flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors",
            file ? "border-emerald-300 bg-emerald-50/40" : "border-slate-200 hover:border-slate-300"
          )}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            pick(e.dataTransfer.files[0] ?? null);
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
          />
          {file ? (
            <div className="flex items-center gap-2 text-sm">
              <FileSpreadsheet className="size-5 text-emerald-600" />
              <span>{file.name}</span>
              <button
                type="button"
                aria-label="Gỡ file"
                className="text-slate-400 hover:text-slate-600"
                onClick={(e) => {
                  e.stopPropagation();
                  pick(null);
                }}
              >
                <X className="size-4" />
              </button>
            </div>
          ) : (
            <>
              <Upload className="size-6 text-slate-400" />
              <p className="text-sm text-slate-600">
                Kéo thả hoặc bấm để chọn file (.xlsx / .csv)
              </p>
            </>
          )}
        </div>

        {result && (
          <div className="space-y-1 rounded-lg border bg-slate-50 p-3 text-sm">
            <p>
              Khớp <b>{formatNumber(result.matched)}</b>/{formatNumber(result.validRows)}{" "}
              dòng · tạo mới <b>{result.partnersCreated}</b> hồ sơ KOC
            </p>
            {result.unmatchedCount > 0 && (
              <p className={TEXT_SUB}>
                {formatNumber(result.unmatchedCount)} đơn không có trong Hubsell
                (đơn cũ chưa đồng bộ / khác gian):{" "}
                {result.unmatchedOrders.slice(0, 5).join(", ")}
                {result.unmatchedCount > 5 && "…"}
              </p>
            )}
            {result.errors.length > 0 && (
              <p className={TEXT_SUB}>
                {result.errors.length} dòng lỗi (thiếu mã đơn/đối tác).
              </p>
            )}
            <p className={TEXT_SUB}>
              Cột đã nhận diện: mã đơn “{result.columns.order}” · đối tác “
              {result.columns.partner}”
              {result.columns.commission && ` · hoa hồng “${result.columns.commission}”`}
            </p>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Đóng
          </Button>
          <Button onClick={handleImport} disabled={!file || busy}>
            {busy ? "Đang xử lý…" : "Import"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
