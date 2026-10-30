"use client";

// ============================================================
// Bảng phân loại của form Tạo mới: mỗi tổ hợp một dòng (Đăng / tên / mã SKU + lỗi /
// giá / tồn / ảnh). Sửa theo TÊN tổ hợp (tổ hợp sinh động từ nhóm phân loại), khác bảng
// của Sửa bài đăng (source-editor.tsx, sửa theo vị trí) nên không gộp.
// Các ô căng mép trên (align-top) + checkbox / tên / nút Ảnh canh theo hàng 32 px — dòng
// lỗi dưới ô SKU không kéo ô Giá / Tồn trôi xuống (anh báo 30/10).
// ============================================================

import { ImagePlus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TEXT_TABLE_HEAD } from "@/lib/typography";
import { cn } from "@/lib/utils";

import { BAD_INPUT, WARN_INPUT } from "./primitives";

export interface ManualVariantRow {
  /** Tên tổ hợp ("Đen, M"); "" = sản phẩm không phân loại. */
  name: string;
  sku: string;
  price: string;
  stock: string;
  imageUrl: string | null;
  excluded: boolean;
}

export interface ManualVariantEdit {
  sku?: string;
  price?: string;
  stock?: string;
  imageUrl?: string | null;
  excluded?: boolean;
}

export function ManualVariantTable({
  rows,
  skuIssue,
  priceOk,
  onEdit,
  onPickImage,
}: {
  rows: ManualVariantRow[];
  /** Lỗi mã SKU theo tên tổ hợp. */
  skuIssue: Record<string, string>;
  priceOk: (price: string) => boolean;
  onEdit: (name: string, patch: ManualVariantEdit) => void;
  /** Mở hộp chọn tệp ảnh cho dòng. */
  onPickImage: (name: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <table className="w-full table-fixed text-sm">
        <thead className="bg-muted/40">
          <tr className={TEXT_TABLE_HEAD}>
            <th className="w-[6%] px-2 py-2 text-left font-medium">Đăng</th>
            <th className="w-[20%] px-2 py-2 text-left font-medium">Phân loại</th>
            <th className="w-[30%] px-2 py-2 text-left font-medium">Mã SKU</th>
            <th className="w-[18%] px-2 py-2 text-left font-medium">Giá</th>
            <th className="w-[13%] px-2 py-2 text-left font-medium">Tồn</th>
            <th className="w-[13%] px-2 py-2 text-left font-medium">Ảnh</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => {
            const issue = skuIssue[r.name];
            return (
              <tr key={r.name || "__single"} className={cn(r.excluded && "opacity-50")}>
                <td className="px-2 py-1.5 align-top">
                  <input type="checkbox" className="mt-2 size-4 accent-primary" aria-label="Đăng phân loại này" checked={!r.excluded} onChange={() => onEdit(r.name, { excluded: !r.excluded })} />
                </td>
                <td className="truncate px-2 py-1.5 align-top leading-8 text-slate-900" title={r.name}>
                  {r.name || "Sản phẩm (không phân loại)"}
                </td>
                <td className="px-2 py-1.5 align-top">
                  <Input className={cn("h-8 px-2 font-mono text-[13px]", issue && !r.excluded && BAD_INPUT)} value={r.sku} placeholder="6–50 ký tự" onChange={(e) => onEdit(r.name, { sku: e.target.value })} />
                  {issue && !r.excluded && <div className="mt-0.5 text-[11px] leading-snug text-red-500">{issue}</div>}
                </td>
                <td className="px-2 py-1.5 align-top">
                  <Input className={cn("h-8 px-2 tabular-nums", !r.excluded && !priceOk(r.price) && WARN_INPUT)} inputMode="numeric" value={r.price} onChange={(e) => onEdit(r.name, { price: e.target.value })} />
                </td>
                <td className="px-2 py-1.5 align-top">
                  <Input className="h-8 px-2 tabular-nums" inputMode="numeric" value={r.stock} onChange={(e) => onEdit(r.name, { stock: e.target.value })} />
                </td>
                <td className="px-2 py-1.5 align-top">
                  {r.imageUrl ? (
                    <button type="button" className="group relative size-8 overflow-hidden rounded border border-slate-200" title="Bỏ ảnh phân loại" onClick={() => onEdit(r.name, { imageUrl: null })}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={r.imageUrl} alt="" className="size-full object-cover" />
                      <span className="absolute inset-0 hidden items-center justify-center bg-black/60 text-white group-hover:flex">
                        <X className="size-3" />
                      </span>
                    </button>
                  ) : (
                    <Button size="xs" variant="ghost" className="mt-1" onClick={() => onPickImage(r.name)}>
                      <ImagePlus data-icon="inline-start" /> Ảnh
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
