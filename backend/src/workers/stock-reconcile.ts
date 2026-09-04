// ============================================================
// WORKER ĐỐI SOÁT TỒN SÀN ↔ HUBSELL (định kỳ, mặc định mỗi 6 giờ)
//
// Chiều đẩy (stock-push-worker) chỉ chạy khi CÓ biến động trong Hubsell. Nếu
// nhân viên sửa tồn tay trên sàn, một lượt đẩy fail sau 3 lần thử, hay sàn
// ghi trễ… thì tồn sàn lệch ÂM THẦM cho tới biến động kế tiếp. Worker này biến
// nguyên lý "mọi gian luôn cùng một số" thành cơ chế TỰ CHỮA LÀNH:
//
//   mỗi nhịp, với từng gian ĐANG BẬT đồng bộ:
//     1. đọc tồn thật từ sàn cho SKU đã nối (refreshLinkedChannelStock → channelStock)
//     2. so từng SKU đã liên kết với "có thể bán" của Hubsell
//     3. SKU lệch → xếp job đẩy lại (hàng đợi + retry + cảnh báo sẵn có)
//     4. ghi bookkeeping lên Channel (lastStockReconcileAt / Mismatch) cho UI
//
// Hubsell là nguồn chuẩn: KHÔNG bao giờ kéo số sàn về đè kho. Gian TẮT đồng bộ
// bị bỏ qua hoàn toàn (khách cố ý quản tồn trên sàn thì đừng làm phiền).
//
// Cấu hình: STOCK_RECONCILE_HOURS (mặc định 6; "0" = tắt). Nhịp đầu chạy sau
// 10 phút kể từ khi backend khởi động để không chen vào lúc deploy.
// ============================================================

import type { Channel } from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  availableToPush,
  enqueueStockPush,
  getSafetyStockDefault,
  PUSHABLE_CHANNELS,
} from "../integrations/inventory-push";
import { refreshLinkedChannelStock } from "../marketplace/stock-refresh";

const DEFAULT_HOURS = 6;
const FIRST_RUN_DELAY_MS = 10 * 60 * 1000;
/** Giãn cách giữa hai gian trong một nhịp — mỗi gian là một loạt call sản phẩm. */
const CHANNEL_GAP_MS = 2_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let started = false;
let running = false;

export function startStockReconcileWorker(): void {
  if (started) return;
  started = true;
  const raw = process.env.STOCK_RECONCILE_HOURS;
  const hours = raw === undefined || raw === "" ? DEFAULT_HOURS : Number(raw);
  if (!Number.isFinite(hours) || hours <= 0) {
    console.log("[Stock-reconcile] TẮT (STOCK_RECONCILE_HOURS=0)");
    return;
  }
  console.log(`[Stock-reconcile] BẬT — đối soát tồn sàn ↔ Hubsell mỗi ${hours} giờ`);
  setTimeout(() => {
    void runOnce();
    setInterval(() => void runOnce(), hours * 60 * 60 * 1000).unref();
  }, FIRST_RUN_DELAY_MS).unref();
}

async function runOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const channels = await prisma.channel.findMany({
      where: {
        stockSyncEnabled: true,
        status: "ACTIVE",
        refreshToken: { not: null },
        channelName: { in: PUSHABLE_CHANNELS },
      },
      orderBy: { createdAt: "asc" },
    });
    if (channels.length === 0) return;
    console.log(`[Stock-reconcile] Bắt đầu — ${channels.length} gian đang bật đồng bộ`);

    let first = true;
    for (const channel of channels) {
      if (!first) await sleep(CHANNEL_GAP_MS);
      first = false;
      try {
        const r = await reconcileChannelStock(channel, "đối soát định kỳ");
        console.log(
          `[Stock-reconcile] ${channel.shopName}: ${r.scanned} SKU, lệch ${r.mismatched}, đã xếp đẩy lại ${r.queued}`
        );
      } catch (err) {
        console.error(`[Stock-reconcile] ${channel.shopName}: lỗi —`, (err as Error).message);
      }
    }
  } catch (err) {
    console.error("[Stock-reconcile] Lỗi vòng đối soát:", err);
  } finally {
    running = false;
  }
}

