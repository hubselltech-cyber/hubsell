// ============================================================
// ENGINE TỒN KHẢ DỤNG + ENQUEUE ĐẨY TỒN ĐA SÀN
//
// Mọi biến động kho (đơn sàn, nhập/xuất tay, nhập hàng hoàn, sửa tồn, import)
// đều đi qua MỘT cửa: enqueueStockPush(productIds) — ghi job vào hàng đợi bền
// stock_push_jobs rồi trả về NGAY (một câu ghi cho cả lô, không gọi API sàn,
// không làm chậm request). Worker stock-push-worker.ts nhặt job và đẩy thật.
//
// Giai đoạn 2 bước 4 (docs/HANG-DOI-BEN.md mục 4.5): bảng stock_push_jobs vẫn
// giữ trạng thái và là nguồn sự thật. Ở đường hàng đợi bền (STOCK_PUSH_MODE=
// queue) nơi ghi đơn / sửa kho ghi dòng chờ đẩy NGAY TRONG giao dịch của mình
// (stageStockPush + finishStockPush), kèm một tín hiệu stock.channel cho từng
// gian để worker chạy ngay; bộ chạy theo gian nằm ở workers/stock-queue.ts.
//
// Công thức tồn khả dụng ("CÓ THỂ BÁN" — số ĐẨY LÊN SÀN):
//   available = max(0, quantityInStock − holdQuantity − safetyStock)
//   safetyStock = Product.safetyStock (per-SKU) ?? ShopSyncSetting.safetyStockDefault
//
// MÔ HÌNH (chốt 05/09 theo Sapo): Hubsell là TRUNG TÂM điều tiết — một SKU kho
// có thể niêm yết trên nhiều gian, nhiều sàn; mọi gian luôn hiện CÙNG một số
// "có thể bán". Gian A bán 1 → kho trừ 1 → A, B, C, D… đều nhận số mới.
//
// Cờ BẬT/TẮT theo TỪNG GIAN (Channel.stockSyncEnabled, mặc định TẮT) gác ngay
// ở cửa enqueue: gian tắt thì biến động tự động không sinh job cho gian đó —
// chỉ thao tác chủ động trên CHÍNH gian đó (force = true: bật gian lần đầu,
// force-sync theo cảnh báo) mới đi qua. Nút [Sync ngay toàn bộ] từ 28/09 (anh
// Trung chốt) cũng CHỈ đẩy gian đang bật. Gian chưa qua màn so sánh/bật sẽ
// không bao giờ bị ghi đè tồn.
// ============================================================

import crypto from "crypto";
import { ChannelName } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { enqueue, isQueueReady, QUEUES } from "../lib/queue";
import { stockPushMode } from "../lib/queue-config";

/** Các sàn đã có chiều ĐẨY tồn. TikTok chưa có product-sync (ChannelProduct
 *  không có externalId) nên chưa đẩy được — bổ sung khi làm product pull TikTok. */
export const PUSHABLE_CHANNELS: ChannelName[] = [
  ChannelName.SHOPEE,
  ChannelName.LAZADA,
  ChannelName.TIKTOK, // 16/09/2026: adapter sản phẩm + inventory/update theo kho
];

export interface StockFields {
  quantityInStock: number;
  holdQuantity: number;
  safetyStock: number | null;
}

/** Tồn khả dụng đẩy lên sàn — âm nghĩa là đã bán vượt, đẩy 0 để chặn bán thêm. */
export function availableToPush(p: StockFields, safetyStockDefault: number): number {
  const safety = p.safetyStock ?? safetyStockDefault;
  return Math.max(0, p.quantityInStock - p.holdQuantity - safety);
}

/**
 * Tồn an toàn mặc định của một chủ shop (0 khi chưa cấu hình). Gom một chỗ để
 * mọi nơi tính "có thể bán" (route danh sách, worker, đối soát) dùng cùng số.
 */
export async function getSafetyStockDefault(ownerId: string): Promise<number> {
  const s = await prisma.shopSyncSetting.findUnique({
    where: { userId: ownerId },
    select: { safetyStockDefault: true },
  });
  return s?.safetyStockDefault ?? 0;
}

