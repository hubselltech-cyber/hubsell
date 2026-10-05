import { Router, type Request, type Response } from "express";
import { InventoryLogType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { applyStockDelta } from "../services/stock-ledger";
import { findMarketplaceProduct, PLATFORM_FEE_RATE } from "../marketplace/mockMarketplace";
import {
  randomCarrierFor,
  randomPhone,
  randomTrackingCode,
} from "../services/shipping";
import { isTikTokConfigured } from "../integrations/tiktok/config";
import { verifyWebhookSignature } from "../integrations/tiktok/client";
import {
  classifyTiktokEvent,
  tiktokPayloadOrderId,
  type TiktokWebhookPayload,
} from "../integrations/tiktok/webhook-queue";
import { isShopeeConfigured } from "../integrations/shopee/config";
import {
  SHOPEE_PUSH_CODE,
  verifyShopeeWebhookSignature,
  type ShopeePushPayload,
} from "../integrations/shopee/webhook";
import { isLazadaConfigured } from "../integrations/lazada/config";
import {
  LAZADA_MSG_ORDER,
  verifyLazadaWebhookSignature,
  type LazadaPushPayload,
} from "../integrations/lazada/webhook";
import {
  isHandledMisaEvent,
  misaSecretMissingInProduction,
  validateMisaPayload,
  verifyMisaWebhookSignature,
  type MisaWebhookPayload,
} from "../integrations/invoice/misa-webhook";
import { enqueueMisaWebhook } from "../integrations/invoice/misa-webhook-queue";
import { getPayosConfig, verifyPayosWebhook } from "../integrations/payos/client";
import { handlePayosWebhook } from "../services/gateway-checkout";
import { isQueueReady } from "../lib/queue";
import { recordAuthEvent, recordOrderEvent } from "../services/webhook-inbox";

const router = Router();

/**
 * Webhook ba sàn CHỈ có một đường: ghi webhook_events + xếp việc pg-boss trong
 * một giao dịch rồi ack (docs/HANG-DOI-BEN.md). Hàng đợi bền chưa sẵn sàng (vài
 * giây đầu lúc tiến trình khởi động, hoặc pg-boss không lên được) thì trả 503 để
 * sàn tự gửi lại; vòng quét đơn định kỳ vẫn là lưới. Đường cũ (bảng
 * shopee_webhook_logs / tiktok_webhook_logs, Lazada xử lý trong RAM sau ack) đã
 * gỡ ở bước 6b — anh Trung chốt 05/10/2026; từ 01/10 tới lúc gỡ nó không nhận sự
 * kiện nào trên prod.
 */
function queueNotReady(res: Response, platform: string): void {
  console.error(`[Webhook ${platform}] Hàng đợi bền chưa sẵn sàng — trả 503 để sàn gửi lại`);
  res.status(503).json({ error: "Máy chủ chưa sẵn sàng nhận sự kiện, hãy gửi lại" });
}

// Route này CHỈ ghi nhận sự kiện; worker (workers/event-queue.ts) xử lý. Webhook
// MISA còn đi hàng đợi riêng trên bảng misa_webhook_logs (gỡ ở bước 6c).

interface MockOrderItem {
  channelSku: string;
  quantity: number;
}

// POST /api/webhooks/mock-order — GIẢ LẬP webhook từ sàn.
// Ở bản thật: Shopee/TikTok sẽ tự gọi vào endpoint này khi có đơn mới.
// Webhook KHÔNG dùng JWT của người dùng — sàn xác thực bằng token của kênh.
//
// Body: {
//   channelId: string,
//   webhookToken: string,          // phải khớp apiToken của kênh
//   customerName?: string,
//   orderCode?: string,
//   items: [{ channelSku: string, quantity: number }]
// }
//
// Luồng xử lý:
// 1. Xác thực kênh + token.
// 2. Với từng SKU sàn → tra bảng đệm ChannelProduct tìm sản phẩm gốc.
// 3. Nếu đủ mapping: trong MỘT transaction — tạo Order, trừ tồn kho
//    sản phẩm gốc (khoá dòng), ghi InventoryLog loại SYNC.
router.post("/mock-order", async (req, res, next) => {
  try {
    const {
      channelId,
      webhookToken,
      customerName,
      customerPhone,
      orderCode,
      items,
    } = req.body ?? {};

    if (typeof channelId !== "string" || typeof webhookToken !== "string") {
      res.status(400).json({ error: "Thiếu channelId hoặc webhookToken" });
      return;
    }
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: "Đơn hàng phải có ít nhất 1 sản phẩm (items)" });
      return;
    }
    for (const it of items as MockOrderItem[]) {
      if (
        typeof it?.channelSku !== "string" ||
        !Number.isInteger(it?.quantity) ||
        it.quantity <= 0
      ) {
        res.status(400).json({ error: "Mỗi item cần channelSku và quantity nguyên dương" });
        return;
      }
    }

    // 1) Xác thực kênh bằng token (thay cho chữ ký webhook của sàn thật)
    const channel = await prisma.channel.findFirst({ where: { id: channelId } });
    if (!channel || channel.apiToken !== webhookToken) {
      res.status(401).json({ error: "Kênh không tồn tại hoặc webhookToken sai" });
      return;
    }
    // Gian ĐÃ NỐI API sàn: đơn chỉ được đến từ sàn (webhook thật / đồng bộ). Đơn
    // giả lập tạo ở đây sẽ trừ kho thật và đi vào báo cáo (rà soát 29/09/2026).
    if (channel.refreshToken !== null) {
      res.status(409).json({ error: "Gian đã kết nối sàn — không tạo đơn thử trên gian này" });
      return;
    }
    if (channel.status !== "ACTIVE") {
      res.status(409).json({ error: "Kênh này đã ngắt kết nối" });
      return;
    }

    // 2) Tra tầng đệm: SKU sàn → sản phẩm gốc.
    // Sản phẩm sàn có trong bảng đệm nhưng productId = null là CHƯA LIÊN KẾT —
    // phải xử lý y như chưa có bản ghi, nếu không sẽ trừ kho vào null.
    const skus = (items as MockOrderItem[]).map((i) => i.channelSku);
    const channelProducts = await prisma.channelProduct.findMany({
      where: {
        channelId: channel.id,
        channelSku: { in: skus },
        productId: { not: null },
      },
    });
    const mapBySku = new Map(channelProducts.map((m) => [m.channelSku, m]));

    const unmapped = skus.filter((sku) => !mapBySku.has(sku));
    if (unmapped.length > 0) {
      res.status(422).json({
        error: `Chưa liên kết (mapping) các SKU sàn sau với sản phẩm gốc: ${unmapped.join(", ")}. Vào trang "Liên kết sản phẩm" để nối trước.`,
        unmappedSkus: unmapped,
      });
      return;
    }

    const finalOrderCode =
      typeof orderCode === "string" && orderCode.trim()
        ? orderCode.trim()
        : `${channel.channelName}-${Date.now()}`;

    // Tính tổng tiền theo giá niêm yết trên sàn
    let totalAmount = 0;
    for (const it of items as MockOrderItem[]) {
      const mp = findMarketplaceProduct(channel.channelName, it.channelSku);
      totalAmount += (mp?.price ?? 0) * it.quantity;
    }

    // 3) Transaction: tạo đơn + trừ kho + ghi log — tất cả hoặc không gì cả
    const result = await prisma.$transaction(async (tx) => {
      // GĐ1 — TẠM TÍNH: dùng % phí cấu hình của kênh (rơi về mặc định nếu chưa có).
      // Số này sẽ được thay bằng số quyết toán thực tế khi đơn hoàn tất.
      const feeRate =
        Number(channel.feeRate) > 0
          ? Number(channel.feeRate)
          : PLATFORM_FEE_RATE[channel.channelName];
      const platformFee = Math.round(totalAmount * feeRate);

      const order = await tx.order.create({
        data: {
          channelId: channel.id,
          orderCode: finalOrderCode,
          customerName:
            typeof customerName === "string" && customerName.trim()
              ? customerName.trim()
              : "Khách từ sàn",
          customerPhone:
            typeof customerPhone === "string" && customerPhone.trim()
              ? customerPhone.trim()
              : randomPhone(),
          totalAmount,
          platformFee,
          paymentStatus: "PAID", // đơn sàn giả lập coi như đã thanh toán
          shippingStatus: "PENDING",
          // Sàn thật gán hãng vận chuyển khi đơn được xác nhận; bản giả lập
          // bốc ngẫu nhiên trong nhóm hãng mà sàn đó hay dùng.
          carrier: randomCarrierFor(channel.channelName),
          trackingCode: randomTrackingCode(),
          // Số dòng hàng, lưu sẵn để kho lọc đơn dễ đóng / khó đóng.
          // Vòng lặp bên dưới tạo đúng một OrderItem cho mỗi phần tử của items,
          // nên con số này luôn khớp với số bản ghi con thực tế.
          itemCount: (items as MockOrderItem[]).length,
        },
      });

      const adjustments: {
        productId: string;
        productName: string;
        deducted: number;
        newQuantity: number;
      }[] = [];

      for (const it of items as MockOrderItem[]) {
        const mapping = mapBySku.get(it.channelSku)!; // đã lọc productId != null ở trên

        // Khoá dòng sản phẩm trong transaction để tránh trừ kho sai khi
        // nhiều đơn đổ về cùng lúc (lấy kèm costPrice để snapshot giá vốn)
        const rows = await tx.$queryRaw<
          {
            id: string;
            productName: string;
            quantityInStock: number;
            costPrice: unknown;
          }[]
        >`SELECT "id", "productName", "quantityInStock", "costPrice" FROM "Product" WHERE "id" = ${mapping.productId!} FOR UPDATE`;
        const product = rows[0];
        if (!product) {
          throw Object.assign(new Error("Sản phẩm gốc trong mapping không còn tồn tại"), {
            statusCode: 422,
          });
        }

        const newQuantity = product.quantityInStock - it.quantity;
        if (newQuantity < 0) {
          throw Object.assign(
            new Error(
              `Không đủ tồn kho cho "${product.productName}": còn ${product.quantityInStock}, đơn cần ${it.quantity}`
            ),
            { statusCode: 409 }
          );
        }

        await applyStockDelta(tx, {
          productId: product.id,
          delta: -it.quantity,
          type: InventoryLogType.SYNC,
          reason: `Trừ kho tự động — đơn ${finalOrderCode} từ ${channel.channelName} (SKU sàn: ${it.channelSku})`,
          orderId: order.id, // gắn với đơn để có thể hoàn kho khi hủy & tính giá vốn
        });

        // Ghi chi tiết dòng sản phẩm + SNAPSHOT giá vốn tại thời điểm bán
        const mp = findMarketplaceProduct(channel.channelName, it.channelSku);
        await tx.orderItem.create({
          data: {
            orderId: order.id,
            productId: product.id,
            channelSku: it.channelSku,
            productName: product.productName,
            quantity: it.quantity,
            price: mp?.price ?? 0,
            costPriceAtSale: String(product.costPrice ?? 0),
          },
        });

        adjustments.push({
          productId: product.id,
          productName: product.productName,
          deducted: it.quantity,
          newQuantity,
        });
      }

      return { order, adjustments };
    });

    res.status(201).json({
      message: `Đã nhận đơn ${finalOrderCode} từ ${channel.channelName}, tự động trừ kho ${result.adjustments.length} sản phẩm.`,
      order: result.order,
      adjustments: result.adjustments,
    });
  } catch (err) {
    const e = err as Error & { statusCode?: number };
    if (e.statusCode) {
      res.status(e.statusCode).json({ error: e.message });
      return;
    }
    next(err);
  }
});

