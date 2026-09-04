// ============================================================
// WORKER ĐẨY TỒN ĐA SÀN (Shopee + Lazada)
//
// Nhặt job từ hàng đợi bền stock_push_jobs (do inventory-push.ts enqueue) và
// gọi API sàn đẩy tồn khả dụng MỚI NHẤT — số luôn được đọc lại ngay lúc đẩy,
// không tin số tính từ trước (giữa enqueue và đẩy có thể đã có đơn khác chen).
//
// Nguyên tắc:
//   · TÁCH BIỆT: request/webhook chỉ enqueue rồi trả ngay; mọi cuộc gọi API
//     sàn nằm ở đây, lỗi sàn không bao giờ lan ngược về luồng đơn hàng/UI.
//   · ĐÁNH THỨC NGAY: enqueue xong là kick drain() (không chờ nhịp poll 5s) —
//     gian A bán 1 thì B, C, D nhận số mới trong ~1s; poll chỉ là lưới an toàn.
//   · Gom job theo GIAN: mỗi gian lấy access_token một lần; các call trong một
//     gian giãn nhịp PACE_MS để né rate-limit (Lazada 901 "retry next second").
//   · Retry: tối đa MAX_ATTEMPTS lần/job, backoff nhân đôi qua nextRetryAt —
//     giữa các lượt job quay về PENDING, KHÔNG chặn job khác.
//   · Mỗi lượt ghi một dòng InventorySyncLog; hết lượt vẫn lỗi → cảnh báo
//     InventorySyncAlert (banner Kho + Trung tâm điều hành) rồi xóa job.
//   · Đẩy Shopee thành công còn hẹn job ĐỐI SOÁT double-check (sàn 200 nhưng
//     ghi trễ) — tái dùng nguyên cơ chế verify sẵn có của shopee/inventory-sync.
// ============================================================

import { ChannelName, StockPushStatus, StockSyncStatus } from "@prisma/client";
import type { StockPushJob } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { availableToPush, registerStockPushKick } from "./inventory-push";
import {
  createSyncAlert,
  parseShopeeExternalId,
  scheduleStockVerification,
} from "./shopee/inventory-sync";
import { updateShopeeStock } from "./shopee/client";
import { getValidShopeeAccessToken } from "./shopee/service";
import { updateLazadaSellableStock } from "./lazada/client";
import { getValidLazadaAccessToken } from "./lazada/service";

const POLL_INTERVAL_MS = 5_000;
const BATCH_SIZE = 30;
/** Số lần thử một job (1 lần đầu + 2 retry) — khớp thông điệp cảnh báo. */
const MAX_ATTEMPTS = 3;
/** Chờ trước retry đầu, các lần sau nhân đôi (30s → 60s). */
const BASE_RETRY_MS = 30_000;
/** Giãn nhịp giữa hai call API trong CÙNG một gian — né rate-limit khi sync loạt. */
const PACE_MS = 400;
/** Trễ nhỏ sau kick để nhiều enqueue liên tiếp (một đơn nhiều SKU) gộp một lượt. */
const KICK_DELAY_MS = 300;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let started = false;
let draining = false;
let kickTimer: NodeJS.Timeout | null = null;

export function startStockPushWorker(): void {
  if (started) return;
  started = true;
  console.log(
    "[Stock-push] BẬT — worker đẩy tồn đa sàn (Shopee + Lazada): đánh thức ngay khi có job, poll lưới an toàn mỗi 5s"
  );
  registerStockPushKick(() => {
    if (kickTimer) return; // đã hẹn — gộp
    kickTimer = setTimeout(() => {
      kickTimer = null;
      void drain();
    }, KICK_DELAY_MS);
    kickTimer.unref();
  });
  // unref: timer không giữ process sống khi server tắt.
  setInterval(() => void drain(), POLL_INTERVAL_MS).unref();
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    for (;;) {
      const due = await prisma.stockPushJob.findMany({
        where: {
          status: StockPushStatus.PENDING,
          nextRetryAt: { lte: new Date() },
        },
        orderBy: { updatedAt: "asc" },
        take: BATCH_SIZE,
      });
      if (due.length === 0) break;

      // Gom theo gian để mỗi gian chỉ lấy token một lần.
      const byChannel = new Map<string, StockPushJob[]>();
      for (const job of due) {
        const list = byChannel.get(job.channelId) ?? [];
        list.push(job);
        byChannel.set(job.channelId, list);
      }
      for (const [channelId, jobs] of byChannel) {
        await processChannelJobs(channelId, jobs);
      }
    }
  } catch (err) {
    console.error("[Stock-push] Lỗi vòng xử lý hàng đợi:", err);
  } finally {
    draining = false;
  }
}