export interface EnqueueOptions {
  /** Nguồn biến động để ghi vào nhật ký sync (vd "webhook Shopee đơn X"). */
  source?: string;
  /** true = người dùng chủ động sync — bỏ qua cờ stockSyncEnabled của gian. */
  force?: boolean;
  /** Chỉ xếp job cho các gian này (vd bật đồng bộ MỘT gian) — bỏ trống = mọi gian. */
  channelIds?: string[];
  /**
   * Snapshot tồn khả dụng TRƯỚC biến động (chụp trong transaction, theo công
   * thức cũ quantityInStock − holdQuantity) — chỉ phục vụ cột "số cũ" của
   * nhật ký sync; số đẩy lên sàn luôn được worker đọc lại mới nhất lúc đẩy.
   */
  oldAvailable?: Record<string, number>;
}

// Worker ĐƯỜNG CŨ đăng ký hàm "đánh thức" để nhặt job NGAY sau khi enqueue thay
// vì chờ nhịp poll. Đăng ký qua callback (không import worker) để tránh import
// vòng. Ở đường hàng đợi bền (STOCK_PUSH_MODE=queue) không có hàm này: mỗi gian
// có dòng mới được gửi một tín hiệu qua hàng đợi stock.channel.
let kickWorker: (() => void) | null = null;
export function registerStockPushKick(fn: () => void): void {
  kickWorker = fn;
}

// ---------- Hàng đợi bền: tín hiệu theo GIAN (giai đoạn 2 bước 4) ----------

/**
 * Dữ liệu một việc stock.channel: tín hiệu "gian này có dòng stock_push_jobs
 * mới tới hạn". Việc không mang nội dung cần đẩy — worker nhận tín hiệu thì gọi
 * bộ chạy của gian, bộ chạy đọc dòng từ bảng (xem workers/stock-queue.ts).
 */
export interface StockChannelJob {
  channelId: string;
}

/** Khóa gộp: nhiều tín hiệu dồn dập của một gian gộp còn một việc đang chờ. */
export function stockChannelKey(channelId: string): string {
  return channelId;
}

/** Số mã sản phẩm tối đa trong một câu hỏi liên kết — giữ câu lệnh nhỏ, xem writePushRows. */
const PRODUCT_ID_CHUNK = 500;
/** Số dòng "tồn chờ đẩy" ghi trong một câu lệnh. */
const PUSH_ROW_CHUNK = 1000;

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * Ghi các dòng "tồn chờ đẩy" (stock_push_jobs) cho mọi SKU sàn đã liên kết các
 * sản phẩm này. `db` là kết nối thường hoặc giao dịch đang mở — truyền giao
 * dịch thì dòng được ghi CHUNG giao dịch với biến động kho.
 *
 * Ghi cả lô bằng MỘT câu lệnh với MỘT tham số JSON (bài học 30/09/2026: câu
 * lệnh hàng nghìn tham số bị Prisma giữ lại trên từng kết nối làm database hết
 * bộ nhớ), sắp theo (gian, SKU) để hai giao dịch chạm cùng các dòng luôn khóa
 * theo cùng thứ tự. Trùng khóa (gian, SKU) thì đưa dòng về PENDING và GIỮ
 * oldAvailable cũ — "số cũ" phải là tồn trước biến động ĐẦU TIÊN của chuỗi
 * được gộp, không phải biến động cuối.
 */
