// ============================================================
// SHOPEE — API ĐĂNG SẢN PHẨM (lát 1b, docs/SAO-CHEP-SAN-PHAM.md mục 10)
//
// Tài liệu đọc 29/10/2026 (docs/KHAO-SAT-SAO-CHEP-SAN-PHAM-DANG-HANG-LOAT-29-10.md
// mục 4): get_category, category_recommend, get_attribute_tree, get_brand_list,
// logistics/get_channel_list, media_space/upload_image, add_item,
// init_tier_variation. CHƯA kiểm trên gian thật — mọi tên trường theo docs v2.
// ============================================================

import { TtlCache } from "../../lib/image-fetch";
import { platformFetch } from "../../lib/platform-http";
import {
  callShopGet,
  callShopPost,
  ensureOk,
  getItemBaseInfo,
  getModelList,
  signShop,
  type ShopeeEnvelope,
  type ShopeeItemBaseInfo,
  type ShopeeModel,
} from "./client";
import { getShopeeConfig, type ShopeeConfig } from "./config";

const P = {
  category: "/api/v2/product/get_category",
  categoryRecommend: "/api/v2/product/category_recommend",
  attributeTree: "/api/v2/product/get_attribute_tree",
  brandList: "/api/v2/product/get_brand_list",
  logisticsChannels: "/api/v2/logistics/get_channel_list",
  uploadImage: "/api/v2/media_space/upload_image",
  addItem: "/api/v2/product/add_item",
  initTierVariation: "/api/v2/product/init_tier_variation",
} as const;

export interface ShopeeCategory {
  category_id: number;
  parent_category_id?: number;
  original_category_name?: string;
  display_category_name?: string;
  has_children?: boolean;
}

interface CategoryData extends ShopeeEnvelope {
  response?: { category_list?: ShopeeCategory[] };
}

const categoryCache = new TtlCache<ShopeeCategory[]>(6 * 60 * 60 * 1000);

/** Cây danh mục (phẳng, có parent) — đệm 6 giờ theo shop. */
export async function getCategories(accessToken: string, shopId: string, cfg = getShopeeConfig()): Promise<ShopeeCategory[]> {
  return categoryCache.get(`shopee:${shopId}`, async () => {
    const d = await callShopGet<CategoryData>(P.category, accessToken, shopId, [["language", "vi"]], "get_category", cfg);
    return d.response?.category_list ?? [];
  });
}

/** Đường dẫn tên từ gốc tới lá. */
export function categoryPath(all: ShopeeCategory[], id: number): string[] {
  const byId = new Map(all.map((c) => [c.category_id, c]));
  const path: string[] = [];
  let cur = byId.get(id);
  let guard = 0;
  while (cur && guard++ < 10) {
    path.unshift(cur.display_category_name ?? cur.original_category_name ?? String(cur.category_id));
    cur = cur.parent_category_id ? byId.get(cur.parent_category_id) : undefined;
  }
  return path;
}

interface RecommendData extends ShopeeEnvelope {
  response?: { category_id?: number[] };
}

/** Gợi ý danh mục theo tên (+ ảnh bìa đã upload nếu có). Trả id lá theo thứ tự ưu tiên. */
export async function recommendCategory(
  accessToken: string,
  shopId: string,
  itemName: string,
  coverImageId?: string,
  cfg = getShopeeConfig()
): Promise<number[]> {
  const params: Array<[string, string | number]> = [["item_name", itemName]];
  if (coverImageId) params.push(["cover_image", coverImageId]);
  const d = await callShopGet<RecommendData>(P.categoryRecommend, accessToken, shopId, params, "category_recommend", cfg);
  return d.response?.category_id ?? [];
}

export interface ShopeeAttributeValue {
  value_id?: number;
  /** get_attribute_tree (v2 mới). */
  name?: string;
  display_name?: string;
  /** get_attributes (v2 cũ) — giữ để không vỡ nếu sàn còn trả. */
  display_value_name?: string;
  original_value_name?: string;
}

export interface ShopeeAttribute {
  attribute_id: number;
  mandatory?: boolean;
  name?: string;
  display_name?: string;
  /** get_attribute_tree gói input_type/validation trong attribute_info. */
  attribute_info?: { input_type?: string; input_validation_type?: string; format_type?: string; max_input_value_count?: number };
  input_type?: string; // DROP_DOWN | TEXT_FILED | COMBO_BOX | MULTIPLE_SELECT | MULTIPLE_SELECT_COMBO_BOX
  input_validation_type?: string; // INT_TYPE | STRING_TYPE | FLOAT_TYPE | DATE_TYPE...
  attribute_value_list?: ShopeeAttributeValue[];
}

interface AttributeTreeData extends ShopeeEnvelope {
  response?: { list?: { category_id: number; attribute_tree?: ShopeeAttribute[] }[] };
}

export async function getAttributeTree(accessToken: string, shopId: string, categoryId: number, cfg = getShopeeConfig()): Promise<ShopeeAttribute[]> {
  const d = await callShopGet<AttributeTreeData>(
    P.attributeTree,
    accessToken,
    shopId,
    [
      ["category_id_list", String(categoryId)],
      ["language", "vi"],
    ],
    "get_attribute_tree",
    cfg
  );
  return d.response?.list?.find((x) => x.category_id === categoryId)?.attribute_tree ?? [];
}

export interface ShopeeBrand {
  brand_id: number;
  original_brand_name?: string;
  display_brand_name?: string;
}