// ============================================================
// POST /api/webhooks/tiktok — WEBHOOK THẬT TỪ TIKTOK SHOP
//
// TikTok gọi vào đây khi đơn đổi trạng thái / hủy / hoàn / kiện hàng / thu hồi
// ủy quyền. Endpoint CÔNG KHAI (không JWT) — an toàn dựa vào CHỮ KÝ trên body
// thô (Authorization = HMAC-SHA256(app_secret, app_key + raw body)).
//
// Route CHỈ verify chữ ký + ghi vào hàng đợi bền rồi ack 200; worker kéo chi
// tiết đơn, upsert, trừ/hoàn kho, thử lại khi lỗi tạm thời.
//
// Payload (rút gọn): { type, tts_notification_id, shop_id, timestamp,
//                      data: { order_id, order_status, ... } }
// ============================================================
router.post("/tiktok", async (req: Request & { rawBody?: Buffer }, res) => {
  // Chưa cấu hình app thì không thể xác thực chữ ký → từ chối, tránh nhận giả.
  if (!isTikTokConfigured()) {
    res.status(503).json({ error: "TikTok Shop chưa được cấu hình trên máy chủ" });
    return;
  }

  // 1) XÁC THỰC CHỮ KÝ trên body thô. Thiếu rawBody (không thể verify) coi như sai.
  const raw = req.rawBody;
  const signature = req.header("authorization") ?? undefined;
  if (!raw || !verifyWebhookSignature(raw.toString("utf8"), signature)) {
    res.status(401).json({ error: "Chữ ký webhook không hợp lệ" });
    return;
  }

  // 2) Ngoài phạm vi (sản phẩm, chat, ping…) hay thiếu định danh → ack luôn
  //    cho TikTok khỏi gửi lại vô ích.
  const payload = (req.body ?? {}) as TiktokWebhookPayload;
  const kind = classifyTiktokEvent(payload);
  const shopId = payload.shop_id != null ? String(payload.shop_id) : "";
  if (!kind || !shopId || (kind === "order" && !tiktokPayloadOrderId(payload))) {
    res.status(200).json({ ok: true, ignored: true, type: payload.type });
    return;
  }

  // 3) ĐƯỜNG HÀNG ĐỢI BỀN pg-boss (giai đoạn 2 bước 2, 01/10/2026 —
  //    docs/HANG-DOI-BEN.md): ghi webhook_events + xếp việc trong một giao dịch
  //    rồi ack. Sự kiện đơn vào evt.order (gộp theo khóa sàn:shop:đơn — khóa
  //    theo đơn giờ đúng trên nhiều tiến trình, trước là Set trong RAM); sự kiện
  //    ủy quyền vào evt.auth. Ghi lỗi → 500, hàng đợi chưa sẵn sàng → 503: TikTok gửi lại.
  if (!isQueueReady()) {
    queueNotReady(res, "TikTok");
    return;
  }
  try {
    const r =
      kind === "order"
        ? await recordOrderEvent({
            source: "TIKTOK",
            eventType: String(payload.type),
            shopId,
            orderId: tiktokPayloadOrderId(payload),
            rawBody: raw,
            payload,
          })
        : await recordAuthEvent({
            source: "TIKTOK",
            eventType: String(payload.type),
            shopId,
            rawBody: raw,
            payload,
          });
    res.status(200).json({ ok: true, type: payload.type, queued: r.queued, duplicate: r.duplicate });
  } catch (err) {
    console.error("[Webhook TikTok] Không ghi được vào hàng đợi bền:", err);
    res.status(500).json({ error: "Không ghi nhận được sự kiện, hãy gửi lại" });
  }
});

