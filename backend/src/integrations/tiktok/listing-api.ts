// ============================================================
// TIKTOK SHOP — API ĐĂNG SẢN PHẨM (lát 1b, docs/SAO-CHEP-SAN-PHAM.md mục 10)
//
// Theo docs 202309 đọc 29/10/2026: Get Categories (category_version v2),
// Recommend Category, Get Attributes, Get Category Rules, Get Brands, Upload
// Product Image (multipart, KHÔNG ký body), Create Product. CHƯA kiểm gian thật.
// Phạm vi: seller.product.write (Product Modify, bật 12/10/2026) — gian ủy
// quyền trước mốc phải nối lại (tiktok/scopes.ts).
// ============================================================

import { TtlCache } from "../../lib/image-fetch";
import { platformFetch } from "../../lib/platform-http";
import { callApi, signRequest } from "./client";
import { getTikTokConfig, TIKTOK_ENDPOINTS, type TikTokConfig } from "./config";

const CATEGORY_VERSION = "v2";
const LOCALE = "vi-VN";

export interface TikTokCategory {
  id: string;
  parent_id?: string;
  local_name?: string;
  is_leaf?: boolean;
  permission_statuses?: string[];
}

const categoryCache = new TtlCache<TikTokCategory[]>(6 * 60 * 60 * 1000);

export async function getCategories(ctx: { accessToken: string; shopCipher: string }, cfg = getTikTokConfig()): Promise<TikTokCategory[]> {
  return categoryCache.get(`tiktok:${ctx.shopCipher}`, async () => {
    const d = await callApi<{ categories?: TikTokCategory[] }>(
      {
        path: "/product/202309/categories",
        accessToken: ctx.accessToken,
        shopCipher: ctx.shopCipher,
        query: { locale: LOCALE, category_version: CATEGORY_VERSION },
      },
      cfg
    );
    return d.categories ?? [];
  });
}

export function categoryPath(all: TikTokCategory[], id: string): string[] {
  const byId = new Map(all.map((c) => [c.id, c]));
  const path: string[] = [];
  let cur = byId.get(id);
  let guard = 0;
  while (cur && guard++ < 10) {
    path.unshift(cur.local_name ?? cur.id);
    cur = cur.parent_id && cur.parent_id !== "0" ? byId.get(cur.parent_id) : undefined;
  }
  return path;
}

export async function recommendCategory(
  ctx: { accessToken: string; shopCipher: string },
  input: { title: string; description?: string; imageUris?: string[] },
  cfg = getTikTokConfig()
): Promise<{ id: string; local_name?: string; level?: number; is_leaf?: boolean }[]> {
  const d = await callApi<{ categories?: { id: string; local_name?: string; level?: number; is_leaf?: boolean }[] }>(
    {
      method: "POST",
      path: "/product/202309/categories/recommend",
      accessToken: ctx.accessToken,
      shopCipher: ctx.shopCipher,
      query: { category_version: CATEGORY_VERSION },
      body: {
        product_title: input.title,
        ...(input.description ? { description: input.description } : {}),
        ...(input.imageUris?.length ? { images: input.imageUris.map((uri) => ({ uri })) } : {}),
      },
      kind: "read",
      retryWhenThrottled: true,
    },
    cfg
  );
  return d.categories ?? [];
}

export interface TikTokAttribute {
  id: string;
  name?: string;
  /** SALES_PROPERTY (phân loại) | PRODUCT_PROPERTY (thuộc tính). */
  type?: string;
  /** Docs 202309 viết sai chính tả `is_requried`; giữ cả hai. */
  is_requried?: boolean;
  is_required?: boolean;
  is_multiple_selection?: boolean;
  is_customizable?: boolean;
  values?: { id?: string; name?: string }[];
}

export async function getCategoryAttributes(
  ctx: { accessToken: string; shopCipher: string },
  categoryId: string,
  cfg = getTikTokConfig()
): Promise<TikTokAttribute[]> {
  const d = await callApi<{ attributes?: TikTokAttribute[] }>(
    {
      path: `/product/202309/categories/${categoryId}/attributes`,
      accessToken: ctx.accessToken,
      shopCipher: ctx.shopCipher,
      query: { locale: LOCALE, category_version: CATEGORY_VERSION },
    },
    cfg
  );
  return d.attributes ?? [];
}

export interface TikTokCategoryRules {
  product_certifications?: { id?: string; name?: string; is_required?: boolean }[];
  size_chart?: { is_supported?: boolean; is_required?: boolean };
  cod?: { is_supported?: boolean };
  package_dimension?: { is_required?: boolean };
  [k: string]: unknown;
}

