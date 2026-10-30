// ============================================================
// LAZADA — API ĐĂNG SẢN PHẨM (docs/SAO-CHEP-SAN-PHAM.md mục 10; CHƯA kiểm trên gian thật)
//
// Theo docs open.lazada.com đọc 29/10/2026: /category/tree/get,
// /product/category/suggestion/get, /category/attributes/get,
// /category/brands/query, /image/migrate, /product/create (payload JSON),
// /product/item/get. Cần kiểm app 140639 / ISV 142085 có nhóm Product API chưa
// (docs khảo sát mục 8). Cây danh mục + thuộc tính đệm RAM có trần (lib/ttl-cache).
// ============================================================

import { TtlCache } from "../../lib/ttl-cache";
import { callLazada, callLazadaPost, escapeXml, type LazadaEnvelope, type LazadaProduct } from "./client";
import { getLazadaConfig, LAZADA_ENDPOINTS } from "./config";

const LANG = "vi_VN";
const HOUR = 60 * 60 * 1000;

export interface LazadaCategoryNode {
  category_id: number;
  name?: string;
  leaf?: boolean;
  var?: boolean;
  children?: LazadaCategoryNode[];
}

interface TreeData extends LazadaEnvelope {
  data?: LazadaCategoryNode[];
}

/** Cây danh mục Lazada chung toàn sàn (không theo gian) — một bản, đệm 6 giờ. */
const treeCache = new TtlCache<LazadaCategoryNode[]>(6 * HOUR);

export async function getCategoryTree(accessToken: string, cfg = getLazadaConfig()): Promise<LazadaCategoryNode[]> {
  return treeCache.get("lazada:tree", async () => {
    const d = await callLazada<TreeData>(
      LAZADA_ENDPOINTS.api,
      "/category/tree/get",
      { access_token: accessToken, language_code: LANG },
      "category/tree/get",
      cfg
    );
    return d.data ?? [];
  });
}

interface SuggestData extends LazadaEnvelope {
  data?: { categorySuggestions?: { categoryId?: number | string; categoryName?: string; categoryPath?: string }[] };
}

export async function suggestCategory(
  accessToken: string,
  productName: string,
  cfg = getLazadaConfig()
): Promise<{ id: string; name: string; path: string[] }[]> {
  const d = await callLazada<SuggestData>(
    LAZADA_ENDPOINTS.api,
    "/product/category/suggestion/get",
    { access_token: accessToken, product_name: productName },
    "category/suggestion/get",
    cfg
  );
  return (d.data?.categorySuggestions ?? [])
    .filter((s) => s.categoryId != null)
    .map((s) => ({
      id: String(s.categoryId),
      name: s.categoryName ?? "",
      path: s.categoryPath ? s.categoryPath.split(/\s*>\s*|\s*\/\s*/).filter(Boolean) : [s.categoryName ?? ""],
    }));
}

export interface LazadaAttribute {
  id?: number;
  /** Khóa dùng trong payload (vd "color_family", "brand", "material"). */
  name: string;
  label?: string;
  is_mandatory?: number | boolean;
  is_sale_prop?: number | boolean;
  input_type?: string; // text | singleSelect | multiSelect | numeric | richText | enumInput
  attribute_type?: string; // normal | sku | ...
  options?: { name?: string; id?: number }[];
}

interface AttrData extends LazadaEnvelope {
  data?: LazadaAttribute[];
}

/** Thuộc tính danh mục chung toàn sàn — đệm 6 giờ theo danh mục. */
const attributeCache = new TtlCache<LazadaAttribute[]>(6 * HOUR);

export async function getCategoryAttributes(accessToken: string, categoryId: string, cfg = getLazadaConfig()): Promise<LazadaAttribute[]> {
  return attributeCache.get(`lazada:${categoryId}`, async () => {
    const d = await callLazada<AttrData>(
      LAZADA_ENDPOINTS.api,
      "/category/attributes/get",
      { access_token: accessToken, primary_category_id: categoryId, language_code: LANG },
      "category/attributes/get",
      cfg
    );
    return d.data ?? [];
  });
}

