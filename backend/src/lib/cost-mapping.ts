// ============================================================
// MAPPING GIÁ VỐN (17/09/2026) — khai giá vốn MỘT LẦN cho một mã SKU, áp cho
// mọi gian, mọi sàn. Lý do tồn tại: tab Nhập giá vốn tách theo từng gian, một
// mẫu 10 phân loại bán trên 10 gian là 100 ô phải gõ.
//
// Ba việc:
//   1. GỘP THEO MÃ (groupSkusByCode): mỗi mã SKU một dòng dù nằm trên bao nhiêu
//      gian. Mã đã có giá ở gian này, trống ở gian khác → ĐỀ XUẤT điền.
//   2. ĐẶT GIÁ THEO MÃ (setCostForCodes): nhập một lần, ghi cho mọi gian.
//   3. BẢNG GIÁ TỰ NHẬP (CostPriceRule): khớp mã đầy đủ HOẶC mã mẫu (tiền tố) —
//      "TBSA01" khớp "TBSA01-Vàng-XXL". Mã dài hơn thắng mã ngắn hơn.
//
// Nguyên tắc bất di bất dịch:
//   - CHỈ khớp theo MÃ, không bao giờ theo tên — khớp tên sai là lãi/lỗ sai âm
//     thầm, không ai phát hiện. Mã không khớp thì HIỆN RA cho chủ shop xử lý.
//   - Mọi thao tác TỰ ĐỘNG / HÀNG LOẠT chỉ điền ô TRỐNG. Ghi đè giá đang có chỉ
//     xảy ra khi chủ shop chỉ đích danh mã đó. Máy chủ luôn TÍNH LẠI khi áp,
//     không tin số client gửi lên.
//   - Không có nguồn giá vốn thứ ba: mọi thứ ghi xuống qua lib/cost-price.ts.
// ============================================================

import { ChannelName } from "@prisma/client";
import { prisma } from "./prisma";
import { applyChannelCostPrice, applyCostPrice } from "./cost-price";

/* ───────────────────────── Phần THUẦN (vitest đánh thẳng) ───────────────────────── */

/**
 * Chuẩn hoá mã để so khớp: trim + NFC + UPPERCASE. NFC là bắt buộc — cùng chữ
 * "Vàng" mà sàn này trả dạng dựng sẵn, sàn kia trả dạng tổ hợp thì so chuỗi
 * thô sẽ trượt dù mắt người thấy giống hệt.
 */
export function normalizeSkuCode(raw: string): string {
  return raw.normalize("NFC").trim().toUpperCase();
}

export interface MappingTarget {
  skuId: string; // id ChannelProduct
  channelId: string;
  channelName: ChannelName;
  shopName: string;
  sku: string;
  productName: string;
  variantName: string | null;
  imageUrl: string | null;
  /** null = chưa nối kho → giá vốn nằm trên chính SKU sàn. */
  productId: string | null;
  currentCost: number;
}

/**
 * suggest  = các gian đã có giá đều THỐNG NHẤT một giá, còn gian đang trống
 * conflict = các gian đang có giá KHÁC NHAU — không đoán, chủ shop chọn
 * missing  = chưa gian nào có giá
 * complete = mọi gian đã cùng một giá
 *
 * Mã lệch giá mà chủ shop đã chọn "giữ nguyên, không nhắc nữa" KHÔNG còn là
 * conflict: đủ giá thì complete, còn gian trống thì missing (giá khác nhau có
 * chủ đích nên không có giá nào để đề xuất cho gian trống).
 */
export type SkuGroupStatus = "suggest" | "conflict" | "missing" | "complete";

export interface SkuGroup {
  /** Mã đã chuẩn hoá — khoá để đặt giá. */
  code: string;
  /** Tên / ảnh đại diện: ưu tiên gian đã có giá (thường là gian chủ shop chăm nhất). */
  productName: string;
  variantName: string | null;
  imageUrl: string | null;
  entries: MappingTarget[];
  status: SkuGroupStatus;
  /** Chỉ có khi status = suggest. */
  suggestedCost: number | null;
  /** Các gian đang lệch giá và chủ shop đã chọn giữ nguyên. */
  conflictDismissed: boolean;
}

