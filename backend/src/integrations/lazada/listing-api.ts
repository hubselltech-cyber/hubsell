// ============================================================
// LAZADA — API ĐĂNG SẢN PHẨM (lát 1b, docs/SAO-CHEP-SAN-PHAM.md mục 10)
//
// Theo docs open.lazada.com đọc 29/10/2026: /category/tree/get,
// /product/category/suggestion/get, /category/attributes/get,
// /category/brands/query, /image/migrate, /product/create (payload JSON),
// /product/item/get. CHƯA kiểm gian thật. Cần kiểm app 140639 / ISV 142085 có
// nhóm Product API chưa (docs khảo sát mục 8).
// ============================================================

import { TtlCache } from "../../lib/image-fetch";
import { callLazada, callLazadaPost, escapeXml, type LazadaEnvelope, type LazadaProduct } from "./client";
import { getLazadaConfig, LAZADA_ENDPOINTS } from "./config";

const LANG = "vi_VN";

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

const treeCache = new TtlCache<LazadaCategoryNode[]>(6 * 60 * 60 * 1000);

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

/** Duỗi cây thành danh sách lá kèm đường dẫn. */
export function flattenLeaves(tree: LazadaCategoryNode[]): { id: string; name: string; path: string[] }[] {
  const out: { id: string; name: string; path: string[] }[] = [];
  const walk = (nodes: LazadaCategoryNode[], trail: string[]) => {
    for (const n of nodes) {
      const name = n.name ?? String(n.category_id);
      const path = [...trail, name];
      if (n.leaf || !n.children || n.children.length === 0) out.push({ id: String(n.category_id), name, path });
      else walk(n.children, path);
    }
  };
  walk(tree, []);
  return out;
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

export async function getCategoryAttributes(accessToken: string, categoryId: string, cfg = getLazadaConfig()): Promise<LazadaAttribute[]> {
  const d = await callLazada<AttrData>(
    LAZADA_ENDPOINTS.api,
    "/category/attributes/get",
    { access_token: accessToken, primary_category_id: categoryId, language_code: LANG },
    "category/attributes/get",
    cfg
  );
  return d.data ?? [];
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

export interface LazadaCreatePayload {
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

export interface LazadaItemDetail extends LazadaProduct {
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
