// ============================================================
// SAO CHÉP SẢN PHẨM — NGUỒN "TẠO MỚI" (sourceType MANUAL, 30/10/2026,
// docs/SAO-CHEP-SAN-PHAM.md mục 24).
//
// Khách soạn sản phẩm MỘT lần theo chuẩn chung chặt nhất của 3 sàn (tên 25–120,
// ảnh ≤ 8, ≤ 2 nhóm × 20 giá trị ≤ 50 tổ hợp, cân nặng…) → NormalizedListing y hệt
// hai nguồn kia → bước 2 (gian, danh mục, thuộc tính, thương hiệu, vận chuyển, Đăng)
// dùng lại 100 %. Khi bấm Đăng: ghi SKU vào Tổng kho (mỗi phân loại một dòng
// Product), KHÔNG nối gian (anh chốt 30/10 — lưu kho và nối là hai việc khác nhau;
// khách muốn nối thì bấm Tự khớp, trùng mã chính xác vì cùng một mã).
//
// Mã SKU làm chặt ngay từ form (anh: "chuẩn SKU từ đầu thì sau này nối thuận
// tiện"): mỗi phân loại một mã riêng (chặn hẳn), 6–50 ký tự, chỉ chữ/số/-/_/.,
// không trùng với Tổng kho lẫn mọi gian đã nối.
// ============================================================

import { InventoryLogType, Prisma, type ChannelName } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { cleanVariantName, productGroupKey } from "../../lib/product-group";
import { computeMissing, normalizeDims, type MissingCode } from "../../marketplace/listing/rules";
import type { ListingOption, ListingVariant, NormalizedListing } from "../../marketplace/listing/types";
import { applyStockDelta } from "../stock-ledger";
import { ListingCopyError } from "./service";

/** Trần đầu vào của form — rộng hơn mức "đủ 3 sàn" để khách vẫn đăng được riêng TikTok (3 nhóm, 100 tổ hợp). */
export const MANUAL_LIMITS = {
  images: 9,
  descriptionImages: 12,
  options: 3,
  optionValues: 100,
  variants: 100,
  titleMax: 255,
  descriptionMax: 25_000,
  skuMin: 6,
  skuMax: 50,
} as const;

/** Mã SKU hợp lệ: chữ/số/-/_/. , 6–50 ký tự (TikTok seller_sku 6–50 — mức chặt nhất 3 sàn). */
export const SKU_PATTERN = /^[A-Za-z0-9._-]{6,50}$/;

export interface ManualMeta {
  /** Giá vốn mặc định ghi vào SKU kho (tùy chọn; nhân viên không được nhập → 0). */
  costPrice: number | null;
}

/** Job MANUAL lưu `source = { ...listing, manual }` — adapter chỉ đọc phần NormalizedListing. */
export type ManualSource = NormalizedListing & { manual?: ManualMeta };

const CHECK_PLATFORMS: ChannelName[] = ["SHOPEE", "TIKTOK", "LAZADA"];

/** Mã thuộc BƯỚC 2 (theo từng gian) — không báo ở thẻ "Đạt chuẩn sàn" của form. */
const STEP2_CODES: ReadonlySet<string> = new Set(["category", "brand", "logistics", "sku_exists"]);