export function groupSkusByCode(
  targets: MappingTarget[],
  dismissedCodes: ReadonlySet<string> = new Set()
): SkuGroup[] {
  const byCode = new Map<string, MappingTarget[]>();
  for (const t of targets) {
    const code = normalizeSkuCode(t.sku);
    if (!code) continue;
    const list = byCode.get(code) ?? [];
    list.push(t);
    byCode.set(code, list);
  }

  const groups: SkuGroup[] = [];
  for (const [code, entries] of byCode) {
    const costs = new Set(entries.filter((e) => e.currentCost > 0).map((e) => e.currentCost));
    const hasEmpty = entries.some((e) => e.currentCost <= 0);
    const conflictDismissed = costs.size > 1 && dismissedCodes.has(code);
    const status: SkuGroupStatus =
      costs.size === 0
        ? "missing"
        : conflictDismissed
          ? hasEmpty
            ? "missing"
            : "complete"
          : costs.size > 1
            ? "conflict"
            : hasEmpty
              ? "suggest"
              : "complete";
    const face =
      entries.find((e) => e.currentCost > 0 && e.imageUrl) ??
      entries.find((e) => e.currentCost > 0) ??
      entries.find((e) => e.imageUrl) ??
      entries[0];
    groups.push({
      code,
      productName: face.productName,
      variantName: face.variantName,
      imageUrl: face.imageUrl ?? entries.find((e) => e.imageUrl)?.imageUrl ?? null,
      entries,
      status,
      suggestedCost: status === "suggest" ? [...costs][0] : null,
      conflictDismissed,
    });
  }
  return groups.sort((a, b) => a.code.localeCompare(b.code));
}

export interface CostRule {
  /** Mã ĐÃ chuẩn hoá. */
  code: string;
  cost: number;
}

export interface RuleMatch {
  code: string;
  cost: number;
  kind: "exact" | "prefix";
}

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/**
 * Dựng hàm khớp từ bảng giá. Khớp tiền tố CHỈ tính khi ký tự ngay sau tiền tố
 * là dấu ngăn cách (-, _, khoảng trắng, /, …) — để "TBSA01" không ăn nhầm
 * "TBSA010-Đen". Duyệt từ dài về ngắn nên mã cụ thể hơn luôn thắng.
 */
export function buildRuleMatcher(rules: CostRule[]): (rawSku: string) => RuleMatch | null {
  const byCode = new Map<string, number>();
  for (const r of rules) if (!byCode.has(r.code)) byCode.set(r.code, r.cost);

  return (rawSku) => {
    const sku = normalizeSkuCode(rawSku);
    if (!sku) return null;
    const exact = byCode.get(sku);
    if (exact !== undefined) return { code: sku, cost: exact, kind: "exact" };

    for (let i = sku.length - 1; i >= 1; i--) {
      if (LETTER_OR_DIGIT.test(sku[i])) continue;
      const prefix = sku.slice(0, i).trimEnd();
      const cost = byCode.get(prefix);
      if (cost !== undefined) return { code: prefix, cost, kind: "prefix" };
    }
    return null;
  };
}

/**
 * fill      = ô đang trống, sẽ điền
 * same      = đã đúng giá này, không làm gì
 * conflict  = đang có giá KHÁC — chỉ ghi đè khi chủ shop tick
 * ambiguous = SKU đã nối kho mà các gian khớp ra các giá KHÁC NHAU cho cùng
 *             một sản phẩm gốc — không đoán, bỏ qua và báo ra
 */
export type MappingStatus = "fill" | "same" | "conflict" | "ambiguous";

export interface MappingRow extends MappingTarget {
  newCost: number;
  matchedCode: string;
  matchKind: "exact" | "prefix";
  status: MappingStatus;
}

export interface MappingPlan {
  rows: MappingRow[];
  /** Không khớp mã nào VÀ đang thiếu giá vốn — danh sách cần chủ shop xử lý. */
  unmatched: MappingTarget[];
}

export function planMapping(
  targets: MappingTarget[],
  match: (rawSku: string) => RuleMatch | null
): MappingPlan {
  const rows: MappingRow[] = [];
  const unmatched: MappingTarget[] = [];

  for (const t of targets) {
    const m = match(t.sku);
    if (!m) {
      if (t.currentCost <= 0) unmatched.push(t);
      continue;
    }
    const status: MappingStatus =
      t.currentCost <= 0 ? "fill" : t.currentCost === m.cost ? "same" : "conflict";
    rows.push({ ...t, newCost: m.cost, matchedCode: m.code, matchKind: m.kind, status });
  }

  // Một sản phẩm gốc chỉ có MỘT giá vốn: nếu các SKU sàn của nó khớp ra nhiều
  // giá khác nhau thì không giá nào đáng tin hơn giá nào.
  const costsByProduct = new Map<string, Set<number>>();
  for (const r of rows) {
    if (!r.productId) continue;
    const set = costsByProduct.get(r.productId) ?? new Set<number>();
    set.add(r.newCost);
    costsByProduct.set(r.productId, set);
  }
  for (const r of rows) {
    if (r.productId && (costsByProduct.get(r.productId)?.size ?? 0) > 1) {
      r.status = "ambiguous";
    }
  }

  return { rows, unmatched };
}

