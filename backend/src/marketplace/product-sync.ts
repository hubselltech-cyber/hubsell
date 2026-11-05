// ============================================================
// ĐỒNG BỘ SẢN PHẨM — TẦNG KHO NỘI BỘ (trung lập sàn).
//
// Nhận sản phẩm ĐÃ CHUẨN HOÁ từ adapter rồi upsert vào bảng đệm ChannelProduct.
// Tầng này KHÔNG biết gì về Shopee/TikTok — chỉ làm việc với dữ liệu chuẩn.
//
// Nguyên tắc bất di bất dịch (giữ từ luồng cũ):
//   - TUYỆT ĐỐI không đụng `productId` (liên kết do người dùng cấu hình).
//   - TUYỆT ĐỐI không GHI ĐÈ giá vốn chủ shop đã nhập. Ngoại lệ duy nhất: SKU
//     VỪA TẠO MỚI, còn trống giá, được tự điền theo bảng giá tự nhập / SKU trùng
//     mã ở gian khác của chính chủ shop (lib/cost-mapping.ts, 17/09).
//   - SKU không còn thấy trên sàn → đánh DELISTED (giữ lịch sử, không xoá).
//
// Từ 15/10/2026 (sự cố Hi.Bé — xem marketplace/sku-key.ts):
//   - DANH TÍNH dòng = `externalId` (id phân loại lá phía sàn). Khóa `channelSku`
//     là khóa hiển thị, duy nhất trong gian; mã trùng được thêm đuôi tên phân loại.
//   - Dòng cũ có cùng externalId mà khóa khác (đổi tên phân loại, hoặc dòng gộp
//     cũ "LT075-HONG" nay thành "LT075-HONG (Hồng, 3-5kg)") → ĐỔI KHÓA tại chỗ,
//     giữ nguyên liên kết kho + giá vốn thay vì tạo dòng mới + gỡ dòng cũ.
//
// Từ 05/11/2026 (lát 3.9 GĐ3 — anh Trung 03/11: "mỗi lần kéo lại phải kéo lại hết thì
// quá gãy"; Hy Korea Shopee 38.889 dòng, +0 mới, 38.889 UPDATE, khoảng 19 phút):
//   - CHỈ GHI DÒNG CÓ KHÁC BIỆT. Dòng sàn trả về giống hệt dòng đang lưu thì không có
//     lệnh UPDATE nào (trước đây mọi dòng bị ghi `lastSyncedAt` mỗi lượt). Hệ quả:
//     `lastSyncedAt` nay là "lần cuối dòng ĐỔI theo sàn"; "lần cuối kéo" xem ở
//     Channel.lastProductSyncAt.
//   - HAI KIỂU LƯỢT (marketplace/catalog-sync-plan.ts): TOÀN BỘ và TĂNG DẦN (adapter chỉ
//     trả sản phẩm sàn báo đổi từ mốc). Mốc chỉ tiến khi lượt đọc đủ.
//   - BẤT BIẾN: lượt tăng dần TUYỆT ĐỐI không đánh DELISTED hay tự "Ngừng bán" SKU VẮNG
//     MẶT — vắng mặt ở lượt tăng dần chỉ có nghĩa là "không đổi". Chỉ lượt toàn bộ đọc
//     đủ mới được gỡ. (Dòng sàn TRẢ VỀ kèm trạng thái đã gỡ thì vẫn ghi DELISTED như cũ.)
//   - Lượt toàn bộ có mốc đo ĐỐI CHIẾU: dòng nào đổi mà lượt tăng dần sẽ không thấy
//     (sàn không báo đổi trong cửa sổ) → log, để biết có tin được lượt tăng dần không.
// ============================================================

