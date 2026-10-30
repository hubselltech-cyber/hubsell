"use client";

// ============================================================
// FORM "TẠO MỚI" — nguồn thứ 3 của Sao chép sản phẩm (30/10/2026, docs/SAO-CHEP-SAN-PHAM.md
// mục 24.5). Khách soạn MỘT lần theo chuẩn chung chặt nhất của 3 sàn; phần khác nhau theo
// sàn (danh mục, thuộc tính, thương hiệu, vận chuyển) để nguyên ở bước 2. Bố cục kiểu
// KiotViet: biểu mẫu dài một cột + mục lục neo bên phải + thẻ "Đạt chuẩn sàn" sống
// (manual-platform-check.tsx); bảng phân loại ở manual-variant-table.tsx.
//
// Mã SKU làm chặt từ đây (anh: "chuẩn SKU từ đầu thì sau này nối thuận tiện"): mã gốc →
// tự sinh MÃ GỐC-ĐUÔI theo tên phân loại (cùng quy tắc Nối SKU nhanh), mỗi phân loại một
// mã, 6–50 ký tự, kiểm trùng sống với Tổng kho + mọi gian đã nối.
// Trần form (số ảnh, nhóm, tổ hợp) đọc từ GET /manual-limits — một nguồn số với backend.
// ============================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  apiErrorMessage,
  checkCopyListingDraft,
  checkCopyListingSkus,
  fetchCopyListingManualLimits,
  type ChannelName,
  type CopyListingManualPayload,
} from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { stripDiacritics } from "@/lib/text";
import { TEXT_SUB, TEXT_TABLE_HEAD } from "@/lib/typography";
import { useApiQuery } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";

import { ImageGrid, uploadImageFile, useImageUploads } from "./image-grid";
import { ManualPlatformCheck } from "./manual-platform-check";
import { ManualVariantTable, type ManualVariantEdit } from "./manual-variant-table";
import { FieldLabel, RequiredPill, WARN_INPUT } from "./primitives";
import { SKU_PATTERN, type MissingContext } from "./shared";

// ---------------------------------------------------------------- Chuẩn chung (khớp backend rules.ts)

/**
 * Số "đủ 3 sàn" — mức chặt nhất của PLATFORM_LISTING_RULES backend; vượt thì thẻ Đạt chuẩn sàn nói
 * sàn nào không nhận. Chép tay (không gọi API) để nhãn nói số ngay khi khách gõ — sửa rules.ts thì sửa đây.
 */
const COMMON = { titleMin: 25, titleMax: 120, descriptionMin: 20, shopeeDescriptionMax: 3000, images: 8, options: 2, optionValues: 20, variants: 50 };
/** Số để nhãn "x / tối đa y" — chép từ PLATFORM_LISTING_RULES backend. */
const PLATFORM_CTX: Record<ChannelName, Pick<MissingContext, "maxVariants" | "maxOptions" | "maxOptionValues">> = {
  SHOPEE: { maxVariants: 50, maxOptions: 2, maxOptionValues: 20 },
  TIKTOK: { maxVariants: 100, maxOptions: 3 },
  LAZADA: { maxVariants: 100, maxOptions: 2, maxOptionValues: 20 },
  OFFLINE: {},
};

const SECTIONS = [
  { id: "tm-thong-tin", label: "Thông tin" },
  { id: "tm-anh", label: "Ảnh" },
  { id: "tm-phan-loai", label: "Phân loại & SKU" },
  { id: "tm-van-chuyen", label: "Vận chuyển" },
  { id: "tm-kho", label: "Tổng kho" },
] as const;

interface Limits {
  images: number;
  descriptionImages: number;
  options: number;
  variants: number;
  imageQuota: { used: number; max: number | null };
}

interface OptionDraft {
  name: string;
  values: string[];
  input: string;
}

