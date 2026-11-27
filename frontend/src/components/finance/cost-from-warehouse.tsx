"use client";

// ============================================================
// NÚT "LẤY GIÁ VỐN TỪ TỔNG KHO" ở trang Cấu hình Giá vốn (lát B, 27/11/2026 —
// docs/QUAN-LY-KHO-TAI-CAU-TRUC.md mục 15.7; anh Trung: "Trong phần cập nhật giá vốn này có đường nào để lấy
// giá vốn từ Sản phẩm Tổng kho thì sẽ tốt").
//
// SKU sàn đã nối kho mà gian đang đặt giá vốn riêng thì giá Tổng kho không tới được. Bấm nút → máy chủ soi
// trong phạm vi đang lọc (tab sàn + gian) → hộp xem trước:
//   · SKU có giá riêng BẰNG giá Tổng kho: chuyển sang theo Tổng kho, không đổi số nào — chỉ báo số lượng;
//   · SKU có giá riêng KHÁC giá Tổng kho: bảng từng dòng giá của gian → giá Tổng kho, khách tích dòng muốn đổi.
//     Dòng lệch nhiều lần không tích sẵn (máy chủ đánh dấu `bigGap`) — hai giá cách xa nhau thì thường một bên
//     nhập nhầm hoặc nối nhầm quy cách, phải để khách nhìn rồi mới đổi.
// Chữ hai nút theo cách anh Trung đặt cho hộp hỏi ở Tổng kho ("Không thay đổi giá vốn của gian hàng" / "Áp … lên
// gian hàng") để khách gặp cùng một cách nói ở hai nơi.
// ============================================================

import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, Warehouse } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  apiErrorMessage,
  applyCostFromWarehouse,
  previewCostFromWarehouse,
  type CostFromWarehousePreview,
  type SkuChannelFilter,
} from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { formatNumber, formatVND } from "@/lib/format";
import { TEXT_SUB, TEXT_TABLE_HEAD } from "@/lib/typography";
import { cn } from "@/lib/utils";

