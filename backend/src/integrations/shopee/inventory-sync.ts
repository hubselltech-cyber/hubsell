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

import { ChannelName, StockSyncStatus, WebhookJobStatus } from "@prisma/client";
import type { Channel } from "@prisma/client";
import { prisma } from "../../prisma";
import {
  getItemBaseInfo,
  getModelList,
  shopeeSellerStock,
  updateShopeeStock,
} from "./client";
import { getValidShopeeAccessToken } from "./service";

/** Số lần thử đẩy tồn cho MỘT SKU (1 lần đầu + 2 lần retry). */
const SYNC_MAX_ATTEMPTS = 3;
/** Giãn cách trước lần thử lại đầu tiên; các lần sau nhân đôi (2s → 4s). */
const SYNC_BASE_DELAY_MS = 2000;

// ---------- Double-Check (Reconciliation) ----------
//
// update_stock của Shopee có thể trả 200 OK nhưng dữ liệu trên sàn GHI TRỄ.
// Vì vậy mỗi lượt đẩy thành công cho một (gian × SKU) không được tin ngay:
// ta ghi một JOB ĐỐI SOÁT vào chính hàng đợi bền shopee_webhook_logs (status
// VERIFYING, hẹn giờ VERIFY_DELAY_MS). Worker đến giờ sẽ gọi API đọc lại tồn
// thực tế trên sàn (get_item_base_info / get_model_list) và so khớp — xem
// verifyStockPush() bên dưới + nhánh xử lý trong webhook-queue.ts.

/** eventCode NỘI BỘ đánh dấu job đối soát tồn (Shopee chỉ dùng 3/4/5). */
export const STOCK_VERIFY_EVENT_CODE = 100;
/** Chờ bao lâu sau khi đẩy tồn mới kiểm tra chéo (cho sàn kịp ghi). */
export const VERIFY_DELAY_MS = 3 * 60 * 1000;

/** Nội dung một job đối soát, lưu JSON trong cột payload. */
export interface StockVerifyPayload {
  kind: "stock-verify";
  channelId: string;
  channelSku: string;
  productId: string;
  itemId: number;
  modelId?: number;
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

/** Bóc (item_id, model_id) từ ChannelProduct.externalId ("123" | "123-456"). */
function parseShopeeExternalId(
  externalId: string | null
): { itemId: number; modelId?: number } | null {
  const m = /^(\d+)(?:-(\d+))?$/.exec(externalId ?? "");
  if (!m) return null;
  return { itemId: Number(m[1]), modelId: m[2] ? Number(m[2]) : undefined };
}

/**
 * Đẩy tồn khả dụng hiện tại của các sản phẩm lên mọi gian Shopee có mapping.
 * Best-effort: lỗi được retry + ghi log + bắn cảnh báo bên trong, KHÔNG ném ra.
 */
export async function syncShopeeStockForProducts(
  req: StockSyncRequest,
  source: string
): Promise<void> {
  try {
    if (req.productIds.length === 0) return;

    // Đọc trạng thái MỚI NHẤT — giữa lúc biến động và lúc đẩy có thể đã có đơn
    // khác chen vào; đẩy số hiện tại luôn an toàn hơn số tính từ trước.
    const products = await prisma.product.findMany({
      where: { id: { in: req.productIds } },
      select: { id: true, skuCode: true, quantityInStock: true, holdQuantity: true },
    });
    if (products.length === 0) return;
    const byProduct = new Map(products.map((p) => [p.id, p]));

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
        channel: true,
      },
    });
    if (mappings.length === 0) return;

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
        for (const mp of chMappings) {
          await recordSyncResult(channel.id, mp.channelSku, mp.productId, req, {
            ok: false,
            attempts: 0,
            error: `Không lấy được access_token: ${msg}`,
          });
        }
        await createSyncAlert(channel.id, {
          orderSn: req.orderSn,
          message: `Không đồng bộ được tồn kho lên gian "${channel.shopName}": ${msg}. Kiểm tra kết nối/uỷ quyền lại gian hàng.`,
        });
        continue;
      }

      for (const mp of chMappings) {
        const product = byProduct.get(mp.productId!);
        if (!product) continue;
        const ids = parseShopeeExternalId(mp.externalId);
        if (!ids) continue; // mapping cũ chưa có externalId chuẩn — bỏ qua

        const available = product.quantityInStock - product.holdQuantity;
        // Sàn không nhận tồn âm — âm nghĩa là ĐÃ bán vượt, đẩy 0 để chặn bán thêm.
        const pushValue = Math.max(0, available);

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
              ids.modelId
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
            message: `Đẩy tồn kho SKU ${mp.channelSku} lên gian "${channel.shopName}" thất bại sau ${SYNC_MAX_ATTEMPTS} lần thử: ${lastError}. Tồn trên sàn đang LỆCH (đúng phải là ${pushValue}) — cần chỉnh tay để tránh bán vượt/bị phạt.`,
          });
        }
      }
    }
  } catch (err) {
    // Lỗi ngoài dự kiến (DB...) — nuốt để không kéo sập job đơn hàng, chỉ log.
    console.error("[Inventory Sync] Lỗi ngoài dự kiến khi đồng bộ tồn Shopee:", err);
  }
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

  console.log(
    `[Inventory Sync] [${new Date().toISOString()}] - [${channelSku}] - [cũ ${oldQty}] - [mới ${newQty}] - [${result.ok ? "Thành công" : "Thất bại"}]${result.error ? ` — ${result.error}` : ""}`
  );
}

