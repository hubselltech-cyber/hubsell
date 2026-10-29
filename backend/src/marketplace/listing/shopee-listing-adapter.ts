// ============================================================
// ADAPTER ĐĂNG SẢN PHẨM — SHOPEE (lát 1b, CHƯA kiểm gian thật)
//
// Luồng createListing: upload ≤9 ảnh → add_item (giá/tồn phân loại đầu, thuộc
// tính, thương hiệu, kênh vận chuyển, cân nặng/kích thước) → có phân loại thì
// chờ 5 giây rồi init_tier_variation (≤2 nhóm, <50 tổ hợp). item_status NORMAL
// = bán ngay. Mô tả: text thuần (Shopee không nhận HTML).
// ============================================================

import type { Channel } from "@prisma/client";
import { fetchImageBuffer } from "../../lib/image-fetch";
import type { ShopeeItemBaseInfo } from "../../integrations/shopee/client";
import * as api from "../../integrations/shopee/listing-api";
import { getValidShopeeAccessToken } from "../../integrations/shopee/service";
import { viAttributeName } from "./attribute-names-vi";
import { dimsComplete, MAX_DESCRIPTION_IMAGES, normalizeDims, PLATFORM_LISTING_RULES } from "./rules";
import type {
  AttributeDef,
  Brand,
  CategoryNode,
  CategoryRequirements,
  CategorySuggestion,
  CategoryTreeNode,
  CreateListingResult,
  ListingAdapter,
  ListingDraft,
  ListingOption,
  ListingVariant,
  LogisticOption,
  NormalizedListing,
} from "./types";
import { gramsToKg, htmlToText, normalizeText, splitVariantValues, tierIndexes, vndInt } from "./variant-map";

const NO_BRAND: Brand = { id: "0", name: "No Brand" };
const TIER_INIT_DELAY_MS = 5_500;

/** Trường add_item/base_info mà kiểu ShopeeItemBaseInfo hiện chưa khai. */
interface BaseInfoExtra {
  category_id?: number;
  weight?: number | string;
  dimension?: { package_length?: number; package_width?: number; package_height?: number };
  brand?: { brand_id?: number; original_brand_name?: string };
  tier_variation?: { name?: string; option_list?: { option?: string; image?: { image_url?: string } }[] }[];
}

/** Tên giá trị thuộc tính — get_attribute_tree trả `display_name`/`name`, bản cũ get_attributes trả `display_value_name`/`original_value_name`; nhận cả hai. */
export function attrValueName(v: api.ShopeeAttributeValue): string {
  return v.display_name ?? v.name ?? v.display_value_name ?? v.original_value_name ?? "";
}

function attrDef(a: api.ShopeeAttribute): AttributeDef {
  const options = (a.attribute_value_list ?? []).map(attrValueName).filter(Boolean);
  const validation = a.attribute_info?.input_validation_type ?? a.input_validation_type;
  const type: AttributeDef["type"] = options.length > 0 ? "select" : validation === "INT_TYPE" || validation === "FLOAT_TYPE" ? "number" : "text";
  return { id: String(a.attribute_id), name: viAttributeName(a.display_name ?? a.name ?? String(a.attribute_id)), required: Boolean(a.mandatory), type, options: options.length ? options : undefined };
}

