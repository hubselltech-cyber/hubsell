"use client";

// ============================================================
// Khung "Sửa bài đăng": ảnh (bìa + phụ, bỏ / tải mới, ≤ 9) bên trái · tên + mô tả rộng bên
// phải · bảng phân loại bên dưới (SKU / giá / tồn / bỏ đăng từng dòng) — sửa một lần áp
// cho MỌI gian đích của sản phẩm. Giới hạn tên / mô tả / ảnh gom từ luật các sàn đích.
// ============================================================

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { CopyIconButton } from "@/components/ui/copy-icon-button";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { apiErrorMessage, updateCopyListingSource, type CopyListingJob } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { stripDiacritics } from "@/lib/text";
import { TEXT_SUB, TEXT_TABLE_HEAD } from "@/lib/typography";
import { useInvalidate } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";

import { ImageGrid, useImageUploads } from "./image-grid";
import { FieldLabel, WARN_INPUT } from "./primitives";
import { duplicateSkus, MAX_LISTING_IMAGES, WARNING_LABELS } from "./shared";

/** Ảnh chèn trong mô tả hiện tối đa ngần này (sàn nhận 12 ảnh đầu). */
const DESC_IMAGE_PREVIEW = 12;
/** Chỉ xem (đã đăng): hiện ngần này phân loại đầu. */
const VIEW_VARIANT_ROWS = 12;

/** Giá / tồn / mã SKU / bỏ đăng từng phân loại đang sửa, theo vị trí trong source.variants (chỉ ô khách đã gõ). */
type SourceVariantEdit = { price?: number; stock?: number; sku?: string; excluded?: boolean };

