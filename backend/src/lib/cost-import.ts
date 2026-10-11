// ============================================================
// NHẬP GIÁ VỐN TỪ EXCEL — phần THUẦN (không DB) của POST
// /api/finance/cost-prices/import, tách ra để test.
//
// ★ 11/10/2026 — GIÁ VỐN THEO GIAN: file có thêm cột "Gian hàng" (tùy chọn,
//   kèm "Kênh bán" để phân biệt hai gian trùng tên ở hai sàn).
//   - Dòng CÓ gian   → chỉ ghi giá riêng của đúng gian đó.
//   - Dòng KHÔNG gian (file mẫu cũ) → áp như trước: MỌI gian có mã đó + giá
//     mặc định ở kho nếu mã trùng mã sản phẩm kho. Khách cũ không gãy.
//   - "Kho nội bộ" (hàng Offline trong file xuất) → chỉ giá ở kho.
//   Trùng ô (cùng gian + mã, hoặc dòng không gian phủ lên) → dòng SAU thắng.
// ============================================================

import { ChannelName } from "@prisma/client";

export interface CostImportRow {
  row: number; // số dòng Excel để báo lỗi
  sku: string;
  cost: number;
  shop: string; // "" = không ghi gian
  channel: string; // "" = không ghi kênh
}

export interface CostImportPlan {
  /** productId → giá mặc định ở kho */
  productCost: Map<string, number>;
  /** channelProductId → giá riêng của gian */
  shopCost: Map<string, number>;
  errors: { row: number; message: string }[];
  matchedRows: number;
}

/** Tên gian dùng trong file xuất cho hàng kho chưa nối sàn nào. */
export const OFFLINE_SHOP_LABEL = "Kho nội bộ";

const norm = (s: string) => s.normalize("NFC").trim().toLowerCase();

/** "Shopee" / "TikTok Shop" / "lazada" → ChannelName; không nhận ra → null. */
function channelFromLabel(raw: string): ChannelName | null {
  const k = norm(raw).replace(/[^a-z]/g, "");
  if (k.startsWith("shopee")) return ChannelName.SHOPEE;
  if (k.startsWith("tiktok")) return ChannelName.TIKTOK;
  if (k.startsWith("lazada")) return ChannelName.LAZADA;
  if (k.startsWith("offline")) return ChannelName.OFFLINE;
  return null;
}

export function planCostImport(
  rows: CostImportRow[],
  data: {
    /** costPrice = giá kho hiện tại — dòng trùng giá thì bỏ qua, không ghi lại. */
    products: { id: string; skuCode: string; costPrice: number }[];
    channels: { id: string; channelName: ChannelName; shopName: string }[];
    /**
     * currentCost = giá HIỆU LỰC hiện tại của gian; ownCost = giá riêng (0 =
     * đang theo kho); productId = sản phẩm kho đã nối. Trùng giá thì không ghi:
     * file xuất ra nhập lại nguyên văn không biến giá "theo kho" thành giá riêng.
     */
    channelProducts: {
      id: string;
      channelId: string;
      channelSku: string;
      productId: string | null;
      ownCost: number;
      currentCost: number;
    }[];
  }
): CostImportPlan {
  const productBySku = new Map<string, string>();
  const productNow = new Map<string, number>();
  for (const p of data.products) {
    productBySku.set(norm(p.skuCode), p.id);
    productNow.set(p.id, p.costPrice);
  }

  // mã → các dòng gian mang mã đó
  type Cp = (typeof data.channelProducts)[number];
  const cpsBySku = new Map<string, Cp[]>();
  for (const cp of data.channelProducts) {
    const key = norm(cp.channelSku);
    const list = cpsBySku.get(key);
    if (list) list.push(cp);
    else cpsBySku.set(key, [cp]);
  }

  const channelsByShop = new Map<string, typeof data.channels>();
  for (const c of data.channels) {
    if (c.channelName === ChannelName.OFFLINE) continue;
    const key = norm(c.shopName);
    const list = channelsByShop.get(key);
    if (list) list.push(c);
    else channelsByShop.set(key, [c]);
  }

  const productCost = new Map<string, number>();
  const shopCost = new Map<string, number>();
  const errors: { row: number; message: string }[] = [];
  let matchedRows = 0;

  for (const r of rows) {
    const sku = norm(r.sku);
    const shop = r.shop.trim();

    if (shop && norm(shop) === norm(OFFLINE_SHOP_LABEL)) {
      const pid = productBySku.get(sku);
      if (!pid) {
        errors.push({ row: r.row, message: `Không tìm thấy mã "${r.sku}" trong kho` });
        continue;
      }
      productCost.set(pid, r.cost);
      matchedRows++;
      continue;
    }

    if (shop) {
      let candidates = channelsByShop.get(norm(shop)) ?? [];
      const wantChannel = r.channel ? channelFromLabel(r.channel) : null;
      if (wantChannel && candidates.length > 1) {
        candidates = candidates.filter((c) => c.channelName === wantChannel);
      }
      if (candidates.length === 0) {
        errors.push({ row: r.row, message: `Không tìm thấy gian "${shop}"` });
        continue;
      }
      if (candidates.length > 1) {
        errors.push({
          row: r.row,
          message: `Có ${candidates.length} gian cùng tên "${shop}" — ghi thêm cột "Kênh bán"`,
        });
        continue;
      }
      const channelId = candidates[0].id;
      const hits = (cpsBySku.get(sku) ?? []).filter((cp) => cp.channelId === channelId);
      if (hits.length === 0) {
        errors.push({ row: r.row, message: `Gian "${shop}" không có mã "${r.sku}"` });
        continue;
      }
      for (const cp of hits) shopCost.set(cp.id, r.cost);
      matchedRows++;
      continue;
    }

    // Không ghi gian → mọi gian có mã + giá mặc định ở kho (cách cũ).
    const pid = productBySku.get(sku);
    const hits = cpsBySku.get(sku) ?? [];
    if (!pid && hits.length === 0) {
      errors.push({ row: r.row, message: `Không tìm thấy SKU "${r.sku}" trong hệ thống` });
      continue;
    }
    if (pid) productCost.set(pid, r.cost);
    for (const cp of hits) {
      // Gian đang theo giá của CHÍNH sản phẩm kho vừa ghi → để nó tiếp tục theo
      // kho (không đóng băng thành giá riêng); bỏ cả giá riêng dòng trước đặt.
      if (pid && cp.productId === pid && cp.ownCost <= 0) shopCost.delete(cp.id);
      else shopCost.set(cp.id, r.cost);
    }
    matchedRows++;
  }

  // Ô đã đúng giá → không ghi (đếm là khớp nhưng không "cập nhật"). Gian theo
  // một sản phẩm kho đang đổi giá trong chính file này thì vẫn phải ghi.
  const cpById = new Map(data.channelProducts.map((cp) => [cp.id, cp]));
  for (const [id, cost] of shopCost) {
    const cp = cpById.get(id);
    const stockDefaultChanging = cp?.productId ? productCost.has(cp.productId) : false;
    if (cp && cp.currentCost === cost && !stockDefaultChanging) shopCost.delete(id);
  }
  for (const [id, cost] of productCost) if (productNow.get(id) === cost) productCost.delete(id);

  return { productCost, shopCost, errors, matchedRows };
}

/** Gom map id → giá thành giá → [id] để mỗi giá một lượt ghi. */
export function groupByCost(m: Map<string, number>): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const [id, cost] of m) {
    const list = out.get(cost);
    if (list) list.push(id);
    else out.set(cost, [id]);
  }
  return out;
}
