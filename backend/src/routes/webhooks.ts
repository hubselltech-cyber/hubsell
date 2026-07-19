import { Router } from "express";
import { InventoryLogType } from "@prisma/client";
import { prisma } from "../prisma";
import { findMarketplaceProduct, PLATFORM_FEE_RATE } from "../mockMarketplace";
import {
  randomCarrierFor,
  randomPhone,
  randomTrackingCode,
} from "../shipping";

const router = Router();

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
// 2. Với từng SKU sàn → tra bảng ProductMapping tìm sản phẩm gốc.
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

    // 2) Tra mapping cho toàn bộ SKU trong đơn
    const skus = (items as MockOrderItem[]).map((i) => i.channelSku);
    const mappings = await prisma.productMapping.findMany({
      where: { channelId: channel.id, channelSku: { in: skus } },
    });
    const mapBySku = new Map(mappings.map((m) => [m.channelSku, m]));

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
        const mapping = mapBySku.get(it.channelSku)!;

        // Khoá dòng sản phẩm trong transaction để tránh trừ kho sai khi
        // nhiều đơn đổ về cùng lúc (lấy kèm costPrice để snapshot giá vốn)
        const rows = await tx.$queryRaw<
          {
            id: string;
            productName: string;
            quantityInStock: number;
            costPrice: unknown;
          }[]
        >`SELECT "id", "productName", "quantityInStock", "costPrice" FROM "Product" WHERE "id" = ${mapping.productId} FOR UPDATE`;
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

export default router;