async function writePushRows(
  db: Prisma.TransactionClient,
  ids: string[],
  opts: EnqueueOptions
): Promise<{ queued: number; channelIds: string[] }> {
  const mappings = [];
  for (const part of chunks(ids, PRODUCT_ID_CHUNK)) {
    mappings.push(
      ...(await db.channelProduct.findMany({
        where: {
          productId: { in: part },
          externalId: { not: null },
          // SKU đã gỡ niêm yết trên sàn không nhận tồn — đẩy chỉ sinh lỗi + cảnh báo rác.
          status: "ACTIVE",
          ...(opts.channelIds?.length ? { channelId: { in: opts.channelIds } } : {}),
          channel: {
            channelName: { in: PUSHABLE_CHANNELS },
            status: "ACTIVE",
            refreshToken: { not: null },
            // Cờ theo gian gác ngay tại cửa — gian tắt không sinh job tự động.
            ...(opts.force ? {} : { stockSyncEnabled: true }),
          },
        },
        select: {
          channelId: true,
          channelSku: true,
          productId: true,
          channel: { select: { userId: true } },
          product: {
            select: { quantityInStock: true, holdQuantity: true, safetyStock: true },
          },
        },
      }))
    );
  }
  if (mappings.length === 0) return { queued: 0, channelIds: [] };

  // Tồn an toàn mặc định theo CHỦ SHOP của từng gian (cột "số cũ" của log).
  const ownerIds = [...new Set(mappings.map((m) => m.channel.userId))];
  const settings = await db.shopSyncSetting.findMany({
    where: { userId: { in: ownerIds } },
    select: { userId: true, safetyStockDefault: true },
  });
  const safetyByOwner = new Map(settings.map((s) => [s.userId, s.safetyStockDefault]));

  const rows = mappings
    .map((mp) => ({
      id: crypto.randomUUID(),
      channelId: mp.channelId,
      channelSku: mp.channelSku,
      productId: mp.productId!,
      oldAvailable:
        opts.oldAvailable?.[mp.productId!] ??
        (mp.product ? availableToPush(mp.product, safetyByOwner.get(mp.channel.userId) ?? 0) : null),
    }))
    .sort((a, b) =>
      a.channelId === b.channelId
        ? a.channelSku < b.channelSku ? -1 : a.channelSku > b.channelSku ? 1 : 0
        : a.channelId < b.channelId ? -1 : 1
    );

  // Giờ truyền dạng chữ có múi giờ rồi đổi về UTC ngay trong câu lệnh: cột là
  // TIMESTAMP không múi giờ (Prisma ghi UTC), không phụ thuộc múi giờ của phiên kết nối.
  const nowIso = new Date().toISOString();
  const source = opts.source ?? null;
  const forced = opts.force ?? false;
  for (const part of chunks(rows, PUSH_ROW_CHUNK)) {
    await db.$executeRaw`
      INSERT INTO "stock_push_jobs"
        ("id", "channelId", "channelSku", "productId", "oldAvailable", "forced", "source",
         "status", "attempts", "nextRetryAt", "lastError", "createdAt", "updatedAt")
      SELECT r."id", r."channelId", r."channelSku", r."productId", r."oldAvailable", ${forced}::boolean, ${source}::text,
             'PENDING'::"StockPushStatus", 0, t."now", NULL, t."now", t."now"
      FROM jsonb_to_recordset(${JSON.stringify(part)}::jsonb)
        AS r("id" text, "channelId" text, "channelSku" text, "productId" text, "oldAvailable" int),
        (SELECT (${nowIso}::timestamptz AT TIME ZONE 'UTC') AS "now") AS t
      ORDER BY r."channelId", r."channelSku"
      ON CONFLICT ("channelId", "channelSku") DO UPDATE SET
        "productId" = EXCLUDED."productId",
        "status" = 'PENDING'::"StockPushStatus",
        "attempts" = 0,
        "nextRetryAt" = EXCLUDED."nextRetryAt",
        "lastError" = NULL,
        "source" = EXCLUDED."source",
        "forced" = EXCLUDED."forced",
        "updatedAt" = EXCLUDED."updatedAt"`;
  }

  return { queued: rows.length, channelIds: [...new Set(rows.map((r) => r.channelId))] };
}

/**
 * Gửi tín hiệu stock.channel cho từng gian vừa có dòng chờ đẩy. Gian đã có tín
 * hiệu đang chờ thì thôi (gộp theo khóa). Số gian bị chặn bởi trần gian của gói
 * (tối đa 40 gian một chủ shop), và danh sách đã sắp sẵn theo mã gian nên hai
 * giao dịch không khóa chéo nhau. Ném khi hàng đợi chưa sẵn sàng / lỗi.
 * Trả các gian mà việc mới KHÔNG được tạo vì đã có việc đang chờ.
 */
