// ============================================================
// SAO CHÉP SẢN PHẨM — NGUỒN (docs/SAO-CHEP-SAN-PHAM.md mục 1, 5)
//
// Danh sách chọn ở bước 1 + dựng NormalizedListing cho nguồn kho:
//   · CHANNEL: các dòng ChannelProduct của một sản phẩm sàn (mọi phân loại). Khoá
//     sản phẩm = phần trước dấu "-" của externalId (Shopee itemId-modelId, TikTok
//     productId-skuId, Lazada itemId-SkuId); dòng không có externalId thì khoá =
//     id dòng. Bảng chỉ có tên / giá / 1 ảnh / SKU → chi tiết (mô tả, mảng ảnh, danh
//     mục, cân nặng) do adapter thật đọc từ API sàn (fetchListing); adapter giả lập
//     dựng từ chính các dòng này.
//   · PRODUCT: nhóm cha–con kho (Product.groupKey ?? id) — lib/product-group.ts.
// ============================================================

import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { inferOptions } from "../../marketplace/listing/infer-options";
import type { ListingVariant, NormalizedListing } from "../../marketplace/listing/types";

interface SourceSummary {
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

interface SourcePage {
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

function summarize<R>(key: string, list: R[], pick: (r: R) => { title: string; imageUrl: string | null; price: number; sku: string; linked: boolean }): SourceSummary {
  const rows = list.map(pick);
  const prices = rows.map((r) => r.price);
  return {
    key,
    title: rows[0].title,
    imageUrl: rows.find((r) => r.imageUrl)?.imageUrl ?? null,
    variantCount: rows.length,
    minPrice: Math.min(...prices),
    maxPrice: Math.max(...prices),
    skus: rows.map((r) => r.sku),
    linkedCount: rows.filter((r) => r.linked).length,
  };
}

function groupBy<R>(rows: R[], keyOf: (r: R) => string): [string, R[]][] {
  const groups = new Map<string, R[]>();
  for (const r of rows) {
    const k = keyOf(r);
    const arr = groups.get(k) ?? [];
    arr.push(r);
    groups.set(k, arr);
  }
  return [...groups.entries()];
}

// ---------- Nguồn gian đã nối ----------

const CP_SELECT = {
  id: true,
  channelSku: true,
  productName: true,
  price: true,
  imageUrl: true,
  externalId: true,
  productId: true,
} as const;

export async function listChannelSources(channelId: string, search: string, page: number, pageSize: number): Promise<SourcePage> {
  const rows = await prisma.channelProduct.findMany({
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
  const groups = groupBy(rows, channelItemKey);
  const items = groups
    .slice((page - 1) * pageSize, page * pageSize)
    .map(([key, list]) =>
      summarize(key, list, (r) => ({ title: r.productName, imageUrl: r.imageUrl, price: Number(r.price), sku: r.channelSku, linked: Boolean(r.productId) }))
    );
  return { items, total: groups.length, page, pageSize };
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

export async function listProductSources(ownerId: string, search: string, page: number, pageSize: number): Promise<SourcePage> {
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
  const groups = groupBy(rows, (p) => p.groupKey ?? p.id);
  const items = groups
    .slice((page - 1) * pageSize, page * pageSize)
    .map(([key, list]) =>
      summarize(key, list, (r) => ({ title: r.productName, imageUrl: r.imageUrl, price: Number(r.sellingPrice), sku: r.skuCode, linked: true }))
    );
  return { items, total: groups.length, page, pageSize };
}

export async function buildListingFromProducts(ownerId: string, groupKey: string): Promise<NormalizedListing | null> {
  const rows: PRow[] = await prisma.product.findMany({
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
