// ============================================================
// BÙ ID LÁ SÀN CHO DÒNG ĐƠN CŨ — Lát 2 (18/10/2026, docs/MO-HINH-CAY-SAN-PHAM-SAN.md mục 7)
//
// Dòng đơn tạo trước Lát 1a chỉ có chuỗi `channelSku`; mỗi lần mã đổi (đổi đuôi
// phân loại 15/10, seller đổi mã…) là mồ côi khỏi mọi phép gom theo sản phẩm.
// Lát này HỎI SÀN chi tiết từng đơn (≤ 50 đơn một lượt) để ghi `OrderItem.externalId`
// = id lá thật — không suy luận từ mã (anh Trung chốt 18/10), trừ gian không gọi
// được sàn (inferIdsByUniqueSku: mã ↔ đúng một lá).
//
// Luật khớp dòng sàn ↔ OrderItem (planLineIds, thuần):
//   · 1 ↔ 1          → externalId = id lá; channelSku = khóa hiện hành của lá nếu danh mục có.
//   · 1 OrderItem ↔ nhiều dòng sàn (trước 15/10 hai lá cùng mã bị gộp, số lượng cộng dồn):
//       cùng SPU → externalId = SPU (khuôn "item"), mã giữ nguyên; khác SPU → để NULL, đếm.
//   · không khớp / sàn không trả → để NULL, đếm.
//   GIỮ NGUYÊN costPriceAtSale, productId, số lượng, giá (bất biến B5 — snapshot là lịch sử).
//
// Phạm vi: gian ACTIVE Shopee/TikTok, đơn tạo trong BACKFILL_WINDOW_DAYS, phase
// "orphan" (mã không còn trong danh mục) trước rồi "all". Lazada chưa có id lá
// trên dòng đơn → không thuộc lát này.
// ============================================================

import { ChannelName, Prisma, type Channel } from "@prisma/client";
import { invalidateCostCaches } from "../lib/cost-cache-invalidation";
import { ledgerItemIdOf } from "../lib/order-ledger";
import { prisma } from "../lib/prisma";
import { timestampConst } from "./order-ledger";
import { lineKey, resolveOrderLineRows } from "../integrations/order-line-keys";
import { getOrderDetail as shopeeGetOrderDetail } from "../integrations/shopee/client";
import { aggregateShopeeItems, getValidShopeeAccessToken } from "../integrations/shopee/service";
import { getOrderDetail as tiktokGetOrderDetail } from "../integrations/tiktok/client";
import { aggregateLineItems, getValidAccessToken as getValidTiktokAccessToken } from "../integrations/tiktok/service";

/** Cửa sổ đơn cần bù: 90 ngày phủ hòa vốn TikTok 60 ngày + biên lãi Shopee 30 ngày có dư (anh Trung chốt 18/10). */
export const BACKFILL_WINDOW_DAYS = 90;
/** Mỗi lượt gọi sàn tối đa 50 mã đơn (Shopee get_order_detail; TikTok GET /orders?ids=). */
export const BACKFILL_BATCH = 50;
/** Nghỉ giữa hai lượt gọi sàn: 2 giây = 0,5 lượt/giây — MẶC ĐỊNH TỰ CHỌN, thấp hơn nhiều mức khởi điểm "đọc batch 5–20/giây" TikTok công bố; Shopee không công bố. */
export const BACKFILL_CALL_GAP_MS = 2_000;
/** Trần lượt gọi một lượt chạy (một gian) để worker không ôm một gian quá lâu; gian lớn chạy tiếp ở lượt sau nhờ cursor. */
export const BACKFILL_MAX_CALLS_PER_RUN = 400;

export type BackfillPhase = "orphan" | "all" | "infer";

export interface PlatformLine {
  /** Mã thô của sàn (cùng hàm sinh khóa với luồng đồng bộ đơn). */
  channelSku: string;
  externalId: string | null;
}

export interface ExistingLine {
  id: string;
  channelSku: string;
  externalId: string | null;
}

export interface LinePlan {
  updates: { id: string; externalId: string; channelSku: string }[];
  linesSet: number;
  linesSpu: number;
  linesSkipped: number;
}

/**
 * Khớp dòng sàn với dòng đơn hiện có của MỘT đơn. `resolvedKeyOf(lineKey)` = khóa hiện hành của lá trong danh mục
 * (resolveOrderLineRows), undefined nếu danh mục chưa có lá. Thuần.
 */
