"use client";

import * as React from "react";
import { toast } from "sonner";
import { Download, ExternalLink, FileText, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ApiError,
  fetchHandoverSheetsPdf,
  type HandoverSheetSummary,
} from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { openPdfBlob } from "@/lib/print-labels";

export type CreatedSheet = Pick<
  HandoverSheetSummary,
  "id" | "code" | "carrierLabel" | "orderCount"
>;

/** Tải blob về máy bằng thẻ <a download> — không bị chặn pop-up vì là click của người dùng. */
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * HỘP KẾT QUẢ SAU KHI TẠO BIÊN BẢN BÀN GIAO (01/11/2026, anh Trung chốt luồng
 * gọn: tích đơn Đã đóng gói → Tạo biên bản → ra PDF từng hãng). Mỗi hãng một
 * dòng với Mở / Tải về; thêm "Mở tất cả" ghép một file. Mở ở đây là click của
 * người dùng nên trình duyệt không chặn tab mới như khi mở tự động.
 */
export function HandoverSheetsDialog({
  sheets,
  skipped,
  onClose,
}: {
  /** null = đóng */
  sheets: CreatedSheet[] | null;
  /** Số đơn đã tích nhưng không đưa vào biên bản (chưa đóng gói / đã bàn giao / đã hủy) */
  skipped: number;
  onClose: () => void;
}) {
  const [busy, setBusy] = React.useState<string | null>(null);

  async function run(
    key: string,
    ids: string[],
    mode: "open" | "download",
    filename: string,
  ) {
    setBusy(key);
    try {
      const blob = await fetchHandoverSheetsPdf(ids);
      if (mode === "download") downloadBlob(blob, filename);
      else if (!openPdfBlob(blob)) {
        toast.warning("Trình duyệt chặn tab mới — bấm Tải về rồi mở file");
      }
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Không tải được biên bản",
      );
    } finally {
      setBusy(null);
    }
  }

  const list = sheets ?? [];
  const allIds = list.map((s) => s.id);
  return (
    <Dialog open={sheets !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Đã tạo {formatNumber(list.length)} biên bản bàn giao
          </DialogTitle>
          <DialogDescription>
            Mỗi đơn vị vận chuyển một tờ A4 có mã vạch từng đơn, ship ký ở cuối
            tờ.
            {skipped > 0 &&
              ` ${formatNumber(skipped)} đơn đã tích bị bỏ qua vì chưa đóng gói, đã bàn giao trước đó hoặc đã hủy.`}
          </DialogDescription>
        </DialogHeader>

        <ul className="divide-y rounded-lg border">
          {list.map((s) => {
            const file = `bien-ban-ban-giao-${s.code}.pdf`;
            return (
              <li
                key={s.id}
                className="flex flex-wrap items-center gap-2 px-3 py-2"
              >
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {s.carrierLabel} · {formatNumber(s.orderCount)} kiện
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {s.code}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => run(`o-${s.id}`, [s.id], "open", file)}
                >
                  {busy === `o-${s.id}` ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <ExternalLink className="size-4" />
                  )}
                  Mở
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => run(`d-${s.id}`, [s.id], "download", file)}
                >
                  {busy === `d-${s.id}` ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Download className="size-4" />
                  )}
                  Tải về
                </Button>
              </li>
            );
          })}
        </ul>

        <div className="flex flex-wrap justify-end gap-2">
          {list.length > 1 && (
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={() =>
                run(
                  "all",
                  allIds,
                  "open",
                  `bien-ban-ban-giao-${list.length}-to.pdf`,
                )
              }
            >
              {busy === "all" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ExternalLink className="size-4" />
              )}
              Mở tất cả (một file)
            </Button>
          )}
          <Button onClick={onClose}>Xong</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