interface BrandData extends LazadaEnvelope {
  data?: { module?: { brand_id?: number | string; name?: string; name_en?: string }[]; total_record?: number } | { brand_id?: number | string; name?: string }[];
}

export async function queryBrands(
  accessToken: string,
  input: { categoryId?: string | null; name?: string },
  cfg = getLazadaConfig()
): Promise<{ id: string; name: string }[]> {
  const d = await callLazada<BrandData>(
    LAZADA_ENDPOINTS.api,
    "/category/brands/query",
    {
      access_token: accessToken,
      startRow: "0",
      pageSize: "200",
      languageCode: LANG,
      ...(input.categoryId ? { categoryId: input.categoryId } : {}),
      ...(input.name ? { brandName: input.name } : {}),
    },
    "category/brands/query",
    cfg
  );
  const list = Array.isArray(d.data) ? d.data : (d.data?.module ?? []);
  return list.filter((b) => b.brand_id != null).map((b) => ({ id: String(b.brand_id), name: b.name ?? String(b.brand_id) }));
}

interface MigrateData extends LazadaEnvelope {
  data?: { image?: { url?: string; hash_code?: string } };
}

/** Kéo ảnh từ URL ngoài vào kho ảnh Lazada → URL Lazada để dùng trong create. */
export async function migrateImage(accessToken: string, url: string, cfg = getLazadaConfig()): Promise<string> {
  const payload = `<Request><Image><Url>${escapeXml(url)}</Url></Image></Request>`;
  const d = await callLazadaPost<MigrateData>(LAZADA_ENDPOINTS.api, "/image/migrate", { access_token: accessToken, payload }, "image/migrate", cfg);
  const out = d.data?.image?.url;
  if (!out) throw new Error("Lazada image/migrate không trả url");
  return out;
}

export interface LazadaCreateSku {
  SellerSku: string;
  quantity: number;
  price: number;
  package_length: number;
  package_width: number;
  package_height: number;
  package_weight: number;
  Images?: { Image: string[] };
  saleProp?: Record<string, string>;
}

interface LazadaCreatePayload {
  Request: {
    Product: {
      PrimaryCategory: string;
      Images: { Image: string[] };
      Attributes: Record<string, string>;
      Skus: { Sku: LazadaCreateSku[] };
    };
  };
}

interface CreateData extends LazadaEnvelope {
  data?: { item_id?: number | string; sku_list?: { seller_sku?: string; sku_id?: number | string; shop_sku?: string }[] };
}

export async function createProduct(
  accessToken: string,
  payload: LazadaCreatePayload,
  cfg = getLazadaConfig()
): Promise<{ itemId: string; skus: { sellerSku: string; skuId: string }[] }> {
  const d = await callLazadaPost<CreateData>(
    LAZADA_ENDPOINTS.api,
    "/product/create",
    { access_token: accessToken, payload: JSON.stringify(payload) },
    "product/create",
    cfg
  );
  const itemId = d.data?.item_id;
  if (itemId == null) throw new Error("Lazada product/create không trả item_id");
  return {
    itemId: String(itemId),
    skus: (d.data?.sku_list ?? []).map((s) => ({ sellerSku: s.seller_sku ?? "", skuId: String(s.sku_id ?? "") })),
  };
}

interface LazadaItemDetail extends LazadaProduct {
  attributes?: { name?: string; description?: string; short_description?: string; brand?: string; [k: string]: unknown };
  primary_category?: number | string;
}

interface ItemData extends LazadaEnvelope {
  data?: LazadaItemDetail;
}

export async function getItem(accessToken: string, itemId: string, cfg = getLazadaConfig()): Promise<LazadaItemDetail | null> {
  const d = await callLazada<ItemData>(LAZADA_ENDPOINTS.api, "/product/item/get", { access_token: accessToken, item_id: itemId }, "product/item/get", cfg);
  return d.data ?? null;
}