export function countPlan(plan: MappingPlan) {
  const c = { matched: plan.rows.length, fill: 0, same: 0, conflict: 0, ambiguous: 0 };
  for (const r of plan.rows) c[r.status]++;
  return { ...c, unmatched: plan.unmatched.length };
}

/* ───────────────────────────── Phần chạm DB ───────────────────────────── */

export class MappingInputError extends Error {}

async function loadRules(ownerId: string): Promise<CostRule[]> {
  const rules = await prisma.costPriceRule.findMany({
    where: { userId: ownerId },
    select: { code: true, costPrice: true },
  });
  return rules.map((r) => ({ code: r.code, cost: Number(r.costPrice) }));
}

/** Mọi SKU sàn của chủ shop kèm giá vốn HIỆU LỰC (đã nối kho thì theo sản phẩm gốc). */
async function loadTargets(ownerId: string, ids?: string[]): Promise<MappingTarget[]> {
  const cps = await prisma.channelProduct.findMany({
    where: {
      ...(ids ? { id: { in: ids } } : {}),
      channel: { userId: ownerId, channelName: { not: ChannelName.OFFLINE } },
    },
    select: {
      id: true,
      channelId: true,
      channelSku: true,
      productName: true,
      variantName: true,
      imageUrl: true,
      productId: true,
      costPrice: true,
      product: { select: { costPrice: true } },
      channel: { select: { channelName: true, shopName: true } },
    },
    orderBy: [{ channelId: "asc" }, { channelSku: "asc" }],
  });
  return cps.map((cp) => ({
    skuId: cp.id,
    channelId: cp.channelId,
    channelName: cp.channel.channelName,
    shopName: cp.channel.shopName,
    sku: cp.channelSku,
    productName: cp.productName,
    variantName: cp.variantName,
    imageUrl: cp.imageUrl,
    productId: cp.product ? cp.productId : null,
    currentCost: Number((cp.product ? cp.product.costPrice : cp.costPrice) ?? 0),
  }));
}

/** Ghi một loạt dòng xuống hai nơi lưu giá vốn, gom theo giá. */
async function writeRows(
  ownerId: string,
  rows: { skuId: string; productId: string | null; newCost: number }[]
): Promise<{ updatedSkus: number; backfilledOrderLines: number }> {
  const productsByCost = new Map<number, Set<string>>();
  const cpsByCost = new Map<number, string[]>();
  for (const r of rows) {
    if (r.productId) {
      const set = productsByCost.get(r.newCost) ?? new Set<string>();
      set.add(r.productId);
      productsByCost.set(r.newCost, set);
    } else {
      const list = cpsByCost.get(r.newCost) ?? [];
      list.push(r.skuId);
      cpsByCost.set(r.newCost, list);
    }
  }

  let backfilledOrderLines = 0;
  for (const [cost, ids] of productsByCost) {
    const r = await applyCostPrice([...ids], cost, ownerId);
    backfilledOrderLines += r.backfilledOrderLines;
  }
  for (const [cost, ids] of cpsByCost) {
    const r = await applyChannelCostPrice(ids, cost, ownerId);
    backfilledOrderLines += r.backfilledOrderLines;
  }
  return { updatedSkus: rows.length, backfilledOrderLines };
}

// ---------- 1 + 2. Gộp theo mã: đề xuất + đặt giá một lần ----------

async function loadGroups(ownerId: string): Promise<SkuGroup[]> {
  const [targets, dismissed] = await Promise.all([
    loadTargets(ownerId),
    prisma.costConflictDismissal.findMany({
      where: { userId: ownerId },
      select: { code: true },
    }),
  ]);
  return groupSkusByCode(targets, new Set(dismissed.map((d) => d.code)));
}

export async function listSkuGroups(ownerId: string) {
  const groups = await loadGroups(ownerId);
  const totals = { codes: groups.length, suggest: 0, conflict: 0, missing: 0, complete: 0 };
  let suggestEmptySlots = 0;
  for (const g of groups) {
    totals[g.status]++;
    if (g.status === "suggest") {
      suggestEmptySlots += g.entries.filter((e) => e.currentCost <= 0).length;
    }
  }
  return { totals: { ...totals, suggestEmptySlots }, groups };
}