// ============================================================
// POST /api/webhook/shopee — WEBHOOK THẬT TỪ SHOPEE (Push Mechanism)
//
// Shopee push khi có sự kiện: code 3 (lịch lấy hàng), 4 (đơn đổi trạng thái),
// 5 (thay đổi uỷ quyền). Yêu cầu khắt khe của Shopee: ack 200 trong <3 GIÂY,
// chậm nhiều lần sẽ bị block push. Vì vậy route này CHỈ verify chữ ký rồi ack
// ngay; toàn bộ xử lý DB/API (kéo chi tiết đơn, upsert, trừ/hoàn kho) chạy ở
// worker của hàng đợi bền (workers/event-queue.ts).
//
// Chữ ký: header `Authorization` = HMAC-SHA256(partner_key, url + "|" + RAW
// body). Bắt buộc kiểm trên req.rawBody (đã giữ ở app.ts) — body qua JSON.parse
// serialize lại là sai chữ ký. Sai chữ ký → 401, không xử lý gì.
// ============================================================
router.post("/shopee", async (req: Request & { rawBody?: Buffer }, res) => {
  // Chưa cấu hình partner_key thì không thể xác thực → từ chối, tránh nhận giả.
  if (!isShopeeConfigured()) {
    res.status(503).json({ error: "Shopee chưa được cấu hình trên máy chủ" });
    return;
  }

  // 0) PING VERIFY của Console (code 0, mang data.verify_info) → 200 rỗng NGAY,
  //    TRƯỚC bước kiểm chữ ký. Đã đối chiếu HMAC đủ 4 key của app (Live/Test
  //    Push Key + Live/Test API Key, phiên 05/08/2026) — ping này ký bằng key
  //    nội bộ Shopee KHÔNG công bố, giữ cổng chữ ký là kẹt Verify/Save vĩnh
  //    viễn. Code 0 không có tác dụng nghiệp vụ nên bỏ chữ ký không mở lỗ hổng;
  //    mọi sự kiện thật (code 1-4) vẫn phải qua chữ ký như cũ.
  const pingCode = Number((req.body as { code?: unknown } | undefined)?.code);
  if (pingCode === 0) {
    res.status(200).end();
    return;
  }

  // 1) XÁC THỰC CHỮ KÝ trên body thô. Thiếu rawBody (không thể verify) coi như sai.
  const raw = req.rawBody;
  const signature = req.header("authorization") ?? undefined;
  if (!raw || !verifyShopeeWebhookSignature(raw, signature)) {
    res.status(401).json({ error: "Chữ ký webhook không hợp lệ" });
    return;
  }

  const payload = (req.body ?? {}) as ShopeePushPayload;
  const code = Number(payload.code);
  const handled = [
    SHOPEE_PUSH_CODE.AUTHORIZATION,
    SHOPEE_PUSH_CODE.DEAUTHORIZATION,
    SHOPEE_PUSH_CODE.ORDER_STATUS,
    SHOPEE_PUSH_CODE.TRACKING_NO,
  ] as number[];

  // 2) Sự kiện ngoài phạm vi (ping code 0, test...) → ack luôn cho Shopee khỏi retry.
  if (!handled.includes(code)) {
    res.status(200).json({ ok: true, ignored: true, code });
    return;
  }

  // 3) ĐƯỜNG HÀNG ĐỢI BỀN pg-boss (giai đoạn 2 bước 3, 01/10/2026 —
  //    docs/HANG-DOI-BEN.md): ghi webhook_events + xếp việc trong một giao dịch
  //    (~10 ms, hạn ack của Shopee là 3 giây) rồi ack. Sự kiện đơn (code 3, 4)
  //    vào evt.order — gộp theo khóa sàn:shop:đơn, nhiều việc chạy song song
  //    (hàng đợi cũ chỉ 1 luồng); mã vận đơn của push code 4 đi kèm việc. Sự kiện
  //    ủy quyền (code 1, 2) vào evt.auth. Ghi lỗi → 500, hàng đợi chưa sẵn sàng
  //    → 503: Shopee gửi lại.
  if (!isQueueReady()) {
    queueNotReady(res, "Shopee");
    return;
  }
  const shopId = payload.shop_id != null ? String(payload.shop_id) : "";
  const isOrderEvent = code === SHOPEE_PUSH_CODE.ORDER_STATUS || code === SHOPEE_PUSH_CODE.TRACKING_NO;
  const orderSn = String(payload.data?.ordersn ?? payload.data?.order_sn ?? "").trim();
  // Thiếu định danh thì không có gì để làm → ack luôn.
  if (!shopId || (isOrderEvent && !orderSn)) {
    res.status(200).json({ ok: true, ignored: true, code });
    return;
  }
  try {
    const trackingNo = String(payload.data?.trackingno ?? payload.data?.tracking_no ?? "").trim();
    const r = isOrderEvent
      ? await recordOrderEvent({
          source: "SHOPEE",
          eventType: String(code),
          shopId,
          orderId: orderSn,
          ...(trackingNo ? { trackingNo } : {}),
          rawBody: raw,
          payload,
        })
      : await recordAuthEvent({ source: "SHOPEE", eventType: String(code), shopId, rawBody: raw, payload });
    res.status(200).json({ ok: true, code, queued: r.queued, duplicate: r.duplicate });
  } catch (err) {
    console.error("[Webhook Shopee] Không ghi được vào hàng đợi bền:", err);
    res.status(500).json({ error: "Không ghi nhận được sự kiện, hãy gửi lại" });
  }
});

