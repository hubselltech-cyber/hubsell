"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Upload,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ApiError, importProductsExcel, type ImportResult } from "@/lib/api";
import { downloadProductTemplate } from "@/lib/excel";
import { cn } from "@/lib/utils";

export function ImportExcelDialog({ onImported }: { onImported: () => void }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null);
    setResult(null);
    setDragging(false);
  }

  function pickFile(f: File | undefined) {
    if (!f) return;
    if (!/\.(xlsx|xls)$/i.test(f.name)) {
      toast.error("Vui lòng chọn file Excel (.xlsx hoặc .xls)");
      return;
    }
    setFile(f);
    setResult(null);
  }

  async function handleUpload() {
    if (!file) return;
    setSubmitting(true);
    try {
      const res = await importProductsExcel(file);
      setResult(res);
      toast.success(
        `Đã nhập thành công ${res.totalImported} sản phẩm vào kho!` +
          (res.skipped > 0 ? ` (${res.skipped} dòng bị bỏ qua)` : ""),
        { duration: 6000 }
      );
      onImported();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không kết nối được máy chủ");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger render={<Button variant="outline" />}>
        <Upload className="size-4" />
        Nhập Excel
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nhập sản phẩm từ Excel</DialogTitle>
          <DialogDescription>
            Tải lên file .xlsx theo mẫu. SKU đã có sẽ được cập nhật giá & tồn kho;
            SKU mới sẽ được tạo mới.
          </DialogDescription>
        </DialogHeader>

        {/* Nút tải file mẫu */}
        <div className="flex items-center justify-between rounded-lg border border-dashed bg-muted/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            Chưa biết cấu trúc cột? Tải file mẫu:
          </span>
          <Button variant="ghost" size="sm" onClick={downloadProductTemplate}>
            <Download className="size-4" />
            Tải file Excel mẫu
          </Button>
        </div>

        {/* Vùng kéo-thả */}
        {!file ? (
          <div
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              pickFile(e.dataTransfer.files?.[0]);
            }}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
              dragging
                ? "border-primary bg-primary/5"
                : "border-input hover:border-primary/50 hover:bg-muted/40"
            )}
          >
            <FileSpreadsheet className="size-9 text-emerald-500" />
            <p className="text-sm">
              Kéo thả file Excel vào đây, hoặc bấm để chọn
            </p>
            <p className="text-xs text-muted-foreground">
              Hỗ trợ .xlsx, .xls · tối đa 5MB
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-xl border bg-muted/30 p-3">
            <FileSpreadsheet className="size-8 shrink-0 text-emerald-500" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{file.name}</p>
              <p className="text-xs text-muted-foreground">
                {(file.size / 1024).toFixed(1)} KB
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                setFile(null);
                setResult(null);
              }}
            >
              <X className="size-4" />
            </Button>
          </div>
        )}

        {/* Kết quả sau khi nhập */}
        {result && (
          <div className="space-y-2 rounded-xl border bg-emerald-50/60 p-3 text-sm">
            <p className="flex items-center gap-2 font-medium text-emerald-800">
              <CheckCircle2 className="size-4" />
              Đã tạo mới {result.created} · cập nhật {result.updated} · bỏ qua{" "}
              {result.skipped}
            </p>
            {result.errors.length > 0 && (
              <div className="max-h-32 overflow-y-auto rounded-lg bg-background p-2 text-xs text-muted-foreground">
                {result.errors.map((e, i) => (
                  <p key={i}>
                    • Dòng {e.row}: {e.message}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={submitting}
          >
            {result ? "Đóng" : "Huỷ"}
          </Button>
          <Button onClick={handleUpload} disabled={!file || submitting || !!result}>
            {submitting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Upload className="size-4" />
            )}
            Nhập vào kho
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
