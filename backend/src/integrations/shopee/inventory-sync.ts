// ============================================================
// ĐỒNG BỘ TỒN KHO NGƯỢC LÊN SHOPEE (Inventory Sync)
//
// Khi một đơn webhook làm biến động kho (hold / trừ / hoàn), tồn KHẢ DỤNG mới
//   available = quantityInStock − holdQuantity
// phải được đẩy NGAY lên MỌI gian Shopee đang liên kết SKU đó (kể cả gian khác
// gian phát sinh đơn) — đây chính là chốt chặn bán vượt kho đa gian.
//
// Nguyên tắc chịu lỗi:
//   · Hàm public KHÔNG BAO GIỜ ném lỗi — đơn đã ghi DB xong, việc đẩy tồn là
//     best-effort với retry riêng; ném lên worker sẽ làm cả job đơn hàng chạy lại.
//   · Mỗi SKU retry tối đa SYNC_MAX_ATTEMPTS lần, giãn cách NHÂN ĐÔI
//     (exponential backoff). Hết lượt vẫn lỗi → ghi log FAILED + bắn
//     InventorySyncAlert để UI nhắc chủ shop chỉnh tay trên sàn.
//   · Mỗi lượt (thành công lẫn thất bại) ghi một dòng InventorySyncLog:
//     [thời gian] − [SKU] − [số cũ] − [số mới] − [trạng thái] để đối soát.
// ============================================================

import { ChannelName, StockSyncStatus } from "@prisma/client";
import type { Channel } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { isQueueReady, QUEUES, upsertQueued } from "../../lib/queue";
import { availableToPush } from "../inventory-push";
import {
  getItemBaseInfo,
  getModelList,
  shopeeSellerStock,
  shopeeStockLocationId,
  updateShopeeStock,
} from "./client";
import { getValidShopeeAccessToken } from "./service";
import {
  describeChannelFailure,
  describeStockPushFailure,
} from "../../services/sync-alert-text";

/** Số lần thử đẩy tồn cho MỘT SKU (1 lần đầu + 2 lần retry). */
const SYNC_MAX_ATTEMPTS = 3;
/** Giãn cách trước lần thử lại đầu tiên; các lần sau nhân đôi (2s → 4s). */
const SYNC_BASE_DELAY_MS = 2000;

// ---------- Double-Check (Reconciliation) ----------
//
// update_stock của Shopee có thể trả 200 OK nhưng dữ liệu trên sàn GHI TRỄ.
// Vì vậy mỗi lượt đẩy thành công cho một (gian × SKU) không được tin ngay:
// ta xếp một VIỆC ĐỐI SOÁT hẹn giờ VERIFY_DELAY_MS vào hàng đợi stock.verify
// (scheduleStockVerifyJob / runStockVerifyJob bên dưới). Tới giờ worker gọi API
// đọc lại tồn thực tế trên sàn (get_item_base_info / get_model_list) và so khớp
// — xem verifyStockPush(). (Trước bước 6b việc này từng nhét chung vào bảng
// shopee_webhook_logs.)

/** Chờ bao lâu sau khi đẩy tồn mới kiểm tra chéo (cho sàn kịp ghi). */
export const VERIFY_DELAY_MS = 3 * 60 * 1000;
/** Số lượt đối soát tối đa cho một lần đẩy. */
export const VERIFY_MAX_ATTEMPTS = 3;

