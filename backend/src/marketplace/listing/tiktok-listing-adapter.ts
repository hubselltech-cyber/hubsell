// ============================================================
// ADAPTER ĐĂNG SẢN PHẨM — TIKTOK SHOP (lát 1b, CHƯA kiểm gian thật)
//
// createListing: upload ảnh → kho bán mặc định → Create Product save_mode
// LISTING → sàn trả product_id, trạng thái PENDING chờ duyệt → ta ghi
// "Chờ sàn duyệt". Gian ủy quyền trước 12/10/2026 thiếu Product Modify →
// báo nối lại gian (tiktok/scopes.ts).
// ============================================================

import type { Channel } from "@prisma/client";
import { fetchImageBuffer } from "../../lib/image-fetch";
import { getWarehouses } from "../../integrations/tiktok/client";
import * as api from "../../integrations/tiktok/listing-api";
import { tiktokNeedsReauthForStockPush } from "../../integrations/tiktok/scopes";
import { getValidAccessToken } from "../../integrations/tiktok/service";
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
import { appendHtmlImages, extractHtmlImages, gramsToKg, htmlToText, normalizeText, textToHtml, variantPairs, vndInt } from "./variant-map";

async function ctxOf(channel: Channel) {
  if (tiktokNeedsReauthForStockPush(channel)) {
    throw new Error("Gian TikTok ủy quyền trước khi app có quyền Product Modify — vào Kênh bán bấm Kết nối lại gian rồi đăng.");
  }
  return getValidAccessToken(channel);
}

function pickUrl(img?: { url?: string; urls?: string[] }): string | null {
  return img?.urls?.[0] ?? img?.url ?? null;
}

function attrDef(a: api.TikTokAttribute): AttributeDef {
  const options = (a.values ?? []).map((v) => v.name ?? "").filter(Boolean);
  return {
    id: a.id,
    name: viAttributeName(a.name ?? a.id),
    required: Boolean(a.is_requried ?? a.is_required),
    type: options.length > 0 && !a.is_customizable ? "select" : "text",
    options: options.length ? options : undefined,
  };
}