/**
 * NÚT "ĐIỀN TẤT CẢ": mọi mã đang ở trạng thái suggest → điền ô trống bằng giá
 * các gian khác đã thống nhất. Không bao giờ chạm ô đã có giá.
 * `onlyCodes` = gợi ý "áp luôn cho N gian khác" ngay sau khi lưu giá ở tab Nhập
 * giá vốn — chỉ điền cho đúng các mã vừa nhập.
 */
export async function fillSuggested(ownerId: string, onlyCodes?: string[]) {
  const only = onlyCodes ? new Set(onlyCodes.map(normalizeSkuCode)) : null;
  const rows: { skuId: string; productId: string | null; newCost: number }[] = [];
  let codes = 0;
  for (const g of await loadGroups(ownerId)) {
    if (g.status !== "suggest" || g.suggestedCost === null) continue;
    if (only && !only.has(g.code)) continue;
    codes++;
    for (const e of g.entries) {
      if (e.currentCost <= 0) {
        rows.push({ skuId: e.skuId, productId: e.productId, newCost: g.suggestedCost });
      }
    }
  }
  const r = await writeRows(ownerId, rows);
  return { codes, filledSkus: r.updatedSkus, backfilledOrderLines: r.backfilledOrderLines };
}

/**
 * NÚT "ÁP DỤNG CHO TẤT CẢ GIAN": chủ shop chỉ đích danh (các) mã và một giá →
 * ghi cho MỌI gian có mã đó, KỂ CẢ gian đang có giá khác (đó chính là ý muốn).
 * Nhiều mã một lượt = ô "Giá vốn chung" của cả mẫu.
 */
export async function setCostForCodes(ownerId: string, codes: string[], cost: number) {
  const wanted = new Set(codes.map(normalizeSkuCode).filter(Boolean));
  const hit = (await loadTargets(ownerId)).filter((t) => wanted.has(normalizeSkuCode(t.sku)));
  if (hit.length === 0) throw new MappingInputError("Không tìm thấy mã SKU này trên gian nào");

  const rows = hit
    .filter((t) => t.currentCost !== cost)
    .map((t) => ({ skuId: t.skuId, productId: t.productId, newCost: cost }));
  const r = await writeRows(ownerId, rows);
  // Mã đã về một giá chung → quyết định "giữ lệch giá" cũ (nếu có) hết nghĩa.
  await prisma.costConflictDismissal.deleteMany({
    where: { userId: ownerId, code: { in: [...wanted] } },
  });
  return {
    updatedSkus: r.updatedSkus,
    shops: new Set(hit.map((t) => t.channelId)).size,
    backfilledOrderLines: r.backfilledOrderLines,
  };
}

/** "Giữ nguyên, không nhắc nữa" cho một mã đang lệch giá — hoặc bật nhắc lại. */
export async function setConflictDismissed(ownerId: string, rawCode: string, dismissed: boolean) {
  const code = normalizeSkuCode(rawCode);
  if (!code) throw new MappingInputError("Thiếu mã SKU");
  if (dismissed) {
    await prisma.costConflictDismissal.upsert({
      where: { userId_code: { userId: ownerId, code } },
      create: { userId: ownerId, code },
      update: {},
    });
  } else {
    await prisma.costConflictDismissal.deleteMany({ where: { userId: ownerId, code } });
  }
  return { code, dismissed };
}

/**
 * Vừa lưu giá vốn cho vài SKU ở tab Nhập giá vốn → các mã đó còn nằm ở gian nào
 * khác? Trả về để giao diện gợi ý "áp luôn" tại chỗ, khỏi phải nhớ sang tab
 * Mapping. `fillable` = ô trống điền được ngay (mã đang ở trạng thái suggest);
 * `conflicting` = số mã có gian đang mang giá KHÁC, cần chủ shop quyết ở tab
 * Mapping. Mã đã chọn "giữ lệch giá" thì không gợi ý gì.
 */