/** "Đen, M" → "DEN-M" (khớp backend lib/product-group.ts variantSkuSuffix). */
function variantSkuSuffix(name: string): string {
  return stripDiacritics(name)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
function skuFromRoot(root: string, name: string): string {
  const base = root.trim().toUpperCase().replace(/\s+/g, "-");
  const suffix = variantSkuSuffix(name);
  return suffix ? `${base}-${suffix}` : base;
}

function cartesian(options: { name: string; values: string[] }[]): string[] {
  if (options.length === 0) return [""];
  return options.reduce<string[]>((acc, o) => acc.flatMap((prefix) => o.values.map((v) => (prefix ? `${prefix}, ${v}` : v))), [""]);
}

function toInt(s: string): number | null {
  const n = Number(String(s).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}
const priceOk = (s: string) => (toInt(s) ?? 0) > 0;

export interface ManualFormSummary {
  variantCount: number;
  /** Lý do chưa gửi được (null = gửi được). */
  blocker: string | null;
}

interface FormProps {
  /** Nhân viên không nhập giá vốn (backend cũng bỏ). */
  canSeeCost: boolean;
  onChange: (payload: CopyListingManualPayload | null, summary: ManualFormSummary) => void;
}

/** Đợi trần form từ server rồi mới dựng (hook ảnh cần số trần ngay từ đầu). */
export function ManualProductForm(props: FormProps) {
  const limitsQ = useApiQuery({ queryKey: qk.copyListingManualLimits(), queryFn: fetchCopyListingManualLimits });
  if (!limitsQ.data) return <p className="text-sm text-slate-500">{limitsQ.error ?? "Đang tải biểu mẫu…"}</p>;
  return <ManualProductFormBody {...props} limits={limitsQ.data} />;
}

function ManualProductFormBody({ canSeeCost, onChange, limits }: FormProps & { limits: Limits }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const cover = useImageUploads([], limits.images);
  const desc = useImageUploads([], limits.descriptionImages);
  const [options, setOptions] = useState<OptionDraft[]>([]);
  const [rootSku, setRootSku] = useState("");
  const [basePrice, setBasePrice] = useState("");
  const [baseStock, setBaseStock] = useState("0");
  const [edits, setEdits] = useState<Record<string, ManualVariantEdit>>({});
  const [weight, setWeight] = useState("");
  const [dims, setDims] = useState({ length: "", width: "", height: "" });
  const [costPrice, setCostPrice] = useState("");

  const [byPlatform, setByPlatform] = useState<Record<ChannelName, string[]> | null>(null);
  const [checkReason, setCheckReason] = useState<string | null>(null);
  const [taken, setTaken] = useState<Record<string, string>>({});
  const [active, setActive] = useState<string>(SECTIONS[0].id);

  /** Ảnh riêng từng phân loại: input ẩn dùng chung, nhớ dòng đang chọn ảnh. */
  const rowInput = useRef<HTMLInputElement>(null);
  const rowKeyRef = useRef<string | null>(null);

  // ---------------------------------------------------------------- phân loại → tổ hợp
  const liveOptions = useMemo(() => options.filter((o) => o.name.trim() && o.values.length > 0).map((o) => ({ name: o.name.trim(), values: o.values })), [options]);
  const comboNames = useMemo(() => cartesian(liveOptions), [liveOptions]);
  const rows = useMemo(
    () =>
      comboNames.map((name) => {
        const e = edits[name] ?? {};
        return {
          name,
          sku: e.sku !== undefined ? e.sku : rootSku.trim() ? skuFromRoot(rootSku, name) : "",
          price: e.price !== undefined ? e.price : basePrice,
          stock: e.stock !== undefined ? e.stock : baseStock,
          imageUrl: e.imageUrl ?? null,
          excluded: Boolean(e.excluded),
        };
      }),
    [comboNames, edits, rootSku, basePrice, baseStock]
  );
  const activeRows = rows.filter((r) => !r.excluded);
  const editRow = (name: string, patch: ManualVariantEdit) => setEdits((m) => ({ ...m, [name]: { ...(m[name] ?? {}), ...patch } }));

  /** Lỗi mã SKU từng dòng: trống / sai mẫu / trùng trong bài / đã có ở kho-gian. */
  const skuIssue = useMemo(() => {
    const count = new Map<string, number>();
    for (const r of activeRows) {
      const k = r.sku.trim().toUpperCase();
      if (k) count.set(k, (count.get(k) ?? 0) + 1);
    }
    const out: Record<string, string> = {};
    for (const r of activeRows) {
      const k = r.sku.trim();
      if (!k) out[r.name] = "Chưa có mã";
      else if (!SKU_PATTERN.test(k)) out[r.name] = k.length < 6 ? "Ngắn hơn 6 ký tự (TikTok đòi ≥ 6)" : k.length > 50 ? "Dài hơn 50 ký tự" : "Chỉ chữ, số, - _ .";
      else if ((count.get(k.toUpperCase()) ?? 0) > 1) out[r.name] = "Trùng với phân loại khác";
      else if (taken[k.toUpperCase()]) out[r.name] = `Đã có ở ${taken[k.toUpperCase()]}`;
    }
    return out;
  }, [activeRows, taken]);

  // ---------------------------------------------------------------- payload
  const payload = useMemo<CopyListingManualPayload>(() => {
    const d = { length: toInt(dims.length) ?? 0, width: toInt(dims.width) ?? 0, height: toInt(dims.height) ?? 0 };
    return {
      title: title.trim(),
      description: description.trim(),
      images: cover.urls,
      descriptionImages: desc.urls,
      weightGrams: toInt(weight),
      dimensionsCm: d.length > 0 || d.width > 0 || d.height > 0 ? d : null,
      options: liveOptions,
      variants: rows.map((r) => ({
        sku: r.sku.trim(),
        name: r.name,
        price: toInt(r.price) ?? 0,
        stock: toInt(r.stock) ?? 0,
        imageUrl: r.imageUrl,
        excluded: r.excluded || undefined,
      })),
      costPrice: canSeeCost ? toInt(costPrice) : null,
    };
  }, [title, description, cover.urls, desc.urls, weight, dims, liveOptions, rows, costPrice, canSeeCost]);
  const payloadJson = JSON.stringify(payload);
  const uploading = cover.uploading || desc.uploading;

  const blocker = useMemo<string | null>(() => {
    if (!payload.title) return "Nhập tên sản phẩm";
    // Anh chốt 30/10: mã gốc BẮT BUỘC (chuẩn SKU từ đầu) — không cho qua dù từng dòng đã gõ tay.
    if (!rootSku.trim()) return "Nhập mã gốc SKU";
    if (activeRows.length === 0) return "Cần ít nhất một phân loại để đăng";
    if (Object.keys(skuIssue).length > 0) return "Sửa mã SKU còn lỗi";
    if (activeRows.some((r) => !priceOk(r.price))) return "Giá bán phải lớn hơn 0";
    if (uploading) return "Đang tải ảnh…";
    return null;
  }, [payload.title, rootSku, activeRows, skuIssue, uploading]);

  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  useEffect(() => {
    onChangeRef.current(blocker ? null : (JSON.parse(payloadJson) as CopyListingManualPayload), { variantCount: activeRows.length, blocker });
  }, [payloadJson, blocker, activeRows.length]);

  // Thẻ "Đạt chuẩn sàn" sống — đợi gõ xong 400 ms.
  useEffect(() => {
    const t = setTimeout(() => {
      const p = JSON.parse(payloadJson) as CopyListingManualPayload;
      if (!p.title) {
        setByPlatform(null);
        setCheckReason(null);
        return;
      }
      checkCopyListingDraft(p)
        .then((r) => {
          setByPlatform(r.byPlatform);
          setCheckReason(r.reason ?? null);
        })
        .catch(() => undefined);
    }, 400);
    return () => clearTimeout(t);
  }, [payloadJson]);

  // Kiểm trùng mã với Tổng kho + gian đã nối — đợi 500 ms.
  const skuListJson = JSON.stringify([...new Set(activeRows.map((r) => r.sku.trim()).filter((s) => SKU_PATTERN.test(s)))]);
  useEffect(() => {
    const skus = JSON.parse(skuListJson) as string[];
    if (skus.length === 0) {
      setTaken({});
      return;
    }
    const t = setTimeout(() => {
      checkCopyListingSkus(skus)
        .then((r) => setTaken(Object.fromEntries(r.taken.map((x) => [x.sku.toUpperCase(), x.where]))))
        .catch(() => undefined);
    }, 500);
    return () => clearTimeout(t);
  }, [skuListJson]);

  // Mục lục neo: mục nào đang trong tầm nhìn thì sáng.
  useEffect(() => {
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter((e): e is HTMLElement => Boolean(e));
    if (els.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive(vis[0].target.id);
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: 0 }
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);

  // ---------------------------------------------------------------- ảnh phân loại
  async function addRowImage(files: FileList | null) {
    const file = files?.[0];
    const rowKey = rowKeyRef.current;
    if (!file || rowKey === null) return;
    try {
      const { url } = await uploadImageFile(file);
      editRow(rowKey, { imageUrl: url });
    } catch (err) {
      toast.error(`${file.name}: ${apiErrorMessage(err, "không tải được ảnh")}`);
    }
  }

  // ---------------------------------------------------------------- phân loại
  function addOption() {
    if (options.length >= limits.options) return;
    setOptions((o) => [...o, { name: "", values: [], input: "" }]);
  }
  function commitValue(i: number) {
    setOptions((o) =>
      o.map((opt, idx) => {
        if (idx !== i) return opt;
        const v = opt.input.trim();
        if (!v || opt.values.some((x) => x.toLowerCase() === v.toLowerCase())) return { ...opt, input: "" };
        return { ...opt, values: [...opt.values, v], input: "" };
      })
    );
  }

  const titleLen = title.trim().length;
  const titleBad = titleLen > 0 && (titleLen < COMMON.titleMin || titleLen > COMMON.titleMax);
  const descLen = description.trim().length;
  const descWarn = descLen > COMMON.shopeeDescriptionMax;
  const coverOverCommon = cover.images.length > COMMON.images;

  const ctxOf = (p: ChannelName): MissingContext => ({
    variantCount: activeRows.length,
    optionCount: liveOptions.length,
    widestOption: Math.max(0, ...liveOptions.map((o) => o.values.length)),
    skuMissing: activeRows.filter((r) => !r.sku.trim()).length,
    ...PLATFORM_CTX[p],
  });

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_240px]">
      {/* ------------------------------------------------ biểu mẫu */}
      <div className="min-w-0 space-y-6">
        {/* 1. Thông tin */}
        <section id={SECTIONS[0].id} className="scroll-mt-24 space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">1. Thông tin</h3>
          <div className="space-y-1">
            <FieldLabel label="Tên sản phẩm" meta={`${titleLen}/${COMMON.titleMax} · đủ 3 sàn cần ${COMMON.titleMin}–${COMMON.titleMax} ký tự`} warn={titleBad} />
            <Input className={cn(titleBad && WARN_INPUT)} placeholder="Vd: Túi đeo chéo nam ANO da PU cao cấp, khóa chống nước TC113" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1">
            <FieldLabel
              label="Mô tả"
              meta={`${formatNumber(descLen)} ký tự · tối thiểu ${COMMON.descriptionMin}${descWarn ? ` · Shopee cắt ở ${formatNumber(COMMON.shopeeDescriptionMax)}` : ""}`}
              warn={descWarn || (descLen > 0 && descLen < COMMON.descriptionMin)}
            />
            <Textarea
              className={cn("min-h-32", descWarn && WARN_INPUT)}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Chữ thuần, giữ xuống dòng. Shopee nhận chữ thuần; TikTok, Lazada giữ xuống dòng. Ảnh minh họa thêm ở mục Ảnh."
            />
          </div>
        </section>

        {/* 2. Ảnh */}
        <section id={SECTIONS[1].id} className="scroll-mt-24 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-sm font-semibold text-slate-900">2. Ảnh</h3>
            {limits.imageQuota.max != null && (
              <span className={cn(TEXT_SUB, "tabular-nums", limits.imageQuota.used >= limits.imageQuota.max && "text-amber-700")}>
                Gói của bạn: đã lưu {formatNumber(limits.imageQuota.used)}/{formatNumber(limits.imageQuota.max)} ảnh sản phẩm
              </span>
            )}
          </div>
          {cover.input}
          {desc.input}
          <input ref={rowInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void addRowImage(e.target.files).then(() => (e.target.value = ""))} />
          <div className="space-y-2">
            <FieldLabel label="Ảnh sản phẩm" meta={`${cover.images.length}/${limits.images}${coverOverCommon ? " · Lazada chỉ nhận 8" : ""}`} warn={coverOverCommon} />
            <ImageGrid images={cover.images} max={limits.images} editable onRemove={cover.remove} onSetCover={cover.setCover} onAdd={cover.pick} />
            <p className={TEXT_SUB}>Ảnh đầu là bìa. Nén tự động ≤ 1.600 px; nên vuông, ≥ 500 px. Lazada nhận 8, Shopee/TikTok 9.</p>
          </div>
          <div className="space-y-2">
            <FieldLabel label="Ảnh trong mô tả" meta={`${desc.images.length}/${limits.descriptionImages}`} />
            <ImageGrid images={desc.images} max={limits.descriptionImages} editable showCover={false} onRemove={desc.remove} onSetCover={desc.setCover} onAdd={desc.pick} />
            <p className={TEXT_SUB}>Ghép vào cuối mô tả khi đăng (Shopee: mô tả mở rộng; TikTok/Lazada: &lt;img&gt;).</p>
          </div>
        </section>

        {/* 3. Phân loại & SKU */}
        <section id={SECTIONS[2].id} className="scroll-mt-24 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-sm font-semibold text-slate-900">3. Phân loại & mã SKU</h3>
            <span className={TEXT_SUB}>
              Đủ 3 sàn: ≤ {COMMON.options} nhóm × {COMMON.optionValues} giá trị, ≤ {COMMON.variants} tổ hợp (nhóm 3 / &gt; 50 tổ hợp: chỉ TikTok).
            </span>
          </div>

          <div className="space-y-3">
            {options.map((opt, i) => (
              <div key={i} className="rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Input className="w-44" placeholder={i === 0 ? "Nhóm, vd: Màu" : "Nhóm, vd: Size"} value={opt.name} onChange={(e) => setOptions((o) => o.map((x, idx) => (idx === i ? { ...x, name: e.target.value } : x)))} />
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                    {opt.values.map((v) => (
                      <span key={v} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-muted/60 px-2 py-0.5 text-sm">
                        {v}
                        <button type="button" aria-label={`Bỏ ${v}`} className="text-slate-500 hover:text-slate-900" onClick={() => setOptions((o) => o.map((x, idx) => (idx === i ? { ...x, values: x.values.filter((y) => y !== v) } : x)))}>
                          <X className="size-3" />
                        </button>
                      </span>
                    ))}
                    <Input
                      className="w-40"
                      placeholder="Giá trị, Enter để thêm"
                      value={opt.input}
                      onChange={(e) => setOptions((o) => o.map((x, idx) => (idx === i ? { ...x, input: e.target.value } : x)))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === ",") {
                          e.preventDefault();
                          commitValue(i);
                        }
                      }}
                      onBlur={() => commitValue(i)}
                    />
                  </div>
                  <span className={cn(TEXT_SUB, "tabular-nums", opt.values.length > COMMON.optionValues && "text-amber-700")}>
                    {opt.values.length}/{COMMON.optionValues}
                  </span>
                  <Button size="xs" variant="ghost" onClick={() => setOptions((o) => o.filter((_, idx) => idx !== i))}>
                    Bỏ nhóm
                  </Button>
                </div>
              </div>
            ))}
            {options.length < limits.options && (
              <Button size="sm" variant="outline" onClick={addOption}>
                <Plus data-icon="inline-start" /> {options.length === 0 ? "Thêm phân loại (Màu, Size…)" : "Thêm nhóm phân loại"}
              </Button>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <div className={cn(TEXT_TABLE_HEAD, "flex items-center gap-2")}>
                Mã gốc SKU <RequiredPill tone="amber" />
              </div>
              <Input className={cn(!rootSku.trim() && WARN_INPUT)} placeholder="Vd: TC113" value={rootSku} onChange={(e) => setRootSku(e.target.value)} />
              <p className={TEXT_SUB}>{liveOptions.length > 0 ? "Tự sinh MÃ GỐC-ĐUÔI theo phân loại, sửa tay từng dòng được." : "Sản phẩm không phân loại: mã gốc = mã SKU."}</p>
            </div>
            <div className="space-y-1">
              <div className={TEXT_TABLE_HEAD}>Giá bán chung (đ)</div>
              <Input inputMode="numeric" placeholder="199000" value={basePrice} onChange={(e) => setBasePrice(e.target.value)} />
              <p className={TEXT_SUB}>Áp cho dòng chưa sửa riêng.</p>
            </div>
            <div className="space-y-1">
              <div className={TEXT_TABLE_HEAD}>Tồn chung</div>
              <Input inputMode="numeric" placeholder="10" value={baseStock} onChange={(e) => setBaseStock(e.target.value)} />
              <p className={TEXT_SUB}>Tồn đăng lên sàn và nhập Tổng kho.</p>
            </div>
          </div>

          <ManualVariantTable
            rows={rows}
            skuIssue={skuIssue}
            priceOk={priceOk}
            onEdit={editRow}
            onPickImage={(name) => {
              rowKeyRef.current = name;
              rowInput.current?.click();
            }}
          />
          <div className={cn(TEXT_SUB, "flex flex-wrap items-center gap-x-3")}>
            <span className="tabular-nums">
              {activeRows.length} phân loại sẽ đăng{rows.length !== activeRows.length ? ` (bỏ ${rows.length - activeRows.length})` : ""}
            </span>
            {Object.values(edits).some((e) => e.sku !== undefined) && (
              <Button size="xs" variant="ghost" onClick={() => setEdits((m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { ...v, sku: undefined }])))}>
                Áp lại mã theo mã gốc
              </Button>
            )}
          </div>
        </section>

        {/* 4. Vận chuyển */}
        <section id={SECTIONS[3].id} className="scroll-mt-24 space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">4. Vận chuyển</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <div className={cn(TEXT_TABLE_HEAD, "flex items-center gap-2")}>
                Cân nặng (gram) <RequiredPill tone="amber">Bắt buộc 3 sàn</RequiredPill>
              </div>
              <Input inputMode="numeric" placeholder="600" value={weight} onChange={(e) => setWeight(e.target.value)} className={cn(weight && !priceOk(weight) && WARN_INPUT)} />
              <p className={TEXT_SUB}>Cân cả gói hàng, tính phí ship. Vd áo thun: 250.</p>
            </div>
            <div className="space-y-1">
              <div className={cn(TEXT_TABLE_HEAD, "flex items-center gap-2")}>
                Kích thước kiện (cm) <RequiredPill tone="amber">Lazada bắt buộc</RequiredPill>
              </div>
              <div className="flex gap-2">
                {(["length", "width", "height"] as const).map((k, i) => (
                  <Input key={k} inputMode="numeric" placeholder={["Dài", "Rộng", "Cao"][i]} value={dims[k]} onChange={(e) => setDims((d) => ({ ...d, [k]: e.target.value }))} />
                ))}
              </div>
              <p className={TEXT_SUB}>Shopee/TikTok không bắt buộc, nhưng điền thì phải đủ 3 số.</p>
            </div>
          </div>
        </section>

        {/* 5. Tổng kho */}
        <section id={SECTIONS[4].id} className="scroll-mt-24 space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">5. Tổng kho</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {canSeeCost && (
              <div className="space-y-1">
                <div className={TEXT_TABLE_HEAD}>Giá vốn mặc định (đ) — tùy chọn</div>
                <Input inputMode="numeric" placeholder="120000" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} />
                <p className={TEXT_SUB}>Ghi vào SKU kho. Giá vốn riêng từng gian nhập ở Tài chính → Mapping giá vốn sau khi đăng.</p>
              </div>
            )}
            <p className={cn(TEXT_SUB, "self-end")}>
              Khi bấm Đăng, mỗi phân loại thành một SKU trong Tổng kho với tồn ở trên. <span className="text-slate-900">Chưa nối với gian</span> — muốn đồng bộ tồn thì vào Hàng hóa bấm Tự khớp (mã trùng nhau nên khớp đúng).
            </p>
          </div>
        </section>
      </div>

      <ManualPlatformCheck sections={SECTIONS} activeSection={active} hasTitle={Boolean(payload.title)} checkReason={checkReason} byPlatform={byPlatform} ctxOf={ctxOf} blocker={blocker} />
    </div>
  );
}
