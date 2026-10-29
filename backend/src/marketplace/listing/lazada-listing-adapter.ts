// ============================================================
// ADAPTER ĐĂNG SẢN PHẨM — LAZADA (lát 1b, CHƯA kiểm gian thật)
//
// createListing: image/migrate từng ảnh (≤8) → product/create payload JSON:
// PrimaryCategory lá, Attributes (name, description HTML, short_description,
// brand = TÊN thương hiệu, thuộc tính danh mục theo khóa), Skus (SellerSku,
// giá, tồn, kiện + cân nặng kg, saleProp theo khóa nhóm phân loại của danh
// mục). Sản phẩm thường Active ngay (một số danh mục qua QC).
// ============================================================

import type { Channel } from "@prisma/client";
import * as api from "../../integrations/lazada/listing-api";
import { getValidLazadaAccessToken } from "../../integrations/lazada/service";
import { PLATFORM_LISTING_RULES } from "./rules";
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
import { gramsToKg, htmlToText, normalizeText, textToHtml, variantPairs, vndInt } from "./variant-map";

/** Khóa hệ thống của Attributes — không phải thuộc tính khách điền. */
const SYSTEM_KEYS = new Set(["name", "description", "short_description", "brand", "video", "name_en", "description_en", "short_description_en"]);

function truthy(v: number | boolean | undefined): boolean {
  return v === true || v === 1;
}

function attrDef(a: api.LazadaAttribute): AttributeDef {
  const options = (a.options ?? []).map((o) => o.name ?? "").filter(Boolean);
  const type: AttributeDef["type"] = options.length > 0 ? "select" : a.input_type === "numeric" ? "number" : "text";
  return { id: a.name, name: a.label ?? a.name, required: truthy(a.is_mandatory), type, options: options.length ? options : undefined };
}

