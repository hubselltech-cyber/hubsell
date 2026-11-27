// ============================================================
// SỬA SẢN PHẨM KHO THEO MẪU + THÊM PHÂN LOẠI (18/11/2026 — docs/QUAN-LY-KHO-TAI-CAU-TRUC.md mục 12)
//
// Anh Trung: "Tổng kho tạo được sản phẩm kho nhưng không sửa được; khách thêm SKU vào sản phẩm
// thì không thêm được." Sản phẩm kho = một MẪU (tên) + các phân loại, mỗi phân loại một dòng
// Product gom bằng groupKey (lib/product-group.ts). Sửa phải đi theo MẪU và trọn gói:
//   · đổi tên → áp cho mọi phân loại (sửa lẻ một dòng là dòng đó rơi khỏi mẫu);
//   · đổi phân loại / mã SKU / giá bán / giá vốn từng dòng;
//   · thêm phân loại mới = thêm một SKU kho vào đúng mẫu (mã vạch DB tự sinh, tồn ban đầu qua sổ kho).
//
// GIÁ VỐN của SKU đang có (19/11/2026, anh Trung: "sửa sản phẩm mà không sửa được giá vốn") = giá MẶC
// ĐỊNH ở kho (Product.costPrice), ghi qua đúng đường của trang Cấu hình Giá vốn (lib/cost-price.ts):
// đơn mới dùng giá mới, đơn cũ còn 0 được vá, đơn cũ đã có giá GIỮ NGUYÊN. Chỉ người thấy tài chính mới sửa được.
//
// SKU SÀN ĐÃ NỐI THEO GIÁ MỚI (27/11/2026, anh Trung — docs mục 15.4): đổi giá vốn ở đây là đổi cho mọi SKU
// sàn đã nối (lib/cost-price followWarehouseCostIn). SKU sàn đang có giá riêng LỆCH cả giá kho cũ lẫn mới
// thì hộp sửa hỏi khách, gửi kèm `ownCost`: "follow" = theo giá mới, "keep" = giữ giá riêng (mặc định khi vắng).
//
// CỐ Ý KHÔNG sửa ở đây: tồn kho (Nhập · Xuất · sổ kho), mã vạch (hộp Cài đặt SKU), ảnh (lát sau: ảnh
// tải lên đang gắn vào lượt Sao chép sản phẩm, cron dọn ảnh mồ côi sau 2 ngày).
//
// Tệp gồm phần THUẦN (planGroupEdit — đọc body, kiểm luật, ra kế hoạch ghi; test không cần DB) và
// phần DB (loadProductGroup / saveProductGroup).
// ============================================================

import { type ChannelName, InventoryLogType, Prisma } from "@prisma/client";
import { applyCostPricesIn, COST_TX_OPTIONS, invalidateOwnerCostCaches, type OwnCostMode } from "../lib/cost-price";
import { prisma } from "../lib/prisma";
import { cleanVariantName, productGroupKey } from "../lib/product-group";
import { MANUAL_LIMITS } from "./listing-copy/manual";
import { applyStockDelta } from "./stock-ledger";

/** Lỗi nghiệp vụ — route trả `status` + câu tiếng Việt cho khách. */
export class ProductGroupEditError extends Error {
  constructor(
    message: string,
    public readonly status = 400
  ) {
    super(message);
    this.name = "ProductGroupEditError";
  }
}

/** Số phân loại thêm tối đa trong MỘT lần lưu — bằng trần phân loại của form Tạo sản phẩm mới. */
export const GROUP_ADD_MAX = MANUAL_LIMITS.variants;
/** Mẫu lớn hơn mức này không mở ở hộp sửa (bảng nghìn dòng trong một hộp thoại không dùng được). */
export const GROUP_MAX_ROWS = 500;
/** Trần cột Decimal(12, 2). */
const PRICE_MAX = 9_999_999_999;
const STOCK_MAX = 1_000_000;
const VARIANT_NAME_MAX = 200;