async function processChannelJobs(
  channelId: string,
  jobs: StockPushJob[]
): Promise<void> {
  // Nhận từng job bằng UPDATE có điều kiện — job đã bị tiến trình khác cầm
  // (hoặc enqueue mới vừa reset) thì bỏ qua lượt này.
  const claimed: StockPushJob[] = [];
  for (const job of jobs) {
    const r = await prisma.stockPushJob.updateMany({
      where: { id: job.id, status: StockPushStatus.PENDING },
      data: { status: StockPushStatus.RUNNING },
    });
    if (r.count > 0) claimed.push(job);
  }
  if (claimed.length === 0) return;

  const channel = await prisma.channel.findFirst({
    where: { id: channelId, status: "ACTIVE", refreshToken: { not: null } },
  });
  if (!channel) {
    // Gian đã ngắt kết nối/xóa — job không còn ý nghĩa.
    await prisma.stockPushJob.deleteMany({
      where: { id: { in: claimed.map((j) => j.id) } },
    });
    return;
  }

  // Không lấy nổi token = không đẩy được SKU nào của gian này → chốt FAILED cả
  // loạt + MỘT cảnh báo cấp gian, khỏi retry từng SKU vô ích (mirror hành vi
  // của syncShopeeStockForProducts).
  let shopeeAuth: { accessToken: string; shopId: string } | null = null;
  let lazadaToken: string | null = null;
  try {
    if (channel.channelName === ChannelName.SHOPEE) {
      shopeeAuth = await getValidShopeeAccessToken(channel);
    } else if (channel.channelName === ChannelName.LAZADA) {
      lazadaToken = await getValidLazadaAccessToken(channel);
    } else {
      // Sàn chưa hỗ trợ chiều đẩy (job rác) — dọn.
      await prisma.stockPushJob.deleteMany({
        where: { id: { in: claimed.map((j) => j.id) } },
      });
      return;
    }
  } catch (err) {
    const msg = (err as Error).message;
    for (const job of claimed) {
      await writeSyncLog(job, null, false, `Không lấy được access_token: ${msg}`);
    }
    await prisma.stockPushJob.deleteMany({
      where: { id: { in: claimed.map((j) => j.id) } },
    });
    await createSyncAlert(channel.id, {
      message: `Không đồng bộ được tồn kho lên gian "${channel.shopName}": ${msg}. Kiểm tra kết nối/uỷ quyền lại gian hàng.`,
    });
    return;
  }

  // Tồn an toàn mặc định của CHỦ gian — một lần cho cả loạt.
  const setting = await prisma.shopSyncSetting.findUnique({
    where: { userId: channel.userId },
    select: { safetyStockDefault: true },
  });
  const safetyDefault = setting?.safetyStockDefault ?? 0;

  let first = true;
  for (const job of claimed) {
    // Giãn nhịp giữa các call trong cùng gian (call đầu không cần chờ).
    if (!first) await sleep(PACE_MS);
    first = false;

    // Chủ shop vừa TẮT đồng bộ gian này giữa chừng → job tự động (không forced)
    // hủy êm; job forced (sync tay) vẫn đi tiếp vì là ý chí người dùng.
    if (!job.forced && !channel.stockSyncEnabled) {
      await prisma.stockPushJob.deleteMany({ where: { id: job.id } });
      continue;
    }

    // Đọc lại mapping + tồn MỚI NHẤT ngay lúc đẩy.
    const mapping = await prisma.channelProduct.findUnique({
      where: {
        channelId_channelSku: { channelId, channelSku: job.channelSku },
      },
      select: {
        externalId: true,
        productId: true,
        channelSku: true,
        channelStockLocationId: true,
      },
    });
    if (!mapping?.productId || !mapping.externalId) {
      // SKU đã bị gỡ liên kết / mapping mất — không còn gì để đẩy.
      await prisma.stockPushJob.deleteMany({ where: { id: job.id } });
      continue;
    }
    const product = await prisma.product.findUnique({
      where: { id: mapping.productId },
      select: { quantityInStock: true, holdQuantity: true, safetyStock: true },
    });
    if (!product) {
      await prisma.stockPushJob.deleteMany({ where: { id: job.id } });
      continue;
    }

    const pushValue = availableToPush(product, safetyDefault);

    try {
      if (channel.channelName === ChannelName.SHOPEE && shopeeAuth) {
        const ids = parseShopeeExternalId(mapping.externalId);
        if (!ids) {
          // externalId không đúng định dạng (mapping cũ) — bỏ, không retry.
          await prisma.stockPushJob.deleteMany({ where: { id: job.id } });
          continue;
        }
        await updateShopeeStock(
          shopeeAuth.accessToken,
          shopeeAuth.shopId,
          ids.itemId,
          pushValue,
          ids.modelId,
          mapping.channelStockLocationId
        );
        // 200 OK chưa chắc sàn đã ghi — hẹn giờ Double-Check đọc lại tồn.
        await scheduleStockVerification(channel, {
          kind: "stock-verify",
          channelId: channel.id,
          channelSku: mapping.channelSku,
          productId: mapping.productId,
          itemId: ids.itemId,
          modelId: ids.modelId,
          locationId: mapping.channelStockLocationId ?? undefined,
        });
      } else if (channel.channelName === ChannelName.LAZADA && lazadaToken) {
        // externalId Lazada dạng "itemId-skuId" (lazada-adapter).
        const [itemId, skuId] = mapping.externalId.split("-");
        if (!itemId || !skuId) {
          await prisma.stockPushJob.deleteMany({ where: { id: job.id } });
          continue;
        }
        await updateLazadaSellableStock({
          accessToken: lazadaToken,
          itemId,
          skuId,
          quantity: pushValue,
        });
      }

      // Sàn đã nhận số mới → ghi luôn "tồn sàn" = số vừa đẩy để UI/đối soát
      // so khớp ngay, không phải chờ lần kéo sản phẩm kế tiếp.
      await prisma.channelProduct.updateMany({
        where: { channelId, channelSku: job.channelSku },
        data: { channelStock: pushValue },
      });

      await writeSyncLog(job, pushValue, true);
      // Chỉ xóa khi job VẪN là RUNNING của mình — enqueue mới trong lúc đẩy đã
      // reset về PENDING thì giữ lại cho lượt sau (đẩy lại số mới, vô hại).
      await prisma.stockPushJob.deleteMany({
        where: { id: job.id, status: StockPushStatus.RUNNING },
      });
    } catch (err) {
      await handleJobFailure(job, channel.shopName, pushValue, (err as Error).message);
    }
  }
}