// ============================================================
// POST /api/webhook/lazada — WEBHOOK THẬT TỪ LAZADA (Push Mechanism / LPM)
//
// Lazada push khi đơn đổi trạng thái (message_type 0 — loại duy nhất đang có).
// Ràng buộc GẮT NHẤT trong 3 sàn: ack 200 trong 500ms, trượt thì retry mỗi 30
// phút tối đa 12 lần.
//
// Từ 01/10/2026 (giai đoạn 2 kiến trúc quy mô, docs/HANG-DOI-BEN.md): route
// verify chữ ký, GHI sự kiện vào webhook_events + xếp việc evt.order trong một
// giao dịch (đo ~10 ms), rồi mới ack; worker (workers/event-queue.ts) gọi API +
// upsert DB.
//
// Chữ ký: header `Authorization` = hex HMAC-SHA256(app_secret, app_key + RAW
// body) — kiểm trên req.rawBody. Sai chữ ký → 401, không xử lý gì.
// ============================================================
router.post("/lazada", async (req: Request & { rawBody?: Buffer }, res) => {
  // Chưa cấu hình app thì không thể xác thực chữ ký → từ chối, tránh nhận giả.
  if (!isLazadaConfigured()) {
    res.status(503).json({ error: "Lazada chưa được cấu hình trên máy chủ" });
    return;
  }

  // 1) XÁC THỰC CHỮ KÝ trên body thô. Thiếu rawBody (không thể verify) coi như sai.
  const raw = req.rawBody;
  const signature = req.header("authorization") ?? undefined;
  if (!raw || !verifyLazadaWebhookSignature(raw, signature)) {
    res.status(401).json({ error: "Chữ ký webhook không hợp lệ" });
    return;
  }

  // 2) Ngoài phạm vi (ping Verify của Console, loại message tương lai, thiếu
  //    trường) → ack luôn cho Lazada khỏi retry vô ích.
  const payload = (req.body ?? {}) as LazadaPushPayload;
  const sellerId = String(payload.seller_id ?? "").trim();
  const orderId = String(payload.data?.trade_order_id ?? "").trim();
  if (Number(payload.message_type) !== LAZADA_MSG_ORDER || !sellerId || !orderId) {
    res.status(200).json({ ok: true, ignored: true, messageType: payload.message_type });
    return;
  }

  // 3) ĐƯỜNG HÀNG ĐỢI BỀN (giai đoạn 2, 01/10/2026 — docs/HANG-DOI-BEN.md): ghi
  //    sự kiện + xếp việc trong MỘT giao dịch rồi mới ack; worker xử lý sau.
  //    Deploy / sập giữa chừng không còn làm mất sự kiện. Đo trên Supabase: ghi
  //    trong giao dịch ~10 ms, nằm gọn trong hạn 500 ms của Lazada.
  //    · Hàng đợi chưa sẵn sàng → 503; ghi lỗi (database sự cố) → 500. Cả hai để
  //      Lazada tự gửi lại (mỗi 30 phút, tối đa 12 lần) thay vì ack rồi mất.
  if (!isQueueReady()) {
    queueNotReady(res, "Lazada");
    return;
  }
  const started = Date.now();
  try {
    const r = await recordOrderEvent({
      source: "LAZADA",
      eventType: String(payload.message_type),
      shopId: sellerId,
      orderId,
      rawBody: raw,
      payload,
    });
    res.status(200).json({ ok: true, orderId, queued: r.queued, duplicate: r.duplicate });
    console.log(
      `[Webhook Lazada] đơn ${orderId} (${payload.data?.order_status ?? "?"}) → hàng đợi: ` +
        `${r.duplicate ? "gửi trùng, bỏ qua" : r.queued ? "việc mới" : "gộp vào việc đang chờ"} (${Date.now() - started} ms)`
    );
  } catch (err) {
    console.error(`[Webhook Lazada] Không ghi được đơn ${orderId} vào hàng đợi:`, err);
    res.status(500).json({ error: "Không ghi nhận được sự kiện, hãy gửi lại" });
  }
});

