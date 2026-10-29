// ============================================================
// ADAPTER ĐĂNG SẢN PHẨM GIẢ LẬP — cho gian chưa nối API thật (dev local, gian demo).
//
// Mô phỏng ĐÚNG khác biệt 3 sàn để UI xem trước có gì để sửa: cây danh mục nhỏ
// (3 tầng) với thuộc tính bắt buộc theo lá; Shopee đòi kênh vận chuyển, Lazada
// đòi thương hiệu + kích thước, TikTok trả "chờ duyệt". Tên chứa "LỖI" → sàn từ
// chối (để demo nhánh lỗi). Sản phẩm nguồn được đọc từ chính bảng ChannelProduct.
// ============================================================

import type { Channel } from "@prisma/client";
import { ChannelName } from "@prisma/client";
import { buildListingFromChannelRows } from "../../services/listing-copy/source";
import { mockImageFor } from "../mockMarketplace";
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
  LogisticOption,
  NormalizedListing,
} from "./types";

const PREFIX: Record<ChannelName, string> = { SHOPEE: "SP", TIKTOK: "TT", LAZADA: "LZ", OFFLINE: "OF" };

/** Cây danh mục mẫu (đường dẫn > lá) + từ khoá để gợi ý. */
const CATEGORY_TREE: { path: string[]; keywords: string[] }[] = [
  { path: ["Thời trang nữ", "Váy", "Chân váy"], keywords: ["chân váy", "váy", "skirt"] },
  { path: ["Thời trang nữ", "Áo", "Áo khoác"], keywords: ["áo khoác", "khoác", "jacket", "gió"] },
  { path: ["Thời trang nữ", "Áo", "Áo len"], keywords: ["áo len", "len", "sweater"] },
  { path: ["Thời trang nữ", "Áo", "Áo thun"], keywords: ["áo thun", "thun", "t-shirt", "tee"] },
  { path: ["Thời trang nam", "Áo", "Áo thun"], keywords: ["áo thun nam", "nam"] },
  { path: ["Thời trang nam", "Quần", "Quần jean"], keywords: ["quần jean", "jean", "denim"] },
  { path: ["Túi ví", "Túi xách", "Túi tote"], keywords: ["túi tote", "tote", "túi", "canvas"] },
  { path: ["Giày dép", "Giày thể thao", "Giày sneaker"], keywords: ["sneaker", "giày", "thể thao"] },
  { path: ["Nhà cửa", "Trang trí", "Đèn"], keywords: ["đèn", "trang trí", "lamp"] },
  { path: ["Sức khỏe & Làm đẹp", "Chăm sóc da", "Kem dưỡng"], keywords: ["kem", "dưỡng", "serum", "da"] },
  { path: ["Điện tử", "Phụ kiện", "Tai nghe"], keywords: ["tai nghe", "headphone", "bluetooth"] },
  { path: ["Mẹ & Bé", "Quần áo trẻ em", "Bộ bé gái"], keywords: ["bé", "trẻ em", "kids"] },
];

function catId(platform: ChannelName, idx: number): string {
  return `${PREFIX[platform]}-${1000 + idx}`;
}

function nodesFor(platform: ChannelName): CategoryNode[] {
  return CATEGORY_TREE.map((c, i) => ({
    id: catId(platform, i),
    name: c.path[c.path.length - 1],
    path: c.path,
    leaf: true,
  }));
}

/** Cây phẳng cha → con dựng từ các đường dẫn mẫu: nút trung gian id theo đường dẫn, lá giữ catId. */
function treeFor(platform: ChannelName): CategoryTreeNode[] {
  const out: CategoryTreeNode[] = [];
  const seen = new Set<string>();
  CATEGORY_TREE.forEach((c, i) => {
    let parentId: string | null = null;
    c.path.forEach((name, depth) => {
      const last = depth === c.path.length - 1;
      const id = last ? catId(platform, i) : `${PREFIX[platform]}-N-${c.path.slice(0, depth + 1).join("/")}`;
      if (!seen.has(id)) {
        seen.add(id);
        out.push({ id, name, parentId, leaf: last });
      }
      parentId = id;
    });
  });
  return out;
}