/** Nội dung một job đối soát, lưu JSON trong cột payload. */
export interface StockVerifyPayload {
  kind: "stock-verify";
  channelId: string;
  channelSku: string;
  productId: string;
  itemId: number;
  modelId?: number;
  /** location_id kho Shopee của SKU (nếu sàn khai) — đẩy lại phải gửi kèm. */
  locationId?: string;
  orderSn?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Yêu cầu đồng bộ tồn sau một biến động kho. `oldAvailable` là snapshot tồn
 * khả dụng TRƯỚC biến động (chụp trong transaction) — chỉ phục vụ cột "số cũ"
 * của log đối soát; số ĐẨY LÊN SÀN luôn đọc lại trạng thái mới nhất lúc đẩy.
 */
export interface StockSyncRequest {
  /** Đơn gây ra biến động (để ghi vào log/cảnh báo). */
  orderSn?: string;
  productIds: string[];
  oldAvailable: Record<string, number>;
}

/** Bóc (item_id, model_id) từ ChannelProduct.externalId ("123" | "123-456").
 *  Export cho worker đẩy tồn đa sàn (stock-push-worker) dùng chung. */
export function parseShopeeExternalId(
  externalId: string | null
): { itemId: number; modelId?: number } | null {
  const m = /^(\d+)(?:-(\d+))?$/.exec(externalId ?? "");
  if (!m) return null;
  return { itemId: Number(m[1]), modelId: m[2] ? Number(m[2]) : undefined };
}

/**
 * Đẩy tồn khả dụng hiện tại của các sản phẩm lên mọi gian Shopee có mapping.
 * Best-effort: lỗi được retry + ghi log + bắn cảnh báo bên trong, KHÔNG ném ra.
 * Trả bộ đếm {pushed, failed} để tầng gọi chủ động (force-sync) biết kết quả.
 */
export async function syncShopeeStockForProducts(
  req: StockSyncRequest
): Promise<{ pushed: number; failed: number }> {
  const summary = { pushed: 0, failed: 0 };
  try {
    if (req.productIds.length === 0) return summary;

    // Đọc trạng thái MỚI NHẤT — giữa lúc biến động và lúc đẩy có thể đã có đơn
    // khác chen vào; đẩy số hiện tại luôn an toàn hơn số tính từ trước.
    const products = await prisma.product.findMany({
      where: { id: { in: req.productIds } },
      select: {
        id: true,
        userId: true,
        skuCode: true,
        quantityInStock: true,
        holdQuantity: true,
        safetyStock: true,
      },
    });
    if (products.length === 0) return summary;
    const byProduct = new Map(products.map((p) => [p.id, p]));

    // Tồn an toàn mặc định theo chủ shop (SKU không đặt riêng thì dùng số này).
    const ownerIds = [...new Set(products.map((p) => p.userId))];
    const settings = await prisma.shopSyncSetting.findMany({
      where: { userId: { in: ownerIds } },
      select: { userId: true, safetyStockDefault: true },
    });
    const safetyDefaultByOwner = new Map(
      settings.map((s) => [s.userId, s.safetyStockDefault])
    );

    const mappings = await prisma.channelProduct.findMany({
      where: {
        productId: { in: products.map((p) => p.id) },
        externalId: { not: null },
        channel: {
          channelName: ChannelName.SHOPEE,
          status: "ACTIVE",
          refreshToken: { not: null },
        },
      },
      select: {
        channelSku: true,
        externalId: true,
        productId: true,
        channelStockLocationId: true,
        channel: true,
      },
    });
    if (mappings.length === 0) return summary;

    // Gom theo gian để mỗi gian chỉ lấy access_token một lần.
    const byChannel = new Map<string, typeof mappings>();
    for (const mp of mappings) {
      const list = byChannel.get(mp.channel.id) ?? [];
      list.push(mp);
      byChannel.set(mp.channel.id, list);
    }

    for (const chMappings of byChannel.values()) {
      const channel = chMappings[0].channel;

      // Không lấy nổi token (hết hạn uỷ quyền...) = không đẩy được SKU nào của
      // gian này → log FAILED + cảnh báo cấp gian, khỏi retry từng SKU vô ích.
      let auth: { accessToken: string; shopId: string };
      try {
        auth = await getValidShopeeAccessToken(channel);
      } catch (err) {
        const msg = (err as Error).message;
        summary.failed += chMappings.length;
        for (const mp of chMappings) {
          await recordSyncResult(channel.id, mp.channelSku, mp.productId, req, {
            ok: false,
            attempts: 0,
            error: `Không lấy được access_token: ${msg}`,
          });
        }
        await createSyncAlert(channel.id, {
          orderSn: req.orderSn,
          message: describeChannelFailure(channel.shopName, msg),
        });
        continue;
      }

      for (const mp of chMappings) {
        const product = byProduct.get(mp.productId!);
        if (!product) continue;
        const ids = parseShopeeExternalId(mp.externalId);
        if (!ids) continue; // mapping cũ chưa có externalId chuẩn — bỏ qua

        // Tồn khả dụng = tồn − hold − tồn an toàn; âm nghĩa là ĐÃ bán vượt,
        // availableToPush tự chặn sàn 0 (sàn không nhận tồn âm).
        const pushValue = availableToPush(
          product,
          safetyDefaultByOwner.get(product.userId) ?? 0
        );
        const available = pushValue;

        let lastError = "";
        let ok = false;
        let attempt = 0;
        while (attempt < SYNC_MAX_ATTEMPTS && !ok) {
          attempt++;
          try {
            await updateShopeeStock(
              auth.accessToken,
              auth.shopId,
              ids.itemId,
              pushValue,
              ids.modelId,
              mp.channelStockLocationId
            );
            ok = true;
          } catch (err) {
            lastError = (err as Error).message;
            if (attempt < SYNC_MAX_ATTEMPTS) {
              // Exponential backoff: 2s → 4s trước hai lần thử lại.
              await sleep(SYNC_BASE_DELAY_MS * 2 ** (attempt - 1));
            }
          }
        }

        if (ok) summary.pushed += 1;
        else summary.failed += 1;

        await recordSyncResult(channel.id, mp.channelSku, mp.productId, req, {
          ok,
          attempts: attempt,
          newAvailable: available,
          error: ok ? undefined : lastError,
        });

        if (ok) {
          // 200 OK chưa chắc sàn đã ghi — hẹn giờ Double-Check đọc lại tồn.
          await scheduleStockVerification(channel, {
            kind: "stock-verify",
            channelId: channel.id,
            channelSku: mp.channelSku,
            productId: mp.productId!,
            itemId: ids.itemId,
            modelId: ids.modelId,
            orderSn: req.orderSn,
          });
        }

        if (!ok) {
          await createSyncAlert(channel.id, {
            channelSku: mp.channelSku,
            orderSn: req.orderSn,
            message: describeStockPushFailure({
              raw: lastError,
              shopName: channel.shopName,
              channelSku: mp.channelSku,
              expected: pushValue,
            }),
          });
        }
      }
    }
  } catch (err) {
    // Lỗi ngoài dự kiến (DB...) — nuốt để không kéo sập job đơn hàng, chỉ log.
    console.error("[Inventory Sync] Lỗi ngoài dự kiến khi đồng bộ tồn Shopee:", err);
  }
  return summary;
}

/** Ghi một dòng đối soát + in log chuẩn [thời gian]−[SKU]−[cũ]−[mới]−[trạng thái]. */
async function recordSyncResult(
  channelId: string,
  channelSku: string,
  productId: string | null,
  req: StockSyncRequest,
  result: { ok: boolean; attempts: number; newAvailable?: number; error?: string }
): Promise<void> {
  const snapshot = productId ? req.oldAvailable[productId] : undefined;
  const oldQty = snapshot ?? result.newAvailable ?? 0;
  const newQty = result.newAvailable ?? oldQty;
  const ctx = [
    source(req),
    result.attempts > 1 ? `sau ${result.attempts} lần thử` : null,
    result.error ? `lỗi: ${result.error}` : null,
  ]
    .filter(Boolean)
    .join(" — ");

  try {
    await prisma.inventorySyncLog.create({
      data: {
        channelId,
        channelSku,
        productId,
        oldQuantity: oldQty,
        newQuantity: newQty,
        status: result.ok ? StockSyncStatus.SUCCESS : StockSyncStatus.FAILED,
        message: ctx || null,
      },
    });
  } catch (err) {
    console.error("[Inventory Sync] Không ghi được InventorySyncLog:", err);
  }
  // Đẩy được rồi → cảnh báo lệch tồn cũ của SKU này tự đóng.
  if (result.ok) await resolveSyncAlerts(channelId, channelSku);

  console.log(
    `[Inventory Sync] [${new Date().toISOString()}] - [${channelSku}] - [cũ ${oldQty}] - [mới ${newQty}] - [${result.ok ? "Thành công" : "Thất bại"}]${result.error ? ` — ${result.error}` : ""}`
  );
}

function source(req: StockSyncRequest): string {
  return req.orderSn ? `webhook Shopee đơn ${req.orderSn}` : "webhook Shopee";
}

/**
 * Hẹn VIỆC ĐỐI SOÁT cho một (gian × SKU) sau khi đẩy tồn thành công. Nhiều lượt
 * đẩy liên tiếp cho cùng SKU gộp về một việc (xem scheduleStockVerifyJob).
 * Best-effort, không ném: hàng đợi chưa sẵn sàng hoặc xếp lỗi thì chỉ ghi log —
 * lượt đẩy đã xong, đối soát tồn 6 giờ (workers/stock-reconcile.ts) là lưới.
 */
export async function scheduleStockVerification(
  channel: Channel,
  payload: StockVerifyPayload
): Promise<void> {
  if (!isQueueReady()) {
    console.warn(
      `[Inventory Sync] Hàng đợi bền chưa sẵn sàng — bỏ lượt đối soát SKU ${payload.channelSku} của gian "${channel.shopName}" (đối soát 6 giờ sẽ soát lại)`
    );
    return;
  }
  try {
    await scheduleStockVerifyJob({ ...payload, attempt: 1 });
  } catch (err) {
    console.error(
      `[Inventory Sync] Không xếp được việc đối soát SKU ${payload.channelSku} vào stock.verify (đối soát 6 giờ sẽ soát lại):`,
      (err as Error).message
    );
  }
}

// ---------- Đối soát qua hàng đợi bền stock.verify (giai đoạn 2 bước 4) ----------

/** Dữ liệu một việc stock.verify: nội dung đối soát + đang ở lượt thứ mấy (1 = lượt đầu). */
export interface StockVerifyJob extends StockVerifyPayload {
  attempt?: number;
}

/**
 * Xếp / dời việc đối soát của một (gian × SKU). Khóa theo (gian, SKU): đã có
 * việc đang chờ thì ghi đè nội dung và dời giờ hẹn về VERIFY_DELAY_MS kể từ bây
 * giờ — nhiều lượt đẩy liên tiếp của một SKU vẫn chỉ sinh MỘT lượt đọc lại tồn
 * sàn, đọc sau lượt đẩy cuối (đúng cách gộp của bảng cũ). Ném khi hàng đợi lỗi.
 */
export async function scheduleStockVerifyJob(job: StockVerifyJob): Promise<void> {
  await upsertQueued(
    QUEUES.stockVerify,
    job,
    `${job.channelId}:${job.channelSku}`,
    undefined,
    Math.round(VERIFY_DELAY_MS / 1000)
  );
}

/**
 * MỘT LƯỢT của việc stock.verify — cùng luật với handleStockVerifyJob của bảng cũ
 * (shopee/webhook-queue.ts): khớp / không còn gì để soát → xong; lệch (đã đẩy
 * lại bên trong verifyStockPush) hoặc lỗi tạm thời → hẹn lượt kế sau
 * VERIFY_DELAY_MS; hết VERIFY_MAX_ATTEMPTS lượt vẫn chưa khớp → cảnh báo chủ shop.
 * Lỗi của sàn KHÔNG ném ra (đã được đếm lượt ở đây); chỉ lỗi database lúc hẹn
 * lượt kế / ghi cảnh báo mới ném, để hàng đợi tự thử lại.
 */
export async function runStockVerifyJob(job: StockVerifyJob): Promise<void> {
  const attempt = job.attempt ?? 1;
  let reason: string;
  try {
    const result = await verifyStockPush(job);
    if (result.outcome === "gone") return;
    if (result.outcome === "match") {
      console.log(
        `[Inventory Sync] Đối soát khớp: SKU ${job.channelSku} — sàn = Hubsell = ${result.actual} (lượt ${attempt})`
      );
      return;
    }
    reason = `Đối soát lượt ${attempt}/${VERIFY_MAX_ATTEMPTS}: sàn còn ${result.actual} ≠ Hubsell ${result.expected} — đã đẩy lại`;
    console.warn(`[Inventory Sync] ${reason} (SKU ${job.channelSku})`);
  } catch (err) {
    reason = (err as Error).message;
    console.error(
      `[Inventory Sync] Đối soát lỗi lượt ${attempt}/${VERIFY_MAX_ATTEMPTS} (SKU ${job.channelSku}): ${reason}`
    );
  }

  if (attempt < VERIFY_MAX_ATTEMPTS) {
    await scheduleStockVerifyJob({ ...job, attempt: attempt + 1 });
    return;
  }
  const shopName =
    (await prisma.channel.findUnique({ where: { id: job.channelId }, select: { shopName: true } }))?.shopName ??
    "Shopee";
  await createSyncAlert(job.channelId, {
    channelSku: job.channelSku,
    orderSn: job.orderSn,
    message: describeStockPushFailure({
      raw: `đối soát ${VERIFY_MAX_ATTEMPTS} lượt vẫn chưa khớp: ${reason}`,
      shopName,
      channelSku: job.channelSku,
    }),
  });
}

export type StockVerifyOutcome =
  | { outcome: "match"; expected: number; actual: number }
  /** Sàn còn lệch — ĐÃ đẩy lại update_stock, cần hẹn giờ kiểm tra tiếp. */
  | { outcome: "mismatch"; expected: number; actual: number }
  /** Mapping/sản phẩm/gian không còn — không có gì để đối soát nữa. */
  | { outcome: "gone" };

/**
 * MỘT LƯỢT ĐỐI SOÁT: đọc tồn thực tế trên sàn và so với tồn khả dụng HIỆN TẠI
 * của Hubsell (đọc lại lúc đối soát — giữa 2 mốc có thể đã có đơn khác).
 * Lệch → đẩy lại update_stock ngay trong lượt này rồi trả "mismatch" để worker
 * hẹn giờ kiểm tra tiếp. Lỗi tạm thời (mạng/token/sàn không trả số tồn) thì
 * NÉM — worker đếm lượt và hẹn giờ y như mismatch.
 */
export async function verifyStockPush(
  payload: StockVerifyPayload
): Promise<StockVerifyOutcome> {
  const channel = await prisma.channel.findFirst({
    where: {
      id: payload.channelId,
      status: "ACTIVE",
      refreshToken: { not: null },
    },
  });
  const product = await prisma.product.findUnique({
    where: { id: payload.productId },
    select: {
      userId: true,
      quantityInStock: true,
      holdQuantity: true,
      safetyStock: true,
    },
  });
  if (!channel || !product) return { outcome: "gone" };

  // Cùng MỘT công thức với chiều đẩy — lệch công thức là đối soát báo sai mãi.
  const setting = await prisma.shopSyncSetting.findUnique({
    where: { userId: product.userId },
    select: { safetyStockDefault: true },
  });
  const expected = availableToPush(product, setting?.safetyStockDefault ?? 0);
  const { accessToken, shopId } = await getValidShopeeAccessToken(channel);

  // Đọc tồn thực tế: sản phẩm có phân loại nằm ở get_model_list, đơn ở base_info.
  let actual: number | null = null;
  if (payload.modelId) {
    const models = await getModelList(accessToken, shopId, payload.itemId);
    const model = models.find((m) => m.model_id === payload.modelId);
    actual = shopeeSellerStock(model?.stock_info_v2);
  } else {
    const infos = await getItemBaseInfo(accessToken, shopId, [payload.itemId]);
    actual = shopeeSellerStock(infos[0]?.stock_info_v2);
  }
  if (actual === null) {
    throw new Error(
      `Shopee không trả số tồn cho item ${payload.itemId}${payload.modelId ? ` model ${payload.modelId}` : ""} — chưa đối soát được`
    );
  }

  if (actual === expected) return { outcome: "match", expected, actual };

  // Sàn ghi trễ / lệch thật → đẩy lại số đúng ngay, worker sẽ kiểm tra tiếp.
  await updateShopeeStock(
    accessToken,
    shopId,
    payload.itemId,
    expected,
    payload.modelId,
    payload.locationId ?? null
  );
  return { outcome: "mismatch", expected, actual };
}

/**
 * Tạo cảnh báo lệch tồn cho UI (best-effort — lỗi DB chỉ log, không ném).
 *
 * Ngoài bản ghi InventorySyncAlert (banner trang Kho + thẻ cảnh báo nhãn [SÀN]
 * trên Trung tâm điều hành), còn ghi MỘT dòng OpsActivity — nhật ký vận hành
 * có sẵn của Trung tâm điều hành — để sự cố xuất hiện ngay trong dòng thời
 * gian của chủ shop, kể cả khi họ chưa nhìn thấy thẻ cảnh báo.
 */
export async function createSyncAlert(
  channelId: string,
  data: { channelSku?: string; orderSn?: string; message: string }
): Promise<void> {
  try {
    // MỘT cảnh báo cho mỗi (gian × SKU) đang mở: lượt đẩy sau lại fail thì làm
    // mới nội dung + mốc giờ thay vì đẻ thêm dòng (100 SKU = 100 thẻ, không phải 300).
    const existing = data.channelSku
      ? await prisma.inventorySyncAlert.findFirst({
          where: { channelId, channelSku: data.channelSku, resolvedAt: null },
          select: { id: true },
        })
      : null;
    if (existing) {
      await prisma.inventorySyncAlert.update({
        where: { id: existing.id },
        data: { message: data.message, orderSn: data.orderSn ?? null, createdAt: new Date() },
      });
      return;
    }

    await prisma.inventorySyncAlert.create({
      data: {
        channelId,
        channelSku: data.channelSku ?? null,
        orderSn: data.orderSn ?? null,
        message: data.message,
      },
    });

    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { userId: true, shopName: true, channelName: true },
    });
    if (channel) {
      // Dòng thời gian vận hành: lấy DÒNG 1 của lời cảnh báo (tiếng người),
      // bỏ chi tiết kỹ thuật sau "\n".
      const plain = data.message.split("\n")[0];
      await prisma.opsActivity.create({
        data: {
          ownerId: channel.userId,
          tag: "channel", // nhãn [SÀN] trên Trung tâm điều hành
          message: `⚠️ ${plain}`,
        },
      });
    }
  } catch (err) {
    console.error("[Inventory Sync] Không tạo được InventorySyncAlert:", err);
  }
}

