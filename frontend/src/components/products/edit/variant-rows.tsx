"use client";

// ============================================================
// Bảng phân loại của hộp "Sửa sản phẩm" (18/11/2026): mỗi SKU kho một dòng. Dòng đang có sửa được
// phân loại / mã SKU / giá bán; giá vốn và tồn chỉ xem (sửa ở Cấu hình Giá vốn và Nhập · Xuất). Dòng
// mới thêm nhập đủ cả giá vốn + tồn ban đầu và bỏ được trước khi lưu.
// Ô căng mép trên (align-top) để dòng lỗi dưới một ô không kéo các ô cạnh trôi xuống — cùng cách với
// bảng phân loại của form Tạo sản phẩm mới.
// ============================================================

import { X } from "lucide-react";

import { BAD_INPUT, WARN_INPUT } from "@/components/operations/copy-listing/primitives";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { formatNumber } from "@/lib/format";
import { TEXT_NUMBER_MUTED, TEXT_SUB, TEXT_TABLE_HEAD } from "@/lib/typography";
import { cn } from "@/lib/utils";

import type { RowDraft, RowEdit, RowIssues } from "./draft";

const CELL = "px-2 py-1.5 align-top";
const FIELD = "h-8 px-2";
/** Ô chỉ xem canh theo hàng 32 px của ô nhập bên cạnh. */
const READONLY = "block leading-8";

export function VariantRows({
  rows,
  issues,
  seesCost,
  anchorKey,
  onEdit,
  onRemove,
}: {
  rows: RowDraft[];
  issues: Record<string, RowIssues>;
  seesCost: boolean;
  /** Dòng khách bấm Sửa từ menu ⋯ — tô nhẹ để nhận ra giữa mẫu nhiều phân loại; null = mở từ dòng cha. */
  anchorKey: string | null;
  onEdit: (key: string, patch: RowEdit) => void;
  onRemove: (key: string) => void;
}) {
  const single = rows.length === 1;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      {/* min-w: hẹp hơn mức này (điện thoại) thì cuộn ngang trong khung, ô Giá bán vẫn đủ chỗ cho số 8 chữ số.
          Cột Mã SKU ăn phần còn lại (~37 %): mã dài tới 50 ký tự, mã thường gặp ≤ 30 ký tự hiện trọn. */}
      <table className="w-full min-w-[760px] table-fixed text-sm">
        <thead className="bg-muted/40">
          <tr className={TEXT_TABLE_HEAD}>
            <th className="w-[22%] px-2 py-2 text-left font-medium">Phân loại</th>
            <th className="px-2 py-2 text-left font-medium">Mã SKU</th>
            <th className="w-[16%] px-2 py-2 text-left font-medium">Giá bán</th>
            {seesCost && <th className="w-[15%] px-2 py-2 text-left font-medium">Giá vốn</th>}
            <th className="w-[10%] px-2 py-2 text-left font-medium">Tồn kho</th>
            <th className="w-9 px-1 py-2" aria-label="Bỏ dòng" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => {
            const isNew = r.kind === "new";
            // Dòng mới CHƯA gõ gì thì chưa tô đỏ — vừa bấm Thêm đã báo lỗi là mắng oan; dòng chân hộp vẫn nói còn thiếu gì.
            const untouched = isNew && !r.variantName && !r.skuCode;
            const issue = untouched ? undefined : issues[r.key];
            const label = r.skuCode.trim() || "phân loại mới";
            return (
              <tr
                key={r.key}
                data-row-key={r.key}
                className={cn(isNew && "bg-emerald-50/40", !isNew && r.key === anchorKey && rows.length > 1 && "bg-sky-50/50")}
              >
                <td className={CELL}>
                  <Input
                    className={cn(FIELD, issue?.variant && BAD_INPUT)}
                    value={r.variantName}
                    placeholder={single ? "không phân loại" : "vd Đen, M"}
                    aria-label={`Phân loại của ${label}`}
                    maxLength={200}
                    onChange={(e) => onEdit(r.key, { variantName: e.target.value })}
                  />
                  {issue?.variant && <p className="mt-0.5 text-[11px] leading-snug text-red-500">{issue.variant}</p>}
                  {!isNew && !r.original.isActive && <p className={cn(TEXT_SUB, "mt-0.5")}>Ngừng bán</p>}
                </td>
                <td className={CELL}>
                  <Input
                    // Hiện chữ hoa ngay khi gõ — máy chủ lưu mã SKU chữ hoa, khách thấy đúng mã sẽ lưu.
                    className={cn(FIELD, "font-mono uppercase placeholder:normal-case", issue?.sku ? BAD_INPUT : issue?.skuNote && WARN_INPUT)}
                    value={r.skuCode}
                    placeholder="mã SKU"
                    aria-label={`Mã SKU của ${label}`}
                    title={r.skuCode}
                    maxLength={50}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(e) => onEdit(r.key, { skuCode: e.target.value })}
                  />
                  {issue?.sku ? (
                    <p className="mt-0.5 text-[11px] leading-snug text-red-500">{issue.sku}</p>
                  ) : issue?.skuNote ? (
                    <p className="mt-0.5 text-[11px] leading-snug text-amber-700">{issue.skuNote}</p>
                  ) : null}
                </td>
                <td className={CELL}>
                  <CurrencyInput
                    className={cn(FIELD, "tabular-nums")}
                    value={r.price}
                    placeholder="0"
                    aria-label={`Giá bán của ${label}`}
                    maxLength={13}
                    onValueChange={(v) => onEdit(r.key, { price: v })}
                  />
                </td>
                {seesCost && (
                  <td className={CELL}>
                    {isNew ? (
                      <CurrencyInput
                        className={cn(FIELD, "tabular-nums")}
                        value={r.cost}
                        placeholder="0"
                        aria-label={`Giá vốn của ${label}`}
                        maxLength={13}
                        onValueChange={(v) => onEdit(r.key, { cost: v })}
                      />
                    ) : (
                      <span className={READONLY}>
                        <Money value={r.original.costPrice ?? 0} className={TEXT_NUMBER_MUTED} />
                      </span>
                    )}
                  </td>
                )}
                <td className={CELL}>
                  {isNew ? (
                    <>
                      <CurrencyInput
                        className={cn(FIELD, "tabular-nums", issue?.stock && BAD_INPUT)}
                        value={r.stock}
                        placeholder="0"
                        aria-label={`Tồn ban đầu của ${label}`}
                        maxLength={9}
                        onValueChange={(v) => onEdit(r.key, { stock: v })}
                      />
                      {issue?.stock && <p className="mt-0.5 text-[11px] leading-snug text-red-500">{issue.stock}</p>}
                    </>
                  ) : (
                    <span className={READONLY}>
                      <span className={TEXT_NUMBER_MUTED}>{formatNumber(r.original.quantityInStock)}</span>
                    </span>
                  )}
                </td>
                <td className="px-1 py-1.5 align-top">
                  {isNew && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="mt-0.5 text-muted-foreground"
                      title="Bỏ phân loại mới này"
                      aria-label={`Bỏ ${label}`}
                      onClick={() => onRemove(r.key)}
                    >
                      <X className="size-4" />
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
