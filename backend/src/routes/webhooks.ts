import { Router, type Request } from "express";
import { InventoryLogType } from "@prisma/client";
import { prisma } from "../prisma";
import { findMarketplaceProduct, PLATFORM_FEE_RATE } from "../mockMarketplace";
import {
  randomCarrierFor,
  randomPhone,
  randomTrackingCode,
} from "../shipping";
import { isTikTokConfigured } from "../integrations/tiktok/config";
import { verifyWebhookSignature } from "../integrations/tiktok/client";
import {
  findTiktokChannelByShopId,
  processTiktokOrderEvent,
} from "../integrations/tiktok/service";
import { isShopeeConfigured } from "../integrations/shopee/config";
import {
  SHOPEE_PUSH_CODE,
  verifyShopeeWebhookSignature,
  type ShopeePushPayload,
} from "../integrations/shopee/webhook";
import {
  enqueueShopeeWebhook,
  startShopeeWebhookWorker,
} from "../integrations/shopee/webhook-queue";
import { isLazadaConfigured } from "../integrations/lazada/config";
import {
  findLazadaChannelsBySellerId,
  LAZADA_MSG_ORDER,
  processLazadaOrderPush,
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
import {
  enqueueMisaWebhook,
  startMisaWebhookWorker,
} from "../integrations/invoice/misa-webhook-queue";

const router = Router();

// Khởi động worker xử lý hàng đợi webhook Shopee (1 lần lúc nạp module):
// nhặt lại job dở dang sau restart + quét job đến hạn retry theo nhịp.
startShopeeWebhookWorker();
// Worker hàng đợi webhook MISA meInvoice — cùng cơ chế, hàng đợi riêng.
startMisaWebhookWorker();

// Loại sự kiện webhook của TikTok Shop (trường `type`, dạng số).
// Ta chỉ xử lý ORDER_STATUS_CHANGE; các loại khác ack 200 và bỏ qua.
const TIKTOK_ORDER_STATUS_CHANGE = 1;

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

        await tx.product.update({
          where: { id: product.id },
          data: { quantityInStock: newQuantity },
        });

        await tx.inventoryLog.create({
          data: {
            productId: product.id,
            changeQuantity: -it.quantity,
            type: InventoryLogType.SYNC,
            reason: `Trừ kho tự động — đơn ${finalOrderCode} từ ${channel.channelName} (SKU sàn: ${it.channelSku})`,
            orderId: order.id, // gắn với đơn để có thể hoàn kho khi hủy & tính giá vốn
          },
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
// TikTok gọi vào đây khi đơn đổi trạng thái (event ORDER_STATUS_CHANGE). Endpoint
// CÔNG KHAI (không JWT) — an toàn dựa vào CHỮ KÝ trên body, không phải phiên đăng
// nhập. Trả 200 nhanh cho các trường hợp không cần xử lý để TikTok khỏi gửi lại;
// chỉ trả 5xx khi gặp lỗi TẠM THỜI (đáng để TikTok thử lại).
//
// Payload (rút gọn): { type, shop_id, timestamp, data: { order_id, order_status } }
// ============================================================
router.post("/tiktok", async (req: Request & { rawBody?: Buffer }, res) => {
  try {
    // Chưa cấu hình app thì không thể xác thực chữ ký → từ chối, tránh xử lý giả.
    if (!isTikTokConfigured()) {
      res.status(503).json({ error: "TikTok Shop chưa được cấu hình trên máy chủ" });
      return;
    }

    // 1) XÁC THỰC CHỮ KÝ trên body thô (chống fake request).
    const raw = req.rawBody?.toString("utf8") ?? JSON.stringify(req.body ?? {});
    const signature = req.header("authorization") ?? undefined;
    if (!verifyWebhookSignature(raw, signature)) {
      res.status(401).json({ error: "Chữ ký webhook không hợp lệ" });
      return;
    }

    const body = (req.body ?? {}) as {
      type?: number;
      shop_id?: string;
      data?: { order_id?: string; order_status?: string };
    };

    // 2) Chỉ xử lý sự kiện đổi trạng thái đơn; loại khác (ping, sản phẩm…) ack luôn.
    if (Number(body.type) !== TIKTOK_ORDER_STATUS_CHANGE) {
      res.status(200).json({ ok: true, ignored: true, type: body.type });
      return;
    }

    const shopId = String(body.shop_id ?? "");
    const orderId = String(body.data?.order_id ?? "");
    if (!shopId || !orderId) {
      res.status(200).json({ ok: true, ignored: true, reason: "thiếu shop_id/order_id" });
      return;
    }

    // 3) Tìm gian hàng theo shop_id (đã ký nên tin được). Không thấy → ack.
    const channel = await findTiktokChannelByShopId(shopId);
    if (!channel) {
      res.status(200).json({ ok: true, ignored: true, reason: "shop chưa kết nối Hubsell" });
      return;
    }

    // 4) Upsert đơn + trừ/hoàn kho (idempotent) trong một transaction.
    const result = await processTiktokOrderEvent(channel, orderId);
    res.status(200).json({ ok: true, orderId, ...result });
  } catch (err) {
    // Lỗi TẠM THỜI khi gọi API TikTok/DB → 500 để TikTok gửi lại sau.
    console.error("[Webhook TikTok]", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================
// POST /api/webhook/shopee — WEBHOOK THẬT TỪ SHOPEE (Push Mechanism)
//
// Shopee push khi có sự kiện: code 3 (lịch lấy hàng), 4 (đơn đổi trạng thái),
// 5 (thay đổi uỷ quyền). Yêu cầu khắt khe của Shopee: ack 200 trong <3 GIÂY,
// chậm nhiều lần sẽ bị block push. Vì vậy route này CHỈ verify chữ ký rồi ack
// ngay; toàn bộ xử lý DB/API (kéo chi tiết đơn, upsert, trừ/hoàn kho) chạy ở
// hàng đợi nền trong integrations/shopee/webhook.ts.
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

  // 3) Ghi vào HÀNG ĐỢI BỀN (một INSERT — vẫn trong hạn ack 3s) rồi ack 200;
  //    worker nền xử lý sau. Dedup bền theo hash raw body chặn bản retry y
  //    nguyên; sự kiện lọt lưới vẫn an toàn nhờ upsert + mốc kho idempotent.
  try {
    const { queued, duplicate } = await enqueueShopeeWebhook(raw, payload);
    res.status(200).json({ ok: true, code, queued, duplicate });
  } catch (err) {
    // Không ghi nổi vào hàng đợi (DB sự cố) → 500 để Shopee tự gửi lại sau.
    console.error("[Webhook Shopee] Không ghi được vào hàng đợi:", err);
    res.status(500).json({ error: "Không ghi nhận được sự kiện, hãy gửi lại" });
  }
});

// ============================================================
// POST /api/webhook/lazada — WEBHOOK THẬT TỪ LAZADA (Push Mechanism / LPM)
//
// Lazada push khi đơn đổi trạng thái (message_type 0 — loại duy nhất đang có).
// Ràng buộc GẮT NHẤT trong 3 sàn: ack 200 trong 500ms, trượt thì retry mỗi 30
// phút tối đa 12 lần. Vì vậy route CHỈ verify chữ ký + parse rồi ACK NGAY;
// tra gian + gọi API + upsert DB chạy nền fire-and-forget sau khi đã trả lời.
// Sự kiện lỡ (restart giữa chừng) có worker order-auto-sync 10 phút vét lại —
// đúng mô hình "consume push, pull with low frequency" Lazada khuyến nghị,
// nên không cần hàng đợi bền như Shopee (tránh thêm bảng + ALTER tay Supabase).
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

  // 3) ACK NGAY trong hạn 500ms — mọi việc còn lại chạy nền sau phản hồi.
  res.status(200).json({ ok: true, orderId });

  setImmediate(async () => {
    try {
      const channels = await findLazadaChannelsBySellerId(sellerId);
      if (channels.length === 0) {
        console.warn(`[Webhook Lazada] seller ${sellerId} chưa nối gian nào — bỏ qua đơn ${orderId}`);
        return;
      }
      for (const channel of channels) {
        const result = await processLazadaOrderPush(channel, orderId);
        console.log(
          `[Webhook Lazada] Gian "${channel.shopName}" đơn ${orderId} (${payload.data?.order_status ?? "?"}):`,
          JSON.stringify(result)
        );
      }
    } catch (err) {
      // Đã ack nên không còn đường trả lỗi cho Lazada — ghi log để truy vết;
      // đơn này sẽ được cron auto-sync 10 phút vét lại.
      console.error(`[Webhook Lazada] Lỗi xử lý nền đơn ${orderId}:`, err);
    }
  });
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

export default router;