export async function findCostSiblings(ownerId: string, skuIds: string[]) {
  const ids = new Set(skuIds);
  const fillCodes: string[] = [];
  const shops = new Set<string>();
  let fillable = 0;
  let conflicting = 0;
  for (const g of await loadGroups(ownerId)) {
    if (!g.entries.some((e) => ids.has(e.skuId))) continue;
    if (g.status === "suggest") {
      fillCodes.push(g.code);
      for (const e of g.entries) {
        if (e.currentCost > 0) continue;
        fillable++;
        shops.add(e.channelId);
      }
    } else if (g.status === "conflict") {
      conflicting++;
    }
  }
  return { fillCodes, fillable, fillShops: shops.size, conflicting };
}

// ---------- 3. Bảng giá tự nhập ----------

export async function buildRulesPlan(ownerId: string): Promise<MappingPlan> {
  const rules = await loadRules(ownerId);
  if (rules.length === 0) {
    throw new MappingInputError("Bảng giá tự nhập đang trống — hãy thêm mã và giá vốn trước.");
  }
  return planMapping(await loadTargets(ownerId), buildRuleMatcher(rules));
}

export async function applyRules(ownerId: string, overwriteSkuIds: string[]) {
  const plan = await buildRulesPlan(ownerId);
  const allowed = new Set(overwriteSkuIds);
  const chosen = plan.rows.filter(
    (r) =>
      r.status === "fill" ||
      (r.status === "conflict" && allowed.has(r.skuId))
  );
  const result = await writeRows(ownerId, chosen);
  return {
    filled: chosen.filter((r) => r.status === "fill").length,
    overwritten: chosen.filter((r) => r.status === "conflict").length,
    backfilledOrderLines: result.backfilledOrderLines,
  };
}

/**
 * Bảng giá tự nhập kèm số SKU mỗi mã đang phủ + độ phủ toàn shop — để chủ shop
 * thấy ngay mã nào gõ sai (phủ 0 SKU) và còn bao nhiêu SKU chưa có mã nào nhận.
 */
export async function listRulesWithCoverage(ownerId: string) {
  const [rules, targets] = await Promise.all([
    prisma.costPriceRule.findMany({
      where: { userId: ownerId },
      orderBy: { code: "asc" },
    }),
    loadTargets(ownerId),
  ]);
  const match = buildRuleMatcher(
    rules.map((r) => ({ code: r.code, cost: Number(r.costPrice) }))
  );
  const hits = new Map<string, number>();
  let covered = 0;
  for (const t of targets) {
    const m = match(t.sku);
    if (!m) continue;
    covered++;
    hits.set(m.code, (hits.get(m.code) ?? 0) + 1);
  }
  return {
    totalSkus: targets.length,
    coveredSkus: covered,
    rules: rules.map((r) => ({
      id: r.id,
      code: r.code,
      costPrice: String(r.costPrice),
      label: r.label,
      matchedSkus: hits.get(r.code) ?? 0,
    })),
  };
}

// ---------- Hook đồng bộ sản phẩm ----------

/**
 * TỰ ĐIỀN giá vốn cho SKU sàn VỪA ĐỒNG BỘ VỀ LẦN ĐẦU (gọi từ product-sync).
 * Thứ tự: bảng giá tự nhập → SKU trùng mã ở gian khác của cùng chủ shop (chỉ
 * khi các gian đó thống nhất một giá). Chỉ chạm SKU mới tạo, chưa nối kho, chưa
 * có giá — không bao giờ ghi đè thứ chủ shop đã nhập.
 */
export async function autoFillCostForNewSkus(
  ownerId: string,
  createdIds: string[]
): Promise<number> {
  if (createdIds.length === 0) return 0;

  const created = new Set(createdIds);
  const all = await loadTargets(ownerId);
  const fresh = all.filter((t) => created.has(t.skuId) && !t.productId && t.currentCost <= 0);
  if (fresh.length === 0) return 0;

  const matchRule = buildRuleMatcher(await loadRules(ownerId));
  const siblingCost = new Map<string, number>();
  for (const g of groupSkusByCode(all.filter((t) => !created.has(t.skuId)))) {
    const costs = new Set(g.entries.filter((e) => e.currentCost > 0).map((e) => e.currentCost));
    if (costs.size === 1) siblingCost.set(g.code, [...costs][0]);
  }

  const rows: { skuId: string; productId: null; newCost: number }[] = [];
  for (const t of fresh) {
    const cost = matchRule(t.sku)?.cost ?? siblingCost.get(normalizeSkuCode(t.sku)) ?? 0;
    if (cost > 0) rows.push({ skuId: t.skuId, productId: null, newCost: cost });
  }
  if (rows.length === 0) return 0;

  await writeRows(ownerId, rows);
  return rows.length;
}