/** Lỗi một lượt đẩy: còn lượt thì hẹn retry (backoff), hết lượt thì log FAILED
 *  + cảnh báo lệch tồn rồi xóa job (audit đã nằm ở log/alert, queue giữ nhỏ). */
async function handleJobFailure(
  job: StockPushJob,
  shopName: string,
  pushValue: number,
  message: string
): Promise<void> {
  const attempt = job.attempts + 1;
  if (attempt < MAX_ATTEMPTS) {
    await prisma.stockPushJob.updateMany({
      // Enqueue mới đã reset job về PENDING/attempts 0 thì tôn trọng nó (no-op).
      where: { id: job.id, status: StockPushStatus.RUNNING },
      data: {
        status: StockPushStatus.PENDING,
        attempts: attempt,
        lastError: message,
        nextRetryAt: new Date(Date.now() + BASE_RETRY_MS * 2 ** (attempt - 1)),
      },
    });
    return;
  }

  await writeSyncLog(job, pushValue, false, `sau ${attempt} lần thử — lỗi: ${message}`);
  await createSyncAlert(job.channelId, {
    channelSku: job.channelSku,
    message: `Đẩy tồn kho SKU ${job.channelSku} lên gian "${shopName}" thất bại sau ${MAX_ATTEMPTS} lần thử: ${message}. Tồn trên sàn đang LỆCH (đúng phải là ${pushValue}) — cần chỉnh tay để tránh bán vượt/bị phạt.`,
  });
  await prisma.stockPushJob.deleteMany({
    where: { id: job.id, status: StockPushStatus.RUNNING },
  });
}

/** Một dòng nhật ký đối soát [SKU] − [số cũ] − [số mới] − [trạng thái] (+nguồn). */
async function writeSyncLog(
  job: StockPushJob,
  newQuantity: number | null,
  ok: boolean,
  errorCtx?: string
): Promise<void> {
  const oldQty = job.oldAvailable ?? newQuantity ?? 0;
  const newQty = newQuantity ?? oldQty;
  const message = [job.source, errorCtx].filter(Boolean).join(" — ") || null;
  try {
    await prisma.inventorySyncLog.create({
      data: {
        channelId: job.channelId,
        channelSku: job.channelSku,
        productId: job.productId,
        oldQuantity: oldQty,
        newQuantity: newQty,
        status: ok ? StockSyncStatus.SUCCESS : StockSyncStatus.FAILED,
        message,
      },
    });
  } catch (err) {
    console.error("[Stock-push] Không ghi được InventorySyncLog:", err);
  }
  console.log(
    `[Stock-push] [${new Date().toISOString()}] - [${job.channelSku}] - [cũ ${oldQty}] - [mới ${newQty}] - [${ok ? "Thành công" : "Thất bại"}]${errorCtx ? ` — ${errorCtx}` : ""}`
  );
}
