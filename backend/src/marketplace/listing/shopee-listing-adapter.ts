// ============================================================
// ADAPTER ĐĂNG SẢN PHẨM — SHOPEE (đăng thật trên gian từ 29/10/2026)
//
// Luồng createListing: upload ≤9 ảnh (chuẩn hóa sharp) → add_item (giá/tồn phân
// loại đầu, thuộc tính, thương hiệu, kênh vận chuyển, cân nặng/kích thước, mô tả
// mở rộng kèm ảnh nếu gian được whitelist) → có phân loại thì chờ 5 giây rồi
// init_tier_variation (≤2 nhóm, ≤50 tổ hợp, ảnh phân loại ở tier 1). item_status
// NORMAL = bán ngay. Mô tả: text thuần (Shopee không nhận HTML).
// ============================================================

import type { Channel } from "@prisma/client";
import type { FetchedImage } from "../../lib/image-fetch";
import { SHOPEE_IMAGE } from "../../lib/image-normalize";
import { prisma } from "../../lib/prisma";
import type { ShopeeItemBaseInfo, ShopeeModel } from "../../integrations/shopee/client";
import * as api from "../../integrations/shopee/listing-api";
import { getValidShopeeAccessToken } from "../../integrations/shopee/service";
import { viAttributeName } from "./attribute-names-vi";
import { mergeUsedBrands, rankBrands } from "./brand-search";
import { isShopeeDescImageWhitelistError } from "./error-text";
import { dimsComplete, MAX_DESCRIPTION_IMAGES, normalizeDims, PLATFORM_LISTING_RULES } from "./rules";
import type {
  AttributeDef,
  Brand,
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
import { prepareImage, uploadImages } from "./upload-images";
import { gramsToKg, htmlToText, normalizeText, optionImages, reorderOptionsForImages, tierIndexes, vndInt } from "./variant-map";

const NO_BRAND: Brand = { id: "0", name: "No Brand" };
const TIER_INIT_DELAY_MS = 5_500;

/**
 * Gian Shopee KHÔNG được whitelist mô tả mở rộng (ảnh chèn trong mô tả) — lỗi thật gian
 * Bunchar 30/10/2026: add_item product.error_param "You are not in the whitelist to add
 * images in description, can only upload plain text". Không có API hỏi trước, nên: lần đầu
 * gặp → đăng lại ngay bằng mô tả chữ (thêm đúng 1 lượt add_item), đồng thời nhớ gian 7 ngày
 * để các lượt sau bỏ qua ảnh mô tả luôn (khỏi tải ảnh + khỏi lượt hỏng).
 * Nhớ trong RAM tiến trình: web và worker học riêng, restart là quên — sai lệch tối đa một
 * lượt add_item thừa cho mỗi tiến trình mỗi 7 ngày, chấp nhận được, không đáng thêm cột.
 */
const DESC_IMAGE_BLOCK_MS = 7 * 24 * 3600 * 1000;
const descImageBlockedUntil = new Map<string, number>();

function descImagesBlocked(channelId: string): boolean {
  const until = descImageBlockedUntil.get(channelId);
  if (!until) return false;
  if (until > Date.now()) return true;
  descImageBlockedUntil.delete(channelId);
  return false;
}

async function addItemWithPlainTextFallback(
  channel: Channel,
  accessToken: string,
  shopId: string,
  body: api.ShopeeAddItemBody,
  descImageCount: number
): Promise<number> {
  try {
    return await api.addItem(accessToken, shopId, body);
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    if (!descImageCount || !isShopeeDescImageWhitelistError(message)) throw err;
    descImageBlockedUntil.set(channel.id, Date.now() + DESC_IMAGE_BLOCK_MS);
    console.warn(
      `[listing-copy] ${channel.shopName}: Shopee không cho gian này chèn ảnh mô tả (${message.slice(0, 160)}) — đăng lại mô tả chữ, bỏ ${descImageCount} ảnh mô tả`
    );
    const { description_type: _t, description_info: _i, ...plain } = body;
    return api.addItem(accessToken, shopId, plain);
  }
}

/** Trường add_item/base_info mà kiểu ShopeeItemBaseInfo hiện chưa khai. */
interface BaseInfoExtra {
  category_id?: number;
  weight?: number | string;
  dimension?: { package_length?: number; package_width?: number; package_height?: number };
  brand?: { brand_id?: number; original_brand_name?: string };
  tier_variation?: { name?: string; option_list?: { option?: string; image?: { image_url?: string } }[] }[];
}

/** Tên giá trị thuộc tính — get_attribute_tree trả `display_name`/`name`, bản cũ get_attributes trả `display_value_name`/`original_value_name`; nhận cả hai. */
function attrValueName(v: api.ShopeeAttributeValue): string {
  return v.display_name ?? v.name ?? v.display_value_name ?? v.original_value_name ?? "";
}

function attrDef(a: api.ShopeeAttribute): AttributeDef {
  const options = (a.attribute_value_list ?? []).map(attrValueName).filter(Boolean);
  const validation = a.attribute_info?.input_validation_type ?? a.input_validation_type;
  const type: AttributeDef["type"] = options.length > 0 ? "select" : validation === "INT_TYPE" || validation === "FLOAT_TYPE" ? "number" : "text";
  return { id: String(a.attribute_id), name: viAttributeName(a.display_name ?? a.name ?? String(a.attribute_id)), required: Boolean(a.mandatory), type, options: options.length ? options : undefined };
}

/** Toàn bộ thương hiệu của danh mục (đệm 6 giờ ở listing-api), đã đổi về dạng chung. */
async function shopeeBrandList(channel: Channel, categoryId: string, status: 1 | 2 = 1): Promise<Brand[]> {
  const { accessToken, shopId } = await getValidShopeeAccessToken(channel);
  const { brands } = await api.getBrands(accessToken, shopId, Number(categoryId), status);
  return brands.map((b) => ({ id: String(b.brand_id), name: b.display_brand_name ?? b.original_brand_name ?? String(b.brand_id) }));
}

/**
 * Hãng khách đang dùng trên gian: id sản phẩm Shopee lấy từ ChannelProduct.externalId
 * ("item-model" → item) của 200 dòng mới nhất, rồi get_item_base_info (≤ 50 item, 1 call, đệm 6 giờ).
 * Lỗi sàn → coi như không có, không làm hỏng ô tìm.
 */
async function shopeeUsedBrands(channel: Channel): Promise<Brand[]> {
  try {
    const rows = await prisma.channelProduct.findMany({
      where: { channelId: channel.id, externalId: { not: null } },
      select: { externalId: true },
      orderBy: { lastSyncedAt: "desc" },
      take: 200,
    });
    const itemIds = [...new Set(rows.map((r) => Number(String(r.externalId).split("-")[0])))];
    const { accessToken, shopId } = await getValidShopeeAccessToken(channel);
    const brands = await api.getShopUsedBrands(accessToken, shopId, itemIds);
    return brands.map((b) => ({ id: String(b.brand_id), name: b.original_brand_name ?? String(b.brand_id) }));
  } catch (err) {
    console.warn(`[listing-copy] đọc hãng đang dùng gian ${channel.shopName} lỗi: ${(err as Error).message.slice(0, 120)}`);
    return [];
  }
}

/**
 * Khách gõ tên mà danh sách hãng thường của danh mục không khớp (Bunchar 30/10, khách nói
 * "trên Shopee có") → ghi log đủ để phân định: danh sách có lật đủ không (mẫu tên bắt đầu
 * bằng chữ cái đầu từ khóa), và hãng có nằm ở nhóm CHỜ DUYỆT (status 2) không. Chỉ chạy khi
 * không khớp, kết quả đệm 6 giờ — không tốn thêm call khi gõ từng phím.
 */
async function logBrandMiss(channel: Channel, categoryId: string, query: string, list: Brand[]): Promise<void> {
  const q = normalizeText(query);
  const first = q[0] ?? "";
  const sameLetter = list.filter((b) => normalizeText(b.name).startsWith(first)).map((b) => b.name);
  let pendingNote = "không đọc được";
  try {
    const pending = await shopeeBrandList(channel, categoryId, 2);
    const hit = rankBrands(pending, query, 5).map((b) => `${b.name}#${b.id}`);
    pendingNote = `chờ duyệt ${pending.length} hãng, khớp: ${hit.length ? hit.join(", ") : "không"}`;
  } catch (err) {
    pendingNote = `status 2 lỗi: ${(err as Error).message.slice(0, 120)}`;
  }
  console.log(
    `[listing-copy] Shopee brand "${query.trim()}" không khớp trong danh mục ${categoryId} (gian ${channel.shopName}): hãng thường ${list.length}, chữ "${first}" có ${sameLetter.length} hãng (vd ${sameLetter.slice(0, 6).join(" | ") || "—"}); ${pendingNote}`
  );
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
    // Ảnh phân loại Shopee nằm ở tier 1 (option_list[].image) — ghép sang model theo tier_index[0].
    const tier0Images = (extra.tier_variation?.[0]?.option_list ?? []).map((o) => o.image?.image_url ?? null);
    const modelImage = (m: ShopeeModel) => {
      const i = m.tier_index?.[0];
      return typeof i === "number" ? (tier0Images[i] ?? null) : null;
    };
    const price = (p?: { current_price?: number; original_price?: number }[]) => Number(p?.[0]?.original_price ?? p?.[0]?.current_price ?? 0);
    const stockOf = (s?: { summary_info?: { total_available_stock?: number } }) => Number(s?.summary_info?.total_available_stock ?? 0);
    const variants: ListingVariant[] =
      models.length > 0
        ? models.map((m) => ({
            sku: m.model_sku?.trim() || "",
            name: m.model_name ?? null,
            price: price(m.price_info),
            stock: stockOf(m.stock_info_v2 as { summary_info?: { total_available_stock?: number } }),
            imageUrl: modelImage(m),
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
    const [categoryBrands, used] = await Promise.all([shopeeBrandList(channel, categoryId), shopeeUsedBrands(channel)]);
    const list = mergeUsedBrands(categoryBrands, used);
    const ranked = rankBrands(list, query, 199);
    // Chẩn đoán khách "không tìm thấy thương hiệu" (30/10 Bunchar) — không chặn trả lời.
    if (query.trim().length >= 3 && ranked.length === 0) {
      void logBrandMiss(channel, categoryId, query, list).catch(() => undefined);
    }
    return [NO_BRAND, ...ranked];
  },

  async getBrandName(channel: Channel, categoryId: string | null, id: string): Promise<string | null> {
    if (id === NO_BRAND.id) return NO_BRAND.name;
    if (!categoryId) return null;
    return (await shopeeBrandList(channel, categoryId)).find((b) => b.id === id)?.name ?? null;
  },

  async createListing(channel: Channel, draft: ListingDraft): Promise<CreateListingResult> {
    const { accessToken, shopId } = await getValidShopeeAccessToken(channel);
    const upload = (scene: "normal" | "desc" = "normal") => (img: FetchedImage) => api.uploadProductImage({ accessToken, shopId, ...img, scene });
    const imageIds = await uploadImages(draft.listing.images.slice(0, 9), SHOPEE_IMAGE, upload());
    if (imageIds.length === 0) throw new Error("Không tải được ảnh nào lên Shopee");
    // Ảnh chèn trong mô tả: upload scene "desc" → mô tả mở rộng (chữ trước, ảnh sau).
    // Gian đã biết là KHÔNG được whitelist mô tả mở rộng (lỗi thật Bunchar 30/10) → bỏ qua
    // luôn, khỏi tải ảnh desc + khỏi một lượt add_item hỏng.
    let descImageIds: string[] = [];
    if (!descImagesBlocked(channel.id)) {
      descImageIds = await uploadImages(draft.listing.descriptionImages.slice(0, MAX_DESCRIPTION_IMAGES), SHOPEE_IMAGE, upload("desc"));
    } else if (draft.listing.descriptionImages.length) {
      console.warn(`[listing-copy] ${channel.shopName}: gian không được Shopee whitelist ảnh mô tả — đăng mô tả chữ, bỏ ${draft.listing.descriptionImages.length} ảnh mô tả`);
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

    // Gian bật nhiều kho → seller_stock phải kèm location_id (lỗi thật 29/10).
    const locationId = api.pickStockLocationId(
      await api.getWarehouses(accessToken, shopId).catch((err) => {
        console.warn(`[listing-copy] ${channel.shopName}: không đọc được danh sách kho Shopee (${(err as Error).message}) — đăng tồn không kèm kho`);
        return [] as api.ShopeeWarehouse[];
      }),
      channel.shopName
    );
    const sellerStock = (stock: number) => [locationId ? { location_id: locationId, stock } : { stock }];

    const first = draft.variants[0];
    const extendedDescription = descImageIds.length
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
      : {};
    const body: api.ShopeeAddItemBody = {
      item_name: draft.listing.title,
      description: descriptionText,
      ...extendedDescription,
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
      seller_stock: sellerStock(Math.max(0, first.stock)),
    };
    const itemId = await addItemWithPlainTextFallback(channel, accessToken, shopId, body, descImageIds.length);

    const variants: { sku: string; remoteId: string }[] = [];
    if (draft.variants.length > 1 && draft.listing.options.length > 0) {
      await new Promise((r) => setTimeout(r, TIER_INIT_DELAY_MS));
      // Nhóm có ảnh (Màu) lên tier 1 — Shopee chỉ nhận ảnh phân loại ở tier đầu (anh 29/10: "Shopee không lấy được ảnh phân loại").
      const options = reorderOptionsForImages(draft.listing.options, draft.variants).slice(0, 2);
      const { byOption } = optionImages(draft.variants, options);
      // Ảnh phân loại thiếu vẫn đăng được → ảnh nào lỗi thì bỏ ảnh đó.
      const tierImageIds = new Map<string, string>();
      for (const [value, url] of byOption[0] ?? []) {
        try {
          tierImageIds.set(value, await upload()(await prepareImage(url, SHOPEE_IMAGE)));
        } catch (err) {
          console.warn(`[listing-copy] ${channel.shopName}: ảnh phân loại "${value}" không tải được (${(err as Error).message}) — bỏ ảnh này`);
        }
      }
      const models = draft.variants
        .map((v) => ({ v, tier_index: tierIndexes(v, options) }))
        .filter((m) => m.tier_index.every((i) => i >= 0))
        .map((m) => ({
          tier_index: m.tier_index,
          original_price: vndInt(m.v.price),
          seller_stock: sellerStock(Math.max(0, m.v.stock)),
          ...(m.v.sku ? { model_sku: m.v.sku } : {}),
        }));
      if (models.length !== draft.variants.length) {
        throw new Error(
          `Shopee: ${draft.variants.length - models.length} phân loại không khớp nhóm phân loại (${options.map((o) => o.name).join(" × ")}) — sản phẩm đã tạo (item ${itemId}) nhưng chưa có phân loại, bổ sung trên sàn.`
        );
      }
      const created = await api.initTierVariation(accessToken, shopId, {
        item_id: itemId,
        tier_variation: options.map((o, ti) => ({
          name: o.name.slice(0, 14),
          option_list: o.values.map((x) => {
            const image_id = ti === 0 ? tierImageIds.get(x) : undefined;
            return { option: x.slice(0, 20), ...(image_id ? { image: { image_id } } : {}) };
          }),
        })),
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
