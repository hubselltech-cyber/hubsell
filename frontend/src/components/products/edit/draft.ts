// ============================================================
// Bản nháp của hộp "Sửa sản phẩm" ở Tổng kho (18/11/2026) — phần THUẦN: dựng nháp từ mẫu, soi lỗi
// ngay khi gõ, gom đúng phần đã đổi để gửi. Luật chép theo backend/src/services/product-group-edit.ts
// (máy chủ vẫn là nơi quyết; ở đây chỉ để khách thấy lỗi tại ô, khỏi bấm Lưu rồi mới biết).
// ============================================================

import type { ChannelName, ProductGroupDetail, ProductGroupSavePayload, ProductGroupVariant } from "@/lib/api";

/** Mã SKU mới: chữ không dấu, số, - _ . — tối đa 50 ký tự (máy chủ tự đổi chữ hoa). */
const NEW_SKU_PATTERN = /^[A-Za-z0-9._-]{1,50}$/;
/** Dưới mức này vẫn lưu được, chỉ nhắc: TikTok không nhận mã người bán ngắn hơn 6 ký tự. */
const SKU_SHORT_HINT = 6;
const STOCK_MAX = 1_000_000;

/** Dòng ĐANG CÓ trong kho — sửa được phân loại, mã SKU, giá bán, giá vốn (người thấy tài chính). */
export interface ExistingRowDraft {
  kind: "existing";
  key: string;
  original: ProductGroupVariant;
  variantName: string;
  skuCode: string;
  /** Chuỗi chữ số thô ("120000") — CurrencyInput lo phần dấu chấm. */
  price: string;
  /** Giá vốn mặc định ở kho; xóa trắng = 0. Người không thấy tài chính không có ô này nên không bao giờ đổi. */
  cost: string;
}

/** Phân loại MỚI THÊM — có thêm giá vốn và tồn ban đầu. */
export interface NewRowDraft {
  kind: "new";
  key: string;
  variantName: string;
  skuCode: string;
  price: string;
  cost: string;
  stock: string;
}

export type RowDraft = ExistingRowDraft | NewRowDraft;

/** Một lần gõ vào một dòng. `stock` chỉ có nghĩa với dòng mới. */
export type RowEdit = Partial<Pick<NewRowDraft, "variantName" | "skuCode" | "price" | "cost" | "stock">>;

export interface GroupDraft {
  productName: string;
  rows: RowDraft[];
}

export interface RowIssues {
  variant?: string;
  sku?: string;
  stock?: string;
  /** Nhắc nhẹ (vàng), không chặn lưu. */
  skuNote?: string;
  /** Chú thích (xám) dưới ô Giá vốn: giá mới sẽ áp cho bao nhiêu SKU sàn đã nối. */
  costNote?: string;
}

/**
 * Một SKU sàn đã nối đang có giá vốn riêng LỆCH cả giá kho cũ lẫn giá kho mới (khách cố ý đặt riêng cho gian,
 * hoặc nối nhầm quy cách) — trước khi lưu phải hỏi: theo giá mới hay giữ giá riêng. Giá riêng trùng giá kho cũ
 * hoặc mới thì không hỏi, máy chủ tự cho theo kho (backend lib/cost-price followWarehouseCostIn — cùng luật).
 */
export interface OwnCostConflict {
  key: string;
  skuCode: string;
  shopName: string;
  channelName: ChannelName;
  /** Phân loại (hoặc mã SKU) của dòng trên sàn. */
  label: string;
  ownCost: number;
  newCost: number;
}

const digitsOf = (n: number) => String(Math.max(0, Math.round(n)));

/** Cùng cách làm sạch với máy chủ: "Đen,M" → "Đen, M"; rỗng → "". */
export function cleanVariant(raw: string): string {
  return raw
    .split(",")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(", ");
}

export function initDraft(detail: ProductGroupDetail): GroupDraft {
  return {
    productName: detail.productName,
    rows: detail.variants.map((v) => ({
      kind: "existing",
      key: v.id,
      original: v,
      variantName: v.variantName ?? "",
      skuCode: v.skuCode,
      price: digitsOf(v.sellingPrice),
      cost: digitsOf(v.costPrice ?? 0),
    })),
  };
}

let newRowSeq = 0;
/** Dòng mới: giá bán điền sẵn theo dòng cuối (các phân loại thường cùng giá) — sửa được. */
export function blankRow(draft: GroupDraft): NewRowDraft {
  newRowSeq += 1;
  const last = draft.rows[draft.rows.length - 1];
  return { kind: "new", key: `new-${newRowSeq}`, variantName: "", skuCode: "", price: last?.price ?? "", cost: "", stock: "" };
}

const skuKey = (r: RowDraft) => r.skuCode.trim().toUpperCase();
const variantKey = (r: RowDraft) => cleanVariant(r.variantName).toLowerCase();

function skuChanged(r: RowDraft): boolean {
  return r.kind === "new" || skuKey(r) !== r.original.skuCode.toUpperCase();
}
function variantChanged(r: RowDraft): boolean {
  return r.kind === "new" || cleanVariant(r.variantName) !== (r.original.variantName ?? "");
}
function priceChanged(r: ExistingRowDraft): boolean {
  return r.price !== digitsOf(r.original.sellingPrice);
}
function costChanged(r: ExistingRowDraft): boolean {
  return Number(r.cost || 0) !== Number(digitsOf(r.original.costPrice ?? 0));
}

