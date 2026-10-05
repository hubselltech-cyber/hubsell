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
//   · Gom job theo GIAN: mỗi gian lấy access_token một lần; các call trong một
//     gian giãn nhịp PACE_MS để né rate-limit (Lazada 901 "retry next second").
//   · Retry: tối đa MAX_ATTEMPTS lần/job, backoff nhân đôi qua nextRetryAt —
//     giữa các lượt job quay về PENDING, KHÔNG chặn job khác.
//   · Mỗi lượt ghi một dòng InventorySyncLog; hết lượt vẫn lỗi → cảnh báo
//     InventorySyncAlert (banner Kho + Trung tâm điều hành) rồi xóa job.
//   · Đẩy Shopee thành công còn hẹn job ĐỐI SOÁT double-check (sàn 200 nhưng
//     ghi trễ) — tái dùng nguyên cơ chế verify sẵn có của shopee/inventory-sync.
//
// docs/HANG-DOI-BEN.md mục 4.5: phần "ai nhặt dòng nào, khi nào" nằm ở
// workers/stock-queue.ts — bộ chạy theo gian, các gian chạy song song; nhận lô
// bằng claimChannelBatch nên một gian không bao giờ có hai tiến trình cùng đẩy.
// Tệp này giữ phần NHẬN LÔ + ĐẨY các dòng đã nhận của một gian. (Vòng quét một
// luồng trước giai đoạn 2 đã gỡ ở bước 6b, 05/10/2026.)
// ============================================================

import { ChannelName, StockPushStatus, StockSyncStatus } from "@prisma/client";
import type { StockPushJob } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { withDbLock } from "../lib/db-lock";
import { STOCK_PUSH_LEASE_SECONDS } from "../lib/queue-config";
import { availableToPush } from "./inventory-push";
import {
  createSyncAlert,
  parseShopeeExternalId,
  resolveShopeeLocationId,
  resolveSyncAlerts,
  scheduleStockVerification,
} from "./shopee/inventory-sync";
import {
  classifyStockPushFailure,
  describeChannelFailure,
  describeStockPushFailure,
} from "../services/sync-alert-text";
import { updateShopeeStock } from "./shopee/client";
import { getValidShopeeAccessToken } from "./shopee/service";
import { updateLazadaSellableStock } from "./lazada/client";
import { getValidLazadaAccessToken } from "./lazada/service";
import { getWarehouses, updateTiktokInventory } from "./tiktok/client";
import { getValidAccessToken as getValidTiktokAccessToken } from "./tiktok/service";

/** Số dòng một gian nhận mỗi lô. */
const BATCH_SIZE = 30;
/** Số lần thử một job (1 lần đầu + 2 retry) — khớp thông điệp cảnh báo. */
const MAX_ATTEMPTS = 3;
/** Chờ trước retry đầu, các lần sau nhân đôi (30s → 60s). */
const BASE_RETRY_MS = 30_000;
/** Giãn nhịp giữa hai call API trong CÙNG một gian — né rate-limit khi sync loạt. */
const PACE_MS = 400;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Nhận MỘT LÔ dòng tới hạn của một gian, và chỉ nhận khi
 * không tiến trình nào khác đang đẩy gian đó.
 *
 * "Đang có người đẩy" = gian còn dòng ở RUNNING chưa quá hạn thuê. Chính các
 * dòng RUNNING làm vé giữ gian, không cần cột hay bảng riêng. Việc xét + nhận
 * nằm trong một giao dịch ngắn dưới khóa theo gian (advisory lock cấp giao dịch)
 * nên hai tiến trình không thể cùng lúc thấy gian trống rồi cùng nhận.
 *
 * Dòng RUNNING quá hạn thuê = tiến trình cầm nó đã chết giữa lô → trả về hàng
 * chờ ngay tại đây (giữ nguyên attempts). Trả mảng rỗng khi gian đang có người
 * đẩy hoặc không có dòng nào tới hạn.
 */