async function wakeChannels(channelIds: string[], tx?: Prisma.TransactionClient): Promise<string[]> {
  const merged: string[] = [];
  for (const channelId of channelIds) {
    const job: StockChannelJob = { channelId };
    const sent = await enqueue(QUEUES.stockChannel, job, { key: stockChannelKey(channelId), tx });
    if (!sent.queued) merged.push(channelId);
  }
  return merged;
}

/**
 * CẢNH BÁO SẮP HẾT HÀNG đi cùng cửa đẩy tồn (mọi biến động kho đều qua đây, kể
 * cả SKU chưa nối sàn): rơi qua ngưỡng → chuông + thẻ điều hành ngay. Phải chạy
 * SAU khi biến động đã commit (nó đọc tồn bằng kết nối thường). Import động để
 * không kéo cả cụm detector điều hành vào luồng đơn hàng lúc nạp module;
 * best-effort, không chờ, không ném.
 */
function checkLowStockLater(ids: string[]): void {
  void import("../services/ops-alerts")
    .then((m) => m.checkLowStock(ids))
    .catch((err) => console.error("[Low-stock] Không kiểm tra được ngưỡng:", err));
}

/**
 * Ghi job đẩy tồn cho MỌI SKU sàn đã liên kết các sản phẩm này (mọi gian
 * Shopee/Lazada/TikTok ACTIVE đang BẬT đồng bộ, hoặc mọi gian nếu force). Khóa
 * (channelId, channelSku) → nhiều biến động liên tiếp của cùng SKU GỘP còn một
 * job (chống bão rate-limit).
 *
 * Gọi SAU khi biến động kho đã commit. Nơi nào đang ở TRONG giao dịch ghi đơn /
 * sửa kho thì dùng cặp stageStockPush + finishStockPush để dòng chờ đẩy nằm
 * chung giao dịch.
 *
 * Best-effort: KHÔNG BAO GIỜ ném — biến động kho đã ghi DB xong, việc đẩy sàn
 * có hàng đợi/retry/cảnh báo riêng; ném lên sẽ làm hỏng luồng gốc.
 */
export async function enqueueStockPush(
  productIds: string[],
  opts: EnqueueOptions = {}
): Promise<{ queued: number }> {
  const result = { queued: 0 };
  try {
    const ids = [...new Set(productIds)].filter(Boolean);
    if (ids.length === 0) return result;

    checkLowStockLater(ids);

    const written = await writePushRows(prisma, ids, opts);
    result.queued = written.queued;
    if (written.queued === 0) return result;

    if (stockPushMode() === "queue") {
      // Dòng đã ghi là đủ để lượt đẩy chắc chắn diễn ra (lưới quét của worker đọc
      // bảng mỗi vài giây). Tín hiệu qua hàng đợi chỉ để worker chạy NGAY.
      if (isQueueReady()) await signalChannels(written.channelIds);
    } else if (kickWorker) {
      kickWorker();
    }
  } catch (err) {
    console.error("[Stock-push] Không enqueue được job đẩy tồn:", err);
  }
  return result;
}

// ---------- Ghi "tồn chờ đẩy" TRONG giao dịch ghi đơn / sửa kho ----------

/** Phiếu trả về từ stageStockPush — đưa cho finishStockPush sau khi giao dịch commit. */
export interface StockPushTicket {
  productIds: string[];
  opts: EnqueueOptions;
  /** true = dòng chờ đẩy đã được ghi trong giao dịch. */
  staged: boolean;
  queued: number;
  /**
   * Gian cần gửi (lại) tín hiệu sau commit: gian mà tín hiệu trong giao dịch bị
   * GỘP vào một tín hiệu đang chờ có sẵn (tín hiệu có sẵn ấy có thể được nhận và
   * bộ chạy quét xong TRƯỚC khi giao dịch này commit, lúc đó chưa thấy dòng mới),
   * hoặc gian chưa gửi được tín hiệu trong giao dịch. Tín hiệu do chính giao
   * dịch tạo ra thì không cần gửi lại: nó chỉ hiện ra sau commit.
   */
  mergedChannelIds: string[];
}

