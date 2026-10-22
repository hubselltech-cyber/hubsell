"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Image as ImageIcon, Loader2, Sparkles, Wand2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import {
  ApiError,
  autoMatchMappings,
  createProductsFromMappings,
  fetchChannelProducts,
  fetchFallbackSkuItems,
  type FallbackSkuItem,
} from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { formatNumber } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

interface OneClickLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Số sản phẩm sàn chưa nối — chỉ để hiện trong tiêu đề. */
  unlinkedCount: number;
  /** Gọi sau khi nối xong (dù chỉ tự khớp hay cả tạo SKU) — hub refresh số liệu. */
  onDone: () => void;
}

/**
 * Đuôi mã SKU kho từ tên phân loại — BẢN SAO của backend lib/product-group.ts
 * variantSkuSuffix, chỉ để XEM TRƯỚC mã trong hộp; mã thật do backend sinh.
 */
function previewSku(root: string, variantName: string | null): string {
  const base = root.trim().toUpperCase().replace(/\s+/g, "-");
  if (!variantName) return base;
  const suffix = variantName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, (c) => (c === "đ" ? "d" : "D"))
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return suffix ? `${base}-${suffix}` : base;
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
 * 22/10/2026 (khách shop váy phàn nàn mã "SPE-…" + phân loại tồn 0 cũng vào kho):
 *   · Ô tích "Bỏ qua phân loại đang tồn 0 trên sàn".
 *   · Sản phẩm sàn KHÔNG có mã SKU → bước hỏi MÃ GỐC từng sản phẩm (cách Salework
 *     "mã gốc + mã model"): gõ "VAY01" → SKU kho VAY01-DEN-M, VAY01-TRANG-L…
 *     Để trống = giữ mã máy như cũ. Lời khuyên gốc vẫn là đặt SKU ngay trên sàn.
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
  const [skipZeroStock, setSkipZeroStock] = useState(false);
  // Bước "mã gốc": danh sách sản phẩm sàn không có mã + mã khách gõ theo id sản phẩm sàn.
  const [step, setStep] = useState<"choose" | "roots">("choose");
  const [fallback, setFallback] = useState<FallbackSkuItem[]>([]);
  const [fallbackTotal, setFallbackTotal] = useState(0);
  const [roots, setRoots] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) {
      setStep("choose");
      setFallback([]);
      setFallbackTotal(0);
      setRoots({});
    }
  }, [open]);

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

  /** Bấm "Tự khớp + tạo SKU còn lại": có sản phẩm không mã → hỏi mã gốc trước; không thì chạy luôn. */
  async function startFull() {
    setBusy("full");
    setProgress("Đang kiểm tra sản phẩm chưa có mã SKU trên sàn…");
    try {
      const r = await fetchFallbackSkuItems();
      if (r.items.length > 0) {
        setFallback(r.items);
        setFallbackTotal(r.total);
        setStep("roots");
        setBusy(null);
        setProgress("");
        return;
      }
    } catch {
      // Không tải được danh sách — không chặn luồng chính, tạo với mã máy như cũ.
    }
    await runFull({});
  }

  async function runFull(rootSkus: Record<string, string>) {
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
          inStock: skipZeroStock ? "yes" : undefined,
          page: 1, // luôn trang 1 — mỗi lô xử lý xong thì dòng rơi khỏi bộ lọc
          pageSize: 100,
        });
        if (pageRes.items.length === 0) break;
        setProgress(
          `Đang tạo SKU kho — còn ${formatNumber(pageRes.counts.unlinked)} sản phẩm sàn…`
        );
        const r = await createProductsFromMappings(
          pageRes.items.map((i) => i.id),
          { rootSkus, skipZeroStock }
        );
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

  const rootsFilled = Object.values(roots).filter((v) => v.trim()).length;

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className={cn(step === "roots" && "sm:max-w-2xl")}>
        {step === "choose" ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="size-5 text-primary" />
                Nối {formatNumber(unlinkedCount)} sản phẩm sàn về kho
              </DialogTitle>
              <DialogDescription>
                Sản phẩm sàn <b>trùng mã SKU</b> với kho sẽ tự nối. Phần còn lại, nếu anh/chị
                chọn, Hubsell tạo SKU kho mới từ chính dữ liệu sàn (tên, phân loại, ảnh, giá)
                rồi nối luôn. Tồn ban đầu lấy theo số đang có trên sàn, sàn không trả số thì
                tồn 0, chỉnh tay sau.
              </DialogDescription>
            </DialogHeader>
            <label className="flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 cursor-pointer accent-primary"
                checked={skipZeroStock}
                onChange={(e) => setSkipZeroStock(e.target.checked)}
                disabled={busy !== null}
              />
              <span>
                Bỏ qua phân loại đang <b>tồn 0</b> trên sàn
                <span className={cn(TEXT_SUB, "block")}>
                  Hàng đã hết trên sàn không tạo SKU kho; sau này nhập hàng lại thì nối ở tab
                  Sản phẩm trên sàn. Sàn không trả số tồn thì vẫn tạo.
                </span>
              </span>
            </label>
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
                <Button onClick={startFull} disabled={busy !== null}>
                  {busy === "full" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Sparkles className="size-4" />
                  )}
                  Tự khớp + tạo SKU còn lại
                </Button>
              </div>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="size-5 text-primary" />
                {formatNumber(fallbackTotal)} sản phẩm trên sàn chưa đặt mã SKU
              </DialogTitle>
              <DialogDescription>
                Gõ <b>mã gốc</b> cho từng sản phẩm, Hubsell ghép thêm phân loại thành mã SKU kho
                (VD gõ <span className="font-mono">VAY01</span> → <span className="font-mono">VAY01-DEN-M</span>).
                Để trống thì mã kho là mã máy của sàn như trước. Lâu dài nên đặt SKU ngay trên
                sàn để mọi gian cùng một mã.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
              {fallback.map((it) => {
                const meta = CHANNEL_META[it.channelName];
                const root = roots[it.itemId] ?? "";
                const sample = it.variants[0];
                return (
                  <div key={it.itemId} className="flex items-center gap-3 rounded-md border px-3 py-2">
                    {it.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.imageUrl} alt={it.productName} className="size-10 shrink-0 rounded-md object-cover" />
                    ) : (
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        <ImageIcon className="size-4" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium" title={it.productName}>
                        {it.productName}
                      </p>
                      <p className={cn(TEXT_SUB, "truncate")}>
                        {meta?.label ?? it.channelName} · {it.shopName} ·{" "}
                        {formatNumber(it.variants.length)} phân loại
                        {sample?.variantName ? ` (${sample.variantName}…)` : ""}
                      </p>
                      {root.trim() && sample && (
                        <p className="truncate font-mono text-[11px] text-sky-700">
                          → {previewSku(root, sample.variantName)}
                          {it.variants.length > 1 ? " …" : ""}
                        </p>
                      )}
                    </div>
                    <Input
                      className="w-36 shrink-0 font-mono uppercase"
                      placeholder="Mã gốc"
                      aria-label={`Mã gốc cho ${it.productName}`}
                      maxLength={40}
                      value={root}
                      disabled={busy !== null}
                      onChange={(e) => setRoots((r) => ({ ...r, [it.itemId]: e.target.value }))}
                    />
                  </div>
                );
              })}
              {fallbackTotal > fallback.length && (
                <p className={cn(TEXT_SUB, "px-1")}>
                  Chỉ hiện {formatNumber(fallback.length)} sản phẩm đầu. Phần còn lại tạo với mã máy —
                  đặt SKU trên sàn rồi Đồng bộ từ sàn là gọn nhất.
                </p>
              )}
            </div>
            {progress && (
              <p className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm">
                <Loader2 className="size-4 animate-spin" />
                {progress}
              </p>
            )}
            <DialogFooter className="sm:justify-between">
              <Button variant="ghost" onClick={() => setStep("choose")} disabled={busy !== null}>
                <ArrowLeft className="size-4" />
                Quay lại
              </Button>
              <Button onClick={() => runFull(roots)} disabled={busy !== null}>
                {busy === "full" ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                {rootsFilled > 0
                  ? `Tạo SKU với ${formatNumber(rootsFilled)} mã gốc`
                  : "Tạo SKU với mã máy"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