export async function claimChannelBatch(channelId: string): Promise<StockPushJob[]> {
  return withDbLock(`stock-push:${channelId}`, async (tx) => {
    const now = new Date();
    const orphaned = await tx.stockPushJob.updateMany({
      where: {
        channelId,
        status: StockPushStatus.RUNNING,
        updatedAt: { lt: new Date(now.getTime() - STOCK_PUSH_LEASE_SECONDS * 1000) },
      },
      data: { status: StockPushStatus.PENDING, nextRetryAt: now },
    });
    if (orphaned.count > 0) {
      console.warn(
        `[Stock-push] Gian ${channelId}: trả ${orphaned.count} dòng kẹt RUNNING quá ${STOCK_PUSH_LEASE_SECONDS} giây về hàng chờ`
      );
    }
    const busy = await tx.stockPushJob.findFirst({
      where: { channelId, status: StockPushStatus.RUNNING },
      select: { id: true },
    });
    if (busy) return [];

    const due = await tx.stockPushJob.findMany({
      where: { channelId, status: StockPushStatus.PENDING, nextRetryAt: { lte: now } },
      // Dòng chờ lâu nhất đi trước — SKU đổi liên tục không chen mãi lên đầu.
      orderBy: { updatedAt: "asc" },
      take: BATCH_SIZE,
    });
    if (due.length === 0) return [];
    await tx.stockPushJob.updateMany({
      where: { id: { in: due.map((j) => j.id) } },
      data: { status: StockPushStatus.RUNNING },
    });
    return due;
  });
}

/**
 * Đẩy các dòng ĐÃ NHẬN (đang RUNNING) của MỘT gian — bộ chạy theo gian
 * (workers/stock-queue.ts) gọi.
 *
 * `shouldStop`: hỏi trước mỗi dòng; trả true thì dừng lô (worker đang tắt lúc
 * deploy), các dòng chưa đụng tới được trả về PENDING cho lượt sau. Lô bị lỗi
 * ngoài dự kiến (database) cũng trả các dòng còn lại về PENDING trước khi ném tiếp.
 */
export async function processClaimedJobs(
  channelId: string,
  claimed: StockPushJob[],
  shouldStop?: () => boolean
): Promise<void> {
  // Dòng đã nhận mà chưa xử lý xong (dừng giữa lô / lỗi ngoài dự kiến) phải về
  // lại PENDING — để nằm ở RUNNING thì phải chờ hết hạn mới có người gỡ.
  let next = 0;
  const releaseRest = async (): Promise<void> => {
    const ids = claimed.slice(next).map((j) => j.id);
    if (ids.length === 0) return;
    await prisma.stockPushJob
      .updateMany({
        where: { id: { in: ids }, status: StockPushStatus.RUNNING },
        data: { status: StockPushStatus.PENDING },
      })
      .catch((err) => console.error("[Stock-push] Không trả được dòng dở về hàng chờ:", (err as Error).message));
  };
  try {
    const stoppedEarly = await pushClaimedJobs(channelId, claimed, {
      shouldStop,
      onJobStart: (i) => {
        next = i;
      },
    });
    if (stoppedEarly) await releaseRest();
  } catch (err) {
    await releaseRest();
    throw err;
  }
}