export async function getCategoryRules(
  ctx: { accessToken: string; shopCipher: string },
  categoryId: string,
  cfg = getTikTokConfig()
): Promise<TikTokCategoryRules> {
  return callApi<TikTokCategoryRules>(
    {
      path: `/product/202309/categories/${categoryId}/rules`,
      accessToken: ctx.accessToken,
      shopCipher: ctx.shopCipher,
      query: { category_version: CATEGORY_VERSION },
    },
    cfg
  );
}

export async function getBrands(
  ctx: { accessToken: string; shopCipher: string },
  input: { categoryId?: string | null; name?: string },
  cfg = getTikTokConfig()
): Promise<{ id: string; name?: string; authorized_status?: string }[]> {
  const d = await callApi<{ brands?: { id: string; name?: string; authorized_status?: string }[] }>(
    {
      path: "/product/202309/brands",
      accessToken: ctx.accessToken,
      shopCipher: ctx.shopCipher,
      query: {
        page_size: 100,
        category_version: CATEGORY_VERSION,
        ...(input.categoryId ? { category_id: input.categoryId } : {}),
        ...(input.name ? { brand_name: input.name } : {}),
      },
    },
    cfg
  );
  return d.brands ?? [];
}

/**
 * Upload ảnh (multipart). Chữ ký TikTok KHÔNG gồm body khi content-type là
 * multipart/form-data → gọi signRequest với body undefined.
 */
export async function uploadProductImage(
  ctx: { accessToken: string; shopCipher: string },
  file: { buffer: Buffer; filename: string; mime: string },
  useCase: "MAIN_IMAGE" | "ATTRIBUTE_IMAGE" | "DESCRIPTION_IMAGE" = "MAIN_IMAGE",
  cfg: TikTokConfig = getTikTokConfig()
): Promise<{ uri: string; url?: string }> {
  const path = "/product/202309/images/upload";
  const query: Record<string, string | number> = {
    app_key: cfg.appKey,
    timestamp: Math.floor(Date.now() / 1000),
    shop_cipher: ctx.shopCipher,
  };
  query.sign = signRequest(cfg.appSecret, path, query, undefined);
  const qs = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)] as [string, string])).toString();
  const form = new FormData();
  form.append("data", new Blob([new Uint8Array(file.buffer)], { type: file.mime }), file.filename);
  form.append("use_case", useCase);
  const res = await platformFetch("TIKTOK", `${TIKTOK_ENDPOINTS.api}${path}?${qs}`, {
    method: "POST",
    headers: { "x-tts-access-token": ctx.accessToken },
    body: form,
  });
  const json = (await res.json()) as { code: number; message: string; data?: { uri?: string; url?: string } };
  if (json.code !== 0) throw new Error(`TikTok API lỗi (code ${json.code}): ${json.message}`);
  if (!json.data?.uri) throw new Error("TikTok upload image không trả uri");
  return { uri: json.data.uri, url: json.data.url };
}

export interface TikTokCreateProductBody {
  save_mode?: "AS_DRAFT" | "LISTING";
  title: string;
  description: string;
  category_id: string;
  category_version: "v2";
  brand_id?: string;
  main_images: { uri: string }[];
  skus: {
    sales_attributes?: { id?: string; name?: string; value_id?: string; value_name?: string; sku_img?: { uri: string } }[];
    seller_sku?: string;
    price: { amount: string; currency: "VND" };
    inventory: { warehouse_id: string; quantity: number }[];
  }[];
  package_weight: { value: string; unit: "KILOGRAM" | "GRAM" };
  package_dimensions?: { length: string; width: string; height: string; unit: "CENTIMETER" };
  product_attributes?: { id: string; values: { id?: string; name?: string }[] }[];
  is_cod_allowed?: boolean;
}

export interface TikTokCreateProductResult {
  product_id: string;
  skus?: { id: string; seller_sku?: string; sales_attributes?: { id?: string; value_id?: string }[] }[];
  warnings?: { message?: string }[];
}

export async function createProduct(
  ctx: { accessToken: string; shopCipher: string },
  body: TikTokCreateProductBody,
  cfg = getTikTokConfig()
): Promise<TikTokCreateProductResult> {
  return callApi<TikTokCreateProductResult>(
    {
      method: "POST",
      path: "/product/202309/products",
      accessToken: ctx.accessToken,
      shopCipher: ctx.shopCipher,
      body,
      kind: "write",
      retryWhenThrottled: false,
    },
    cfg
  );
}