export function SourceEditor({ job, batchId, editable }: { job: CopyListingJob; batchId: string; editable: boolean }) {
  const invalidate = useInvalidate();
  const s = job.source;
  const [title, setTitle] = useState(s.title);
  const [description, setDescription] = useState(s.description);
  const [variantEdits, setVariantEdits] = useState<Record<number, SourceVariantEdit>>({});
  const [saving, setSaving] = useState(false);
  /** Ảnh bài đăng (anh chốt 30/10: khách xóa ảnh cũ / tải ảnh mới ngay tại đây, tối đa 9). Lưu → thay toàn bộ danh sách. */
  const photos = useImageUploads(s.images, MAX_LISTING_IMAGES);
  const imagesDirty = photos.urls.length !== s.images.length || photos.urls.some((u, i) => u !== s.images[i]);

  const variantPatch = Object.entries(variantEdits)
    .map(([i, e]) => ({ index: Number(i), ...e }))
    .filter(
      (e) =>
        (e.price !== undefined && e.price !== s.variants[e.index]?.price) ||
        (e.stock !== undefined && e.stock !== s.variants[e.index]?.stock) ||
        (e.sku !== undefined && e.sku.trim() !== s.variants[e.index]?.sku) ||
        (e.excluded !== undefined && e.excluded !== Boolean(s.variants[e.index]?.excluded))
    );
  const dirty = title !== s.title || description !== s.description || variantPatch.length > 0 || imagesDirty;
  const setVariant = (i: number, k: "price" | "stock", raw: string) =>
    setVariantEdits((m) => ({ ...m, [i]: { ...(m[i] ?? {}), [k]: raw === "" ? 0 : Math.max(0, Number(raw) || 0) } }));
  const setVariantSku = (i: number, raw: string) => setVariantEdits((m) => ({ ...m, [i]: { ...(m[i] ?? {}), sku: raw } }));
  const variantExcluded = (i: number) => variantEdits[i]?.excluded ?? Boolean(s.variants[i]?.excluded);
  const toggleExcluded = (i: number) => setVariantEdits((m) => ({ ...m, [i]: { ...(m[i] ?? {}), excluded: !variantExcluded(i) } }));
  const variantSku = (i: number) => variantEdits[i]?.sku ?? s.variants[i]?.sku ?? "";
  const activeIdx = s.variants.map((_, i) => i).filter((i) => !variantExcluded(i));
  const skuMissingCount = activeIdx.filter((i) => !variantSku(i).trim()).length;
  const skuDuplicate = duplicateSkus(activeIdx.map(variantSku)).size > 0;

  /**
   * Tự đặt mã cho phân loại chưa có: chữ cái đầu các từ trong tên (≤6 ký tự, không dấu) + số thứ tự,
   * vd "TKBTNC-07". Khách sửa lại từng ô được; mã trùng gian đích thì bước xem trước vẫn báo.
   */
  function autoFillSkus() {
    const initials = stripDiacritics(title)
      .replace(/[^A-Za-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0].toUpperCase())
      .join("")
      .slice(0, 6);
    const prefix = initials || "SP";
    const taken = new Set(s.variants.map((_, i) => variantSku(i).trim().toLowerCase()).filter(Boolean));
    setVariantEdits((m) => {
      const next = { ...m };
      let n = 0;
      s.variants.forEach((v, i) => {
        if ((next[i]?.sku ?? v.sku).trim()) return;
        let code: string;
        do {
          n += 1;
          code = `${prefix}-${String(n).padStart(2, "0")}`;
        } while (taken.has(code.toLowerCase()));
        taken.add(code.toLowerCase());
        next[i] = { ...(next[i] ?? {}), sku: code };
      });
      return next;
    });
  }

  const reqs = job.targets.map((t) => t.requirements).filter((r): r is NonNullable<typeof r> => r != null);
  const titleMin = reqs.length ? Math.max(...reqs.map((r) => r.titleMin)) : null;
  const titleMax = reqs.length ? Math.min(...reqs.map((r) => r.titleMax)) : null;
  const descMax = reqs.length ? Math.min(...reqs.map((r) => r.descriptionMax)) : null;
  const maxImages = reqs.length ? Math.min(...reqs.map((r) => r.maxImages)) : null;
  const titleLen = title.trim().length;
  const descLen = description.trim().length;
  const titleBad = (titleMin != null && titleLen < titleMin) || (titleMax != null && titleLen > titleMax);
  const descBad = descMax != null && descLen > descMax;

  async function save() {
    setSaving(true);
    try {
      await updateCopyListingSource(job.id, {
        title,
        description,
        ...(variantPatch.length ? { variants: variantPatch } : {}),
        ...(imagesDirty ? { images: photos.urls } : {}),
      });
      toast.success("Đã cập nhật bài đăng cho mọi gian đích của sản phẩm này.");
      await invalidate(qk.copyListingBatch(batchId));
      setVariantEdits({});
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-5 md:grid-cols-[14rem_1fr]">
        {/* Ảnh bài đăng: ảnh đầu = bìa; còn sửa được thì bỏ ảnh cũ / thêm ảnh mới, tối đa 9. */}
        <div className="space-y-2">
          <FieldLabel label={`Ảnh (${photos.images.length}/${MAX_LISTING_IMAGES})`} meta={maxImages != null && photos.images.length > maxImages ? `sàn nhận ${maxImages} ảnh đầu` : undefined} warn />
          {photos.input}
          {photos.images.length === 0 && <p className="text-sm text-amber-700">Chưa có ảnh — sàn sẽ từ chối.</p>}
          <ImageGrid images={photos.images} max={MAX_LISTING_IMAGES} editable={editable} tile="square" onRemove={photos.remove} onSetCover={photos.setCover} onAdd={photos.pick} />
          {editable && <p className={TEXT_SUB}>Bỏ ảnh có chữ khuyến mãi cũ, khung sàn khác; ảnh mới nén tự động. Lazada chỉ lấy 8 ảnh đầu.</p>}
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <FieldLabel label="Tên sản phẩm" meta={`${titleLen} ký tự${titleMin != null && titleMax != null ? ` · sàn đích nhận ${titleMin}–${titleMax}` : ""}`} warn={titleBad} />
            <Input className={cn(titleBad && WARN_INPUT)} value={title} disabled={!editable} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1">
            <FieldLabel label="Mô tả" meta={`${formatNumber(descLen)} ký tự${descMax != null ? ` · tối đa ${formatNumber(descMax)}` : ""}`} warn={descBad} />
            <Textarea
              className={cn(descBad && WARN_INPUT)}
              rows={Math.min(14, Math.max(6, description.split("\n").length + 1))}
              value={description}
              disabled={!editable}
              onChange={(e) => setDescription(e.target.value)}
            />
            <p className={TEXT_SUB}>Shopee nhận chữ thuần; TikTok, Lazada giữ xuống dòng. Video không chép theo — bổ sung trên sàn sau khi đăng.</p>
          </div>
          {/* Ảnh chèn trong mô tả của nguồn: chép theo, ghép vào CUỐI mô tả trên gian đích. */}
          {s.descriptionImages.length > 0 && (
            <div className="space-y-1">
              <FieldLabel
                label={`Ảnh trong mô tả (${s.descriptionImages.length})`}
                meta={`chép theo, xếp cuối mô tả trên gian đích${s.descriptionImages.length > DESC_IMAGE_PREVIEW ? ` · sàn nhận ${DESC_IMAGE_PREVIEW} ảnh đầu` : ""}`}
              />
              <div className="flex flex-wrap gap-2">
                {s.descriptionImages.slice(0, DESC_IMAGE_PREVIEW).map((url, i) => (
                  <div key={url + i} className="size-16 overflow-hidden rounded-lg border border-slate-200 bg-card">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={`Ảnh mô tả ${i + 1}`} className="size-full object-cover" loading="lazy" />
                  </div>
                ))}
                {s.descriptionImages.length > DESC_IMAGE_PREVIEW && (
                  <div className={cn(TEXT_SUB, "flex size-16 items-center justify-center rounded-lg border border-dashed border-slate-200")}>
                    +{s.descriptionImages.length - DESC_IMAGE_PREVIEW}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Phân loại: giá / tồn nguồn SỬA ĐƯỢC từng dòng (anh 29/10) — % giá và Tồn đăng ở dòng gian áp chồng lên. */}
      <div className="space-y-1">
        <FieldLabel
          label={`Phân loại (${activeIdx.length} đăng${activeIdx.length < s.variants.length ? ` · ${s.variants.length - activeIdx.length} bỏ` : ""})`}
          meta={s.options.length > 0 ? s.options.map((o) => `${o.name}: ${o.values.join(" / ")}`).join(" · ") : undefined}
        />
        {editable && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className={TEXT_SUB}>
              Gõ thẳng vào ô Mã SKU / Giá / Tồn để sửa. Bỏ tick cột Đăng để không đưa phân loại đó lên gian đích (khi vượt trần phân loại của sàn).
            </span>
            {skuMissingCount > 0 && (
              <span className="inline-flex items-center gap-2 text-sm text-amber-700">
                {skuMissingCount} phân loại chưa có mã SKU
                <Button size="xs" variant="outline" onClick={autoFillSkus}>
                  Tự đặt mã cho phân loại thiếu
                </Button>
              </span>
            )}
            {skuDuplicate && (
              <span className="text-sm text-amber-700" title={WARNING_LABELS.sku_duplicate.detail}>
                Có mã SKU trùng nhau — Shopee/TikTok vẫn đăng được, Lazada từ chối; nối kho từng phân loại cần mã riêng.
              </span>
            )}
          </div>
        )}
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                {editable && <TableHead className="w-[6%]">Đăng</TableHead>}
                <TableHead className={editable ? "w-[34%]" : "w-[40%]"}>Phân loại</TableHead>
                <TableHead className="w-[28%]">Mã SKU</TableHead>
                <TableHead className="w-[16%] text-right">Giá nguồn</TableHead>
                <TableHead className="w-[16%] text-right">Tồn nguồn</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(editable ? s.variants : s.variants.slice(0, VIEW_VARIANT_ROWS)).map((v, i) => {
                const price = variantEdits[i]?.price ?? v.price;
                const stock = variantEdits[i]?.stock ?? v.stock;
                const excluded = variantExcluded(i);
                const sku = variantSku(i);
                return (
                  <TableRow key={i} className={cn(excluded && "opacity-50")}>
                    {editable && (
                      <TableCell>
                        <input type="checkbox" className="size-4 accent-primary" aria-label={`Đăng phân loại ${v.name ?? i + 1}`} checked={!excluded} onChange={() => toggleExcluded(i)} />
                      </TableCell>
                    )}
                    <TableCell className="whitespace-normal text-sm text-slate-900">
                      <span className="inline-flex items-center gap-2">
                        {/* Ảnh riêng của phân loại (ảnh màu) — chép sang gian đích: Shopee tier 1, TikTok sku_img, Lazada ảnh SKU. */}
                        {v.imageUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={v.imageUrl} alt="" className="size-8 shrink-0 rounded border border-slate-200 object-cover" loading="lazy" />
                        )}
                        {v.name ?? "Sản phẩm đơn"}
                        {excluded && <span className={TEXT_SUB}>· không đăng</span>}
                      </span>
                    </TableCell>
                    <TableCell>
                      {editable && !excluded ? (
                        <Input className={cn("h-8 w-full max-w-56 font-mono", !sku.trim() && WARN_INPUT)} placeholder="Nhập mã SKU" value={sku} onChange={(e) => setVariantSku(i, e.target.value)} />
                      ) : v.sku ? (
                        <span className="inline-flex items-center gap-1 font-mono text-sm">
                          {v.sku}
                          <CopyIconButton value={v.sku} what="mã SKU" />
                        </span>
                      ) : (
                        <span className="text-sm text-amber-700">Thiếu SKU</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {editable && !excluded ? (
                        <Input type="number" min={0} step={1000} className={cn("ml-auto h-8 w-32 text-right", price <= 0 && WARN_INPUT)} value={price} onChange={(e) => setVariant(i, "price", e.target.value)} />
                      ) : (
                        <Money value={price} />
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {editable && !excluded ? (
                        <Input type="number" min={0} className="ml-auto h-8 w-24 text-right" value={stock} onChange={(e) => setVariant(i, "stock", e.target.value)} />
                      ) : (
                        formatNumber(stock)
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {!editable && s.variants.length > VIEW_VARIANT_ROWS && (
                <TableRow>
                  <TableCell colSpan={4} className={cn(TEXT_SUB, "py-2 text-center")}>
                    +{s.variants.length - VIEW_VARIANT_ROWS} phân loại nữa
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {s.attributes.length > 0 && (
        <div className="space-y-1">
          <div className={TEXT_TABLE_HEAD}>Thuộc tính nguồn (điền sẵn sang gian đích khi trùng tên)</div>
          <div className="flex flex-wrap gap-1.5">
            {s.attributes.map((a) => (
              <span key={a.name} className="rounded-md border border-slate-200 bg-card px-2 py-0.5 text-xs text-slate-900">
                <span className="text-slate-500">{a.name}:</span> {a.value}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <span className={cn(TEXT_SUB, "whitespace-normal")}>
          Tên, mô tả, giá và tồn sửa ở đây áp cho MỌI gian đích của sản phẩm này; muốn giá / tồn khác cho riêng một gian thì
          dùng % điều chỉnh giá và Tồn đăng ở dòng gian đó.
        </span>
        {editable && (
          <Button size="sm" disabled={!dirty || saving || photos.uploading} onClick={save}>
            {saving ? "Đang lưu…" : "Lưu bài đăng"}
          </Button>
        )}
      </div>
    </div>
  );
}
