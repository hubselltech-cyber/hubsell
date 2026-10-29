// ============================================================
// SAO CHÉP SẢN PHẨM — NGUỒN (docs/SAO-CHEP-SAN-PHAM.md mục 1, 5)
//
// Hai nguồn, cùng quy về NormalizedListing:
//   · CHANNEL: các dòng ChannelProduct của một sản phẩm sàn (mọi phân loại). Khoá
//     sản phẩm = phần trước dấu "-" của externalId (Shopee itemId-modelId, TikTok
//     productId-skuId, Lazada itemId-SkuId); dòng không có externalId thì khoá =
//     id dòng. Mô tả / mảng ảnh / danh mục / cân nặng KHÔNG có trong bảng (chỉ
//     tên, giá, 1 ảnh, SKU) → adapter thật sẽ đọc thêm từ API sàn ở lát 1b;
//     adapter giả lập dùng thẳng các dòng này.
//   · PRODUCT: nhóm cha–con kho (Product.groupKey ?? id) — lib/product-group.ts.
// ============================================================

import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import type { ListingVariant, NormalizedListing } from "../../marketplace/listing/types";

export interface SourceSummary {
  key: string;
  title: string;
  imageUrl: string | null;
  variantCount: number;
  minPrice: number;
  maxPrice: number;
  skus: string[];
  /** Số phân loại đã nối SKU kho (nguồn gian) / luôn = variantCount (nguồn kho). */
  linkedCount: number;
}

export interface SourcePage {
  items: SourceSummary[];
  total: number;
  page: number;
  pageSize: number;
}

/** Khoá sản phẩm sàn của một dòng ChannelProduct. */
export function channelItemKey(row: { id: string; externalId: string | null }): string {
  if (!row.externalId) return row.id;
  const dash = row.externalId.indexOf("-");
  return dash > 0 ? row.externalId.slice(0, dash) : row.externalId;
}

function variantLabel(name: string | null): string | null {
  const s = (name ?? "").trim();
  return s ? s : null;
}

/** Suy nhóm phân loại ("Màu: Đen, Size: M" / "Đen, M") thành options. */
export function inferOptions(variants: ListingVariant[]): { name: string; values: string[] }[] {
  const named = new Map<string, Set<string>>();
  const positional: Set<string>[] = [];
  for (const v of variants) {
    if (!v.name) continue;
    const parts = v.name.split(/[,|/;]+/).map((p) => p.trim()).filter(Boolean);
    parts.forEach((p, idx) => {
      const m = p.match(/^([^:]{1,30}):\s*(.+)$/);
      if (m) {
        const set = named.get(m[1].trim()) ?? new Set<string>();
        set.add(m[2].trim());
        named.set(m[1].trim(), set);
      } else {
        positional[idx] = positional[idx] ?? new Set<string>();
        positional[idx].add(p);
      }
    });
  }
  const out: { name: string; values: string[] }[] = [];
  for (const [name, values] of named) out.push({ name, values: [...values] });
  positional.forEach((set, idx) => {
    if (set && set.size > 0) out.push({ name: `Phân loại ${idx + 1}`, values: [...set] });
  });
  return out;
}

const CP_SELECT = {
  id: true,
  channelSku: true,
  productName: true,
  variantName: true,
  price: true,
  imageUrl: true,
  externalId: true,
  channelStock: true,
  productId: true,
  status: true,
} as const;

type CpRow = Prisma.ChannelProductGetPayload<{ select: typeof CP_SELECT }>;