function attributesFor(platform: ChannelName, leafPath: string[]): AttributeDef[] {
  const root = leafPath[0];
  const base: AttributeDef[] = [];
  if (root.startsWith("Thời trang") || root === "Túi ví" || root === "Giày dép" || root === "Mẹ & Bé") {
    base.push({
      id: "material",
      name: "Chất liệu",
      required: true,
      type: "select",
      options: ["Cotton", "Polyester", "Len", "Da", "Canvas", "Vải khác"],
    });
    base.push({ id: "style", name: "Kiểu dáng", required: false, type: "text" });
  }
  if (root === "Sức khỏe & Làm đẹp") {
    base.push({ id: "expiry", name: "Hạn sử dụng (tháng)", required: true, type: "number" });
    base.push({ id: "skin", name: "Loại da", required: false, type: "select", options: ["Mọi loại da", "Da dầu", "Da khô"] });
  }
  if (root === "Điện tử") {
    base.push({ id: "warranty", name: "Bảo hành (tháng)", required: true, type: "number" });
  }
  // Shopee + Lazada bắt xuất xứ; TikTok không.
  if (platform === ChannelName.SHOPEE || platform === ChannelName.LAZADA) {
    base.push({
      id: "origin",
      name: "Xuất xứ",
      required: true,
      type: "select",
      options: ["Việt Nam", "Trung Quốc", "Hàn Quốc", "Khác"],
    });
  }
  return base;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d");
}

const BRANDS: Brand[] = [
  { id: "0", name: "No Brand" },
  { id: "b-hubsell", name: "Hubsell" },
  { id: "b-local", name: "Local Brand" },
  { id: "b-uniqlo", name: "Uniqlo" },
  { id: "b-nike", name: "Nike" },
];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export const mockListingAdapter: ListingAdapter = {
  name: "mock",

  async fetchListing(channel: Channel, itemId: string): Promise<NormalizedListing | null> {
    const listing = await buildListingFromChannelRows(channel.id, itemId);
    // Gian giả lập (seed dev) thường không có ảnh — sinh ảnh mẫu như mock catalog
    // để bản xem trước không kẹt ở "Chưa có ảnh"; gian thật luôn có ảnh từ API.
    if (listing && listing.images.length === 0) listing.images = [mockImageFor(channel.channelName, listing.title)];
    return listing;
  },

  async recommendCategory(channel: Channel, listing: NormalizedListing): Promise<CategorySuggestion[]> {
    const title = normalize(listing.title);
    const scored = CATEGORY_TREE.map((c, i) => {
      const hits = c.keywords.filter((k) => title.includes(normalize(k)));
      const score = hits.reduce((s, k) => s + k.length, 0);
      return { i, score, hits: hits.length };
    })
      .filter((x) => x.hits > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    const top = scored[0]?.score ?? 0;
    return scored.map((x) => ({
      id: catId(channel.channelName, x.i),
      name: CATEGORY_TREE[x.i].path[CATEGORY_TREE[x.i].path.length - 1],
      path: CATEGORY_TREE[x.i].path,
      confidence: Math.min(0.95, 0.5 + (0.45 * x.score) / Math.max(top, 1)),
    }));
  },

  async searchCategories(channel: Channel, query: string): Promise<CategoryNode[]> {
    const q = normalize(query.trim());
    const all = nodesFor(channel.channelName);
    if (!q) return all;
    return all.filter((n) => normalize(n.path.join(" ")).includes(q));
  },

  async getCategoryTree(channel: Channel): Promise<CategoryTreeNode[]> {
    return treeFor(channel.channelName);
  },

  async getCategoryRequirements(channel: Channel, categoryId: string): Promise<CategoryRequirements | null> {
    const node = nodesFor(channel.channelName).find((n) => n.id === categoryId);
    if (!node) return null;
    return { ...PLATFORM_LISTING_RULES[channel.channelName], attributes: attributesFor(channel.channelName, node.path) };
  },

  async getLogistics(channel: Channel): Promise<LogisticOption[]> {
    if (channel.channelName !== ChannelName.SHOPEE) return [];
    return [
      { id: "spx", name: "SPX Express", enabled: true },
      { id: "ghn", name: "Giao Hàng Nhanh", enabled: true },
      { id: "jnt", name: "J&T Express", enabled: true },
      { id: "vtp", name: "Viettel Post", enabled: false },
    ];
  },

  async searchBrands(_channel: Channel, _categoryId: string | null, query: string): Promise<Brand[]> {
    const q = normalize(query.trim());
    return q ? BRANDS.filter((b) => normalize(b.name).includes(q)) : BRANDS;
  },

  async createListing(channel: Channel, draft: ListingDraft): Promise<CreateListingResult> {
    await sleep(800 + Math.floor(Math.random() * 900));
    if (/lỗi|loi test/i.test(draft.listing.title)) {
      throw new Error("Sàn từ chối: tên sản phẩm vi phạm chính sách đăng bán (mô phỏng)");
    }
    const remoteItemId = `${PREFIX[channel.channelName]}${Date.now().toString().slice(-8)}`;
    return {
      remoteItemId,
      remoteUrl: null,
      status: channel.channelName === ChannelName.TIKTOK ? "PENDING_REVIEW" : "LISTED",
      variants: draft.variants.map((v, i) => ({ sku: v.sku, remoteId: `${remoteItemId}-${i + 1}` })),
    };
  },
};