// ============================================================
// POST /v1/webhooks/misa-meinvoice — WEBHOOK TỪ MISA meInvoice (Sandbox)
//
// MISA gọi vào đây khi hóa đơn điện tử đổi trạng thái (đã ký số, bị hủy, bị
// thay thế…). Endpoint CÔNG KHAI (không JWT) — triển khai trên Render/cloud là
// có URL HTTPS thật để khai thẳng vào trang quản trị MISA.
//
// Yêu cầu MISA: phản hồi trong tối đa 3 GIÂY → route này NON-BLOCKING:
//   1. Validate cấu trúc JSON tối thiểu (không đụng DB nghiệp vụ).
//   2. Đẩy nguyên payload vào hàng đợi bền (MỘT insert vào misa_webhook_logs).
//   3. Ack `{ success: true }` NGAY — worker nền xử lý sau, lỗi tự retry
//      3 lần × 5 phút.
//
// Chữ ký: header x-misa-signature = HMAC-SHA256(secret, raw body). Dev local
// chưa có secret thì bỏ qua; PRODUCTION bắt buộc cấu hình MISA_WEBHOOK_SECRET
// — thiếu là trả 503 chứ không mở endpoint trần trên Internet.
// ============================================================
router.post(
  "/misa-meinvoice",
  async (req: Request & { rawBody?: Buffer }, res) => {
    // 0) Production mà chưa cấu hình secret → từ chối phục vụ, tránh nhận giả.
    if (misaSecretMissingInProduction()) {
      res.status(503).json({
        success: false,
        error: "Webhook MISA chưa được bảo vệ: thiếu MISA_WEBHOOK_SECRET trên môi trường production",
      });
      return;
    }

    // 1) Xác thực chữ ký trên body thô (no-op khi chưa cấu hình secret ở dev).
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    if (!verifyMisaWebhookSignature(raw, req.header("x-misa-signature"))) {
      res.status(401).json({ success: false, error: "Chữ ký webhook không hợp lệ" });
      return;
    }

    // 2) Validate sơ bộ cấu trúc — sai thì 400 để MISA biết payload hỏng,
    //    retry của họ với cùng payload cũng sẽ hỏng, không việc gì phải nhận.
    const invalid = validateMisaPayload(req.body);
    if (invalid) {
      res.status(400).json({ success: false, error: invalid });
      return;
    }

    const payload = req.body as MisaWebhookPayload;

    // 3) Sự kiện ngoài phạm vi (ping, loại mới…) → ack luôn cho MISA khỏi retry.
    if (!isHandledMisaEvent(payload.EventType)) {
      res.status(200).json({ success: true, ignored: true, eventType: payload.EventType });
      return;
    }

    // 4) Enqueue (một INSERT) rồi ack ngay — không đợi worker xử lý.
    try {
      const { queued, duplicate } = await enqueueMisaWebhook(raw, payload);
      res.status(200).json({ success: true, queued, duplicate });
    } catch (err) {
      // Không ghi nổi vào hàng đợi (DB sự cố) → 500 để MISA tự gửi lại sau.
      console.error("[Webhook MISA] Không ghi được vào hàng đợi:", err);
      res.status(500).json({ success: false, error: "Không ghi nhận được sự kiện, hãy gửi lại" });
    }
  }
);

