"use client";

// ============================================================
// FORM "TẠO MỚI" — nguồn thứ 3 của Sao chép sản phẩm (30/10/2026, docs/SAO-CHEP-SAN-PHAM.md
// mục 24.5). Khách soạn MỘT lần theo chuẩn chung chặt nhất của 3 sàn; phần khác nhau theo
// sàn (danh mục, thuộc tính, thương hiệu, vận chuyển) để nguyên ở bước 2. Bố cục kiểu
// KiotViet: biểu mẫu dài một cột + mục lục neo bên phải + thẻ "Đạt chuẩn sàn" sống.
//
// Mã SKU làm chặt từ đây (anh: "chuẩn SKU từ đầu thì sau này nối thuận tiện"): mã gốc →
// tự sinh MÃ GỐC-ĐUÔI theo tên phân loại (cùng quy tắc Nối SKU nhanh), mỗi phân loại một
// mã, 6–50 ký tự, kiểm trùng sống với Tổng kho + mọi gian đã nối.
// ============================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, Check, ImagePlus, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  checkCopyListingDraft,
  checkCopyListingSkus,
  fetchCopyListingManualLimits,
  uploadCopyListingImage,
  type ChannelName,
  type CopyListingManualPayload,
} from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { compressImage, imageDimensions } from "@/lib/compress-image";
import { formatNumber } from "@/lib/format";
import { TEXT_SUB, TEXT_TABLE_HEAD } from "@/lib/typography";
import { cn } from "@/lib/utils";

import { missingLabel, type MissingContext } from "./labels";

// ---------------------------------------------------------------- Chuẩn chung (khớp backend rules.ts + manual.ts)

/** Số "đủ 3 sàn" — mức chặt nhất; vượt thì thẻ Đạt chuẩn sàn nói sàn nào không nhận. */
const COMMON = { titleMin: 25, titleMax: 120, descriptionMin: 20, shopeeDescriptionMax: 3000, images: 8, options: 2, optionValues: 20, variants: 50 };
/** Trần form (backend MANUAL_LIMITS) — rộng hơn để vẫn đăng được riêng TikTok. */
const HARD = { images: 9, descriptionImages: 12, options: 3, variants: 100 };
const SKU_PATTERN = /^[A-Za-z0-9._-]{6,50}$/;
/** Ảnh nhỏ hơn mức sàn khuyên (Shopee ≥ 500 px — số trợ giúp sàn, chưa kiểm API). */
const IMAGE_MIN_SIDE = 500;

const PLATFORMS: ChannelName[] = ["SHOPEE", "TIKTOK", "LAZADA"];
/** Số để nhãn "x / tối đa y" — chép từ PLATFORM_LISTING_RULES backend. */
const PLATFORM_CTX: Record<ChannelName, Pick<MissingContext, "maxVariants" | "maxOptions" | "maxOptionValues">> = {
  SHOPEE: { maxVariants: 50, maxOptions: 2, maxOptionValues: 20 },
  TIKTOK: { maxVariants: 100, maxOptions: 3 },
  LAZADA: { maxVariants: 100, maxOptions: 2, maxOptionValues: 20 },
  OFFLINE: {},
};

const TEXTAREA =
  "min-h-9 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm leading-6 shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50";
const WARN = "border-amber-300 bg-amber-50/40";
const BAD = "border-red-300 bg-red-50/40";

/** "Đen, M" → "DEN-M" (khớp backend lib/product-group.ts variantSkuSuffix). */
function variantSkuSuffix(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, (c) => (c === "đ" ? "d" : "D"))
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

let seq = 0;
const uid = () => `img-${Date.now()}-${seq++}`;

interface ImgItem {
  id: string;
  url: string | null;
  preview: string;
  uploading: boolean;
  small?: boolean;
}
interface OptionDraft {
  name: string;
  values: string[];
  input: string;
}
interface VariantEdit {
  sku?: string;
  price?: string;
  stock?: string;
  imageUrl?: string | null;
  excluded?: boolean;
}

const SECTIONS = [
  { id: "tm-thong-tin", label: "Thông tin" },
  { id: "tm-anh", label: "Ảnh" },
  { id: "tm-phan-loai", label: "Phân loại & SKU" },
  { id: "tm-van-chuyen", label: "Vận chuyển" },
  { id: "tm-kho", label: "Tổng kho" },
] as const;