/** Trả true khi dừng giữa lô theo `shouldStop` (các dòng từ dòng đang đứng trở đi chưa xử lý). */
async function pushClaimedJobs(
  channelId: string,
  claimed: StockPushJob[],
  hooks: { shouldStop?: () => boolean; onJobStart: (index: number) => void }
): Promise<boolean> {
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, status: "ACTIVE", refreshToken: { not: null } },
  });
  if (!channel) {
    // Gian đã ngắt kết nối/xóa — job không còn ý nghĩa.
    await prisma.stockPushJob.deleteMany({
      where: { id: { in: claimed.map((j) => j.id) } },
    });
    return false;
  }

  // Không lấy nổi token = không đẩy được SKU nào của gian này → chốt FAILED cả
  // loạt + MỘT cảnh báo cấp gian, khỏi retry từng SKU vô ích (mirror hành vi
  // của syncShopeeStockForProducts).
  let shopeeAuth: { accessToken: string; shopId: string } | null = null;
  let lazadaToken: string | null = null;
  let tiktokAuth: { accessToken: string; shopCipher: string } | null = null;
  // Kho bán hàng mặc định TikTok — tra MỘT lần cho cả loạt job của gian.
  let tiktokDefaultWarehouse: string | null | undefined;
  try {
    if (channel.channelName === ChannelName.SHOPEE) {
      shopeeAuth = await getValidShopeeAccessToken(channel);
    } else if (channel.channelName === ChannelName.LAZADA) {
      lazadaToken = await getValidLazadaAccessToken(channel);
    } else if (channel.channelName === ChannelName.TIKTOK) {
      tiktokAuth = await getValidTiktokAccessToken(channel);
    } else {
      // Sàn chưa hỗ trợ chiều đẩy (job rác) — dọn.
      await prisma.stockPushJob.deleteMany({
        where: { id: { in: claimed.map((j) => j.id) } },
      });
      return false;
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
      message: describeChannelFailure(channel.shopName, msg),
    });
    return false;
  }

  // Tồn an toàn mặc định của CHỦ gian — một lần cho cả loạt.
  const setting = await prisma.shopSyncSetting.findUnique({
    where: { userId: channel.userId },
    select: { safetyStockDefault: true },
  });
  const safetyDefault = setting?.safetyStockDefault ?? 0;

  let first = true;
  for (const [index, job] of claimed.entries()) {
    hooks.onJobStart(index);
    if (hooks.shouldStop?.()) return true;
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
        try {
          await updateShopeeStock(
            shopeeAuth.accessToken,
            shopeeAuth.shopId,
            ids.itemId,
            pushValue,
            ids.modelId,
            mapping.channelStockLocationId
          );
        } catch (err) {
          // Shop nhiều kho báo thiếu location_id → tự đọc kho đang giữ hàng,
          // lưu lại cho các lần sau rồi đẩy lại NGAY một lượt (tự chữa lành,
          // seller không phải làm gì).
          const raw = (err as Error).message;
          if (classifyStockPushFailure(raw) !== "multi-warehouse") throw err;
          const locationId = await resolveShopeeLocationId(shopeeAuth, ids);
          if (!locationId) throw err;
          await prisma.channelProduct.updateMany({
            where: { channelId, channelSku: job.channelSku },
            data: { channelStockLocationId: locationId },
          });
          await sleep(PACE_MS);
          await updateShopeeStock(
            shopeeAuth.accessToken,
            shopeeAuth.shopId,
            ids.itemId,
            pushValue,
            ids.modelId,
            locationId
          );
        }
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
      } else if (channel.channelName === ChannelName.TIKTOK && tiktokAuth) {
        // externalId TikTok dạng "productId-skuId" (tiktok-adapter). Tồn ghi
        // theo KHO: dùng warehouse adapter đã lưu, thiếu thì tra kho bán hàng
        // mặc định của shop một lần rồi lưu lại cho các lần sau.
        const [productId, skuId] = mapping.externalId.split("-");
        if (!productId || !skuId) {
          await prisma.stockPushJob.deleteMany({ where: { id: job.id } });
          continue;
        }
        let warehouseId = mapping.channelStockLocationId;
        if (!warehouseId) {
          if (tiktokDefaultWarehouse === undefined) {
            const list = await getWarehouses(tiktokAuth);
            const sales = list.filter(
              (w) => (w.effect_status ?? "ENABLED").toUpperCase() === "ENABLED" &&
                (w.type ?? "SALES_WAREHOUSE").toUpperCase() === "SALES_WAREHOUSE"
            );
            tiktokDefaultWarehouse = (sales.find((w) => w.is_default) ?? sales[0])?.id ?? null;
          }
          warehouseId = tiktokDefaultWarehouse;
          if (!warehouseId) throw new Error("Không tìm thấy kho bán hàng TikTok của gian (logistics/warehouses)");
          await prisma.channelProduct.updateMany({
            where: { channelId, channelSku: job.channelSku },
            data: { channelStockLocationId: warehouseId },
          });
        }
        await updateTiktokInventory({
          ...tiktokAuth,
          productId,
          skuId,
          warehouseId,
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
      // Đẩy được rồi → cảnh báo lệch tồn cũ của SKU này tự đóng.
      await resolveSyncAlerts(channelId, job.channelSku);
      // Chỉ xóa khi job VẪN là RUNNING của mình — enqueue mới trong lúc đẩy đã
      // reset về PENDING thì giữ lại cho lượt sau (đẩy lại số mới, vô hại).
      await prisma.stockPushJob.deleteMany({
        where: { id: job.id, status: StockPushStatus.RUNNING },
      });
    } catch (err) {
      await handleJobFailure(job, channel.shopName, pushValue, (err as Error).message);
    }
  }
  return false;
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
    message: describeStockPushFailure({
      raw: message,
      shopName,
      channelSku: job.channelSku,
      expected: pushValue,
    }),
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
