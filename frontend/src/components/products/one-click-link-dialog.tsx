"use client";

import { useState } from "react";
import { Loader2, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ApiError,
  autoMatchMappings,
  createProductsFromMappings,
  fetchChannelProducts,
} from "@/lib/api";
import { formatNumber } from "@/lib/format";

interface OneClickLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Số sản phẩm sàn chưa nối — chỉ để hiện trong tiêu đề. */
  unlinkedCount: number;
  /** Gọi sau khi nối xong (dù chỉ tự khớp hay cả tạo SKU) — hub refresh số liệu. */
  onDone: () => void;
}

/**
 * HỘP THOẠI "TỰ KHỚP + TẠO SKU" — một cửa vào duy nhất cho việc nối sản phẩm sàn
 * về kho (06/09: gộp hai nút "Tự khớp SKU" và "Tự khớp + tạo SKU toàn bộ" cũ,
 * seller mới không phải phân biệt). Hai mức trong cùng một hộp:
 *
 *   · CHỈ TỰ KHỚP trùng mã — không sinh SKU kho mới, an toàn tuyệt đối.
 *   · TỰ KHỚP + TẠO SKU CÒN LẠI — khớp trùng mã trước, phần còn lại tạo SKU kho
 *     từ chính dữ liệu sàn rồi nối luôn (tồn ban đầu lấy theo sàn).
 *
 * Dùng ở khối Thiết lập kho (bước 2) và tab Sản phẩm trên sàn.
 */
export function OneClickLinkDialog({
  open,
  onOpenChange,
  unlinkedCount,
  onDone,
}: OneClickLinkDialogProps) {
  const [busy, setBusy] = useState<"match" | "full" | null>(null);
  const [progress, setProgress] = useState("");

  async function runMatchOnly() {
    setBusy("match");
    try {
      setProgress("Đang tự khớp SKU trùng mã…");
      const r = await autoMatchMappings();
      if (r.matched === 0) {
        toast.info(
          `Không có SKU nào trùng mã với kho (đã quét ${formatNumber(r.scanned)} dòng chưa liên kết). Chọn "Tự khớp + tạo SKU còn lại" để tạo SKU kho cho phần này.`,
          { duration: 7000 }
        );
      } else {
        toast.success(
          `Tự khớp xong: nối ${formatNumber(r.matched)} SKU sàn vào ${formatNumber(r.products)} sản phẩm kho.` +
            (r.seededProducts > 0
              ? ` ${formatNumber(r.seededProducts)} SKU tồn 0 đã lấy tồn theo sàn.`
              : ""),
          { duration: 6000 }
        );
        onOpenChange(false);
      }
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không tự khớp được");
    } finally {
      setBusy(null);
      setProgress("");
    }
  }

  async function runFull() {
    setBusy("full");
    try {
      // (1) Tự khớp trùng mã trước — liên kết đúng nhất, không đẻ SKU thừa.
      setProgress("Đang tự khớp SKU trùng mã…");
      const matched = await autoMatchMappings();

      // (2) Phần còn lại: gom id chưa liên kết rồi tạo SKU kho theo lô.
      let created = 0;
      let reused = 0;
      let linked = 0;
      for (;;) {
        const pageRes = await fetchChannelProducts({
          linked: "no",
          page: 1, // luôn trang 1 — mỗi lô xử lý xong thì dòng rơi khỏi bộ lọc
          pageSize: 100,
        });
        if (pageRes.items.length === 0) break;
        setProgress(
          `Đang tạo SKU kho — còn ${formatNumber(pageRes.counts.unlinked)} sản phẩm sàn…`
        );
        const r = await createProductsFromMappings(pageRes.items.map((i) => i.id));
        created += r.createdProducts;
        reused += r.reusedProducts;
        linked += r.linked;
        // Không tiến thêm được nữa (dòng lỗi/thiếu mã SKU) — dừng để khỏi lặp vô hạn.
        if (r.linked === 0) break;
      }

      toast.success(
        `Xong: tự khớp ${formatNumber(matched.matched)} SKU, tạo mới ${formatNumber(created)} SKU kho` +
          (reused > 0 ? ` (dùng lại ${formatNumber(reused)})` : "") +
          `, nối thêm ${formatNumber(linked)} sản phẩm sàn.`,
        { duration: 8000 }
      );
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không xử lý hết được");
    } finally {
      setBusy(null);
      setProgress("");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary" />
            Nối {formatNumber(unlinkedCount)} sản phẩm sàn về kho
          </DialogTitle>
          <DialogDescription>
            Sản phẩm sàn <b>trùng mã SKU</b> với kho sẽ tự nối. Phần còn lại, nếu anh/chị
            chọn, Hubsell tạo SKU kho mới từ chính dữ liệu sàn (tên, ảnh, giá) rồi nối
            luôn. Tồn ban đầu lấy theo số đang có trên sàn, sàn không trả số thì tồn 0,
            chỉnh tay sau.
          </DialogDescription>
        </DialogHeader>
        {progress && (
          <p className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm">
            <Loader2 className="size-4 animate-spin" />
            {progress}
          </p>
        )}
        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy !== null}>
            Để sau
          </Button>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              onClick={runMatchOnly}
              disabled={busy !== null}
              title="Chỉ nối những SKU sàn trùng mã với kho, không tạo SKU mới"
            >
              {busy === "match" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Wand2 className="size-4" />
              )}
              Chỉ tự khớp trùng mã
            </Button>
            <Button onClick={runFull} disabled={busy !== null}>
              {busy === "full" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              Tự khớp + tạo SKU còn lại
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