interface BrandData extends ShopeeEnvelope {
  response?: { brand_list?: ShopeeBrand[]; has_next_page?: boolean; next_offset?: number; is_mandatory?: boolean };
}

export async function getBrands(
  accessToken: string,
  shopId: string,
  categoryId: number,
  cfg = getShopeeConfig()
): Promise<{ brands: ShopeeBrand[]; mandatory: boolean }> {
  const d = await callShopGet<BrandData>(
    P.brandList,
    accessToken,
    shopId,
    [
      ["category_id", categoryId],
      ["offset", 0],
      ["page_size", 100],
      ["status", 1],
      ["language", "vi"],
    ],
    "get_brand_list",
    cfg
  );
  return { brands: d.response?.brand_list ?? [], mandatory: Boolean(d.response?.is_mandatory) };
}

export interface ShopeeLogisticsChannel {
  logistics_channel_id: number;
  logistics_channel_name?: string;
  enabled?: boolean;
  size_list?: unknown[];
  /** Kênh đòi kích thước kiện (SIZE_INPUT) hay theo cân (WEIGHT_INPUT). */
  fee_type?: string;
}

interface LogisticsData extends ShopeeEnvelope {
  response?: { logistics_channel_list?: ShopeeLogisticsChannel[] };
}

export async function getLogisticsChannels(accessToken: string, shopId: string, cfg = getShopeeConfig()): Promise<ShopeeLogisticsChannel[]> {
  const d = await callShopGet<LogisticsData>(P.logisticsChannels, accessToken, shopId, [], "get_channel_list", cfg);
  return d.response?.logistics_channel_list ?? [];
}

interface UploadData extends ShopeeEnvelope {
  response?: { image_info?: { image_id?: string; image_url_list?: { image_url?: string }[] } };
}

/** Tải ảnh lên không gian media (bắt buộc trước add_item — Shopee không nhận URL ngoài). */
export async function uploadProductImage(
  params: { accessToken: string; shopId: string; buffer: Buffer; filename: string; mime: string },
  cfg: ShopeeConfig = getShopeeConfig()
): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = signShop(cfg.partnerKey, cfg.partnerId, P.uploadImage, timestamp, params.accessToken, params.shopId);
  const qs = new URLSearchParams({
    partner_id: cfg.partnerId,
    timestamp: String(timestamp),
    access_token: params.accessToken,
    shop_id: params.shopId,
    sign,
  }).toString();
  const form = new FormData();
  form.append("scene", "normal");
  form.append("image", new Blob([new Uint8Array(params.buffer)], { type: params.mime }), params.filename);
  const res = await platformFetch("SHOPEE", `${cfg.apiBase}${P.uploadImage}?${qs}`, { method: "POST", body: form });
  const data = ensureOk((await res.json()) as UploadData, "upload_image");
  const id = data.response?.image_info?.image_id;
  if (!id) throw new Error("Shopee upload_image không trả image_id");
  return id;
}

export interface ShopeeAddItemBody {
  item_name: string;
  description: string;
  original_price: number;
  weight: number; // kg
  category_id: number;
  item_status: "NORMAL" | "UNLIST";
  image: { image_id_list: string[] };
  logistic_info: { logistic_id: number; enabled: boolean }[];
  attribute_list?: { attribute_id: number; attribute_value_list: { value_id: number; original_value_name?: string }[] }[];
  brand?: { brand_id: number; original_brand_name?: string };
  dimension?: { package_length: number; package_width: number; package_height: number };
  item_sku?: string;
  seller_stock: { stock: number }[];
  description_type?: "normal";
}

interface AddItemData extends ShopeeEnvelope {
  response?: { item_id?: number };
}

export async function addItem(accessToken: string, shopId: string, body: ShopeeAddItemBody, cfg = getShopeeConfig()): Promise<number> {
  const d = await callShopPost<AddItemData>(P.addItem, accessToken, shopId, body as unknown as Record<string, unknown>, "add_item", cfg);
  const id = d.response?.item_id;
  if (!id) throw new Error("Shopee add_item không trả item_id");
  return id;
}

export interface ShopeeTierVariationBody {
  item_id: number;
  tier_variation: { name: string; option_list: { option: string }[] }[];
  model: { tier_index: number[]; original_price: number; seller_stock: { stock: number }[]; model_sku?: string }[];
}

interface TierData extends ShopeeEnvelope {
  response?: { model?: { model_id: number; tier_index?: number[]; model_sku?: string }[] };
}

/** Gọi sau add_item ≥ 5 giây (docs). */
export async function initTierVariation(
  accessToken: string,
  shopId: string,
  body: ShopeeTierVariationBody,
  cfg = getShopeeConfig()
): Promise<{ model_id: number; tier_index?: number[]; model_sku?: string }[]> {
  const d = await callShopPost<TierData>(
    P.initTierVariation,
    accessToken,
    shopId,
    body as unknown as Record<string, unknown>,
    "init_tier_variation",
    cfg
  );
  return d.response?.model ?? [];
}

/** Chi tiết item + model để dựng listing nguồn. */
export async function getItemDetail(
  accessToken: string,
  shopId: string,
  itemId: number,
  cfg = getShopeeConfig()
): Promise<{ item: ShopeeItemBaseInfo | null; models: ShopeeModel[] }> {
  const [items, models] = await Promise.all([
    getItemBaseInfo(accessToken, shopId, [itemId], cfg),
    getModelList(accessToken, shopId, itemId, cfg).catch(() => [] as ShopeeModel[]),
  ]);
  return { item: items[0] ?? null, models };
}