export function planLineIds(
  items: ExistingLine[],
  lines: PlatformLine[],
  resolvedKeyOf: (key: string) => string | undefined
): LinePlan {
  const plan: LinePlan = { updates: [], linesSet: 0, linesSpu: 0, linesSkipped: 0 };
  const usable = lines.filter((l): l is PlatformLine & { externalId: string } => Boolean(l.externalId));
  for (const it of items) {
    if (it.externalId) continue; // đã có id — không chạm
    // Dòng cũ ghi mã thô của sàn; dòng tạo sau 15/10 không khớp id lúc tạo cũng ghi mã thô; hoặc khóa có đuôi của lá.
    const cands = usable.filter((l) => l.channelSku === it.channelSku || resolvedKeyOf(lineKey(l)) === it.channelSku);
    if (cands.length === 0) {
      plan.linesSkipped++;
      continue;
    }
    if (cands.length === 1) {
      const l = cands[0];
      plan.updates.push({ id: it.id, externalId: l.externalId, channelSku: resolvedKeyOf(lineKey(l)) ?? it.channelSku });
      plan.linesSet++;
      continue;
    }
    const spus = new Set(cands.map((l) => ledgerItemIdOf(l.externalId)));
    if (spus.size === 1) {
      const spu = [...spus][0];
      if (spu) {
        plan.updates.push({ id: it.id, externalId: spu, channelSku: it.channelSku });
        plan.linesSpu++;
        continue;
      }
    }
    plan.linesSkipped++;
  }
  return plan;
}

// ------------------------------------------------------------
// Nạp đơn cần bù + gọi sàn
// ------------------------------------------------------------

interface PendingOrder {
  id: string;
  orderCode: string;
  createdAt: Date;
}

const windowStart = () => new Date(Date.now() - BACKFILL_WINDOW_DAYS * 86_400_000);

/** Lô đơn kế tiếp của gian trong phase, đi lùi theo createdAt từ `cursorAt` (null = từ mới nhất). */
export async function nextPendingOrders(
  channelId: string,
  phase: "orphan" | "all",
  cursorAt: Date | null,
  limit: number = BACKFILL_BATCH
): Promise<PendingOrder[]> {
  const rows = await prisma.$queryRaw<PendingOrder[]>`
    SELECT o."id", o."orderCode", o."createdAt"
    FROM "Order" o
    WHERE o."channelId" = ${channelId}
      AND o."createdAt" >= ${timestampConst(windowStart())}
      ${cursorAt ? Prisma.sql`AND o."createdAt" < ${timestampConst(cursorAt)}` : Prisma.empty}
      AND EXISTS (
        SELECT 1 FROM "OrderItem" oi
        WHERE oi."orderId" = o."id" AND oi."externalId" IS NULL
          ${
            phase === "orphan"
              ? Prisma.sql`AND NOT EXISTS (SELECT 1 FROM "ChannelProduct" cp WHERE cp."channelId" = o."channelId" AND cp."channelSku" = oi."channelSku")`
              : Prisma.empty
          }
      )
    ORDER BY o."createdAt" DESC
    LIMIT ${limit}::int
  `;
  return rows;
}

/** Chi tiết dòng hàng của nhiều đơn từ sàn, theo mã đơn (orderCode). Lỗi ném ra nguyên vẹn. */
export async function fetchPlatformLines(channel: Channel, orderCodes: string[]): Promise<Map<string, PlatformLine[]>> {
  const out = new Map<string, PlatformLine[]>();
  if (orderCodes.length === 0) return out;
  if (channel.channelName === ChannelName.SHOPEE) {
    const { accessToken, shopId } = await getValidShopeeAccessToken(channel);
    for (const d of await shopeeGetOrderDetail(accessToken, shopId, orderCodes)) {
      out.set(d.order_sn, aggregateShopeeItems(d).map((l) => ({ channelSku: l.channelSku, externalId: l.externalId })));
    }
    return out;
  }
  if (channel.channelName === ChannelName.TIKTOK) {
    const { accessToken, shopCipher } = await getValidTiktokAccessToken(channel);
    for (const o of await tiktokGetOrderDetail({ accessToken, shopCipher, orderIds: orderCodes })) {
      out.set(o.id, aggregateLineItems(o).map((l) => ({ channelSku: l.channelSku, externalId: l.externalId })));
    }
    return out;
  }
  throw new Error(`Bù id lá: sàn ${channel.channelName} chưa hỗ trợ (dòng đơn không có id lá)`);
}

// ------------------------------------------------------------
// Bù một lô đơn + một gian
// ------------------------------------------------------------

export interface BackfillCounts {
  ordersDone: number;
  linesSet: number;
  linesSpu: number;
  linesSkipped: number;
  apiCalls: number;
}

const emptyCounts = (): BackfillCounts => ({ ordersDone: 0, linesSet: 0, linesSpu: 0, linesSkipped: 0, apiCalls: 0 });