// ============================================================
// WEBHOOK payOS — cổng thu tiền gói Hubsell (09/09). URL đăng ký trên
// my.payos.vn (hoặc scripts/payos-confirm-webhook.ts): /api/webhooks/payos.
//   · Không có đơn khớp orderCode → 200 ignored (payOS gọi thử với orderCode
//     giả khi đăng ký URL; đơn lạ thì cũng chẳng có gì để làm).
//   · Có đơn → BẮT BUỘC chữ ký HMAC đúng, sai → 401 (giả mạo không mở được gói).
//   · Xử lý ĐỒNG BỘ (một khoản/giây là nhiều với thuê bao) — lỗi DB trả 500
//     để payOS retry; idempotent nhờ trạng thái PAID + externalRef unique.
// ============================================================
router.post("/payos", async (req, res) => {
  const cfg = getPayosConfig();
  if (!cfg) {
    res.status(503).json({ success: false, error: "Cổng payOS chưa cấu hình" });
    return;
  }
  const body = req.body as { data?: { orderCode?: unknown } } | undefined;
  const rawCode = body?.data?.orderCode;
  const orderCode =
    typeof rawCode === "number" && Number.isSafeInteger(rawCode)
      ? rawCode
      : typeof rawCode === "string" && /^\d{1,19}$/.test(rawCode)
        ? Number(rawCode)
        : null;
  if (orderCode === null) {
    res.status(200).json({ success: true, ignored: true, reason: "no orderCode" });
    return;
  }
  const exists = await prisma.gatewayPaymentOrder.findUnique({
    where: { orderCode: BigInt(orderCode) },
    select: { id: true },
  });
  if (!exists) {
    res.status(200).json({ success: true, ignored: true, reason: "unknown order" });
    return;
  }
  if (!verifyPayosWebhook(req.body, cfg.checksumKey)) {
    console.warn("[payOS] Webhook chữ ký SAI cho đơn", orderCode);
    res.status(401).json({ success: false, error: "Chữ ký webhook không hợp lệ" });
    return;
  }
  try {
    const result = await handlePayosWebhook(req.body);
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error("[payOS] Xử lý webhook lỗi:", (err as Error).message);
    res.status(500).json({ success: false, error: "Xử lý webhook lỗi — payOS sẽ gửi lại" });
  }
});

export default router;