export const shopeeListingAdapter: ListingAdapter = {
  name: "shopee",

  async fetchListing(channel: Channel, itemId: string): Promise<NormalizedListing | null> {
    const { accessToken, shopId } = await getValidShopeeAccessToken(channel);
    const { item, models } = await api.getItemDetail(accessToken, shopId, Number(itemId));
    if (!item) return null;
    const extra = item as ShopeeItemBaseInfo & BaseInfoExtra;
    // Mô tả mở rộng = dãy ô text/image; chữ gom lại, ảnh tách sang descriptionImages.
    const fields = item.description_info?.extended_description?.field_list ?? [];
    const description =
      item.description?.trim() ||
      fields
        .filter((f) => f.field_type !== "image")
        .map((f) => f.text ?? "")
        .filter(Boolean)
        .join("\n") ||
      "";
    const descriptionImages = fields
      .filter((f) => f.field_type === "image")
      .map((f) => f.image_info?.image_url ?? "")
      .filter(Boolean);
    const options: ListingOption[] = (extra.tier_variation ?? []).map((t) => ({
      name: t.name ?? "Phân loại",
      values: (t.option_list ?? []).map((o) => o.option ?? "").filter(Boolean),
    }));
    const price = (p?: { current_price?: number; original_price?: number }[]) => Number(p?.[0]?.original_price ?? p?.[0]?.current_price ?? 0);
    const stockOf = (s?: { summary_info?: { total_available_stock?: number } }) => Number(s?.summary_info?.total_available_stock ?? 0);
    const variants: ListingVariant[] =
      models.length > 0
        ? models.map((m) => ({
            sku: m.model_sku?.trim() || "",
            name: m.model_name ?? null,
            price: price(m.price_info),
            stock: stockOf(m.stock_info_v2 as { summary_info?: { total_available_stock?: number } }),
            imageUrl: null,
          }))
        : [{ sku: item.item_sku?.trim() || "", name: null, price: price(item.price_info), stock: stockOf(item.stock_info_v2 as never), imageUrl: null }];
    const categories = await api.getCategories(accessToken, shopId).catch(() => [] as api.ShopeeCategory[]);
    return {
      title: item.item_name ?? "",
      description,
      images: item.image?.image_url_list ?? [],
      descriptionImages,
      categoryId: extra.category_id ? String(extra.category_id) : null,
      categoryPath: extra.category_id && categories.length ? api.categoryPath(categories, extra.category_id) : null,
      brandName: extra.brand?.original_brand_name ?? null,
      weightGrams: extra.weight ? Math.round(Number(extra.weight) * 1000) : null,
      dimensionsCm: normalizeDims({
        length: extra.dimension?.package_length,
        width: extra.dimension?.package_width,
        height: extra.dimension?.package_height,
      }),
      options,
      variants,
      attributes: (item.attribute_list ?? [])
        .map((a) => ({ name: a.original_attribute_name ?? "", value: a.attribute_value_list?.[0]?.original_value_name ?? "" }))
        .filter((a) => a.name && a.value),
    };
  },

  async recommendCategory(channel: Channel, listing: NormalizedListing): Promise<CategorySuggestion[]> {
    const { accessToken, shopId } = await getValidShopeeAccessToken(channel);
    const [ids, all] = await Promise.all([api.recommendCategory(accessToken, shopId, listing.title), api.getCategories(accessToken, shopId)]);
    return ids.slice(0, 3).map((id, i) => {
      const path = api.categoryPath(all, id);
      return { id: String(id), name: path[path.length - 1] ?? String(id), path, confidence: Math.max(0.5, 0.9 - i * 0.15) };
    });
  },

  async searchCategories(channel: Channel, query: string): Promise<CategoryNode[]> {
    const { accessToken, shopId } = await getValidShopeeAccessToken(channel);
    const all = await api.getCategories(accessToken, shopId);
    const q = normalizeText(query);
    const leaves = all.filter((c) => !c.has_children);
    const nodes = leaves.map((c) => {
      const path = api.categoryPath(all, c.category_id);
      return { id: String(c.category_id), name: path[path.length - 1] ?? "", path, leaf: true };
    });
    return (q ? nodes.filter((n) => normalizeText(n.path.join(" ")).includes(q)) : nodes).slice(0, 300);
  },

  async getCategoryTree(channel: Channel): Promise<CategoryTreeNode[]> {
    const { accessToken, shopId } = await getValidShopeeAccessToken(channel);
    const all = await api.getCategories(accessToken, shopId);
    return all.map((c) => ({
      id: String(c.category_id),
      name: c.display_category_name ?? c.original_category_name ?? String(c.category_id),
      parentId: c.parent_category_id ? String(c.parent_category_id) : null,
      leaf: !c.has_children,
    }));
  },

  async getCategoryRequirements(channel: Channel, categoryId: string): Promise<CategoryRequirements | null> {
    const { accessToken, shopId } = await getValidShopeeAccessToken(channel);
    const [tree, brands] = await Promise.all([
      api.getAttributeTree(accessToken, shopId, Number(categoryId)),
      api.getBrands(accessToken, shopId, Number(categoryId)).catch(() => ({ brands: [], mandatory: false })),
    ]);
    return { ...PLATFORM_LISTING_RULES.SHOPEE, brandRequired: brands.mandatory, attributes: tree.map(attrDef) };
  },

  async getLogistics(channel: Channel): Promise<LogisticOption[]> {
    const { accessToken, shopId } = await getValidShopeeAccessToken(channel);
    const list = await api.getLogisticsChannels(accessToken, shopId);
    return list.map((l) => ({ id: String(l.logistics_channel_id), name: l.logistics_channel_name ?? String(l.logistics_channel_id), enabled: Boolean(l.enabled) }));
  },

  async searchBrands(channel: Channel, categoryId: string | null, query: string): Promise<Brand[]> {
    if (!categoryId) return [NO_BRAND];
    const { accessToken, shopId } = await getValidShopeeAccessToken(channel);
    const { brands } = await api.getBrands(accessToken, shopId, Number(categoryId));
    const q = normalizeText(query);
    const list = brands.map((b) => ({ id: String(b.brand_id), name: b.display_brand_name ?? b.original_brand_name ?? String(b.brand_id) }));
    const filtered = q ? list.filter((b) => normalizeText(b.name).includes(q)) : list;
    return [NO_BRAND, ...filtered].slice(0, 200);
  },

  async createListing(channel: Channel, draft: ListingDraft): Promise<CreateListingResult> {
    const { accessToken, shopId } = await getValidShopeeAccessToken(channel);
    const imageIds: string[] = [];
    for (const url of draft.listing.images.slice(0, 9)) {
      const img = await fetchImageBuffer(url);
      imageIds.push(await api.uploadProductImage({ accessToken, shopId, ...img }));
    }
    if (imageIds.length === 0) throw new Error("Không tải được ảnh nào lên Shopee");
    // Ảnh chèn trong mô tả: upload scene "desc" → mô tả mở rộng (chữ trước, ảnh sau).
    const descImageIds: string[] = [];
    for (const url of draft.listing.descriptionImages.slice(0, MAX_DESCRIPTION_IMAGES)) {
      const img = await fetchImageBuffer(url);
      descImageIds.push(await api.uploadProductImage({ accessToken, shopId, ...img, scene: "desc" }));
    }
    const descriptionText = htmlToText(draft.listing.description).slice(0, 3000);

    // Thuộc tính: cần value_id cho kiểu chọn; kiểu gõ tay gửi value_id 0 + tên.
    const tree = await api.getAttributeTree(accessToken, shopId, Number(draft.categoryId));
    const attribute_list = Object.entries(draft.attributes)
      .filter(([, v]) => String(v).trim())
      .map(([id, value]) => {
        const def = tree.find((a) => String(a.attribute_id) === id);
        const found = def?.attribute_value_list?.find((v) => attrValueName(v).toLowerCase() === String(value).toLowerCase());
        return {
          attribute_id: Number(id),
          attribute_value_list: [found?.value_id ? { value_id: found.value_id } : { value_id: 0, original_value_name: String(value) }],
        };
      });

    const first = draft.variants[0];
    const body: api.ShopeeAddItemBody = {
      item_name: draft.listing.title,
      description: descriptionText,
      ...(descImageIds.length
        ? {
            description_type: "extended" as const,
            description_info: {
              extended_description: {
                field_list: [
                  { field_type: "text" as const, text: descriptionText },
                  ...descImageIds.map((image_id) => ({ field_type: "image" as const, image_info: { image_id } })),
                ],
              },
            },
          }
        : {}),
      original_price: vndInt(first.price),
      weight: gramsToKg(draft.weightGrams),
      category_id: Number(draft.categoryId),
      item_status: "NORMAL",
      image: { image_id_list: imageIds },
      logistic_info: draft.logisticIds.map((id) => ({ logistic_id: Number(id), enabled: true })),
      ...(attribute_list.length ? { attribute_list } : {}),
      ...(draft.brandId ? { brand: { brand_id: Number(draft.brandId), original_brand_name: draft.brandName ?? undefined } } : {}),
      // Chỉ gửi khi đủ 3 số > 0 — Shopee từ chối cả gói nếu có số 0 (sự cố 29/10).
      ...(dimsComplete(draft.dimensionsCm)
        ? { dimension: { package_length: draft.dimensionsCm.length, package_width: draft.dimensionsCm.width, package_height: draft.dimensionsCm.height } }
        : {}),
      ...(draft.variants.length === 1 && first.sku ? { item_sku: first.sku } : {}),
      seller_stock: [{ stock: Math.max(0, first.stock) }],
    };
    const itemId = await api.addItem(accessToken, shopId, body);

    const variants: { sku: string; remoteId: string }[] = [];
    if (draft.variants.length > 1 && draft.listing.options.length > 0) {
      await new Promise((r) => setTimeout(r, TIER_INIT_DELAY_MS));
      const options = draft.listing.options.slice(0, 2);
      const models = draft.variants
        .map((v) => ({ v, tier_index: tierIndexes(v, options) }))
        .filter((m) => m.tier_index.every((i) => i >= 0))
        .map((m) => ({
          tier_index: m.tier_index,
          original_price: vndInt(m.v.price),
          seller_stock: [{ stock: Math.max(0, m.v.stock) }],
          ...(m.v.sku ? { model_sku: m.v.sku } : {}),
        }));
      if (models.length !== draft.variants.length) {
        throw new Error(
          `Shopee: ${draft.variants.length - models.length} phân loại không khớp nhóm phân loại (${options.map((o) => o.name).join(" × ")}) — sản phẩm đã tạo (item ${itemId}) nhưng chưa có phân loại, bổ sung trên sàn.`
        );
      }
      const created = await api.initTierVariation(accessToken, shopId, {
        item_id: itemId,
        tier_variation: options.map((o) => ({ name: o.name.slice(0, 14), option_list: o.values.map((x) => ({ option: x.slice(0, 20) })) })),
        model: models,
      });
      for (const m of created) {
        const match = draft.variants.find((v) => tierIndexes(v, options).join(",") === (m.tier_index ?? []).join(","));
        if (match) variants.push({ sku: match.sku, remoteId: `${itemId}-${m.model_id}` });
      }
    } else {
      variants.push({ sku: first.sku, remoteId: String(itemId) });
    }
    return { remoteItemId: String(itemId), remoteUrl: null, status: "LISTED", variants };
  },
};

/** Dùng cho test: chuỗi phân loại nguồn → giá trị theo nhóm. */
export { splitVariantValues };