/**
 * Đẩy tồn THÀNH CÔNG cho (gian × SKU) → mọi cảnh báo lệch tồn đang mở của SKU
 * đó tự đóng: seller không phải bấm "Đã xử lý" cho lỗi đã tự hết.
 */
export async function resolveSyncAlerts(channelId: string, channelSku: string): Promise<void> {
  try {
    await prisma.inventorySyncAlert.updateMany({
      where: { channelId, channelSku, resolvedAt: null },
      data: { resolvedAt: new Date() },
    });
  } catch (err) {
    console.error("[Inventory Sync] Không tự đóng được cảnh báo:", err);
  }
}

/**
 * Shop Shopee khai nhiều kho ("multi warehouse") thì update_stock bắt buộc kèm
 * location_id. Đọc lại stock_info_v2 của item/model để chọn kho đang giữ hàng
 * (shopeeStockLocationId) — worker gọi khi sàn báo thiếu location rồi đẩy lại.
 */
export async function resolveShopeeLocationId(
  auth: { accessToken: string; shopId: string },
  ids: { itemId: number; modelId?: number }
): Promise<string | null> {
  if (ids.modelId) {
    const models = await getModelList(auth.accessToken, auth.shopId, ids.itemId);
    const m = models.find((x) => x.model_id === ids.modelId);
    return shopeeStockLocationId(m?.stock_info_v2);
  }
  const infos = await getItemBaseInfo(auth.accessToken, auth.shopId, [ids.itemId]);
  return shopeeStockLocationId(infos[0]?.stock_info_v2);
}