/** Lưới ảnh (bìa / trong mô tả) — component cấp module để React không tạo lại mỗi lần render. */
function ImageGrid({
list,
setList,
max,
label,
hint,
inputRef,
}: {
list: ImgItem[];
setList: React.Dispatch<React.SetStateAction<ImgItem[]>>;
max: number;
label: string;
hint: string;
inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const overCommon = label === "Ảnh sản phẩm" && list.length > COMMON.images;
  return (
    <div className="space-y-2">
      <div className={cn(TEXT_TABLE_HEAD, "flex flex-wrap items-center gap-x-2")}>
        <span>{label}</span>
        <span className={cn("font-normal tabular-nums", overCommon ? "text-amber-700" : "text-slate-500")}>
          {list.length}/{max}
          {overCommon ? " · Lazada chỉ nhận 8" : ""}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {list.map((img, i) => (
          <div key={img.id} className="group relative size-20 overflow-hidden rounded-lg border border-slate-200 bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img.url ?? img.preview} alt="" className={cn("size-full object-cover", img.uploading && "opacity-50")} />
            {img.uploading && <span className="absolute inset-x-0 bottom-0 bg-black/60 text-center text-[10px] text-white">Đang tải…</span>}
            {!img.uploading && label === "Ảnh sản phẩm" && i === 0 && (
              <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 text-[10px] font-medium text-white">Bìa</span>
            )}
            {!img.uploading && img.small && (
              <span className="absolute left-1 top-1 rounded bg-amber-500/90 px-1 text-[10px] font-medium text-white" title={`Ảnh nhỏ hơn ${IMAGE_MIN_SIDE} px — sàn có thể làm mờ`}>
                Nhỏ
              </span>
            )}
            <button
              type="button"
              aria-label="Bỏ ảnh"
              onClick={() => setList((prev) => prev.filter((x) => x.id !== img.id))}
              className="absolute right-1 top-1 hidden size-5 items-center justify-center rounded-full bg-black/70 text-white group-hover:flex"
            >
              <X className="size-3" />
            </button>
            {label === "Ảnh sản phẩm" && i > 0 && !img.uploading && (
              <button
                type="button"
                onClick={() => setList((prev) => [img, ...prev.filter((x) => x.id !== img.id)])}
                className="absolute inset-x-0 bottom-0 hidden bg-black/60 py-0.5 text-center text-[10px] text-white group-hover:block"
              >
                Đặt làm bìa
              </button>
            )}
          </div>
        ))}
        {list.length < max && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex size-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 text-slate-500 transition-colors hover:border-slate-400 hover:text-slate-700"
          >
            <ImagePlus className="size-5" />
            <span className="text-[11px]">Thêm ảnh</span>
          </button>
        )}
      </div>
      <p className={TEXT_SUB}>{hint}</p>
    </div>
  );
}

export interface ManualFormSummary {
  variantCount: number;
  /** Lý do chưa gửi được (null = gửi được). */
  blocker: string | null;
}