const ROWS_SAVEPOINT = "stock_push_rows";
const SIGNAL_SAVEPOINT = "stock_push_signal";

/**
 * Gọi TRONG giao dịch vừa làm biến động kho: ghi dòng "tồn chờ đẩy" chung giao
 * dịch đó — đơn / phiếu kho đã commit thì lượt đẩy tồn chắc chắn tồn tại (trước
 * bước 4 dòng được ghi SAU commit, tiến trình chết đúng khe đó là mất lượt đẩy,
 * chỉ còn đối soát 6 giờ vớt lại). Kèm tín hiệu stock.channel trong cùng giao
 * dịch để worker chạy ngay khi commit.
 *
 * Luôn đi kèm finishStockPush(phiếu) SAU khi giao dịch commit.
 *
 * Không làm hỏng giao dịch gốc: mỗi phần nằm trong một SAVEPOINT riêng. Ghi dòng
 * lỗi thì lùi về savepoint, ghi log, finishStockPush sẽ ghi lại ngoài giao dịch.
 * Gửi tín hiệu lỗi (hoặc hàng đợi chưa sẵn sàng) thì dòng VẪN được giữ — lưới
 * quét của worker đọc bảng mỗi vài giây — và finishStockPush thử gửi lại.
 * Ở đường cũ (STOCK_PUSH_MODE=legacy) hàm này không ghi gì — finishStockPush làm
 * đúng việc enqueueStockPush vẫn làm.
 */
export async function stageStockPush(
  tx: Prisma.TransactionClient,
  productIds: string[],
  opts: EnqueueOptions = {}
): Promise<StockPushTicket> {
  const ids = [...new Set(productIds)].filter(Boolean);
  const ticket: StockPushTicket = { productIds: ids, opts, staged: false, queued: 0, mergedChannelIds: [] };
  if (ids.length === 0 || stockPushMode() !== "queue") return ticket;

  let channelIds: string[];
  await tx.$executeRawUnsafe(`SAVEPOINT ${ROWS_SAVEPOINT}`);
  try {
    const written = await writePushRows(tx, ids, opts);
    await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${ROWS_SAVEPOINT}`);
    ticket.staged = true;
    ticket.queued = written.queued;
    channelIds = written.channelIds;
  } catch (err) {
    console.error(
      "[Stock-push] Không ghi được dòng chờ đẩy trong giao dịch — sẽ ghi lại sau khi giao dịch commit:",
      (err as Error).message
    );
    await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${ROWS_SAVEPOINT}`);
    return ticket;
  }
  if (channelIds.length === 0) return ticket;

  if (!isQueueReady()) {
    ticket.mergedChannelIds = channelIds;
    return ticket;
  }
  await tx.$executeRawUnsafe(`SAVEPOINT ${SIGNAL_SAVEPOINT}`);
  try {
    ticket.mergedChannelIds = await wakeChannels(channelIds, tx);
    await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${SIGNAL_SAVEPOINT}`);
  } catch (err) {
    console.error(
      "[Stock-push] Dòng chờ đẩy đã ghi nhưng chưa gửi được tín hiệu stock.channel trong giao dịch (sẽ gửi lại sau commit; lưới quét cũng nhặt):",
      (err as Error).message
    );
    await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${SIGNAL_SAVEPOINT}`);
    ticket.mergedChannelIds = channelIds;
  }
  return ticket;
}

/**
 * Gọi SAU khi giao dịch của stageStockPush đã commit (giao dịch rollback thì
 * đừng gọi). Kiểm ngưỡng sắp hết hàng; phiếu chưa được ghi trong giao dịch
 * (đường cũ hoặc ghi lỗi) thì ghi + xếp việc ở đây. Không ném.
 */
