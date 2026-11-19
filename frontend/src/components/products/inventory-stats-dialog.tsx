"use client";

// ============================================================
// HỘP "THỐNG KÊ" Ở TỔNG KHO (19/11/2026 — docs/QUAN-LY-KHO-TAI-CAU-TRUC.md mục 14).
// Anh Trung: thay nút "Đồng bộ tồn kho" bằng "Thống kê" — hộp cho biết cả kho có bao nhiêu sản phẩm,
// SKU, tồn, kèm báo cáo tổng tồn / tổng giá trị.
//
// Số của CẢ KHO, không theo ô tìm / chip lọc của bảng, và cùng định nghĩa với bảng: sản phẩm = mẫu hàng,
// hết hàng = tồn ≤ 0, giá trị tồn = tồn × giá vốn (tồn âm tính 0, SKU chưa có giá vốn chưa được cộng —
// hai phần "chưa tính" đó ghi rõ dưới bảng thay vì lặng lẽ thiếu). Chỉ gọi máy chủ khi hộp mở; khóa
// truy vấn nằm dưới "products" nên mọi thao tác ghi ở Tổng kho làm tươi luôn hộp này.
// Người không thấy tài chính: máy chủ không trả tiền, hộp bỏ ô và cột giá trị.
// ============================================================

import { BarChart3, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Money } from "@/components/ui/money";
import { fetchInventoryStats, type InventoryStats, type InventoryStatsBucket } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { TEXT_CARD_TITLE, TEXT_HERO_NUMBER, TEXT_SUB, TEXT_TABLE_HEAD } from "@/lib/typography";
import { useApiQuery } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";

export function InventoryStatsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const q = useApiQuery({ queryKey: qk.inventoryStats(), queryFn: fetchInventoryStats, enabled: open });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="size-4 text-slate-500" />
            Thống kê Tổng kho
          </DialogTitle>
          <DialogDescription>Số liệu của cả kho ngay lúc này, không theo ô tìm hay bộ lọc đang chọn ở bảng.</DialogDescription>
        </DialogHeader>

        {q.data ? (
          <StatsBody stats={q.data} />
        ) : q.error ? (
          <p className="py-6 text-center text-sm text-amber-700">{q.error}</p>
        ) : (
          <p className={cn(TEXT_SUB, "flex items-center justify-center gap-2 py-6")}>
            <Loader2 className="size-4 animate-spin" /> Đang tính…
          </p>
        )}

        <div className="flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Đóng
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Tile({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border px-3 py-2.5">
      <div className={TEXT_CARD_TITLE}>{label}</div>
      <div className={cn(TEXT_HERO_NUMBER, "truncate")}>{children}</div>
      {sub && <div className={cn(TEXT_SUB, "truncate")}>{sub}</div>}
    </div>
  );
}

function StatsBody({ stats }: { stats: InventoryStats }) {
  const seesCost = !stats.costPriceHidden;
  // Shop cách ON_HAND (kho chuẩn quốc tế, 20/11/2026): số lượng và giá trị tính trên HÀNG TRONG KHO
  // (gồm hàng đang giữ cho đơn); "hết hàng" = không còn hàng để bán — mã đó vẫn có thể còn hàng trong
  // kho vì đang giữ cho đơn, nên dòng "hết hàng" có số lượng và giá trị riêng.
  const onHand = stats.stockModel === "ON_HAND";
  const activeSkus = stats.inStock.skus + stats.outOfStock.skus;
  const rows: { label: string; bucket: InventoryStatsBucket; total?: boolean }[] = [
    { label: onHand ? "Đang bán, còn hàng để bán" : "Đang bán, còn hàng", bucket: stats.inStock },
    { label: onHand ? "Đang bán, hết hàng để bán" : "Đang bán, hết hàng", bucket: stats.outOfStock },
    // Ngừng bán chỉ thành một dòng khi có — kho không ngừng mã nào thì bảng gọn hai dòng.
    ...(stats.inactive.skus > 0 ? [{ label: "Ngừng bán", bucket: stats.inactive }] : []),
    { label: "Tổng cộng", bucket: stats.total, total: true },
  ];
  const noCostSkus = stats.noCostSkus ?? 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3">
        <Tile label="Sản phẩm" sub="mẫu hàng đang bán">
          {formatNumber(stats.products)}
        </Tile>
        <Tile
          label="SKU"
          sub={stats.inactive.skus > 0 ? `đang bán · thêm ${formatNumber(stats.inactive.skus)} ngừng bán` : "phân loại đang bán"}
        >
          {formatNumber(activeSkus)}
        </Tile>
        <Tile
          label="Tổng tồn kho"
          sub={
            onHand
              ? `${formatNumber(stats.outOfStock.skus)} SKU hết hàng để bán`
              : `${formatNumber(stats.outOfStock.skus)} SKU đang hết hàng`
          }
        >
          {formatNumber(stats.total.quantity)}
        </Tile>
        {seesCost && (
          <div className="sm:col-span-3">
            <Tile
              label="Tổng giá trị tồn"
              sub={
                onHand
                  ? "Hàng trong kho × giá vốn của từng SKU, gồm cả hàng đã có đơn chưa giao"
                  : "Tồn kho × giá vốn của từng SKU"
              }
            >
              <Money value={stats.total.value ?? 0} />
            </Tile>
          </div>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr className={TEXT_TABLE_HEAD}>
              <th className="px-3 py-2 text-left font-medium">Báo cáo tồn kho</th>
              <th className="px-3 py-2 text-right font-medium">SKU</th>
              <th className="px-3 py-2 text-right font-medium">Tồn kho</th>
              {seesCost && <th className="px-3 py-2 text-right font-medium">Giá trị tồn</th>}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.label} className={cn(r.total && "bg-muted/40 font-semibold")}>
                <td className="px-3 py-2">{r.label}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatNumber(r.bucket.skus)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatNumber(r.bucket.quantity)}</td>
                {seesCost && (
                  <td className="px-3 py-2 text-right tabular-nums">
                    <Money value={r.bucket.value ?? 0} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phần CHƯA nằm trong các con số trên — mỗi ý một dòng. */}
      {(noCostSkus > 0 || stats.negativeSkus > 0) && (
        <ul className={cn(TEXT_SUB, "list-disc space-y-1 pl-5")}>
          {noCostSkus > 0 && (
            <li>
              <b className="text-amber-700">{formatNumber(noCostSkus)} SKU còn hàng chưa nhập giá vốn</b> (tồn{" "}
              {formatNumber(stats.noCostQuantity ?? 0)}) — chưa tính vào giá trị tồn. Nhập giá vốn ở nút sửa của sản phẩm.
            </li>
          )}
          {stats.negativeSkus > 0 && (
            <li>
              {formatNumber(stats.negativeSkus)} SKU đang âm tồn (đã bán nhiều hơn số trong kho) — tính là 0 trong tổng tồn và giá trị.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