/** Lỗi theo từng dòng (khóa = RowDraft.key). Dòng không có lỗi thì vắng mặt. */
export function rowIssues(draft: GroupDraft): Record<string, RowIssues> {
  const tally = (key: (r: RowDraft) => string) => {
    const m = new Map<string, number>();
    for (const r of draft.rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
    return m;
  };
  const skuCount = tally(skuKey);
  const variantCount = tally(variantKey);
  const multi = draft.rows.length >= 2;
  const out: Record<string, RowIssues> = {};
  for (const r of draft.rows) {
    const issue: RowIssues = {};
    const variant = cleanVariant(r.variantName);
    if (multi && !variant) issue.variant = "Đặt tên phân loại (vd Đen, M)";
    else if (variant && variantChanged(r) && (variantCount.get(variantKey(r)) ?? 0) > 1) issue.variant = "Trùng phân loại khác";

    if (skuChanged(r)) {
      const sku = r.skuCode.trim();
      if (!sku) issue.sku = "Nhập mã SKU";
      else if (!NEW_SKU_PATTERN.test(sku)) issue.sku = "Chỉ chữ không dấu, số, - _ . (tối đa 50 ký tự)";
      else if ((skuCount.get(skuKey(r)) ?? 0) > 1) issue.sku = "Trùng mã với phân loại khác";
      else if (r.kind === "existing" && r.original.linkedChannels > 0) {
        issue.skuNote = `Đang nối ${r.original.linkedChannels} SKU sàn — liên kết giữ nguyên, nhưng mã mới sẽ khác mã trên sàn.`;
      } else if (sku.length < SKU_SHORT_HINT) {
        issue.skuNote = `Mã dưới ${SKU_SHORT_HINT} ký tự không đăng được lên TikTok.`;
      }
    }

    if (r.kind === "new" && r.stock !== "" && Number(r.stock) > STOCK_MAX) issue.stock = "Số quá lớn";
    // Đổi giá vốn ở kho = đổi cho mọi SKU sàn đã nối (27/11/2026) — nói ngay tại ô để khách biết giá này đi tới đâu.
    if (r.kind === "existing" && costChanged(r) && Number(r.cost || 0) > 0 && r.original.linkedChannels > 0) {
      issue.costNote = `Áp cho ${r.original.linkedChannels} SKU sàn đã nối`;
    }
    if (Object.keys(issue).length > 0) out[r.key] = issue;
  }
  return out;
}

/** Lỗi đầu tiên chặn lưu (null = lưu được) — in cạnh nút Lưu. */
export function firstBlocker(draft: GroupDraft, issues: Record<string, RowIssues>): string | null {
  if (!draft.productName.trim()) return "Nhập tên sản phẩm";
  for (const r of draft.rows) {
    const i = issues[r.key];
    const blocking = i?.variant ?? i?.sku ?? i?.stock;
    if (blocking) return `${r.skuCode.trim() || "Phân loại mới"}: ${blocking}`;
  }
  return null;
}

/** Chỉ gửi dòng CÓ đổi và trường CÓ đổi — dòng không đụng tới thì máy chủ giữ nguyên. */
export function buildPayload(draft: GroupDraft): ProductGroupSavePayload {
  const payload: ProductGroupSavePayload = { productName: draft.productName.trim(), variants: [], added: [] };
  for (const r of draft.rows) {
    if (r.kind === "new") {
      payload.added.push({
        skuCode: r.skuCode.trim(),
        variantName: cleanVariant(r.variantName),
        sellingPrice: Number(r.price || 0),
        ...(r.cost !== "" ? { costPrice: Number(r.cost) } : {}),
        ...(r.stock !== "" ? { stock: Number(r.stock) } : {}),
      });
      continue;
    }
    const patch: ProductGroupSavePayload["variants"][number] = { id: r.original.id };
    if (skuChanged(r)) patch.skuCode = r.skuCode.trim();
    if (variantChanged(r)) patch.variantName = cleanVariant(r.variantName);
    if (priceChanged(r)) patch.sellingPrice = Number(r.price || 0);
    if (costChanged(r)) patch.costPrice = Number(r.cost || 0);
    if (Object.keys(patch).length > 1) payload.variants.push(patch);
  }
  return payload;
}

/** Các SKU đang có vừa đổi giá vốn, gom theo giá mới — để hỏi lại "mã này đang là quà tặng" trước khi lưu. */
export function costChangesByPrice(payload: ProductGroupSavePayload): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const v of payload.variants) {
    if (v.costPrice === undefined) continue;
    const ids = out.get(v.costPrice);
    if (ids) ids.push(v.id);
    else out.set(v.costPrice, [v.id]);
  }
  return out;
}

/** Các SKU sàn phải hỏi lại trước khi lưu (xem OwnCostConflict). Rỗng = lưu thẳng. */
export function ownCostConflicts(draft: GroupDraft): OwnCostConflict[] {
  const out: OwnCostConflict[] = [];
  for (const r of draft.rows) {
    if (r.kind !== "existing" || !costChanged(r)) continue;
    const newCost = Number(r.cost || 0);
    // Xóa giá kho về 0 không kéo giá các gian về 0 — máy chủ không đụng giá riêng, không có gì để hỏi.
    if (!(newCost > 0)) continue;
    const oldCost = r.original.costPrice ?? 0;
    (r.original.ownCosts ?? []).forEach((own, i) => {
      if (own.costPrice === oldCost || own.costPrice === newCost) return;
      out.push({
        key: `${r.key}-${i}`,
        skuCode: r.skuCode.trim() || r.original.skuCode,
        shopName: own.shopName,
        channelName: own.channelName,
        label: own.label,
        ownCost: own.costPrice,
        newCost,
      });
    });
  }
  return out;
}

/** Có gì để lưu không (nút Lưu sáng / chặn lỡ tay bấm ra ngoài hộp). */
export function isDirty(draft: GroupDraft, detail: ProductGroupDetail): boolean {
  const p = buildPayload(draft);
  return p.productName !== detail.productName || p.variants.length > 0 || p.added.length > 0;
}