export async function finishStockPush(ticket?: StockPushTicket | null): Promise<{ queued: number }> {
  if (!ticket || ticket.productIds.length === 0) return { queued: 0 };
  if (!ticket.staged) return enqueueStockPush(ticket.productIds, ticket.opts);
  checkLowStockLater(ticket.productIds);
  await signalChannels(ticket.mergedChannelIds);
  return { queued: ticket.queued };
}

/**
 * Chốt NHIỀU phiếu của cùng một thao tác (vd "nhập kho tất cả hàng hoàn": mỗi
 * đơn một giao dịch, mỗi giao dịch một phiếu). Các phiếu chưa được ghi trong
 * giao dịch gom lại xếp MỘT lượt thay vì mỗi phiếu một lượt. Không ném.
 */
export async function finishStockPushes(tickets: StockPushTicket[]): Promise<void> {
  const staged = tickets.filter((t) => t.staged && t.productIds.length > 0);
  if (staged.length > 0) {
    checkLowStockLater([...new Set(staged.flatMap((t) => t.productIds))]);
    await signalChannels([...new Set(staged.flatMap((t) => t.mergedChannelIds))].sort());
  }
  const rest = tickets.filter((t) => !t.staged && t.productIds.length > 0);
  if (rest.length > 0) {
    await enqueueStockPush(
      rest.flatMap((t) => t.productIds),
      rest[0].opts
    );
  }
}

/**
 * Gửi tín hiệu stock.channel NGOÀI giao dịch (dòng đã commit). Không ném: gửi
 * không được thì lưới quét của worker (workers/stock-queue.ts) vẫn nhặt dòng.
 */
async function signalChannels(channelIds: string[]): Promise<void> {
  if (channelIds.length === 0 || !isQueueReady()) return;
  try {
    await wakeChannels(channelIds);
  } catch (err) {
    console.error(
      "[Stock-push] Chưa gửi được tín hiệu stock.channel (lưới quét sẽ nhặt):",
      (err as Error).message
    );
  }
}

/**
 * Ghi job cho MỌI SKU sàn đã liên kết của một chủ shop. force: false (nút
 * [Sync ngay toàn bộ] từ 28/09, đổi tồn an toàn mặc định) = chỉ gian đang BẬT;
 * force: true = bỏ qua cờ gian — chỉ còn dùng cho việc nội bộ, đừng gắn vào nút.
 * Trả số job đã xếp hàng để UI hiển thị tiến độ.
 */
export async function enqueueStockPushForOwner(
  ownerId: string,
  source: string,
  opts: { force?: boolean } = {}
): Promise<{ queued: number }> {
  const rows = await prisma.channelProduct.findMany({
    where: {
      productId: { not: null },
      externalId: { not: null },
      status: "ACTIVE",
      channel: {
        userId: ownerId,
        channelName: { in: PUSHABLE_CHANNELS },
        status: "ACTIVE",
        refreshToken: { not: null },
      },
    },
    select: { productId: true },
    distinct: ["productId"],
  });
  return enqueueStockPush(
    rows.map((r) => r.productId!),
    { source, force: opts.force ?? true }
  );
}

/**
 * Đẩy (FORCE) toàn bộ SKU đã liên kết của MỘT gian — dùng ngay khi chủ shop
 * bật đồng bộ cho gian đó sau màn so sánh, để tồn sàn về khớp Hubsell một lượt.
 */
export async function enqueueStockPushForChannel(
  channelId: string,
  source: string
): Promise<{ queued: number }> {
  const rows = await prisma.channelProduct.findMany({
    where: {
      channelId,
      productId: { not: null },
      externalId: { not: null },
      status: "ACTIVE",
    },
    select: { productId: true },
    distinct: ["productId"],
  });
  return enqueueStockPush(
    rows.map((r) => r.productId!),
    { source, force: true, channelIds: [channelId] }
  );
}

/** Số job còn nằm trong hàng đợi của một chủ shop — UI poll để vẽ tiến độ. */
export async function countPendingJobs(ownerId: string): Promise<number> {
  return prisma.stockPushJob.count({
    where: { channel: { userId: ownerId } },
  });
}