export const lazadaListingAdapter: ListingAdapter = {
  name: "lazada",

  async fetchListing(channel: Channel, itemId: string): Promise<NormalizedListing | null> {
    const token = await getValidLazadaAccessToken(channel);
    const item = await api.getItem(token, itemId);
    if (!item) return null;
    const optionMap = new Map<string, Set<string>>();
    const variants: ListingVariant[] = (item.skus ?? []).map((s) => {
      const props = s.saleProp && typeof s.saleProp === "object" ? Object.entries(s.saleProp) : [];
      for (const [k, v] of props) {
        if (v == null || v === "") continue;
        const set = optionMap.get(k) ?? new Set<string>();
        set.add(String(v));
        optionMap.set(k, set);
      }
      const name = props.map(([, v]) => String(v ?? "")).filter(Boolean).join(", ");
      return {
        sku: s.SellerSku?.trim() || "",
        name: name || (s.Variation?.trim() ?? null) || null,
        price: Number(s.special_price || s.price || 0),
        stock: Number(s.quantity ?? 0),
        imageUrl: s.Images?.[0] ?? null,
      };
    });
    const options: ListingOption[] = [...optionMap.entries()].map(([name, values]) => ({ name, values: [...values] }));
    const a = item.attributes ?? {};
    const sku0 = item.skus?.[0] as { package_weight?: number | string; package_length?: number | string; package_width?: number | string; package_height?: number | string } | undefined;
    const known = new Set(["name", "description", "short_description", "brand"]);
    return {
      title: a.name ?? "",
      description: a.description ? htmlToText(String(a.description)) : "",
      images: item.images ?? [],
      categoryId: item.primary_category != null ? String(item.primary_category) : null,
      categoryPath: null,
      brandName: a.brand ?? null,
      weightGrams: sku0?.package_weight ? Math.round(Number(sku0.package_weight) * 1000) : null,
      dimensionsCm: sku0?.package_length
        ? { length: Number(sku0.package_length), width: Number(sku0.package_width ?? 0), height: Number(sku0.package_height ?? 0) }
        : null,
      options,
      variants,
      attributes: Object.entries(a)
        .filter(([k, v]) => !known.has(k) && typeof v === "string" && v)
        .map(([k, v]) => ({ name: k, value: String(v) })),
    };
  },

  async recommendCategory(channel: Channel, listing: NormalizedListing): Promise<CategorySuggestion[]> {
    const token = await getValidLazadaAccessToken(channel);
    const list = await api.suggestCategory(token, listing.title);
    return list.slice(0, 3).map((c, i) => ({ id: c.id, name: c.name || c.path[c.path.length - 1] || c.id, path: c.path, confidence: Math.max(0.5, 0.85 - i * 0.15) }));
  },

  async searchCategories(channel: Channel, query: string): Promise<CategoryNode[]> {
    const token = await getValidLazadaAccessToken(channel);
    const leaves = api.flattenLeaves(await api.getCategoryTree(token));
    const q = normalizeText(query);
    const nodes = leaves.map((l) => ({ ...l, leaf: true }));
    return (q ? nodes.filter((n) => normalizeText(n.path.join(" ")).includes(q)) : nodes).slice(0, 300);
  },

  async getCategoryTree(channel: Channel): Promise<CategoryTreeNode[]> {
    const token = await getValidLazadaAccessToken(channel);
    const out: CategoryTreeNode[] = [];
    const walk = (nodes: api.LazadaCategoryNode[], parentId: string | null) => {
      for (const n of nodes) {
        const id = String(n.category_id);
        const children = n.children ?? [];
        out.push({ id, name: n.name ?? id, parentId, leaf: Boolean(n.leaf) || children.length === 0 });
        if (children.length) walk(children, id);
      }
    };
    walk(await api.getCategoryTree(token), null);
    return out;
  },

  async getCategoryRequirements(channel: Channel, categoryId: string): Promise<CategoryRequirements | null> {
    const token = await getValidLazadaAccessToken(channel);
    const attrs = await api.getCategoryAttributes(token, categoryId);
    return {
      ...PLATFORM_LISTING_RULES.LAZADA,
      attributes: attrs.filter((a) => !SYSTEM_KEYS.has(a.name) && !truthy(a.is_sale_prop) && a.attribute_type !== "sku").map(attrDef),
    };
  },

  async getLogistics(): Promise<LogisticOption[]> {
    return [];
  },

  async searchBrands(channel: Channel, categoryId: string | null, query: string): Promise<Brand[]> {
    const token = await getValidLazadaAccessToken(channel);
    const list = await api.queryBrands(token, { categoryId, name: query || undefined });
    const q = normalizeText(query);
    const filtered = q ? list.filter((b) => normalizeText(b.name).includes(q)) : list;
    return [{ id: "No Brand", name: "No Brand" }, ...filtered.filter((b) => b.name !== "No Brand")].slice(0, 200);
  },

  async createListing(channel: Channel, draft: ListingDraft): Promise<CreateListingResult> {
    const token = await getValidLazadaAccessToken(channel);
    const images: string[] = [];
    for (const url of draft.listing.images.slice(0, 8)) {
      images.push(await api.migrateImage(token, url));
    }
    if (images.length === 0) throw new Error("Không chuyển được ảnh nào vào Lazada");

    const attrs = await api.getCategoryAttributes(token, draft.categoryId);
    const saleKeys = attrs.filter((a) => truthy(a.is_sale_prop)).map((a) => a.name);
    const options = draft.listing.options.slice(0, saleKeys.length || 2);
    if (options.length > 0 && saleKeys.length === 0) {
      throw new Error("Danh mục Lazada này không có nhóm phân loại — chọn danh mục khác hoặc đăng từng phân loại riêng.");
    }
    const attributes: Record<string, string> = {
      name: draft.listing.title,
      description: textToHtml(draft.listing.description),
      short_description: `<ul><li>${draft.listing.title.replace(/</g, "&lt;")}</li></ul>`,
      brand: draft.brandName ?? "No Brand",
    };
    for (const [k, v] of Object.entries(draft.attributes)) if (String(v).trim()) attributes[k] = String(v);

    const dims = draft.dimensionsCm ?? { length: 0, width: 0, height: 0 };
    const skus: api.LazadaCreateSku[] = draft.variants.map((v) => {
      const pairs = variantPairs(v, options);
      const saleProp: Record<string, string> = {};
      pairs.forEach((p, i) => {
        if (saleKeys[i]) saleProp[saleKeys[i]] = p.value;
      });
      return {
        SellerSku: v.sku,
        quantity: Math.max(0, v.stock),
        price: vndInt(v.price),
        package_length: dims.length,
        package_width: dims.width,
        package_height: dims.height,
        package_weight: gramsToKg(draft.weightGrams),
        ...(v.imageUrl ? { Images: { Image: [images[0]] } } : {}),
        ...(Object.keys(saleProp).length ? { saleProp } : {}),
      };
    });

    const r = await api.createProduct(token, {
      Request: { Product: { PrimaryCategory: draft.categoryId, Images: { Image: images }, Attributes: attributes, Skus: { Sku: skus } } },
    });
    const variants = r.skus.length
      ? r.skus.map((s) => ({ sku: s.sellerSku, remoteId: `${r.itemId}-${s.skuId}` }))
      : draft.variants.map((v) => ({ sku: v.sku, remoteId: r.itemId }));
    return { remoteItemId: r.itemId, remoteUrl: null, status: "LISTED", variants };
  },
};