/**
 * Mã SKU MỚI (đổi mã hoặc thêm phân loại): chữ không dấu, số, - _ . — cùng tập ký tự với form Tạo
 * sản phẩm mới. Sàn độ dài hạ về 1 như luồng Sao chép từ sàn: mã phải đặt GIỐNG mã trên gian thì Tự
 * khớp mới bắt được, mà mã người bán trên gian có thể ngắn hơn 6 ký tự. Mã KHÔNG đổi thì không kiểm
 * (mã cũ kéo từ sàn có thể chứa dấu cách / ngoặc).
 */
const NEW_SKU_PATTERN = new RegExp(`^[A-Z0-9._-]{1,${MANUAL_LIMITS.skuMax}}$`);

export interface GroupCurrentRow {
  id: string;
  skuCode: string;
  productName: string;
  variantName: string | null;
  groupKey: string | null;
  sellingPrice: number;
  costPrice: number;
}

interface RowUpdate {
  id: string;
  skuCode?: string;
  variantName?: string | null;
  sellingPrice?: number;
}

interface RowAdd {
  skuCode: string;
  variantName: string | null;
  sellingPrice: number;
  costPrice: number;
  stock: number;
}

export interface GroupEditPlan {
  productName: string;
  /** Khóa gom sau sửa — một giá trị cho cả mẫu (null = sản phẩm đơn không phân loại). */
  groupKey: string | null;
  /** Có dòng nào đang mang tên / khóa gom khác bản sau sửa → ghi lại tên + khóa cho cả mẫu. */
  renameAll: boolean;
  /** Chỉ dòng CÓ đổi, chỉ trường CÓ đổi. */
  updates: RowUpdate[];
  /** Giá vốn mặc định ở kho của các dòng CÓ đổi giá — ghi riêng qua lib/cost-price (kèm vá đơn cũ còn 0). */
  costs: { productId: string; cost: number }[];
  /** SKU sàn đã nối có giá riêng lệch giá kho: theo giá mới hay giữ — khách chọn ở hộp hỏi lại; vắng = giữ. */
  ownCost: OwnCostMode;
  added: RowAdd[];
  /** Mã SKU mới (đổi + thêm) — phải kiểm trùng với phần còn lại của Tổng kho. */
  newSkuCodes: string[];
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

function parsePrice(raw: unknown, label: string): number {
  const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > PRICE_MAX) {
    throw new ProductGroupEditError(`${label} phải là số không âm.`);
  }
  return Math.round(n * 100) / 100;
}

function parseNewSku(raw: unknown, rowLabel: string): string {
  const sku = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  if (!sku) throw new ProductGroupEditError(`${rowLabel} chưa có mã SKU.`);
  if (!NEW_SKU_PATTERN.test(sku)) {
    throw new ProductGroupEditError(
      `Mã SKU "${sku}" không hợp lệ — tối đa ${MANUAL_LIMITS.skuMax} ký tự, chỉ chữ không dấu, số, gạch ngang, gạch dưới, dấu chấm.`
    );
  }
  return sku;
}

function parseVariant(raw: unknown): string | null {
  const v = cleanVariantName(raw);
  if (v && v.length > VARIANT_NAME_MAX) {
    throw new ProductGroupEditError(`Tên phân loại dài quá ${VARIANT_NAME_MAX} ký tự.`);
  }
  return v;
}

/**
 * Body PUT /api/products/:id/group → kế hoạch ghi. Thuần, không chạm DB. Ném ProductGroupEditError
 * khi sai luật. Body: { productName, variants: [{ id, skuCode?, variantName?, sellingPrice?, costPrice? }],
 * added: [{ skuCode, variantName, sellingPrice, costPrice?, stock? }], ownCost? } — trường vắng = giữ nguyên;
 * dòng không gửi = giữ nguyên (vẫn đổi tên theo mẫu). `costPrice` của dòng đang có: người không thấy
 * tài chính gửi lên thì TỪ CHỐI (403) chứ không lặng lẽ bỏ qua — họ không được biết lẫn đổi giá vốn.
 */