export function ManualProductForm({
  canSeeCost,
  onChange,
}: {
  /** Nhân viên không nhập giá vốn (backend cũng bỏ). */
  canSeeCost: boolean;
  onChange: (payload: CopyListingManualPayload | null, summary: ManualFormSummary) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [images, setImages] = useState<ImgItem[]>([]);
  const [descImages, setDescImages] = useState<ImgItem[]>([]);
  const [options, setOptions] = useState<OptionDraft[]>([]);
  const [rootSku, setRootSku] = useState("");
  const [basePrice, setBasePrice] = useState("");
  const [baseStock, setBaseStock] = useState("0");
  const [edits, setEdits] = useState<Record<string, VariantEdit>>({});
  const [weight, setWeight] = useState("");
  const [dims, setDims] = useState({ length: "", width: "", height: "" });
  const [costPrice, setCostPrice] = useState("");

  const [byPlatform, setByPlatform] = useState<Record<ChannelName, string[]> | null>(null);
  const [checkReason, setCheckReason] = useState<string | null>(null);
  const [taken, setTaken] = useState<Record<string, string>>({});
  const [active, setActive] = useState<string>(SECTIONS[0].id);
  /** Trần ảnh theo gói (lát C) — null max = không giới hạn. */
  const [imageQuota, setImageQuota] = useState<{ used: number; max: number | null } | null>(null);
  useEffect(() => {
    fetchCopyListingManualLimits()
      .then((r) => setImageQuota(r.imageQuota))
      .catch(() => undefined);
  }, []);

  const coverInput = useRef<HTMLInputElement>(null);
  const descInput = useRef<HTMLInputElement>(null);
  const rowInput = useRef<HTMLInputElement>(null);
  const rowKeyRef = useRef<string | null>(null);

  // ---------------------------------------------------------------- phân loại → tổ hợp
  const liveOptions = useMemo(() => options.filter((o) => o.name.trim() && o.values.length > 0).map((o) => ({ name: o.name.trim(), values: o.values })), [options]);
  const comboNames = useMemo(() => cartesian(liveOptions), [liveOptions]);
  const rows = useMemo(
    () =>
      comboNames.map((name) => {
        const e = edits[name] ?? {};
        const sku = e.sku !== undefined ? e.sku : rootSku.trim() ? skuFromRoot(rootSku, name) : "";
        return {
          name,
          sku,
          price: e.price !== undefined ? e.price : basePrice,
          stock: e.stock !== undefined ? e.stock : baseStock,
          imageUrl: e.imageUrl ?? null,
          excluded: Boolean(e.excluded),
        };
      }),
    [comboNames, edits, rootSku, basePrice, baseStock]
  );
  const activeRows = rows.filter((r) => !r.excluded);

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
      images: images.map((i) => i.url).filter((u): u is string => Boolean(u)),
      descriptionImages: descImages.map((i) => i.url).filter((u): u is string => Boolean(u)),
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
  }, [title, description, images, descImages, weight, dims, liveOptions, rows, costPrice, canSeeCost]);
  const payloadJson = JSON.stringify(payload);

  const blocker = useMemo<string | null>(() => {
    if (!payload.title) return "Nhập tên sản phẩm";
    // Anh chốt 30/10: mã gốc BẮT BUỘC (chuẩn SKU từ đầu) — không cho qua dù từng dòng đã gõ tay.
    if (!rootSku.trim()) return "Nhập mã gốc SKU";
    if (activeRows.length === 0) return "Cần ít nhất một phân loại để đăng";
    if (Object.keys(skuIssue).length > 0) return "Sửa mã SKU còn lỗi";
    if (activeRows.some((r) => !((toInt(r.price) ?? 0) > 0))) return "Giá bán phải lớn hơn 0";
    if (images.some((i) => i.uploading) || descImages.some((i) => i.uploading)) return "Đang tải ảnh…";
    return null;
  }, [payload.title, rootSku, activeRows, skuIssue, images, descImages]);

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

  // ---------------------------------------------------------------- ảnh
  async function addFiles(files: FileList | null, kind: "cover" | "desc" | "row") {
    if (!files || files.length === 0) return;
    const list = kind === "cover" ? images : kind === "desc" ? descImages : [];
    const max = kind === "cover" ? HARD.images : kind === "desc" ? HARD.descriptionImages : 1;
    const room = max - list.length;
    const picked = Array.from(files).slice(0, Math.max(0, room));
    if (kind !== "row" && picked.length < files.length) toast.warning(`Tối đa ${max} ảnh — đã bỏ ${files.length - picked.length} ảnh.`);
    const setter = kind === "cover" ? setImages : setDescImages;
    const rowKey = rowKeyRef.current;
    for (const file of picked) {
      const id = uid();
      const preview = URL.createObjectURL(file);
      if (kind !== "row") setter((prev) => [...prev, { id, url: null, preview, uploading: true }]);
      try {
        const [blob, dim] = await Promise.all([compressImage(file), imageDimensions(file)]);
        const { url } = await uploadCopyListingImage(blob);
        const small = Math.min(dim.width, dim.height) < IMAGE_MIN_SIDE;
        if (kind === "row") {
          if (rowKey !== null) setEdits((m) => ({ ...m, [rowKey]: { ...(m[rowKey] ?? {}), imageUrl: url } }));
        } else {
          setter((prev) => prev.map((i) => (i.id === id ? { ...i, url, uploading: false, small } : i)));
        }
      } catch (err) {
        toast.error(`${file.name}: ${err instanceof Error ? err.message : "không tải được ảnh"}`);
        if (kind !== "row") setter((prev) => prev.filter((i) => i.id !== id));
      } finally {
        URL.revokeObjectURL(preview);
      }
    }
  }

  // ---------------------------------------------------------------- phân loại
  function addOption() {
    if (options.length >= HARD.options) return;
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

  const ctx = (p: ChannelName): MissingContext => ({
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
            <div className={cn(TEXT_TABLE_HEAD, "flex flex-wrap items-center gap-x-2")}>
              <span>Tên sản phẩm</span>
              <span className={cn("font-normal tabular-nums", titleBad ? "text-amber-700" : "text-slate-500")}>
                {titleLen}/{COMMON.titleMax} · đủ 3 sàn cần {COMMON.titleMin}–{COMMON.titleMax} ký tự
              </span>
            </div>
            <Input className={cn(titleBad && WARN)} placeholder="Vd: Túi đeo chéo nam ANO da PU cao cấp, khóa chống nước TC113" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1">
            <div className={cn(TEXT_TABLE_HEAD, "flex flex-wrap items-center gap-x-2")}>
              <span>Mô tả</span>
              <span className={cn("font-normal tabular-nums", descWarn || (descLen > 0 && descLen < COMMON.descriptionMin) ? "text-amber-700" : "text-slate-500")}>
                {formatNumber(descLen)} ký tự · tối thiểu {COMMON.descriptionMin}
                {descWarn ? ` · Shopee cắt ở ${formatNumber(COMMON.shopeeDescriptionMax)}` : ""}
              </span>
            </div>
            <textarea className={cn(TEXTAREA, "min-h-32", descWarn && WARN)} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Chữ thuần, giữ xuống dòng. Shopee nhận chữ thuần; TikTok, Lazada giữ xuống dòng. Ảnh minh họa thêm ở mục Ảnh." />
          </div>
        </section>

        {/* 2. Ảnh */}
        <section id={SECTIONS[1].id} className="scroll-mt-24 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-sm font-semibold text-slate-900">2. Ảnh</h3>
            {imageQuota?.max != null && (
              <span className={cn(TEXT_SUB, "tabular-nums", imageQuota.used >= imageQuota.max && "text-amber-700")}>
                Gói của bạn: đã lưu {formatNumber(imageQuota.used)}/{formatNumber(imageQuota.max)} ảnh sản phẩm
              </span>
            )}
          </div>
          <input ref={coverInput} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(e) => void addFiles(e.target.files, "cover").then(() => (e.target.value = ""))} />
          <input ref={descInput} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(e) => void addFiles(e.target.files, "desc").then(() => (e.target.value = ""))} />
          <input ref={rowInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void addFiles(e.target.files, "row").then(() => (e.target.value = ""))} />
          <ImageGrid list={images} setList={setImages} max={HARD.images} label="Ảnh sản phẩm" hint="Ảnh đầu là bìa. Nén tự động ≤ 1.600 px; nên vuông, ≥ 500 px. Lazada nhận 8, Shopee/TikTok 9." inputRef={coverInput} />
          <ImageGrid list={descImages} setList={setDescImages} max={HARD.descriptionImages} label="Ảnh trong mô tả" hint="Ghép vào cuối mô tả khi đăng (Shopee: mô tả mở rộng; TikTok/Lazada: <img>)." inputRef={descInput} />
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
            {options.length < HARD.options && (
              <Button size="sm" variant="outline" onClick={addOption}>
                <Plus data-icon="inline-start" /> {options.length === 0 ? "Thêm phân loại (Màu, Size…)" : "Thêm nhóm phân loại"}
              </Button>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <div className={cn(TEXT_TABLE_HEAD, "flex items-center gap-2")}>
                Mã gốc SKU <span className="rounded bg-amber-50 px-1 text-[10px] font-medium text-amber-700">Bắt buộc</span>
              </div>
              <Input className={cn(!rootSku.trim() && WARN)} placeholder="Vd: TC113" value={rootSku} onChange={(e) => setRootSku(e.target.value)} />
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
                      <td className="px-2 py-1.5">
                        <input type="checkbox" className="size-4 accent-primary" aria-label="Đăng phân loại này" checked={!r.excluded} onChange={() => setEdits((m) => ({ ...m, [r.name]: { ...(m[r.name] ?? {}), excluded: !r.excluded } }))} />
                      </td>
                      <td className="truncate px-2 py-1.5 text-slate-900" title={r.name}>{r.name || "Sản phẩm (không phân loại)"}</td>
                      <td className="px-2 py-1.5">
                        <Input className={cn("h-8 px-2 font-mono text-[13px]", issue && !r.excluded && BAD)} value={r.sku} placeholder="6–50 ký tự" onChange={(e) => setEdits((m) => ({ ...m, [r.name]: { ...(m[r.name] ?? {}), sku: e.target.value } }))} />
                        {issue && !r.excluded && <div className="mt-0.5 text-[11px] leading-snug text-red-500">{issue}</div>}
                      </td>
                      <td className="px-2 py-1.5">
                        <Input className={cn("h-8 px-2 tabular-nums", !r.excluded && !((toInt(r.price) ?? 0) > 0) && WARN)} inputMode="numeric" value={r.price} onChange={(e) => setEdits((m) => ({ ...m, [r.name]: { ...(m[r.name] ?? {}), price: e.target.value } }))} />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input className="h-8 px-2 tabular-nums" inputMode="numeric" value={r.stock} onChange={(e) => setEdits((m) => ({ ...m, [r.name]: { ...(m[r.name] ?? {}), stock: e.target.value } }))} />
                      </td>
                      <td className="px-2 py-1.5">
                        {r.imageUrl ? (
                          <button
                            type="button"
                            className="group relative size-8 overflow-hidden rounded border border-slate-200"
                            title="Bỏ ảnh phân loại"
                            onClick={() => setEdits((m) => ({ ...m, [r.name]: { ...(m[r.name] ?? {}), imageUrl: null } }))}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={r.imageUrl} alt="" className="size-full object-cover" />
                            <span className="absolute inset-0 hidden items-center justify-center bg-black/60 text-white group-hover:flex">
                              <X className="size-3" />
                            </span>
                          </button>
                        ) : (
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => {
                              rowKeyRef.current = r.name;
                              rowInput.current?.click();
                            }}
                          >
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
          <div className={cn(TEXT_SUB, "flex flex-wrap items-center gap-x-3")}>
            <span className="tabular-nums">
              {activeRows.length} phân loại sẽ đăng{rows.length !== activeRows.length ? ` (bỏ ${rows.length - activeRows.length})` : ""}
            </span>
            {Object.keys(edits).some((k) => edits[k]?.sku !== undefined) && (
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
                Cân nặng (gram) <span className="rounded bg-amber-50 px-1 text-[10px] font-medium text-amber-700">Bắt buộc 3 sàn</span>
              </div>
              <Input inputMode="numeric" placeholder="600" value={weight} onChange={(e) => setWeight(e.target.value)} className={cn(weight && !((toInt(weight) ?? 0) > 0) && WARN)} />
              <p className={TEXT_SUB}>Cân cả gói hàng, tính phí ship. Vd áo thun: 250.</p>
            </div>
            <div className="space-y-1">
              <div className={cn(TEXT_TABLE_HEAD, "flex items-center gap-2")}>
                Kích thước kiện (cm) <span className="rounded bg-amber-50 px-1 text-[10px] font-medium text-amber-700">Lazada bắt buộc</span>
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

      {/* ------------------------------------------------ mục lục + chuẩn sàn */}
      <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        <nav aria-label="Mục lục biểu mẫu" className="rounded-lg border border-slate-200 p-1.5">
          {SECTIONS.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
                active === s.id ? "bg-muted font-medium text-slate-900" : "text-slate-500 hover:bg-muted/60 hover:text-slate-900"
              )}
            >
              <span className="tabular-nums">{i + 1}.</span> {s.label}
            </button>
          ))}
        </nav>

        <div className="rounded-lg border border-slate-200 p-3">
          <div className={cn(TEXT_TABLE_HEAD, "mb-2")}>Đạt chuẩn sàn</div>
          {!payload.title ? (
            <p className={TEXT_SUB}>Nhập tên sản phẩm để bắt đầu kiểm.</p>
          ) : checkReason ? (
            <p className={cn(TEXT_SUB, "text-amber-700")}>{checkReason}</p>
          ) : !byPlatform ? (
            <p className={TEXT_SUB}>Đang kiểm…</p>
          ) : (
            <ul className="space-y-2">
              {PLATFORMS.map((p) => {
                const codes = byPlatform[p] ?? [];
                const ok = codes.length === 0;
                return (
                  <li key={p} className="flex gap-2">
                    {ok ? <Check className="mt-0.5 size-4 shrink-0 text-emerald-500" /> : <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-500" />}
                    <div className="min-w-0">
                      <span className={cn("inline-flex rounded-md border px-1.5 py-0.5 text-[11px] font-medium", CHANNEL_META[p].className)}>{CHANNEL_META[p].label}</span>
                      {ok ? (
                        <span className={cn(TEXT_SUB, "ml-1.5")}>đạt</span>
                      ) : (
                        <ul className="mt-1 space-y-0.5">
                          {codes.map((c) => (
                            <li key={c} className="text-[12px] leading-snug text-slate-700">
                              {missingLabel(c, undefined, ctx(p))}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <p className={cn(TEXT_SUB, "mt-2")}>Danh mục, thuộc tính, thương hiệu, vận chuyển chọn ở bước sau theo từng gian.</p>
        </div>

        {blocker && (
          <p className={cn(TEXT_SUB, "flex items-start gap-1.5 text-amber-700")}>
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {blocker}
          </p>
        )}
      </aside>
    </div>
  );
}