function source(req: StockSyncRequest): string {
  return req.orderSn ? `webhook Shopee đơn ${req.orderSn}` : "webhook Shopee";
}

/**
 * Ghi/làm mới JOB ĐỐI SOÁT cho một (gian × SKU) vào hàng đợi bền.
 *
 * Khoá `bodyHash` là chuỗi ổn định "stock-verify:{channelId}:{channelSku}" →
 * upsert: nhiều lượt đẩy liên tiếp cho cùng SKU GỘP về một job đối soát duy
 * nhất, tự dời giờ hẹn và reset số lần thử — worker chỉ đối soát trạng thái
 * MỚI NHẤT thay vì rượt đuổi từng lượt đẩy cũ. Best-effort: lỗi DB chỉ log.
 */
async function scheduleStockVerification(
  channel: Channel,
  payload: StockVerifyPayload
): Promise<void> {
  try {
    const bodyHash = `stock-verify:${payload.channelId}:${payload.channelSku}`;
    const data = {
      status: WebhookJobStatus.VERIFYING,
      attempts: 0,
      nextRetryAt: new Date(Date.now() + VERIFY_DELAY_MS),
      lastError: null,
      processedAt: null,
      orderSn: payload.orderSn ?? null,
      payload: JSON.stringify(payload),
    };
    await prisma.shopeeWebhookLog.upsert({
      where: { bodyHash },
      update: data,
      create: {
        eventCode: STOCK_VERIFY_EVENT_CODE,
        shopId: channel.externalShopId ?? "",
        bodyHash,
        ...data,
      },
    });
  } catch (err) {
    console.error("[Inventory Sync] Không lên lịch được job đối soát:", err);
  }
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
    select: { quantityInStock: true, holdQuantity: true },
  });
  if (!channel || !product) return { outcome: "gone" };

  const expected = Math.max(0, product.quantityInStock - product.holdQuantity);
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
  await updateShopeeStock(accessToken, shopId, payload.itemId, expected, payload.modelId);
  return { outcome: "mismatch", expected, actual };
}

/** Tạo cảnh báo lệch tồn cho UI (best-effort — lỗi DB chỉ log, không ném). */
export async function createSyncAlert(
  channelId: string,
  data: { channelSku?: string; orderSn?: string; message: string }
): Promise<void> {
  try {
    await prisma.inventorySyncAlert.create({
      data: {
        channelId,
        channelSku: data.channelSku ?? null,
        orderSn: data.orderSn ?? null,
        message: data.message,
      },
    });
  } catch (err) {
    console.error("[Inventory Sync] Không tạo được InventorySyncAlert:", err);
  }
}