export interface ReconcileResult {
  scanned: number;
  mismatched: number;
  queued: number;
  /** Vài SKU lệch đầu tiên để UI/log kể được chuyện (tối đa 20). */
  samples: { channelSku: string; hubsell: number; onChannel: number }[];
}

/**
 * Đối soát MỘT gian: kéo tồn sàn thật → so với "có thể bán" → xếp job đẩy lại
 * SKU lệch (chỉ khi gian đang BẬT; gian tắt vẫn đếm lệch để báo, không đẩy).
 * Ném lỗi nếu không đọc được sàn (token/mạng) — nơi gọi tự quyết định báo gì.
 */
export async function reconcileChannelStock(
  channel: Channel,
  source: string
): Promise<ReconcileResult> {
  // 1. Tồn thật trên sàn — CHỈ cho SKU đã nối (kéo nguyên danh mục mỗi 6h là
  //    dính rate limit Shopee với shop vài trăm SKU). Không có gì nối → về sớm.
  const r = await refreshLinkedChannelStock(channel);
  if (r.refreshed === 0 && r.missing === 0) {
    await prisma.channel.update({
      where: { id: channel.id },
      data: { lastStockReconcileAt: new Date(), lastStockReconcileMismatch: 0 },
    });
    return { scanned: 0, mismatched: 0, queued: 0, samples: [] };
  }

  // 2. So từng SKU đã liên kết. Bỏ qua SKU đang có job chờ đẩy — số sàn sắp
  //    đổi, so bây giờ là lệch giả.
  const [rows, safetyDefault, pending] = await Promise.all([
    prisma.channelProduct.findMany({
      where: {
        channelId: channel.id,
        productId: { not: null },
        externalId: { not: null },
        status: "ACTIVE",
        channelStock: { not: null },
      },
      select: {
        channelSku: true,
        channelStock: true,
        productId: true,
        product: {
          select: { quantityInStock: true, holdQuantity: true, safetyStock: true },
        },
      },
    }),
    getSafetyStockDefault(channel.userId),
    prisma.stockPushJob.findMany({
      where: { channelId: channel.id },
      select: { channelSku: true },
    }),
  ]);
  const pendingSkus = new Set(pending.map((p) => p.channelSku));

  const mismatches: { channelSku: string; productId: string; hubsell: number; onChannel: number }[] = [];
  for (const r of rows) {
    if (!r.product || pendingSkus.has(r.channelSku)) continue;
    const hubsell = availableToPush(r.product, safetyDefault);
    if (hubsell !== r.channelStock) {
      mismatches.push({
        channelSku: r.channelSku,
        productId: r.productId!,
        hubsell,
        onChannel: r.channelStock!,
      });
    }
  }

  // 3. Đẩy lại — mỗi SKU một job với ngữ cảnh riêng để nhật ký tự kể chuyện.
  //    enqueue KHÔNG force: gian tắt sẽ tự bị lọc (không đẩy), gian bật đi qua.
  let queued = 0;
  for (const m of mismatches) {
    const r = await enqueueStockPush([m.productId], {
      source: `${source}: sàn đang ${m.onChannel}, Hubsell ${m.hubsell}`,
      channelIds: [channel.id],
    });
    queued += r.queued;
  }

  // 4. Bookkeeping + dòng thời gian vận hành khi có lệch.
  await prisma.channel.update({
    where: { id: channel.id },
    data: {
      lastStockReconcileAt: new Date(),
      lastStockReconcileMismatch: mismatches.length,
    },
  });
  if (mismatches.length > 0) {
    await prisma.opsActivity
      .create({
        data: {
          ownerId: channel.userId,
          tag: "channel",
          message: channel.stockSyncEnabled
            ? `🔍 Đối soát tồn gian "${channel.shopName}": ${mismatches.length}/${rows.length} SKU lệch với Hubsell — đã tự đẩy lại số đúng.`
            : `🔍 Đối soát tồn gian "${channel.shopName}": ${mismatches.length}/${rows.length} SKU lệch với Hubsell — gian đang TẮT đồng bộ nên không đẩy lại.`,
        },
      })
      .catch(() => undefined);
  }

  return {
    scanned: rows.length,
    mismatched: mismatches.length,
    queued,
    samples: mismatches.slice(0, 20).map(({ channelSku, hubsell, onChannel }) => ({
      channelSku,
      hubsell,
      onChannel,
    })),
  };
}