export function planGroupEdit(
  current: GroupCurrentRow[],
  body: unknown,
  opts: { allowCost: boolean }
): GroupEditPlan {
  const b = obj(body);
  const productName = typeof b.productName === "string" ? b.productName.trim() : "";
  if (!productName) throw new ProductGroupEditError("Nhập tên sản phẩm.");
  if (productName.length > MANUAL_LIMITS.titleMax) {
    throw new ProductGroupEditError(`Tên sản phẩm dài quá ${MANUAL_LIMITS.titleMax} ký tự.`);
  }

  const byId = new Map(current.map((c) => [c.id, c]));
  const patches = new Map<string, Record<string, unknown>>();
  for (const raw of Array.isArray(b.variants) ? b.variants : []) {
    const r = obj(raw);
    const id = typeof r.id === "string" ? r.id : "";
    if (!byId.has(id)) {
      throw new ProductGroupEditError("Sản phẩm vừa thay đổi ở nơi khác — tải lại trang rồi sửa tiếp.", 409);
    }
    if (patches.has(id)) throw new ProductGroupEditError("Một phân loại bị gửi hai lần — tải lại trang rồi thử lại.");
    patches.set(id, r);
  }

  // Bản SAU SỬA của các dòng đang có + phần thật sự đổi.
  const updates: RowUpdate[] = [];
  const costs: GroupEditPlan["costs"] = [];
  const finalRows: { label: string; skuCode: string; variantName: string | null; skuChanged: boolean; variantChanged: boolean }[] = [];
  for (const c of current) {
    const p = patches.get(c.id);
    const u: RowUpdate = { id: c.id };
    let skuCode = c.skuCode;
    let variantName = c.variantName;
    if (p?.skuCode !== undefined) {
      const typed = typeof p.skuCode === "string" ? p.skuCode.trim().toUpperCase() : "";
      // Gửi lại đúng mã đang có (kể cả mã cũ ngoài tập ký tự) = không đổi, không kiểm.
      if (typed !== c.skuCode.toUpperCase()) {
        skuCode = parseNewSku(p.skuCode, `SKU ${c.skuCode}`);
        u.skuCode = skuCode;
      }
    }
    if (p?.variantName !== undefined) {
      const v = parseVariant(p.variantName);
      if (v !== c.variantName) {
        variantName = v;
        u.variantName = v;
      }
    }
    if (p?.sellingPrice !== undefined) {
      const price = parsePrice(p.sellingPrice, `Giá bán của ${c.skuCode}`);
      if (price !== c.sellingPrice) u.sellingPrice = price;
    }
    if (p?.costPrice !== undefined) {
      if (!opts.allowCost) throw new ProductGroupEditError("Tài khoản không được sửa giá vốn.", 403);
      const cost = parsePrice(p.costPrice, `Giá vốn của ${c.skuCode}`);
      if (cost !== c.costPrice) costs.push({ productId: c.id, cost });
    }
    if (u.skuCode !== undefined || u.variantName !== undefined || u.sellingPrice !== undefined) updates.push(u);
    finalRows.push({
      label: `SKU ${skuCode}`,
      skuCode,
      variantName,
      skuChanged: u.skuCode !== undefined,
      variantChanged: u.variantName !== undefined,
    });
  }

  const addedRaw = Array.isArray(b.added) ? b.added : [];
  if (addedRaw.length > GROUP_ADD_MAX) {
    throw new ProductGroupEditError(`Mỗi lần lưu thêm tối đa ${GROUP_ADD_MAX} phân loại.`);
  }
  const added: RowAdd[] = addedRaw.map((raw, i) => {
    const r = obj(raw);
    const label = `Phân loại mới thứ ${i + 1}`;
    const skuCode = parseNewSku(r.skuCode, label);
    const stockRaw = r.stock === undefined || r.stock === null || r.stock === "" ? 0 : Number(r.stock);
    if (!Number.isInteger(stockRaw) || stockRaw < 0 || stockRaw > STOCK_MAX) {
      throw new ProductGroupEditError(`Tồn ban đầu của ${skuCode} phải là số nguyên không âm.`);
    }
    const costGiven = r.costPrice !== undefined && r.costPrice !== null && r.costPrice !== "";
    const row: RowAdd = {
      skuCode,
      variantName: parseVariant(r.variantName),
      sellingPrice: parsePrice(r.sellingPrice ?? 0, `Giá bán của ${skuCode}`),
      // Người không thấy tài chính không được đặt giá vốn — như lúc tạo sản phẩm.
      costPrice: opts.allowCost && costGiven ? parsePrice(r.costPrice, `Giá vốn của ${skuCode}`) : 0,
      stock: stockRaw,
    };
    finalRows.push({ label: `SKU ${skuCode}`, skuCode, variantName: row.variantName, skuChanged: true, variantChanged: true });
    return row;
  });

  // Mẫu từ 2 dòng trở lên: dòng nào cũng phải có phân loại (dòng trống rơi khỏi mẫu vì khóa gom NULL).
  if (finalRows.length >= 2) {
    const bare = finalRows.find((r) => !r.variantName);
    if (bare) {
      throw new ProductGroupEditError(
        `Sản phẩm có từ 2 phân loại thì phân loại nào cũng phải có tên — ${bare.label} đang để trống.`
      );
    }
  }
  // Trùng tên phân loại / trùng mã trong mẫu — chỉ bắt ở dòng VỪA ĐỔI hoặc MỚI THÊM (dữ liệu cũ kéo
  // từ sàn có thể đã trùng sẵn; không bắt khách dọn hết mới cho lưu việc khác).
  const count = (key: (r: (typeof finalRows)[number]) => string) => {
    const m = new Map<string, number>();
    for (const r of finalRows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
    return m;
  };
  const variantKey = (r: (typeof finalRows)[number]) => (r.variantName ?? "").toLowerCase();
  const skuKey = (r: (typeof finalRows)[number]) => r.skuCode.toUpperCase();
  const variantCount = count(variantKey);
  const skuCount = count(skuKey);
  for (const r of finalRows) {
    if (r.skuChanged && (skuCount.get(skuKey(r)) ?? 0) > 1) {
      throw new ProductGroupEditError(`Mã SKU "${r.skuCode}" bị trùng giữa các phân loại — mỗi phân loại một mã riêng.`);
    }
    if (r.variantChanged && r.variantName && (variantCount.get(variantKey(r)) ?? 0) > 1) {
      throw new ProductGroupEditError(`Phân loại "${r.variantName}" bị trùng trong sản phẩm này.`);
    }
  }

  // Cả mẫu chung một khóa: mọi dòng có phân loại thì khóa = tên; sản phẩm đơn theo phân loại của chính nó.
  const groupKey = productGroupKey(productName, finalRows[0]?.variantName ?? null);
  const renameAll = current.some((c) => c.productName !== productName || c.groupKey !== groupKey);
  return {
    productName,
    groupKey,
    renameAll,
    updates,
    costs,
    ownCost: b.ownCost === "follow" ? "follow" : "keep",
    added,
    newSkuCodes: [...updates.flatMap((u) => (u.skuCode ? [u.skuCode] : [])), ...added.map((a) => a.skuCode)],
  };
}

// ---------------------------------------------------------------- Phần DB

export interface ProductGroupVariant {
  id: string;
  skuCode: string;
  barcode: string | null;
  variantName: string | null;
  sellingPrice: number;
  costPrice: number;
  quantityInStock: number;
  isActive: boolean;
  imageUrl: string | null;
  /** Số SKU sàn đang nối — đổi mã SKU của dòng này thì cảnh báo (liên kết giữ, mã lệch với sàn). */
  linkedChannels: number;
  /** Trong số đó, bao nhiêu SKU sàn đang có giá vốn RIÊNG của gian. */
  ownCostChannels: number;
  /**
   * Các SKU sàn có giá riêng đó — hộp sửa so với giá kho cũ / mới để biết có phải hỏi lại không
   * (giá riêng lệch cả hai). Route cắt khỏi dữ liệu với người không thấy tài chính.
   */
  ownCosts: { shopName: string; channelName: ChannelName; label: string; costPrice: number }[];
}

export interface ProductGroupDetail {
  /** Dòng khách bấm Sửa — hộp sửa đưa con trỏ tới dòng này. */
  anchorId: string;
  productName: string;
  imageUrl: string | null;
  variants: ProductGroupVariant[];
}

const DETAIL_SELECT = {
  id: true,
  skuCode: true,
  barcode: true,
  productName: true,
  variantName: true,
  groupKey: true,
  sellingPrice: true,
  costPrice: true,
  quantityInStock: true,
  isActive: true,
  imageUrl: true,
  _count: { select: { channelProducts: true } },
  // SKU sàn đang có giá riêng của gian (lib/cost-price effectiveSkuCost) — đếm + giá để hộp sửa hỏi lại khi lệch.
  channelProducts: {
    where: { costPrice: { gt: 0 } },
    select: {
      id: true,
      costPrice: true,
      channelSku: true,
      variantName: true,
      channel: { select: { shopName: true, channelName: true } },
    },
  },
} satisfies Prisma.ProductSelect;

type DetailRow = Prisma.ProductGetPayload<{ select: typeof DETAIL_SELECT }>;

/** Mọi dòng Product của mẫu chứa `productId` (sản phẩm đơn = chính nó). null = không thuộc shop. */
async function familyRows(ownerId: string, productId: string): Promise<DetailRow[] | null> {
  const anchor = await prisma.product.findFirst({
    where: { id: productId, userId: ownerId },
    select: { id: true, groupKey: true },
  });
  if (!anchor) return null;
  const rows = await prisma.product.findMany({
    where: anchor.groupKey ? { userId: ownerId, groupKey: anchor.groupKey } : { id: anchor.id },
    select: DETAIL_SELECT,
    take: GROUP_MAX_ROWS + 1,
  });
  if (rows.length > GROUP_MAX_ROWS) {
    throw new ProductGroupEditError(
      `Sản phẩm này có hơn ${GROUP_MAX_ROWS} phân loại — chưa sửa được trong một hộp. Báo support@hubsell.vn để được hỗ trợ.`,
      422
    );
  }
  // Cùng thứ tự với bảng Tổng kho: theo phân loại, số tự nhiên (S, M, L · 3-5kg < 11-13kg).
  const collator = new Intl.Collator("vi", { numeric: true, sensitivity: "base" });
  return rows.sort((a, b) => collator.compare(a.variantName ?? a.skuCode, b.variantName ?? b.skuCode));
}

function toDetail(anchorId: string, rows: DetailRow[]): ProductGroupDetail {
  const anchor = rows.find((r) => r.id === anchorId) ?? rows[0];
  return {
    anchorId,
    productName: anchor.productName,
    imageUrl: anchor.imageUrl ?? rows.find((r) => r.imageUrl)?.imageUrl ?? null,
    variants: rows.map((r) => ({
      id: r.id,
      skuCode: r.skuCode,
      barcode: r.barcode,
      variantName: r.variantName,
      sellingPrice: Number(r.sellingPrice),
      costPrice: Number(r.costPrice),
      quantityInStock: r.quantityInStock,
      isActive: r.isActive,
      imageUrl: r.imageUrl,
      linkedChannels: r._count.channelProducts,
      ownCostChannels: r.channelProducts.length,
      ownCosts: r.channelProducts.map((cp) => ({
        shopName: cp.channel.shopName,
        channelName: cp.channel.channelName,
        label: cp.variantName?.trim() || cp.channelSku,
        costPrice: Number(cp.costPrice ?? 0),
      })),
    })),
  };
}

export async function loadProductGroup(ownerId: string, productId: string): Promise<ProductGroupDetail | null> {
  const rows = await familyRows(ownerId, productId);
  return rows ? toDetail(productId, rows) : null;
}

/**
 * Mã SKU mới có đụng phần còn lại của Tổng kho không: trùng MÃ SKU của sản phẩm ngoài mẫu, hoặc trùng
 * MÃ VẠCH của một sản phẩm khác (ô quét nhận cả hai loại mã — trùng là quét ra hai sản phẩm; cùng luật
 * với ô sửa mã vạch). Mã trên gian KHÔNG chặn: đặt mã kho giống mã sàn chính là điều muốn có để Tự khớp.
 */
async function assertSkuCodesFree(ownerId: string, familyIds: string[], plan: GroupEditPlan): Promise<void> {
  if (plan.newSkuCodes.length === 0) return;
  const clashes = await prisma.product.findMany({
    where: {
      userId: ownerId,
      OR: [
        { id: { notIn: familyIds }, skuCode: { in: plan.newSkuCodes, mode: "insensitive" } },
        { barcode: { in: plan.newSkuCodes, mode: "insensitive" } },
      ],
    },
    select: { id: true, skuCode: true, barcode: true },
  });
  const takerOf = new Map(plan.updates.flatMap((u) => (u.skuCode ? [[u.skuCode, u.id] as const] : [])));
  for (const c of clashes) {
    const asSku = plan.newSkuCodes.find((s) => s === c.skuCode.toUpperCase());
    if (asSku && !familyIds.includes(c.id)) {
      throw new ProductGroupEditError(`Mã SKU "${asSku}" đã có trong Tổng kho — đặt mã khác.`, 409);
    }
    const asBarcode = plan.newSkuCodes.find((s) => s === (c.barcode ?? "").toUpperCase());
    // Mã SKU trùng mã vạch của CHÍNH dòng đó thì quét vẫn ra một sản phẩm — cho qua.
    if (asBarcode && takerOf.get(asBarcode) !== c.id) {
      throw new ProductGroupEditError(
        `"${asBarcode}" đang là mã vạch của SKU ${c.skuCode} — đặt trùng thì quét sẽ ra hai sản phẩm.`,
        409
      );
    }
  }
}

/** Mẫu sau sửa + số dòng đơn cũ (đang giá vốn 0) vừa nhận giá vốn nhờ lượt đổi giá này. */
export interface ProductGroupSaveResult extends ProductGroupDetail {
  backfilledOrderLines: number;
  /** Số SKU sàn đã nối vừa bỏ giá riêng để theo giá kho mới / số SKU sàn còn giữ giá riêng. */
  followedSkus: number;
  keptOwnSkus: number;
}

/**
 * Lưu trọn gói một lần sửa mẫu. Thứ tự trong giao dịch: (1) tên + khóa gom cho cả mẫu, (2) từng dòng
 * có đổi, (3) giá vốn có đổi + SKU sàn đã nối theo giá mới + vá đơn cũ còn 0, (4) phân loại mới + tồn ban đầu qua sổ kho.
 */
export async function saveProductGroup(input: {
  ownerId: string;
  actorId: string;
  productId: string;
  body: unknown;
  allowCost: boolean;
}): Promise<ProductGroupSaveResult | null> {
  const { ownerId, productId } = input;
  const rows = await familyRows(ownerId, productId);
  if (!rows) return null;
  const familyIds = rows.map((r) => r.id);
  const plan = planGroupEdit(
    rows.map((r) => ({
      id: r.id,
      skuCode: r.skuCode,
      productName: r.productName,
      variantName: r.variantName,
      groupKey: r.groupKey,
      sellingPrice: Number(r.sellingPrice),
      costPrice: Number(r.costPrice),
    })),
    input.body,
    { allowCost: input.allowCost }
  );

  await assertSkuCodesFree(ownerId, familyIds, plan);

  // Khóa gom mới trùng một MẪU KHÁC = hai sản phẩm lặng lẽ gộp làm một, sau đó không tách lại được
  // bằng hộp này (đổi tên là đổi cả khối đã gộp) → chặn hẳn, không chỉ cảnh báo.
  const oldKey = rows[0].groupKey;
  if (plan.groupKey && plan.groupKey !== oldKey) {
    const other = await prisma.product.findFirst({
      where: { userId: ownerId, groupKey: plan.groupKey, id: { notIn: familyIds } },
      select: { skuCode: true },
    });
    if (other) {
      throw new ProductGroupEditError(
        `Tổng kho đã có một sản phẩm khác tên "${plan.productName}" (SKU ${other.skuCode}) — lưu thì hai sản phẩm bị gộp làm một. Đặt tên khác.`,
        409
      );
    }
  }

  const groupImage = rows.find((r) => r.imageUrl)?.imageUrl ?? null;
  // Đổi mã nối đuôi / đổi chéo trong mẫu (A lấy mã B đang giữ, B sang mã khác): ràng buộc duy nhất kiểm
  // từng câu lệnh, nên dòng ĐANG GIỮ một mã có dòng khác muốn lấy phải nhả ra mã tạm trước.
  const wantedCodes = new Set(plan.updates.flatMap((u) => (u.skuCode ? [u.skuCode] : [])));
  const needsTemp = rows.filter(
    (r) => wantedCodes.has(r.skuCode.toUpperCase()) && plan.updates.some((u) => u.id === r.id && u.skuCode)
  );

  let backfilledOrderLines = 0;
  let followedSkus = 0;
  let keptOwnSkus = 0;
  try {
    await prisma.$transaction(
      async (tx) => {
        if (plan.renameAll) {
          await tx.product.updateMany({
            where: { userId: ownerId, id: { in: familyIds } },
            data: { productName: plan.productName, groupKey: plan.groupKey },
          });
        }
        for (const r of needsTemp) {
          await tx.product.update({ where: { id: r.id }, data: { skuCode: `~${r.id}` } });
        }
        for (const u of plan.updates) {
          await tx.product.update({
            where: { id: u.id },
            data: {
              ...(u.skuCode !== undefined ? { skuCode: u.skuCode } : {}),
              ...(u.variantName !== undefined ? { variantName: u.variantName } : {}),
              ...(u.sellingPrice !== undefined ? { sellingPrice: new Prisma.Decimal(u.sellingPrice) } : {}),
            },
          });
        }
        if (plan.costs.length > 0) {
          const cost = await applyCostPricesIn(tx, plan.costs, ownerId, { ownCost: plan.ownCost });
          backfilledOrderLines = cost.backfilledOrderLines;
          followedSkus = cost.followedSkus;
          keptOwnSkus = cost.keptOwnSkus;
        }
        for (const a of plan.added) {
          // Mã vạch quản lý: DB tự sinh (DEFAULT của cột) — không truyền.
          const created = await tx.product.create({
            data: {
              userId: ownerId,
              skuCode: a.skuCode,
              productName: plan.productName,
              variantName: a.variantName,
              groupKey: plan.groupKey,
              costPrice: new Prisma.Decimal(a.costPrice),
              sellingPrice: new Prisma.Decimal(a.sellingPrice),
              quantityInStock: 0,
              imageUrl: groupImage,
            },
            select: { id: true },
          });
          if (a.stock > 0) {
            await applyStockDelta(tx, {
              productId: created.id,
              delta: a.stock,
              type: InventoryLogType.IMPORT,
              reason: "Tồn ban đầu khi thêm phân loại",
              actorId: input.actorId,
            });
          }
        }
      },
      // Có đổi giá vốn thì kèm một câu vá đơn cũ — shop nhiều đơn cần trần rộng như trang Cấu hình Giá vốn.
      plan.costs.length > 0 ? COST_TX_OPTIONS : { timeout: 30_000 }
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new ProductGroupEditError("Mã SKU vừa được dùng cho một sản phẩm khác — tải lại trang rồi thử lại.", 409);
    }
    throw err;
  }

  // Bộ đệm biên lãi của Trợ lý quảng cáo đọc giá vốn — xóa sau khi giao dịch đã chốt.
  if (plan.costs.length > 0) await invalidateOwnerCostCaches(ownerId);

  console.log(
    `[product-edit] shop ${ownerId} sửa mẫu "${plan.productName}" (${familyIds.length} SKU): ` +
      `${plan.renameAll ? "đổi tên/khóa gom, " : ""}${plan.updates.length} dòng đổi` +
      `${plan.updates.some((u) => u.skuCode) ? ` (đổi mã: ${plan.updates.filter((u) => u.skuCode).map((u) => u.skuCode).join(", ")})` : ""}` +
      `, thêm ${plan.added.length} phân loại${plan.added.length ? ` (${plan.added.map((a) => a.skuCode).join(", ")})` : ""}` +
      `${plan.costs.length ? `, đổi giá vốn ${plan.costs.length} SKU (vá ${backfilledOrderLines} dòng đơn cũ còn 0; ${followedSkus} SKU sàn theo giá mới, ${keptOwnSkus} giữ giá riêng — ${plan.ownCost})` : ""}`
  );
  const detail = await loadProductGroup(ownerId, productId);
  return detail && { ...detail, backfilledOrderLines, followedSkus, keptOwnSkus };
}