export function CostFromWarehouseButton({
  channel,
  shop,
  scopeLabel,
  disabled,
  onApplied,
}: {
  /** Tab sàn đang chọn của trang. */
  channel: SkuChannelFilter;
  /** "all" hoặc id gian đang chọn. */
  shop: string;
  /** Phạm vi nói bằng chữ, vd "mọi gian" / "gian ABC" — in trong hộp để khách biết nút áp tới đâu. */
  scopeLabel: string;
  disabled?: boolean;
  onApplied: () => void;
}) {
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [preview, setPreview] = useState<CostFromWarehousePreview | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  async function open() {
    setChecking(true);
    try {
      const p = await previewCostFromWarehouse({ channel, shop });
      // Không có gì để đổi VÀ không còn SKU nào thiếu giá vốn mà nút bó tay → một câu báo là đủ. Còn SKU thiếu giá vốn
      // (chưa nối kho / kho chưa có giá) thì vẫn mở hộp để nói rõ vì sao chưa lấy được, không báo "đã xong".
      if (p.same === 0 && p.differ === 0 && p.unlinkedNoCost === 0 && p.linkedNoWarehouseCost === 0) {
        toast.info("Không có SKU sàn đã nối nào đang đặt giá vốn riêng — các gian hàng đã tính theo giá vốn ở Tổng kho.", { duration: 7000 });
        return;
      }
      // Dòng lệch nhiều lần KHÔNG tích sẵn; còn lại tích sẵn (khách bấm nút là muốn lấy giá Tổng kho).
      setPicked(new Set(p.rows.filter((r) => !r.bigGap).map((r) => r.id)));
      setPreview(p);
    } catch (err) {
      toast.error(apiErrorMessage(err, "Không soi được giá vốn ở Tổng kho."));
    } finally {
      setChecking(false);
    }
  }

  const rows = useMemo(() => preview?.rows ?? [], [preview]);
  const allPicked = rows.length > 0 && rows.every((r) => picked.has(r.id));
  const bigGapCount = rows.filter((r) => r.bigGap).length;
  const hidden = preview ? preview.differ - rows.length : 0;
  const willChange = (preview?.same ?? 0) + picked.size;
  /** Có SKU nào chuyển được sang giá Tổng kho không — không có thì hộp chỉ để giải thích, một nút Đóng. */
  const canApply = preview !== null && (preview.same > 0 || preview.differ > 0);
  const stuck = preview !== null && (preview.unlinkedNoCost > 0 || preview.linkedNoWarehouseCost > 0);

  function toggle(id: string) {
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function apply() {
    if (!preview || willChange === 0) return;
    setApplying(true);
    try {
      const r = await applyCostFromWarehouse({ channel, shop }, [...picked]);
      const total = r.followedSame + r.followedDiffer;
      toast.success(
        total === 0
          ? "Không có SKU sàn nào cần đổi."
          : `${formatNumber(total)} SKU sàn nay tính theo giá vốn ở Tổng kho` +
              (r.followedDiffer > 0 ? ` — ${formatNumber(r.followedDiffer)} SKU đổi giá vốn` : " — không SKU nào đổi số"),
        { duration: 7000 }
      );
      setPreview(null);
      onApplied();
    } catch (err) {
      toast.error(apiErrorMessage(err, "Không áp được giá vốn từ Tổng kho."), { duration: 8000 });
    } finally {
      setApplying(false);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={() => void open()}
        disabled={disabled || checking}
        title="SKU sàn đã nối kho mà gian hàng đang đặt giá vốn riêng: xem trước rồi chuyển sang tính theo giá vốn ở Tổng kho"
      >
        {checking ? <Loader2 className="size-4 animate-spin" /> : <Warehouse className="size-4" />}
        Lấy giá vốn từ Tổng kho
      </Button>

      <Dialog open={preview !== null} onOpenChange={(o) => !o && !applying && setPreview(null)}>
        {/* max-h + cuộn: ca lớn (500 dòng lệch + khối "chưa lấy được giá") cao hơn màn laptop 768 px — hộp tự cuộn, chân hộp
            dính đáy để hai nút luôn trong tầm mắt (cùng cách với hộp Sửa sản phẩm). */}
        {/* Bề ngang: 48rem nhưng luôn chừa lề 1rem mỗi bên — `sm:max-w-3xl` trần trụi làm hộp chạm sát hai mép ở màn
            640–800 px (đo ở 768 px: hộp rộng 753, lề 0). */}
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[min(48rem,calc(100%-2rem))]">
          <DialogHeader>
            <DialogTitle>Lấy giá vốn từ Tổng kho</DialogTitle>
            <DialogDescription>
              {canApply ? (
                <>
                  Chuyển SKU sàn đã nối kho của {scopeLabel} sang tính theo giá vốn ở Tổng kho. Sau này sửa giá vốn ở Tổng kho là gian hàng đổi
                  theo. Đơn cũ đã có giá vốn giữ nguyên.
                </>
              ) : (
                <>Trong phạm vi {scopeLabel}, chưa có SKU sàn nào lấy được giá vốn từ Tổng kho.</>
              )}
            </DialogDescription>
          </DialogHeader>

          {preview && preview.same > 0 && (
            <p className="rounded-lg border border-slate-200 bg-muted/40 px-3 py-2 text-sm">
              <span className="font-medium tabular-nums">{formatNumber(preview.same)}</span> SKU sàn đang có giá vốn bằng đúng giá ở Tổng kho — chuyển
              sang tính theo Tổng kho, không đổi số nào.
            </p>
          )}

          {preview && preview.differ > 0 && (
            <div className="space-y-2">
              <div className="space-y-0.5">
                <p className="text-sm">
                  <span className="font-medium tabular-nums">{formatNumber(preview.differ)}</span> SKU sàn đang có giá vốn khác giá ở Tổng kho. Tích
                  dòng muốn đổi theo Tổng kho.
                </p>
                {bigGapCount > 0 && (
                  <p className="text-[13px] leading-snug text-amber-700">
                    {formatNumber(bigGapCount)} dòng hai giá lệch nhau nhiều lần chưa được tích sẵn — xem bên nào đúng rồi hãy tích.
                  </p>
                )}
              </div>
              <div className={cn("overflow-auto rounded-lg border border-slate-200", stuck ? "max-h-[36vh]" : "max-h-[46vh]")}>
                {/* Điện thoại (< sm): bảng 5 cột không vừa 300 px, hai cột giá từng trôi ra ngoài phải cuộn ngang mới thấy
                    → ẩn cột Gian hàng + hai cột giá, in gian và "giá gian → giá Tổng kho" ngay dưới tên SKU. */}
                <table className="w-full table-fixed text-sm sm:min-w-[600px]">
                  <thead className="sticky top-0 z-10 bg-muted">
                    <tr className={TEXT_TABLE_HEAD}>
                      <th className="w-10 px-3 py-2 text-left">
                        <input
                          type="checkbox"
                          className="size-4 align-middle accent-primary"
                          checked={allPicked}
                          aria-label="Tích tất cả dòng"
                          onChange={(e) => setPicked(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                        />
                      </th>
                      <th className="hidden w-[24%] px-2 py-2 text-left font-medium sm:table-cell">Gian hàng</th>
                      <th className="px-2 py-2 text-left font-medium">SKU sàn</th>
                      <th className="hidden w-[19%] px-2 py-2 text-right font-medium sm:table-cell">Giá của gian hàng</th>
                      <th className="hidden w-[19%] px-3 py-2 text-right font-medium sm:table-cell">Giá ở Tổng kho</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((r) => {
                      const on = picked.has(r.id);
                      return (
                        <tr key={r.id} className={cn("cursor-pointer", r.bigGap && "bg-amber-50/60")} onClick={() => toggle(r.id)}>
                          <td className="px-3 py-2 align-top">
                            <input
                              type="checkbox"
                              className="size-4 align-middle accent-primary"
                              checked={on}
                              aria-label={`Đổi ${r.channelSku} theo Tổng kho`}
                              onClick={(e) => e.stopPropagation()}
                              onChange={() => toggle(r.id)}
                            />
                          </td>
                          <td className="hidden px-2 py-2 align-top sm:table-cell">
                            <span className="block truncate" title={r.shopName}>
                              {r.shopName}
                            </span>
                            <span className={cn(TEXT_SUB, "block")}>{CHANNEL_META[r.channelName]?.label ?? r.channelName}</span>
                          </td>
                          <td className="px-2 py-2 align-top">
                            <span className="block truncate" title={r.variantName ? `${r.productName} — ${r.variantName}` : r.productName}>
                              {r.variantName?.trim() || r.productName}
                            </span>
                            <span className={cn(TEXT_SUB, "block truncate font-mono")} title={`Mã SKU kho ${r.stockSku}`}>
                              {r.stockSku}
                            </span>
                            {/* Điện thoại: gian + hai giá nằm ngay đây (các cột riêng đã ẩn). */}
                            <span className={cn(TEXT_SUB, "block truncate sm:hidden")}>
                              {r.shopName} · {CHANNEL_META[r.channelName]?.label ?? r.channelName}
                            </span>
                            <span className="mt-0.5 block tabular-nums sm:hidden">
                              <span className={on ? "text-muted-foreground line-through" : "font-medium"}>{formatVND(r.ownCost)}</span>
                              <span className="mx-1.5 text-muted-foreground">→</span>
                              <span className={on ? "font-medium" : "text-muted-foreground"}>{formatVND(r.warehouseCost)}</span>
                            </span>
                            {r.bigGap && <span className="block text-[11px] leading-snug text-amber-700">Hai giá lệch nhau nhiều lần</span>}
                          </td>
                          {/* Chữ đậm = giá gian hàng sẽ dùng sau khi áp: tích thì là giá Tổng kho, không tích thì giữ giá của gian. */}
                          <td
                            className={cn(
                              "hidden px-2 py-2 text-right align-top tabular-nums sm:table-cell",
                              on ? "text-muted-foreground line-through" : "font-medium"
                            )}
                          >
                            {formatVND(r.ownCost)}
                          </td>
                          <td className={cn("hidden px-3 py-2 text-right align-top tabular-nums sm:table-cell", on ? "font-medium" : "text-muted-foreground")}>
                            {formatVND(r.warehouseCost)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {hidden > 0 && (
                <p className={TEXT_SUB}>
                  Đang bày {formatNumber(rows.length)} dòng lệch nhiều nhất. Còn {formatNumber(hidden)} dòng nữa — áp xong bấm nút lần nữa để xem tiếp.
                </p>
              )}
            </div>
          )}

          {/* SKU sàn đang bán còn thiếu giá vốn mà nút không lấy giá hộ được — nói rõ vì sao + đường đi tiếp, kẻo khách
              có cả nghìn SKU chưa có giá bấm nút rồi tưởng đã xong (anh Trung 27/11). */}
          {preview && stuck && (
            <div className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <p className="font-medium">Còn SKU sàn đang bán chưa lấy được giá vốn từ Tổng kho</p>
              <ul className="list-disc space-y-0.5 pl-5">
                {preview.unlinkedNoCost > 0 && (
                  <li>
                    <span className="font-medium tabular-nums">{formatNumber(preview.unlinkedNoCost)}</span> SKU sàn chưa nối với Tổng kho.{" "}
                    <Link href="/products/marketplace" className="underline underline-offset-2 hover:text-foreground">
                      Nối ở Sản phẩm trên sàn
                    </Link>{" "}
                    rồi bấm lại nút này, hoặc nhập giá vốn ngay trong bảng.
                  </li>
                )}
                {preview.linkedNoWarehouseCost > 0 && (
                  <li>
                    <span className="font-medium tabular-nums">{formatNumber(preview.linkedNoWarehouseCost)}</span> SKU sàn đã nối nhưng sản phẩm ở
                    Tổng kho chưa có giá vốn.{" "}
                    <Link href="/products" className="underline underline-offset-2 hover:text-foreground">
                      Nhập giá vốn ở Tổng kho
                    </Link>{" "}
                    là các gian hàng đã nối tính theo.
                  </li>
                )}
              </ul>
            </div>
          )}

          <DialogFooter className="sticky -bottom-4 z-10 bg-muted sm:items-center">
            {canApply ? (
              <>
                <span className={cn(TEXT_SUB, "sm:mr-auto")}>
                  {willChange > 0 ? `Sẽ áp cho ${formatNumber(willChange)} SKU sàn` : "Chưa tích dòng nào"}
                </span>
                <Button type="button" variant="outline" onClick={() => setPreview(null)} disabled={applying}>
                  Không thay đổi giá vốn của gian hàng
                </Button>
                <Button type="button" onClick={() => void apply()} disabled={applying || willChange === 0}>
                  {applying ? <Loader2 className="size-4 animate-spin" /> : null}
                  Áp giá vốn Tổng kho lên gian hàng
                </Button>
              </>
            ) : (
              <Button type="button" variant="outline" onClick={() => setPreview(null)}>
                Đóng
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