/** Bù id cho một lô đơn đã có chi tiết sàn. Ghi từng dòng (trigger sổ cái đánh dấu đơn tính lại). */
export async function applyBackfillBatch(
  channelId: string,
  orders: PendingOrder[],
  platform: Map<string, PlatformLine[]>
): Promise<Omit<BackfillCounts, "apiCalls">> {
  const counts = { ordersDone: 0, linesSet: 0, linesSpu: 0, linesSkipped: 0 };
  const items = await prisma.orderItem.findMany({
    where: { orderId: { in: orders.map((o) => o.id) }, externalId: null },
    select: { id: true, orderId: true, channelSku: true, externalId: true },
  });
  const itemsByOrder = new Map<string, ExistingLine[]>();
  for (const it of items) {
    const list = itemsByOrder.get(it.orderId) ?? [];
    list.push(it);
    itemsByOrder.set(it.orderId, list);
  }
  // Tra danh mục MỘT lần cho mọi dòng sàn của lô (khóa hiện hành của lá).
  const allLines = [...platform.values()].flat();
  const resolved = await resolveOrderLineRows(prisma, channelId, allLines);
  const resolvedKeyOf = (key: string) => resolved.get(key)?.channelSku;

  for (const o of orders) {
    counts.ordersDone++;
    const existing = itemsByOrder.get(o.id) ?? [];
    const lines = platform.get(o.orderCode);
    if (!lines) {
      counts.linesSkipped += existing.length; // sàn không trả đơn
      continue;
    }
    const plan = planLineIds(existing, lines, resolvedKeyOf);
    counts.linesSet += plan.linesSet;
    counts.linesSpu += plan.linesSpu;
    counts.linesSkipped += plan.linesSkipped;
    for (const u of plan.updates) {
      await prisma.orderItem.update({ where: { id: u.id }, data: { externalId: u.externalId, channelSku: u.channelSku } });
    }
  }
  return counts;
}

export interface BackfillRunDeps {
  sleep: (ms: number) => Promise<void>;
  fetchLines: typeof fetchPlatformLines;
  maxCalls: number;
}

const defaultDeps: BackfillRunDeps = {
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  fetchLines: fetchPlatformLines,
  maxCalls: BACKFILL_MAX_CALLS_PER_RUN,
};

export interface BackfillRunResult extends BackfillCounts {
  /** Phase đang dở sau lượt này ("done" = cả orphan lẫn all đã hết). */
  phase: BackfillPhase | "done";
  cursorAt: Date | null;
}

/**
 * Chạy bù cho MỘT gian từ trạng thái (phase, cursorAt) cho tới khi hết đơn hoặc chạm trần lượt gọi. Trả trạng thái mới để
 * worker lưu; lỗi sàn / token ném ra để worker ghi lastError và thử lại sau. Nghỉ `BACKFILL_CALL_GAP_MS` giữa hai lượt gọi.
 */
export async function runChannelBackfill(
  channel: Channel,
  state: { phase: "orphan" | "all"; cursorAt: Date | null },
  deps: Partial<BackfillRunDeps> = {}
): Promise<BackfillRunResult> {
  const d = { ...defaultDeps, ...deps };
  const counts = emptyCounts();
  let phase: "orphan" | "all" = state.phase;
  let cursorAt = state.cursorAt;
  while (counts.apiCalls < d.maxCalls) {
    const orders = await nextPendingOrders(channel.id, phase, cursorAt);
    if (orders.length === 0) {
      if (phase === "orphan") {
        phase = "all";
        cursorAt = null;
        continue;
      }
      invalidateCostCaches([channel.id]);
      return { ...counts, phase: "done", cursorAt: null };
    }
    if (counts.apiCalls > 0) await d.sleep(BACKFILL_CALL_GAP_MS);
    const platform = await d.fetchLines(channel, orders.map((o) => o.orderCode));
    counts.apiCalls++;
    const c = await applyBackfillBatch(channel.id, orders, platform);
    counts.ordersDone += c.ordersDone;
    counts.linesSet += c.linesSet;
    counts.linesSpu += c.linesSpu;
    counts.linesSkipped += c.linesSkipped;
    cursorAt = orders[orders.length - 1].createdAt;
  }
  invalidateCostCaches([channel.id]);
  return { ...counts, phase, cursorAt };
}

/**
 * Gian KHÔNG gọi được sàn (DISCONNECTED): suy luận hẹp — mã thô của dòng đơn ứng với ĐÚNG MỘT lá trong danh mục (mã hiện
 * hành bằng mã thô, hoặc mã thô + đuôi phân loại) → ghi id lá đó. Mã ứng nhiều lá / không lá → để NULL. Không suy luận
 * "một SPU nhiều lá". Trả số dòng đã ghi.
 */
export async function inferIdsByUniqueSku(channelId: string): Promise<number> {
  return prisma.$executeRaw`
    WITH cand AS (
      SELECT cp."channelId",
             regexp_replace(regexp_replace(cp."channelSku", '\s\(.*\)(\s#\S+)?$', ''), '\s#\S+$', '') AS base,
             cp."externalId", cp."channelSku"
      FROM "ChannelProduct" cp
      WHERE cp."channelId" = ${channelId} AND cp."externalId" IS NOT NULL
    ),
    uniq AS (
      SELECT base, min("externalId") AS "externalId", min("channelSku") AS "channelSku"
      FROM cand GROUP BY base HAVING count(*) = 1
    )
    UPDATE "OrderItem" oi
    SET "externalId" = u."externalId", "channelSku" = u."channelSku"
    FROM "Order" o, uniq u
    WHERE oi."orderId" = o."id"
      AND o."channelId" = ${channelId}
      AND o."createdAt" >= ${timestampConst(windowStart())}
      AND oi."externalId" IS NULL
      AND oi."channelSku" = u.base`;
}