import type { Channel } from "@prisma/client";
import { ChannelProductStatus, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { autoFillCostForNewSkus } from "../lib/cost-mapping";
import {
  CATALOG_PLAN_REASON_LABEL,
  incrementalSettingFor,
  nextCatalogMarks,
  planCatalogSync,
  type CatalogMarks,
  type IncrementalSetting,
} from "./catalog-sync-plan";
import { getProductAdapter } from "./registry";
import { baseSkuOf, leafIdOf, normalizeVariantName, resolveChannelSkuKeys, suffixedSku } from "./sku-key";
import type { NormalizedChannelProduct } from "./types";

export interface ProductSyncOptions {
  /** true = khách bấm nút (lượt tăng dần cho nhanh kể cả khi đã đến hạn kéo toàn bộ). */
  requested?: boolean;
  /** Ép cờ mở tăng dần (test / script đo). Mặc định đọc env theo gian. */
  setting?: IncrementalSetting;
  /** Giờ bắt đầu lượt (test). */
  now?: Date;
}

/** Đo đối chiếu ở lượt TOÀN BỘ có mốc: lượt tăng dần từ `since` sẽ thấy / sót những dòng nào. */
export interface ShadowReport {
  since: Date;
  /** Số dòng lượt toàn bộ thấy khác DB (ghi đè + tạo mới). */
  changedRows: number;
  /** Trong đó: sản phẩm cha nằm TRONG cửa sổ tăng dần (lượt tăng dần cũng sẽ thấy). */
  covered: number;
  /** Nằm NGOÀI cửa sổ — lượt tăng dần sẽ sót cho tới lượt toàn bộ kế. */
  missed: number;
  /** Sàn không trả thời điểm cập nhật → không kết luận được. */
  unknown: number;
  /** Phân loại các dòng sót theo thứ đã đổi (một dòng đổi nhiều thứ tính vào nhiều ô). */
  missedBy: { created: number; stock: number; price: number; status: number; other: number };
}

export interface ProductSyncResult {
  scanned: number; // số dòng SKU sàn adapter trả về
  created: number; // số ChannelProduct tạo mới
  updated: number; // số ChannelProduct THỰC SỰ được ghi vì khác dữ liệu sàn
  /** Số dòng sàn trả về giống hệt dòng đang lưu — không có lệnh ghi nào. */
  unchanged: number;
  delisted: number; // số SKU cũ không còn → đánh DELISTED
  costAutoFilled: number; // số SKU mới được tự điền giá vốn theo mã
  /** Số dòng đổi khóa hiển thị theo externalId (đuôi phân loại / đổi tên). */
  renamed: number;
  /** Số SKU kho tự chuyển "Ngừng bán" vì mọi liên kết sàn đều đã gỡ (22/10/2026). */
  deactivated: number;
  /** false = adapter chạm chốt chặn phân trang / sàn chậm, lượt đọc CHƯA đủ — không đánh DELISTED, mốc không tiến. */
  complete: boolean;
  /** Kiểu lượt đã chạy. "incremental" = danh sách chỉ gồm phần thay đổi → không bao giờ gỡ theo vắng mặt. */
  mode: "full" | "incremental";
  /** Vì sao lượt này kéo toàn bộ (nhãn tiếng Việt); null ở lượt tăng dần. */
  fullReason: string | null;
  /** Lượt tăng dần đọc từ mốc này (đã lùi chồng lấn); null ở lượt toàn bộ. */
  since: Date | null;
  startedAt: Date;
  /** Mốc cần ghi lên Channel sau lượt này ({} = giữ nguyên mốc cũ). */
  marks: CatalogMarks;
  /** Số lệnh gọi sàn (adapter không đếm = null). */
  apiCalls: number | null;
  /** Lượt tăng dần: số dòng sàn trả về mà thời điểm cập nhật CŨ hơn mốc (sàn bỏ qua bộ lọc?). */
  outsideWindow: number;
  shadow: ShadowReport | null;
}

interface ExistingRow {
  id: string;
  channelSku: string;
  externalId: string | null;
  variantName: string | null;
  status: ChannelProductStatus;
  productName: string;
  price: number;
  imageUrl: string | null;
  itemSku: string | null;
  channelStock: number | null;
  channelStockLocationId: string | null;
}

const ROW_SELECT = {
  id: true,
  channelSku: true,
  externalId: true,
  variantName: true,
  status: true,
  productName: true,
  price: true,
  imageUrl: true,
  itemSku: true,
  channelStock: true,
  channelStockLocationId: true,
} satisfies Prisma.ChannelProductSelect;

type RawRow = Prisma.ChannelProductGetPayload<{ select: typeof ROW_SELECT }>;
const toRow = (r: RawRow): ExistingRow => ({ ...r, price: Number(r.price) });

/**
 * Chọn dòng cũ đại diện cho một externalId khi DB lỡ có nhiều dòng cùng id sàn
 * (người bán từng đổi model_sku: dòng cũ DELISTED + dòng mới cùng model). Ưu
 * tiên dòng đang mang đúng khóa mới, rồi dòng ACTIVE, rồi dòng đầu.
 */
export function pickRowForExternalId<T extends { channelSku: string; status: ChannelProductStatus }>(
  rows: T[],
  key: string
): T {
  return rows.find((r) => r.channelSku === key) ?? rows.find((r) => r.status === "ACTIVE") ?? rows[0];
}

/** Dữ liệu một dòng sàn sau chuẩn hoá, đúng các cột sẽ so và ghi. */
export interface SyncRowData {
  productName: string;
  price: number;
  externalId: string | null;
  /** null = adapter không đọc được → giữ giá trị đang lưu. */
  imageUrl: string | null;
  /** null = adapter không đọc được → giữ giá trị đang lưu. */
  variantName: string | null;
  itemSku: string | null;
  /** null = sàn không trả số → giữ giá trị đang lưu (không có nghĩa là hết hàng). */
  channelStock: number | null;
  channelStockLocationId: string | null;
  status: ChannelProductStatus;
}

export type RowPatch = Partial<SyncRowData> & { channelSku?: string };

const money = (n: number) => Math.round(n * 100);

/**
 * So dòng sàn với dòng đang lưu → chỉ các cột KHÁC (null = không khác gì, không ghi). Hàm thuần.
 * Ba cột "null = giữ nguyên" (ảnh, tên phân loại, tồn) không bao giờ ghi đè bằng null.
 */
export function diffChannelProductRow(
  row: Omit<ExistingRow, "id">,
  data: SyncRowData,
  newKey?: string
): RowPatch | null {
  const patch: RowPatch = {};
  if (data.productName !== row.productName) patch.productName = data.productName;
  if (money(data.price) !== money(row.price)) patch.price = data.price;
  if (data.externalId !== row.externalId) patch.externalId = data.externalId;
  if (data.imageUrl !== null && data.imageUrl !== row.imageUrl) patch.imageUrl = data.imageUrl;
  if (data.variantName !== null && data.variantName !== row.variantName) patch.variantName = data.variantName;
  if (data.itemSku !== row.itemSku) patch.itemSku = data.itemSku;
  if (data.channelStock !== null && data.channelStock !== row.channelStock) patch.channelStock = data.channelStock;
  if (data.channelStockLocationId !== row.channelStockLocationId) {
    patch.channelStockLocationId = data.channelStockLocationId;
  }
  if (data.status !== row.status) patch.status = data.status;
  if (newKey && newKey !== row.channelSku) patch.channelSku = newKey;
  return Object.keys(patch).length > 0 ? patch : null;
}

/** Id sản phẩm CHA từ externalId "cha-lá" (Shopee item, TikTok product, Lazada item). */
export function parentIdOf(externalId: string): string {
  const i = externalId.indexOf("-");
  return i >= 0 ? externalId.slice(0, i) : externalId;
}

/**
 * LƯỢT TĂNG DẦN — dòng đang mang khóa CÓ ĐUÔI của cùng mã ("ABC (Đỏ)" / "ABC #123") mà lượt này chỉ thấy
 * một mình nó nên tính ra khóa trơn "ABC": GIỮ khóa có đuôi. Mã có trùng với sản phẩm khác hay không chỉ
 * lượt toàn bộ mới biết; đổi về khóa trơn ở đây có thể đụng khóa của sản phẩm không nằm trong lượt.
 */
export function keepsSuffixedKey(existingKey: string, rawSku: string, candidateKey: string): boolean {
  return candidateKey === rawSku && existingKey !== rawSku && baseSkuOf(existingKey) === rawSku;
}

/** Lô giá trị mỗi câu IN — hai danh sách một câu vẫn dưới xa trần 32.767 tham số của Postgres. */
const LOAD_BATCH = 2000;
/** Lượt tăng dần trả nhiều hơn số này thì nạp cả gian một lần (rẻ hơn hàng chục câu IN). Số tự chọn. */
const PARTIAL_LOAD_MAX = 5000;

async function loadAllRows(channelId: string): Promise<ExistingRow[]> {
  const rows = await prisma.channelProduct.findMany({ where: { channelId }, select: ROW_SELECT });
  return rows.map(toRow);
}

/** Chỉ các dòng dính tới lượt tăng dần: trùng externalId hoặc trùng khóa với danh sách đưa vào. */
async function loadRowsByIdentity(channelId: string, externalIds: string[], keys: string[]): Promise<ExistingRow[]> {
  const out = new Map<string, ExistingRow>();
  const steps = Math.max(Math.ceil(externalIds.length / LOAD_BATCH), Math.ceil(keys.length / LOAD_BATCH));
  for (let s = 0; s < steps; s++) {
    const ext = externalIds.slice(s * LOAD_BATCH, (s + 1) * LOAD_BATCH);
    const key = keys.slice(s * LOAD_BATCH, (s + 1) * LOAD_BATCH);
    const or: Prisma.ChannelProductWhereInput[] = [];
    if (ext.length) or.push({ externalId: { in: ext } });
    if (key.length) or.push({ channelSku: { in: key } });
    if (or.length === 0) continue;
    const rows = await prisma.channelProduct.findMany({ where: { channelId, OR: or }, select: ROW_SELECT });
    for (const r of rows) out.set(r.id, toRow(r));
  }
  return [...out.values()];
}

type Fetched = NormalizedChannelProduct & { rawSku: string };

/**
 * Đồng bộ sản phẩm của MỘT gian: lập kế hoạch (toàn bộ / tăng dần) → adapter kéo (đã chuẩn hoá) →
 * gán khóa duy nhất → ghi bảng đệm theo externalId (rồi mới tới khóa), CHỈ dòng có khác biệt.
 * KHÔNG tự ghi mốc lên Channel: trả `marks` để nơi gọi ghi cùng lịch kế (một lệnh UPDATE).
 */
export async function syncChannelProducts(
  channel: Channel,
  opts: ProductSyncOptions = {}
): Promise<ProductSyncResult> {
  const adapter = getProductAdapter(channel);
  const startedAt = opts.now ?? new Date();
  const plan = planCatalogSync({
    channelId: channel.id,
    supportsIncremental: adapter.supportsIncremental === true,
    setting: opts.setting ?? incrementalSettingFor(channel.id),
    watermark: channel.productSyncWatermark ?? null,
    fullSyncAt: channel.productFullSyncAt ?? null,
    requested: opts.requested === true,
    now: startedAt,
  });
  const shadowSince = plan.mode === "full" ? plan.shadowSince : null;
  const fetched = await adapter.fetchProducts(
    channel,
    plan.mode === "incremental" ? { since: plan.since } : shadowSince ? { shadowSince } : undefined
  );
  const { complete } = fetched;
  // Xin tăng dần HOẶC adapter báo danh sách chỉ gồm phần thay đổi → lượt tăng dần: không bao giờ gỡ
  // theo vắng mặt. (Xin tăng dần mà adapter tự lùi về toàn bộ cũng vẫn coi là tăng dần — thà gỡ muộn
  // ở lượt toàn bộ kế còn hơn gỡ nhầm vì một adapter quên gắn cờ.)
  const partial = plan.mode === "incremental" || fetched.incremental === true;
  const mode: "full" | "incremental" = partial ? "incremental" : "full";
  const since = plan.mode === "incremental" ? plan.since : null;
  const raw: Fetched[] = fetched.products.map((p) => ({ ...p, rawSku: p.channelSku }));
  const now = new Date();

  // Dòng đang lưu → tra theo externalId và theo khóa trong RAM. Lượt toàn bộ nạp cả gian (đã cần sẵn
  // cho bước DELISTED); lượt tăng dần chỉ nạp các dòng dính tới danh sách vừa kéo.
  const loadAll = !partial || raw.length > PARTIAL_LOAD_MAX;
  const batchExt = new Set<string>();
  for (const p of raw) if (p.externalId) batchExt.add(p.externalId);
  const existing: ExistingRow[] = loadAll
    ? await loadAllRows(channel.id)
    : await loadRowsByIdentity(channel.id, [...batchExt], [...new Set(raw.map((p) => p.rawSku))]);
  const byKey = new Map<string, ExistingRow>();
  const byExt = new Map<string, ExistingRow[]>();
  const index = (r: ExistingRow) => {
    byKey.set(r.channelSku, r);
    if (r.externalId) {
      const l = byExt.get(r.externalId) ?? [];
      if (!l.includes(r)) l.push(r);
      byExt.set(r.externalId, l);
    }
  };
  for (const r of existing) index(r);

  // Khóa duy nhất: mã trùng → đuôi tên phân loại. Adapter không đọc được tên
  // (TikTok lượt không bổ sung chi tiết) thì mượn tên đã lưu của đúng dòng đó.
  const { products, suffixed } = resolveChannelSkuKeys(raw, (p: Fetched) => {
    if (p.variantName) return p.variantName;
    const rows = p.externalId ? byExt.get(p.externalId) : undefined;
    return rows?.find((r) => r.variantName)?.variantName ?? null;
  });

  // Lượt tăng dần: khóa có đuôi vừa tính có thể đang thuộc một dòng chưa nạp → nạp thêm đúng các khóa đó.
  if (!loadAll) {
    const more = [...new Set(products.map((p) => p.channelSku))].filter((k) => !byKey.has(k));
    const loadedIds = new Set(existing.map((r) => r.id));
    for (const r of await loadRowsByIdentity(channel.id, [], more)) {
      if (loadedIds.has(r.id)) continue;
      existing.push(r);
      index(r);
    }
  }
  /** Khóa đã có dòng nào giữ chưa — lượt tăng dần hỏi thêm DB cho khóa chưa nạp. */
  const isKeyTaken = async (key: string): Promise<boolean> => {
    if (byKey.has(key)) return true;
    if (loadAll) return false;
    const hit = await prisma.channelProduct.findUnique({
      where: { channelId_channelSku: { channelId: channel.id, channelSku: key } },
      select: ROW_SELECT,
    });
    if (!hit) return false;
    const r = toRow(hit);
    existing.push(r);
    index(r);
    return true;
  };
  const batchParents = new Set<string>();
  for (const e of batchExt) batchParents.add(parentIdOf(e));

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let renamed = 0;
  let renameSkipped = 0;
  let keptSuffixed = 0;
  let outsideWindow = 0;
  const createdIds: string[] = [];
  const seenIds = new Set<string>();
  const sinceSec = since ? Math.floor(since.getTime() / 1000) : null;
  const shadowSec = shadowSince ? Math.floor(shadowSince.getTime() / 1000) : null;
  const shadow: ShadowReport | null = shadowSince
    ? {
        since: shadowSince,
        changedRows: 0,
        covered: 0,
        missed: 0,
        unknown: 0,
        missedBy: { created: 0, stock: 0, price: 0, status: 0, other: 0 },
      }
    : null;
  /** Ghi một dòng đổi vào sổ đối chiếu: lượt tăng dần có thấy sản phẩm cha của dòng này không. */
  const noteShadow = (p: Fetched, patch: RowPatch | "created") => {
    if (!shadow || shadowSec === null) return;
    shadow.changedRows++;
    const inWindow =
      p.inIncrementalWindow ?? (typeof p.sourceUpdatedAt === "number" ? p.sourceUpdatedAt >= shadowSec : null);
    if (inWindow === null) shadow.unknown++;
    else if (inWindow) shadow.covered++;
    else {
      shadow.missed++;
      if (patch === "created") shadow.missedBy.created++;
      else {
        const { channelStock, channelStockLocationId, price, status, ...rest } = patch;
        if (channelStock !== undefined || channelStockLocationId !== undefined) shadow.missedBy.stock++;
        if (price !== undefined) shadow.missedBy.price++;
        if (status !== undefined) shadow.missedBy.status++;
        if (Object.keys(rest).length > 0) shadow.missedBy.other++;
      }
    }
  };

  for (const p of products) {
    if (sinceSec !== null && typeof p.sourceUpdatedAt === "number" && p.sourceUpdatedAt < sinceSec) outsideWindow++;
    const data: SyncRowData = {
      productName: p.productName,
      price: p.price,
      externalId: p.externalId,
      // Ảnh/phân loại: adapter không đọc được (TikTok products/search không trả
      // ảnh, chỉ chi tiết từng SP mới có) → giữ giá trị cũ thay vì xóa trắng.
      imageUrl: p.imageUrl,
      variantName: p.variantName,
      itemSku: p.itemSku,
      // Tồn sàn chỉ ghi đè khi adapter ĐỌC ĐƯỢC số — null giữ nguyên giá trị cũ
      // (sàn không trả số không có nghĩa là hết hàng).
      channelStock: p.channelStock,
      channelStockLocationId: p.channelStockLocationId,
      status: p.status === "ACTIVE" ? ChannelProductStatus.ACTIVE : ChannelProductStatus.DELISTED,
    };

    // 1) Theo externalId (danh tính thật). 2) Theo khóa (dòng cũ chưa có externalId).
    const extRows = p.externalId ? byExt.get(p.externalId) : undefined;
    let row = extRows?.length ? pickRowForExternalId(extRows, p.channelSku) : undefined;
    let key = p.channelSku;
    let newKey: string | undefined;
    if (row && row.channelSku !== key) {
      if (partial && keepsSuffixedKey(row.channelSku, p.rawSku, key)) {
        keptSuffixed++;
      } else {
        const clash = byKey.get(key);
        if (clash && clash.id !== row.id) {
          // Khóa mới đang thuộc một dòng KHÁC (id sàn khác) — không đổi, giữ khóa
          // cũ để không phá unique; cập nhật dữ liệu như thường và đếm để soi log.
          renameSkipped++;
        } else {
          newKey = key;
        }
      }
    }
    if (!row) {
      const holder = byKey.get(key);
      if (holder) {
        // Dùng lại dòng đang giữ khóa (giữ liên kết kho + giá vốn) khi nó không mang danh tính của một
        // phân loại KHÁC còn sống: dòng cũ chưa có id sàn; hoặc phân loại cũ của chính sản phẩm vừa đọc
        // (người bán xóa phân loại rồi tạo lại cùng mã). Dòng thuộc sản phẩm khác — lượt tăng dần không
        // đọc tới, hoặc lượt này có sản phẩm khác nhận nó theo id — thì KHÔNG chiếm: tạo dòng mới.
        const reusable =
          !p.externalId ||
          !holder.externalId ||
          (!batchExt.has(holder.externalId) && (!partial || batchParents.has(parentIdOf(holder.externalId))));
        if (reusable) row = holder;
        else {
          const variant = normalizeVariantName(p.variantName);
          const leaf = leafIdOf(p.externalId);
          key = suffixedSku(p.rawSku, variant, leaf, false);
          if (key === p.channelSku || (await isKeyTaken(key))) key = suffixedSku(p.rawSku, variant, leaf, true);
          const base = key;
          for (let n = 2; await isKeyTaken(key); n++) key = `${base} #${n}`;
        }
      }
    }

    if (row) {
      // KHÔNG đụng productId — liên kết là của người dùng.
      const patch = diffChannelProductRow(row, data, newKey);
      if (patch) {
        await prisma.channelProduct.update({ where: { id: row.id }, data: { ...patch, lastSyncedAt: now } });
        updated++;
        noteShadow(p, patch);
        if (patch.channelSku) {
          byKey.delete(row.channelSku);
          byKey.set(patch.channelSku, row);
          renamed++;
        }
        if (patch.externalId) {
          const l = byExt.get(patch.externalId) ?? [];
          if (!l.includes(row)) l.push(row);
          byExt.set(patch.externalId, l);
        }
        Object.assign(row, patch);
      } else {
        unchanged++;
      }
      seenIds.add(row.id);
    } else {
      const made = await prisma.channelProduct.create({
        data: {
          channelId: channel.id,
          channelSku: key,
          productName: data.productName,
          price: data.price,
          externalId: data.externalId,
          ...(data.imageUrl !== null ? { imageUrl: data.imageUrl } : {}),
          ...(data.variantName !== null ? { variantName: data.variantName } : {}),
          itemSku: data.itemSku,
          ...(data.channelStock !== null ? { channelStock: data.channelStock } : {}),
          channelStockLocationId: data.channelStockLocationId,
          status: data.status,
          lastSyncedAt: now,
        },
        select: { id: true },
      });
      const fresh: ExistingRow = { ...data, id: made.id, channelSku: key };
      index(fresh);
      seenIds.add(made.id);
      createdIds.push(made.id);
      created++;
      noteShadow(p, "created");
    }
  }

  if (suffixed > 0 || renamed > 0 || renameSkipped > 0 || keptSuffixed > 0) {
    console.log(
      `[product-sync] gian ${channel.shopName} (${channel.id}): ${suffixed} dòng trùng mã được thêm đuôi phân loại, ` +
        `${renamed} dòng đổi khóa theo id sàn${renameSkipped ? `, ${renameSkipped} dòng KHÔNG đổi được vì khóa mới thuộc dòng khác` : ""}` +
        `${keptSuffixed ? `, ${keptSuffixed} dòng giữ khóa có đuôi (lượt tăng dần không xét trùng mã)` : ""}`
    );
  }

  // SKU cũ không còn trong danh mục sàn → đánh DELISTED (không xoá để giữ liên kết).
  // CHỈ làm khi lượt kéo TOÀN BỘ và ĐẦY ĐỦ: danh mục bị cắt ở chốt chặn phân trang thì SKU
  // vắng mặt chưa chắc đã gỡ — đánh DELISTED nhầm là gian đó ngừng được đẩy tồn
  // (enqueueStockPush chỉ nhặt ACTIVE) → bán vượt tồn (rà soát 29/09/2026). Lượt TĂNG DẦN thì SKU
  // vắng mặt chỉ có nghĩa là không đổi → TUYỆT ĐỐI không gỡ (05/11/2026).
  let delisted = 0;
  let deactivated = 0;
  if (mode === "full" && complete) {
    const gone = await delistUnseen(existing, seenIds);
    delisted = gone.count;
    // SKU kho mà MỌI liên kết sàn đều đã gỡ → tự chuyển "Ngừng bán" (22/10/2026,
    // khách: "mã không bán nữa thì đẩy trạng thái không hoạt động cho dễ kiểm").
    deactivated = await deactivateProductsWithoutActiveLinks(channel, gone.ids);
  } else if (!complete) {
    console.warn(
      `[product-sync] gian ${channel.shopName} (${channel.id}): lượt ${mode === "full" ? "toàn bộ" : "tăng dần"} CHƯA đủ (chạm chốt chặn phân trang hoặc sàn chậm, đọc được ${products.length} SKU) — ` +
        `${mode === "full" ? "bỏ qua bước đánh DELISTED, " : ""}mốc không tiến`
    );
  }

  if (shadow && shadow.changedRows > 0) {
    const m = shadow.missedBy;
    console.log(
      `[product-sync] ĐỐI CHIẾU TĂNG DẦN gian ${channel.shopName} (${channel.id}), cửa sổ từ ${shadow.since.toISOString()}: ` +
        `lượt toàn bộ thấy ${shadow.changedRows} dòng đổi — ${shadow.covered} trong cửa sổ, ${shadow.missed} NGOÀI cửa sổ ` +
        `(mới ${m.created}, tồn ${m.stock}, giá ${m.price}, trạng thái ${m.status}, khác ${m.other}), ${shadow.unknown} sàn không trả thời điểm; gỡ theo vắng mặt ${delisted}`
    );
  }

  // Tự điền giá vốn là tiện ích — hỏng thì danh mục vẫn phải đồng bộ xong.
  let costAutoFilled = 0;
  try {
    costAutoFilled = await autoFillCostForNewSkus(channel.userId, createdIds);
  } catch (err) {
    console.error(`[product-sync] tự điền giá vốn lỗi (gian ${channel.id}):`, err);
  }

  // Sàn chỉ bổ sung được ảnh cho một phần danh mục mỗi lượt (TikTok) → chạy nền
  // nốt phần còn thiếu, KHÔNG bắt chủ shop chờ. Hàm tự nuốt lỗi.
  void adapter.enrichMissing?.(channel);

  return {
    scanned: products.length,
    created,
    updated,
    unchanged,
    delisted,
    deactivated,
    costAutoFilled,
    renamed,
    complete,
    mode,
    fullReason: mode === "full" && plan.mode === "full" ? CATALOG_PLAN_REASON_LABEL[plan.reason] : null,
    since,
    startedAt,
    marks: nextCatalogMarks({ mode, complete, startedAt }),
    apiCalls: fetched.apiCalls ?? null,
    outsideWindow,
    shadow,
  };
}

/** Lô id mỗi lệnh UPDATE — dưới xa trần 32.767 tham số của Postgres. */
const DELIST_BATCH = 1000;

/**
 * Đánh DELISTED các dòng đang ACTIVE của gian mà lượt kéo KHÔNG chạm tới
 * (`seenIds`). So khớp trong bộ nhớ rồi cập nhật theo lô id: `channelSku notIn
 * [hàng chục nghìn mã]` vượt trần tham số của Postgres ở gian danh mục lớn.
 * CHỈ gọi từ lượt toàn bộ đọc đủ, với `existing` là MỌI dòng của gian.
 */
async function delistUnseen(
  existing: ExistingRow[],
  seenIds: Set<string>
): Promise<{ count: number; ids: string[] }> {
  const goneIds = existing
    .filter((r) => r.status === ChannelProductStatus.ACTIVE && !seenIds.has(r.id))
    .map((r) => r.id);
  let count = 0;
  for (let i = 0; i < goneIds.length; i += DELIST_BATCH) {
    const r = await prisma.channelProduct.updateMany({
      where: {
        id: { in: goneIds.slice(i, i + DELIST_BATCH) },
        status: ChannelProductStatus.ACTIVE,
      },
      data: { status: ChannelProductStatus.DELISTED },
    });
    count += r.count;
  }
  return { count, ids: goneIds };
}

/**
 * TỰ "NGỪNG BÁN" SKU KHO KHI SÀN GỠ HẾT (22/10/2026). Chỉ xét SKU kho đang nối
 * với các dòng VỪA bị đánh DELISTED ở lượt này; SKU nào vẫn còn ≥ 1 liên kết
 * ACTIVE (gian khác còn bán) thì giữ nguyên. Chỉ chuyển isActive → false, KHÔNG
 * đụng tồn / liên kết / đơn cũ (chip "Ngừng bán" + nút Bán lại có sẵn trên bảng).
 * Khách tự bán lại được; sàn đăng lại thì KHÔNG tự bật — tránh ghi đè ý khách.
 */
async function deactivateProductsWithoutActiveLinks(
  channel: Channel,
  goneChannelProductIds: string[]
): Promise<number> {
  if (goneChannelProductIds.length === 0) return 0;
  const productIds = new Set<string>();
  for (let i = 0; i < goneChannelProductIds.length; i += DELIST_BATCH) {
    const rows = await prisma.channelProduct.findMany({
      where: { id: { in: goneChannelProductIds.slice(i, i + DELIST_BATCH) }, productId: { not: null } },
      select: { productId: true },
    });
    for (const r of rows) if (r.productId) productIds.add(r.productId);
  }
  if (productIds.size === 0) return 0;

  let total = 0;
  const ids = [...productIds];
  for (let i = 0; i < ids.length; i += DELIST_BATCH) {
    const r = await prisma.product.updateMany({
      where: {
        id: { in: ids.slice(i, i + DELIST_BATCH) },
        userId: channel.userId,
        isActive: true,
        channelProducts: { none: { status: ChannelProductStatus.ACTIVE } },
      },
      data: { isActive: false },
    });
    total += r.count;
  }
  if (total > 0) {
    console.log(
      `[product-sync] gian ${channel.shopName} (${channel.id}): ${total} SKU kho tự chuyển Ngừng bán vì sàn đã gỡ hết phân loại/sản phẩm (khách bán lại được ở chip Ngừng bán)`
    );
  }
  return total;
}
