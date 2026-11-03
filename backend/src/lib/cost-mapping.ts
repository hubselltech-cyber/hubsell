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
//
// ★ 11/10/2026 — GIÁ VỐN THEO GIAN: mọi thao tác ở đây ghi GIÁ RIÊNG CỦA GIAN
//   (ChannelProduct.costPrice), kể cả SKU đã nối kho; giá đọc ra là giá hiệu
//   lực (effectiveSkuCost). Cả tab nhận thêm `channelIds` = các gian chủ shop
//   đang chọn: gộp, đề xuất, "Điền tất cả", "Áp dụng N gian" CHỈ trong các gian
//   đó — gian không chọn giữ nguyên giá của nó. Không gửi = mọi gian (như cũ).
// ============================================================

import { ChannelName, Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { effectiveSkuCost } from "./cost-price";
import { saveCostPlan } from "./cost-import-apply";
import { loadSkuGroupPage, loadSuggestedFill, type SkuGroupStatusFilter } from "./cost-mapping-catalog";

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
  /**
   * Danh tính dòng trên sàn ("item-model" / "product-sku") — để khách dán mã
   * sản phẩm / mã phân loại của sàn vào ô tìm (khách 22/10). Không dùng để khớp.
   */
  externalId?: string | null;
  /** null = chưa nối kho. */
  productId: string | null;
  /** Giá vốn HIỆU LỰC: giá riêng của gian, không có thì giá mặc định ở kho. */
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
  /**
   * Các gian gắn cùng mã này vào những PHÂN LOẠI KHÁC TÊN (sàn cho phép; sau
   * 15/10 trong một gian mã trùng đã có đuôi tên nên chỉ còn xảy ra giữa các
   * gian). Giao diện không được lấy tên một dòng làm mặt nhóm — phải nói rõ.
   */
  variantMixed: boolean;
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
    const variantNames = new Set(
      entries.map((e) => e.variantName?.trim()).filter((v): v is string => Boolean(v))
    );
    groups.push({
      code,
      productName: face.productName,
      variantName: face.variantName,
      variantMixed: variantNames.size > 1,
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
 */
export type MappingStatus = "fill" | "same" | "conflict";

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

  // Từ 11/10/2026 mỗi gian một giá vốn riêng: hai gian cùng sản phẩm kho khớp
  // ra hai giá là hợp lệ (trước đây bị chặn "ambiguous").
  return { rows, unmatched };
}

export function countPlan(plan: MappingPlan) {
  const c = { matched: plan.rows.length, fill: 0, same: 0, conflict: 0 };
  for (const r of plan.rows) c[r.status]++;
  return { ...c, unmatched: plan.unmatched.length };
}

/* ───────────────────────────── Phần chạm DB ───────────────────────────── */

export class MappingInputError extends Error {}

/**
 * ★ 03/11/2026: danh mục vượt catalogRowLimit() (mặc định 5.000 dòng, tự chọn) không tải vào RAM web mà tính
 * trong DB (cost-mapping-catalog.ts), bảng giá tự nhập đọc theo lô. Bản đầu chặn hẳn bằng 413 làm khách 57.877
 * dòng không mở được tab; KHÔNG chặn nữa.
 */

/** Trần dòng một lượt tải danh mục trên web (env SKU_PRODUCTS_MAX_ROWS, mặc định 5.000). */
export function catalogRowLimit(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.SKU_PRODUCTS_MAX_ROWS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5000;
}

function catalogScope(ownerId: string, channelIds?: string[]) {
  return {
    channel: {
      userId: ownerId,
      channelName: { not: ChannelName.OFFLINE },
      ...(channelIds ? { id: { in: channelIds } } : {}),
    },
  } satisfies Prisma.ChannelProductWhereInput;
}

/** Dạng cần hỏi DB cho một mã đã chuẩn hóa: NFC và NFD (sàn trả cả hai); so khớp chính xác làm lại trong RAM. */
export function codeLookupVariants(code: string): string[] {
  return [...new Set([code.normalize("NFC"), code.normalize("NFD")])];
}

async function loadRules(ownerId: string): Promise<CostRule[]> {
  const rules = await prisma.costPriceRule.findMany({
    where: { userId: ownerId },
    select: { code: true, costPrice: true },
  });
  return rules.map((r) => ({ code: r.code, cost: Number(r.costPrice) }));
}

const TARGET_SELECT = {
  id: true,
  channelId: true,
  channelSku: true,
  productName: true,
  variantName: true,
  imageUrl: true,
  externalId: true,
  productId: true,
  costPrice: true,
  product: { select: { costPrice: true } },
  channel: { select: { channelName: true, shopName: true } },
} satisfies Prisma.ChannelProductSelect;

function toTarget(cp: Prisma.ChannelProductGetPayload<{ select: typeof TARGET_SELECT }>): MappingTarget {
  return {
    skuId: cp.id,
    channelId: cp.channelId,
    channelName: cp.channel.channelName,
    shopName: cp.channel.shopName,
    sku: cp.channelSku,
    productName: cp.productName,
    variantName: cp.variantName,
    imageUrl: cp.imageUrl,
    externalId: cp.externalId,
    productId: cp.product ? cp.productId : null,
    currentCost: effectiveSkuCost(cp),
  };
}

/**
 * Mọi SKU sàn của chủ shop (trong các gian `channelIds` nếu có) kèm giá vốn
 * HIỆU LỰC (giá riêng của gian, không có thì giá mặc định ở kho).
 */
async function loadTargets(
  ownerId: string,
  channelIds?: string[],
  /** Có = CHỈ đọc các mã này (đã chuẩn hóa), không tải cả danh mục. */
  codes?: ReadonlySet<string>
): Promise<MappingTarget[]> {
  if (codes && codes.size === 0) return [];
  const cps = await prisma.channelProduct.findMany({
    where: {
      ...catalogScope(ownerId, channelIds),
      ...(codes
        ? {
            OR: [...codes].flatMap(codeLookupVariants).map((c) => ({
              channelSku: { equals: c, mode: "insensitive" as const },
            })),
          }
        : {}),
    },
    select: TARGET_SELECT,
    orderBy: [{ channelId: "asc" }, { channelSku: "asc" }],
  });
  // So khớp chính xác theo normalizeSkuCode: ILIKE của DB coi "_" và "%" là ký tự đại diện.
  const matched = codes ? cps.filter((cp) => codes.has(normalizeSkuCode(cp.channelSku))) : cps;
  return matched.map(toTarget);
}

const TARGET_BATCH = 2000;

/** Duyệt cả danh mục theo lô, không giữ lại trong RAM. Phân trang id > con trỏ, không cursor+skip. */
async function forEachTargetBatch(ownerId: string, fn: (batch: MappingTarget[]) => void): Promise<void> {
  let after: string | undefined;
  for (;;) {
    const batch = await prisma.channelProduct.findMany({
      where: { ...catalogScope(ownerId), ...(after ? { id: { gt: after } } : {}) },
      select: TARGET_SELECT,
      orderBy: { id: "asc" },
      take: TARGET_BATCH,
    });
    if (batch.length === 0) return;
    fn(batch.map(toTarget));
    if (batch.length < TARGET_BATCH) return;
    after = batch[batch.length - 1].id;
  }
}

/** Ghi giá riêng của gian cho một loạt SKU sàn, một câu cho cả loạt. */
async function writeRows(
  ownerId: string,
  rows: { skuId: string; newCost: number }[]
): Promise<{ updatedSkus: number; backfilledOrderLines: number }> {
  if (rows.length === 0) return { updatedSkus: 0, backfilledOrderLines: 0 };
  const r = await saveCostPlan(
    { productCost: new Map(), shopCost: new Map(rows.map((x) => [x.skuId, x.newCost])) },
    ownerId
  );
  return { updatedSkus: r.updated, backfilledOrderLines: r.backfilled };
}

// ---------- 1 + 2. Gộp theo mã: đề xuất + đặt giá một lần ----------

async function loadGroups(
  ownerId: string,
  channelIds?: string[],
  codes?: ReadonlySet<string>
): Promise<SkuGroup[]> {
  const [targets, dismissed] = await Promise.all([
    loadTargets(ownerId, channelIds, codes),
    prisma.costConflictDismissal.findMany({
      where: { userId: ownerId, ...(codes ? { code: { in: [...codes] } } : {}) },
      select: { code: true },
    }),
  ]);
  return groupSkusByCode(targets, new Set(dismissed.map((d) => d.code)));
}

export const SKU_GROUP_PAGE_DEFAULT = 200;
const SKU_GROUP_PAGE_MAX = 5000;

export interface SkuGroupQuery {
  q?: string;
  status?: SkuGroupStatusFilter;
  limit?: number;
}

/** Danh mục vượt trần: gộp, đếm, lọc và chia trang trong DB; web chỉ đọc đúng các dòng của trang. */
async function listSkuGroupsFromDb(ownerId: string, channelIds: string[] | undefined, query: SkuGroupQuery) {
  const limit = Math.min(Math.max(1, Math.floor(query.limit ?? SKU_GROUP_PAGE_DEFAULT)), SKU_GROUP_PAGE_MAX);
  const page = await loadSkuGroupPage({
    ownerId,
    channelIds,
    q: query.q ?? "",
    status: query.status ?? "all",
    limit,
  });
  const [cps, dismissed] = await Promise.all([
    prisma.channelProduct.findMany({
      where: { id: { in: page.ids } },
      select: TARGET_SELECT,
      orderBy: [{ channelId: "asc" }, { channelSku: "asc" }],
    }),
    prisma.costConflictDismissal.findMany({
      where: { userId: ownerId, code: { in: page.codes } },
      select: { code: true },
    }),
  ]);
  const order = new Map(page.codes.map((c, i) => [c, i]));
  const groups = groupSkusByCode(cps.map(toTarget), new Set(dismissed.map((d) => d.code))).sort(
    (a, b) => (order.get(a.code) ?? Infinity) - (order.get(b.code) ?? Infinity)
  );
  return {
    totals: page.totals,
    groups,
    serverPaged: {
      limit,
      matchedCodes: page.matchedCodes,
      canLoadMore: page.matchedCodes > limit && limit < SKU_GROUP_PAGE_MAX,
      shops: page.shops,
    },
  };
}

export async function listSkuGroups(ownerId: string, channelIds?: string[], query: SkuGroupQuery = {}) {
  const rows = await prisma.channelProduct.count({ where: catalogScope(ownerId, channelIds) });
  if (rows > catalogRowLimit()) return listSkuGroupsFromDb(ownerId, channelIds, query);
  const groups = await loadGroups(ownerId, channelIds);
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
export async function fillSuggested(
  ownerId: string,
  onlyCodes?: string[],
  channelIds?: string[]
) {
  const only = onlyCodes ? new Set(onlyCodes.map(normalizeSkuCode).filter(Boolean)) : null;
  if (!only) {
    // "Điền tất cả": tính trong DB, cỡ danh mục nào cũng chạy được.
    const fill = await loadSuggestedFill(ownerId, channelIds);
    const w = await writeRows(ownerId, fill.rows);
    return { codes: fill.codes, filledSkus: w.updatedSkus, backfilledOrderLines: w.backfilledOrderLines };
  }
  const rows: { skuId: string; newCost: number }[] = [];
  let codes = 0;
  for (const g of await loadGroups(ownerId, channelIds, only)) {
    if (g.status !== "suggest" || g.suggestedCost === null) continue;
    if (!only.has(g.code)) continue;
    codes++;
    for (const e of g.entries) {
      if (e.currentCost <= 0) {
        rows.push({ skuId: e.skuId, newCost: g.suggestedCost });
      }
    }
  }
  const r = await writeRows(ownerId, rows);
  return { codes, filledSkus: r.updatedSkus, backfilledOrderLines: r.backfilledOrderLines };
}

/**
 * NÚT "ÁP DỤNG N GIAN": chủ shop chỉ đích danh (các) mã và một giá → ghi cho
 * MỌI gian ĐANG CHỌN có mã đó (`channelIds`, không gửi = mọi gian), KỂ CẢ gian
 * đang có giá khác (đó chính là ý muốn). Gian không chọn giữ nguyên.
 * Nhiều mã một lượt = ô "Giá vốn chung" của cả mẫu.
 */
export async function setCostForCodes(
  ownerId: string,
  codes: string[],
  cost: number,
  channelIds?: string[]
) {
  const wanted = new Set(codes.map(normalizeSkuCode).filter(Boolean));
  const hit = await loadTargets(ownerId, channelIds, wanted);
  if (hit.length === 0) throw new MappingInputError("Không tìm thấy mã SKU này trên gian nào");

  const rows = hit
    .filter((t) => t.currentCost !== cost)
    .map((t) => ({ skuId: t.skuId, newCost: cost }));
  const r = await writeRows(ownerId, rows);
  // Mã đã về một giá chung ở MỌI gian → quyết định "giữ giá khác nhau" cũ (nếu
  // có) hết nghĩa. Chỉ áp cho vài gian thì các gian kia vẫn có thể khác giá có
  // chủ đích — giữ nguyên quyết định.
  if (!channelIds) {
    await prisma.costConflictDismissal.deleteMany({
      where: { userId: ownerId, code: { in: [...wanted] } },
    });
  }
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
  // ★ 03/11/2026: hàm này chạy MỖI LẦN khách lưu giá. Trước đây tải cả danh mục (57.877 dòng ở gian
  // lớn nhất); nay chỉ đọc các dòng cùng mã với SKU vừa lưu.
  const saved = await prisma.channelProduct.findMany({
    where: { id: { in: skuIds }, channel: { userId: ownerId } },
    select: { channelSku: true },
  });
  const codes = new Set(saved.map((s) => normalizeSkuCode(s.channelSku)).filter(Boolean));
  for (const g of await loadGroups(ownerId, undefined, codes)) {
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

/** Trần mỗi danh sách trả về giao diện khi xem trước; số đếm luôn đủ. */
export const RULES_PREVIEW_LIST_MAX = 5000;

async function loadMatcher(ownerId: string) {
  const rules = await loadRules(ownerId);
  if (rules.length === 0) {
    throw new MappingInputError("Bảng giá tự nhập đang trống — hãy thêm mã và giá vốn trước.");
  }
  return buildRuleMatcher(rules);
}

const byShopThenSku = (a: MappingTarget, b: MappingTarget) =>
  a.channelId.localeCompare(b.channelId) || a.sku.localeCompare(b.sku);

/** Xem trước đọc theo lô: đếm đủ cả danh mục, chỉ giữ tối đa RULES_PREVIEW_LIST_MAX dòng mỗi loại để hiển thị. */
export async function previewRules(ownerId: string) {
  const match = await loadMatcher(ownerId);
  const counts = { matched: 0, fill: 0, same: 0, conflict: 0, unmatched: 0 };
  const fill: MappingRow[] = [];
  const conflict: MappingRow[] = [];
  const unmatched: MappingTarget[] = [];
  await forEachTargetBatch(ownerId, (batch) => {
    const plan = planMapping(batch, match);
    const c = countPlan(plan);
    counts.matched += c.matched;
    counts.fill += c.fill;
    counts.same += c.same;
    counts.conflict += c.conflict;
    counts.unmatched += c.unmatched;
    for (const r of plan.rows) {
      const list = r.status === "fill" ? fill : r.status === "conflict" ? conflict : null;
      if (list && list.length < RULES_PREVIEW_LIST_MAX) list.push(r);
    }
    for (const t of plan.unmatched) {
      if (unmatched.length < RULES_PREVIEW_LIST_MAX) unmatched.push(t);
    }
  });
  return {
    counts,
    // Dòng "same" không cần ai nhìn — chỉ trả những gì sẽ đổi hoặc cần quyết.
    rows: [...conflict, ...fill].sort(byShopThenSku),
    unmatched: unmatched.sort(byShopThenSku),
  };
}

export async function applyRules(ownerId: string, overwriteSkuIds: string[]) {
  const match = await loadMatcher(ownerId);
  const allowed = new Set(overwriteSkuIds);
  const chosen: { skuId: string; newCost: number }[] = [];
  let filled = 0;
  let overwritten = 0;
  await forEachTargetBatch(ownerId, (batch) => {
    for (const r of planMapping(batch, match).rows) {
      if (r.status === "fill") filled++;
      else if (r.status === "conflict" && allowed.has(r.skuId)) overwritten++;
      else continue;
      chosen.push({ skuId: r.skuId, newCost: r.newCost });
    }
  });
  const result = await writeRows(ownerId, chosen);
  return { filled, overwritten, backfilledOrderLines: result.backfilledOrderLines };
}

/**
 * Bảng giá tự nhập kèm số SKU mỗi mã đang phủ + độ phủ toàn shop — để chủ shop
 * thấy ngay mã nào gõ sai (phủ 0 SKU) và còn bao nhiêu SKU chưa có mã nào nhận.
 */
export async function listRulesWithCoverage(ownerId: string) {
  const rules = await prisma.costPriceRule.findMany({
    where: { userId: ownerId },
    orderBy: { code: "asc" },
  });
  const match = buildRuleMatcher(rules.map((r) => ({ code: r.code, cost: Number(r.costPrice) })));
  const hits = new Map<string, number>();
  let covered = 0;
  let totalSkus = 0;
  if (rules.length === 0) {
    totalSkus = await prisma.channelProduct.count({ where: catalogScope(ownerId) });
  } else {
    await forEachTargetBatch(ownerId, (batch) => {
      totalSkus += batch.length;
      for (const t of batch) {
        const m = match(t.sku);
        if (!m) continue;
        covered++;
        hits.set(m.code, (hits.get(m.code) ?? 0) + 1);
      }
    });
  }
  return {
    totalSkus,
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

  const rows: { skuId: string; newCost: number }[] = [];
  for (const t of fresh) {
    const cost = matchRule(t.sku)?.cost ?? siblingCost.get(normalizeSkuCode(t.sku)) ?? 0;
    if (cost > 0) rows.push({ skuId: t.skuId, newCost: cost });
  }
  if (rows.length === 0) return 0;

  await writeRows(ownerId, rows);
  return rows.length;
}