export const tiktokListingAdapter: ListingAdapter = {
  name: "tiktok",

  async fetchListing(channel: Channel, productId: string): Promise<NormalizedListing | null> {
    const ctx = await ctxOf(channel);
    const { getProduct } = await import("../../integrations/tiktok/client");
    const p = await getProduct({ ...ctx, productId });
    if (!p) return null;
    const optionMap = new Map<string, Set<string>>();
    const variants: ListingVariant[] = (p.skus ?? []).map((s) => {
      const pairs = (s.sales_attributes ?? []).filter((a) => a.name && a.value_name);
      for (const a of pairs) {
        const set = optionMap.get(a.name!) ?? new Set<string>();
        set.add(a.value_name!);
        optionMap.set(a.name!, set);
      }
      return {
        sku: s.seller_sku?.trim() || "",
        name: pairs.length ? pairs.map((a) => a.value_name).join(", ") : null,
        price: Number(s.price?.sale_price ?? s.price?.tax_exclusive_price ?? 0),
        stock: (s.inventory ?? []).reduce((sum, i) => sum + (i.quantity ?? 0), 0),
        imageUrl: pickUrl((s.sales_attributes ?? []).find((a) => a.sku_img)?.sku_img),
      };
    });
    const options: ListingOption[] = [...optionMap.entries()].map(([name, values]) => ({ name, values: [...values] }));
    const extra = p as {
      description?: string;
      category_chains?: { id?: string; local_name?: string; is_leaf?: boolean }[];
      brand?: { id?: string; name?: string };
      package_weight?: { value?: string; unit?: string };
      package_dimensions?: { length?: string; width?: string; height?: string; unit?: string };
      product_attributes?: { id?: string; name?: string; values?: { name?: string }[] }[];
    };
    const leaf = extra.category_chains?.find((c) => c.is_leaf) ?? extra.category_chains?.[extra.category_chains.length - 1];
    const w = extra.package_weight;
    const weightGrams = w?.value ? Math.round(Number(w.value) * (w.unit === "GRAM" ? 1 : 1000)) : null;
    const d = extra.package_dimensions;
    // Mô tả TikTok là HTML: tách <img> sang descriptionImages, chữ về text thuần.
    const descHtml = extractHtmlImages(extra.description ?? "");
    return {
      title: p.title ?? "",
      description: htmlToText(descHtml.html),
      images: (p.main_images ?? []).map(pickUrl).filter((u): u is string => Boolean(u)),
      descriptionImages: descHtml.images,
      categoryId: leaf?.id ?? null,
      categoryPath: extra.category_chains?.map((c) => c.local_name ?? "").filter(Boolean) ?? null,
      brandName: extra.brand?.name ?? null,
      weightGrams,
      // TikTok trả chuỗi "0" khi gian không khai kích thước → normalizeDims về null (sự cố 29/10).
      dimensionsCm: normalizeDims(d),
      options,
      variants,
      attributes: (extra.product_attributes ?? [])
        .map((a) => ({ name: a.name ?? "", value: a.values?.[0]?.name ?? "" }))
        .filter((a) => a.name && a.value),
    };
  },

  async recommendCategory(channel: Channel, listing: NormalizedListing): Promise<CategorySuggestion[]> {
    const ctx = await ctxOf(channel);
    const [rec, all] = await Promise.all([
      api.recommendCategory(ctx, { title: listing.title, description: listing.description ? textToHtml(listing.description) : undefined }),
      api.getCategories(ctx),
    ]);
    const leaf = rec.filter((c) => c.is_leaf);
    const picked = (leaf.length ? leaf : rec.slice(-1)).slice(0, 3);
    return picked.map((c, i) => {
      const path = api.categoryPath(all, c.id);
      return { id: c.id, name: c.local_name ?? path[path.length - 1] ?? c.id, path: path.length ? path : [c.local_name ?? c.id], confidence: Math.max(0.5, 0.9 - i * 0.15) };
    });
  },

  async searchCategories(channel: Channel, query: string): Promise<CategoryNode[]> {
    const ctx = await ctxOf(channel);
    const all = await api.getCategories(ctx);
    const q = normalizeText(query);
    const nodes = all
      .filter((c) => c.is_leaf)
      .map((c) => {
        const path = api.categoryPath(all, c.id);
        return { id: c.id, name: c.local_name ?? c.id, path, leaf: true };
      });
    return (q ? nodes.filter((n) => normalizeText(n.path.join(" ")).includes(q)) : nodes).slice(0, 300);
  },

  async getCategoryTree(channel: Channel): Promise<CategoryTreeNode[]> {
    const ctx = await ctxOf(channel);
    const all = await api.getCategories(ctx);
    return all.map((c) => ({
      id: c.id,
      name: c.local_name ?? c.id,
      parentId: c.parent_id && c.parent_id !== "0" ? c.parent_id : null,
      leaf: Boolean(c.is_leaf),
    }));
  },

  async getCategoryRequirements(channel: Channel, categoryId: string): Promise<CategoryRequirements | null> {
    const ctx = await ctxOf(channel);
    const [attrs, rules] = await Promise.all([
      api.getCategoryAttributes(ctx, categoryId),
      api.getCategoryRules(ctx, categoryId).catch(() => ({}) as api.TikTokCategoryRules),
    ]);
    return {
      ...PLATFORM_LISTING_RULES.TIKTOK,
      dimensionsRequired: Boolean(rules.package_dimension?.is_required),
      attributes: attrs.filter((a) => a.type !== "SALES_PROPERTY").map(attrDef),
    };
  },

  async getLogistics(): Promise<LogisticOption[]> {
    return [];
  },

  async searchBrands(channel: Channel, categoryId: string | null, query: string): Promise<Brand[]> {
    const ctx = await ctxOf(channel);
    const list = await api.getBrands(ctx, { categoryId, name: query || undefined });
    return list.map((b) => ({ id: b.id, name: b.name ?? b.id }));
  },

  async createListing(channel: Channel, draft: ListingDraft): Promise<CreateListingResult> {
    const ctx = await ctxOf(channel);
    const main_images: { uri: string }[] = [];
    for (const url of draft.listing.images.slice(0, 9)) {
      const img = await fetchImageBuffer(url);
      const up = await api.uploadProductImage(ctx, img, "MAIN_IMAGE");
      main_images.push({ uri: up.uri });
    }
    if (main_images.length === 0) throw new Error("Không tải được ảnh nào lên TikTok");
    // Ảnh chèn trong mô tả: upload use_case DESCRIPTION_IMAGE, lấy url trả về ghép <img> cuối mô tả.
    const descUrls: string[] = [];
    for (const url of draft.listing.descriptionImages.slice(0, MAX_DESCRIPTION_IMAGES)) {
      const img = await fetchImageBuffer(url);
      const up = await api.uploadProductImage(ctx, img, "DESCRIPTION_IMAGE");
      if (up.url) descUrls.push(up.url);
      else console.warn(`[listing-copy] TikTok upload ảnh mô tả không trả url (uri ${up.uri}) — bỏ qua ảnh này`);
    }

    const warehouses = await getWarehouses(ctx);
    const wh =
      warehouses.find((w) => w.is_default && w.effect_status === "ENABLED" && (w.type ?? "SALES_WAREHOUSE") === "SALES_WAREHOUSE") ??
      warehouses.find((w) => w.effect_status === "ENABLED" && (w.type ?? "SALES_WAREHOUSE") === "SALES_WAREHOUSE") ??
      warehouses[0];
    if (!wh) throw new Error("Gian TikTok chưa có kho bán (warehouse) — tạo kho trên Seller Center trước.");

    const attrs = await api.getCategoryAttributes(ctx, draft.categoryId);
    const product_attributes = Object.entries(draft.attributes)
      .filter(([, v]) => String(v).trim())
      .map(([id, value]) => {
        const def = attrs.find((a) => a.id === id);
        const found = def?.values?.find((v) => (v.name ?? "").toLowerCase() === String(value).toLowerCase());
        return { id, values: [found?.id ? { id: found.id, name: found.name } : { name: String(value) }] };
      });

    const options = draft.listing.options.slice(0, 3);
    const skus: api.TikTokCreateProductBody["skus"] = draft.variants.map((v) => ({
      ...(options.length ? { sales_attributes: variantPairs(v, options).map((p) => ({ name: p.name, value_name: p.value })) } : {}),
      ...(v.sku ? { seller_sku: v.sku } : {}),
      price: { amount: String(vndInt(v.price)), currency: "VND" },
      inventory: [{ warehouse_id: wh.id, quantity: Math.max(0, v.stock) }],
    }));

    const body: api.TikTokCreateProductBody = {
      save_mode: "LISTING",
      title: draft.listing.title,
      description: appendHtmlImages(textToHtml(draft.listing.description), descUrls),
      category_id: draft.categoryId,
      category_version: "v2",
      ...(draft.brandId ? { brand_id: draft.brandId } : {}),
      main_images,
      skus,
      package_weight: { value: gramsToKg(draft.weightGrams).toFixed(3), unit: "KILOGRAM" },
      ...(dimsComplete(draft.dimensionsCm)
        ? { package_dimensions: { length: String(draft.dimensionsCm.length), width: String(draft.dimensionsCm.width), height: String(draft.dimensionsCm.height), unit: "CENTIMETER" } }
        : {}),
      ...(product_attributes.length ? { product_attributes } : {}),
    };
    const r = await api.createProduct(ctx, body);
    const variants = (r.skus ?? []).map((s) => ({ sku: s.seller_sku ?? "", remoteId: `${r.product_id}-${s.id}` }));
    if (variants.length === 0) variants.push({ sku: draft.variants[0]?.sku ?? "", remoteId: r.product_id });
    return { remoteItemId: r.product_id, remoteUrl: null, status: "PENDING_REVIEW", variants };
  },
};