function s(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
function urlList(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const u of v) {
    if (typeof u !== "string") continue;
    const t = u.trim();
    if (!/^https?:\/\//i.test(t) || t.length > 2048) continue;
    if (!out.includes(t)) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}
function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Đọc body form → NormalizedListing + meta kho. Ném ListingCopyError 400 khi sai cấu
 * trúc; các luật "đủ chuẩn sàn" (tên ngắn, thiếu cân nặng…) KHÔNG chặn ở đây —
 * computeMissing ở bước 2 lo, đúng luật cảnh báo không khóa cứng.
 */
export function parseManualListing(body: unknown): { listing: NormalizedListing; manual: ManualMeta } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const title = s(b.title, MANUAL_LIMITS.titleMax);
  if (!title) throw new ListingCopyError("Nhập tên sản phẩm.");
  const description = s(b.description, MANUAL_LIMITS.descriptionMax);
  const images = urlList(b.images, MANUAL_LIMITS.images);
  const descriptionImages = urlList(b.descriptionImages, MANUAL_LIMITS.descriptionImages);

  const options: ListingOption[] = [];
  if (Array.isArray(b.options)) {
    for (const o of b.options.slice(0, MANUAL_LIMITS.options)) {
      const name = s((o as Record<string, unknown>)?.name, 40);
      const raw = (o as Record<string, unknown>)?.values;
      const values: string[] = [];
      if (Array.isArray(raw)) {
        for (const v of raw) {
          const t = s(v, 60);
          if (t && !values.some((x) => x.toLowerCase() === t.toLowerCase())) values.push(t);
          if (values.length >= MANUAL_LIMITS.optionValues) break;
        }
      }
      if (name && values.length > 0) options.push({ name, values });
    }
  }

  const variants: ListingVariant[] = [];
  if (Array.isArray(b.variants)) {
    for (const v of b.variants.slice(0, MANUAL_LIMITS.variants)) {
      const r = (v as Record<string, unknown>) ?? {};
      const price = num(r.price);
      const stock = num(r.stock);
      variants.push({
        sku: s(r.sku, MANUAL_LIMITS.skuMax),
        name: options.length > 0 ? s(r.name, 200) : "",
        price: price !== null && price > 0 ? Math.round(price) : 0,
        stock: stock !== null && stock >= 0 ? Math.floor(stock) : 0,
        imageUrl: urlList([r.imageUrl], 1)[0] ?? null,
        excluded: r.excluded === true,
      });
    }
  }
  if (variants.length === 0) throw new ListingCopyError("Sản phẩm cần ít nhất một phân loại (hoặc một dòng giá/tồn).");
  if (options.length > 0) {
    const expected = options.reduce((n, o) => n * o.values.length, 1);
    if (variants.length !== expected) throw new ListingCopyError("Bảng phân loại không khớp số tổ hợp — tải lại trang rồi thử lại.");
  }
  // Mã SKU: bắt buộc, đúng mẫu, không trùng trong bài (chặn hẳn — đây là SP tạo mới).
  const seen = new Set<string>();
  for (const v of variants) {
    if (v.excluded) continue;
    if (!v.sku) throw new ListingCopyError(`Phân loại "${v.name || "sản phẩm"}" chưa có mã SKU.`);
    if (!SKU_PATTERN.test(v.sku)) throw new ListingCopyError(`Mã SKU "${v.sku}" không hợp lệ — 6–50 ký tự, chỉ chữ, số, gạch ngang, gạch dưới, dấu chấm.`);
    const k = v.sku.toUpperCase();
    if (seen.has(k)) throw new ListingCopyError(`Mã SKU "${v.sku}" bị trùng giữa các phân loại — mỗi phân loại một mã riêng.`);
    seen.add(k);
  }

  const weight = num(b.weightGrams);
  const cost = num(b.costPrice);
  return {
    listing: {
      title,
      description,
      images,
      descriptionImages,
      categoryId: null,
      categoryPath: null,
      brandName: s(b.brandName, 120) || null,
      weightGrams: weight !== null && weight > 0 ? Math.round(weight) : null,
      dimensionsCm: normalizeDims(b.dimensionsCm),
      options,
      variants,
      attributes: [],
    },
    manual: { costPrice: cost !== null && cost >= 0 ? Math.round(cost) : null },
  };
}

/**
 * Thẻ "Đạt chuẩn sàn" sống: luật chung từng sàn (requirements null = chưa có danh
 * mục), bỏ mã thuộc bước 2. Thuần, không gọi DB/sàn.
 */
export function checkManualDraft(listing: NormalizedListing): Record<ChannelName, MissingCode[]> {
  const state = { categoryId: "x", attributes: {}, brandId: null, logisticIds: [], weightGrams: listing.weightGrams, dimensionsCm: listing.dimensionsCm };
  const out = {} as Record<ChannelName, MissingCode[]>;
  for (const p of CHECK_PLATFORMS) out[p] = computeMissing(p, listing, state, null).filter((c) => !STEP2_CODES.has(c));
  return out;
}

export interface SkuTaken {
  sku: string;
  /** "Tổng kho" hoặc tên gian. */
  where: string;
}

/** Mã đã có ở Tổng kho hoặc trên gian đã nối của chủ shop (so không phân biệt hoa thường). */
export async function findTakenSkus(ownerId: string, skus: string[]): Promise<SkuTaken[]> {
  const wanted = [...new Set(skus.map((x) => x.trim()).filter(Boolean))].slice(0, 200);
  if (wanted.length === 0) return [];
  const upper = wanted.map((x) => x.toUpperCase());
  const [products, channelRows] = await Promise.all([
    prisma.product.findMany({ where: { userId: ownerId, skuCode: { in: upper } }, select: { skuCode: true } }),
    prisma.channelProduct.findMany({
      where: { channel: { userId: ownerId }, channelSku: { in: wanted, mode: "insensitive" } },
      select: { channelSku: true, channel: { select: { shopName: true } } },
    }),
  ]);
  const taken = new Map<string, string>();
  for (const p of products) taken.set(p.skuCode.toUpperCase(), "Tổng kho");
  for (const r of channelRows) if (!taken.has(r.channelSku.toUpperCase())) taken.set(r.channelSku.toUpperCase(), r.channel.shopName);
  return wanted.filter((x) => taken.has(x.toUpperCase())).map((x) => ({ sku: x, where: taken.get(x.toUpperCase())! }));
}

/**
 * Ghi Tổng kho khi bấm Đăng: mỗi phân loại ĐANG ĐĂNG = một dòng Product (mã đã có
 * thì bỏ qua — bấm Đăng lại không tạo trùng). Tồn ban đầu đi qua sổ kho. KHÔNG nối gian.
 */
export async function ensureWarehouseProducts(
  ownerId: string,
  actorId: string | null,
  source: ManualSource,
  opts: { allowCost: boolean }
): Promise<{ created: number; skipped: number }> {
  const cost = opts.allowCost ? (source.manual?.costPrice ?? 0) : 0;
  let created = 0;
  let skipped = 0;
  for (const v of source.variants) {
    if (v.excluded || !v.sku.trim()) continue;
    const sku = v.sku.trim().toUpperCase();
    const existed = await prisma.product.findUnique({ where: { userId_skuCode: { userId: ownerId, skuCode: sku } }, select: { id: true } });
    if (existed) {
      skipped += 1;
      continue;
    }
    const variant = source.options.length > 0 ? cleanVariantName(v.name) : null;
    await prisma.$transaction(async (tx) => {
      const p = await tx.product.create({
        data: {
          userId: ownerId,
          skuCode: sku,
          productName: source.title,
          variantName: variant,
          groupKey: productGroupKey(source.title, variant),
          costPrice: new Prisma.Decimal(cost),
          sellingPrice: new Prisma.Decimal(v.price),
          quantityInStock: 0,
          imageUrl: v.imageUrl ?? source.images[0] ?? null,
        },
      });
      if (v.stock > 0) {
        await applyStockDelta(tx, {
          productId: p.id,
          delta: v.stock,
          type: InventoryLogType.IMPORT,
          reason: "Tạo từ Sao chép sản phẩm (Tạo mới)",
          actorId,
        });
      }
    });
    created += 1;
  }
  return { created, skipped };
}