async function loadChannelRows(channelId: string, search: string): Promise<CpRow[]> {
  return prisma.channelProduct.findMany({
    where: {
      channelId,
      status: "ACTIVE",
      ...(search
        ? {
            OR: [
              { channelSku: { contains: search, mode: "insensitive" } },
              { productName: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: CP_SELECT,
    orderBy: [{ productName: "asc" }, { channelSku: "asc" }],
    take: 5000,
  });
}

function groupRows(rows: CpRow[]): Map<string, CpRow[]> {
  const groups = new Map<string, CpRow[]>();
  for (const r of rows) {
    const k = channelItemKey(r);
    const arr = groups.get(k) ?? [];
    arr.push(r);
    groups.set(k, arr);
  }
  return groups;
}

export async function listChannelSources(
  channelId: string,
  search: string,
  page: number,
  pageSize: number
): Promise<SourcePage> {
  const rows = await loadChannelRows(channelId, search);
  const groups = [...groupRows(rows).entries()];
  const items = groups.slice((page - 1) * pageSize, page * pageSize).map(([key, list]) => {
    const prices = list.map((r) => Number(r.price));
    return {
      key,
      title: list[0].productName,
      imageUrl: list.find((r) => r.imageUrl)?.imageUrl ?? null,
      variantCount: list.length,
      minPrice: Math.min(...prices),
      maxPrice: Math.max(...prices),
      skus: list.map((r) => r.channelSku),
      linkedCount: list.filter((r) => r.productId).length,
    };
  });
  return { items, total: groups.length, page, pageSize };
}

/** Dựng listing từ các dòng ChannelProduct của một sản phẩm sàn (dùng cho adapter giả lập). */
export async function buildListingFromChannelRows(channelId: string, itemKey: string): Promise<NormalizedListing | null> {
  const rows = await prisma.channelProduct.findMany({
    where: {
      channelId,
      OR: [{ externalId: itemKey }, { externalId: { startsWith: `${itemKey}-` } }, { id: itemKey }],
    },
    select: CP_SELECT,
    orderBy: { channelSku: "asc" },
  });
  if (rows.length === 0) return null;
  const variants: ListingVariant[] = rows.map((r) => ({
    sku: r.channelSku,
    name: variantLabel(r.variantName),
    price: Number(r.price),
    stock: r.channelStock ?? 0,
    imageUrl: r.imageUrl,
  }));
  const images = [...new Set(rows.map((r) => r.imageUrl).filter((u): u is string => Boolean(u)))];
  return {
    title: rows[0].productName,
    // Bảng ChannelProduct không giữ mô tả — adapter thật đọc từ API sàn (lát 1b);
    // ở đây dựng mô tả tối thiểu để bản xem trước có gì mà sửa.
    description: `${rows[0].productName}. Sản phẩm sao chép từ gian hàng đã nối Hubsell; vui lòng bổ sung mô tả chi tiết trước khi đăng.`,
    images,
    descriptionImages: [],
    categoryId: null,
    categoryPath: null,
    brandName: null,
    weightGrams: null,
    dimensionsCm: null,
    options: inferOptions(variants),
    variants,
    attributes: [],
  };
}

/** Danh sách sản phẩm sàn đã nối kho của gian nguồn → map SKU → productId (để nối SKU ở gian đích). */
export async function sourceSkuToProductId(channelId: string, skus: string[]): Promise<Map<string, string>> {
  const rows = await prisma.channelProduct.findMany({
    where: { channelId, channelSku: { in: skus }, productId: { not: null } },
    select: { channelSku: true, productId: true },
  });
  return new Map(rows.map((r) => [r.channelSku, r.productId as string]));
}

// ---------- Nguồn kho Hubsell ----------

const P_SELECT = {
  id: true,
  skuCode: true,
  productName: true,
  variantName: true,
  groupKey: true,
  sellingPrice: true,
  quantityInStock: true,
  holdQuantity: true,
  imageUrl: true,
  material: true,
} as const;

type PRow = Prisma.ProductGetPayload<{ select: typeof P_SELECT }>;

function productGroup(p: PRow): string {
  return p.groupKey ?? p.id;
}

export async function listProductSources(
  ownerId: string,
  search: string,
  page: number,
  pageSize: number
): Promise<SourcePage> {
  const rows = await prisma.product.findMany({
    where: {
      userId: ownerId,
      isActive: true,
      ...(search
        ? {
            OR: [
              { skuCode: { contains: search, mode: "insensitive" } },
              { productName: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: P_SELECT,
    orderBy: [{ productName: "asc" }, { skuCode: "asc" }],
    take: 5000,
  });
  const groups = new Map<string, PRow[]>();
  for (const r of rows) {
    const k = productGroup(r);
    const arr = groups.get(k) ?? [];
    arr.push(r);
    groups.set(k, arr);
  }
  const entries = [...groups.entries()];
  const items = entries.slice((page - 1) * pageSize, page * pageSize).map(([key, list]) => {
    const prices = list.map((r) => Number(r.sellingPrice));
    return {
      key,
      title: list[0].productName,
      imageUrl: list.find((r) => r.imageUrl)?.imageUrl ?? null,
      variantCount: list.length,
      minPrice: Math.min(...prices),
      maxPrice: Math.max(...prices),
      skus: list.map((r) => r.skuCode),
      linkedCount: list.length,
    };
  });
  return { items, total: entries.length, page, pageSize };
}

export async function buildListingFromProducts(ownerId: string, groupKey: string): Promise<NormalizedListing | null> {
  const rows = await prisma.product.findMany({
    where: { userId: ownerId, OR: [{ groupKey }, { id: groupKey }] },
    select: P_SELECT,
    orderBy: { skuCode: "asc" },
  });
  if (rows.length === 0) return null;
  const variants: ListingVariant[] = rows.map((r) => ({
    sku: r.skuCode,
    name: variantLabel(r.variantName),
    price: Number(r.sellingPrice),
    stock: Math.max(0, r.quantityInStock - r.holdQuantity),
    imageUrl: r.imageUrl,
  }));
  const images = [...new Set(rows.map((r) => r.imageUrl).filter((u): u is string => Boolean(u)))];
  const material = rows.find((r) => r.material)?.material ?? null;
  return {
    title: rows[0].productName,
    description: "",
    images,
    descriptionImages: [],
    categoryId: null,
    categoryPath: null,
    brandName: null,
    weightGrams: null,
    dimensionsCm: null,
    options: inferOptions(variants),
    variants,
    attributes: material ? [{ name: "Chất liệu", value: material }] : [],
  };
}

/** SKU kho → productId (nối SKU cho gian đích khi nguồn là kho). */
export async function productIdsBySku(ownerId: string, skus: string[]): Promise<Map<string, string>> {
  const rows = await prisma.product.findMany({
    where: { userId: ownerId, skuCode: { in: skus } },
    select: { id: true, skuCode: true },
  });
  return new Map(rows.map((r) => [r.skuCode, r.id]));
}
