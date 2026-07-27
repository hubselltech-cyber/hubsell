// Fixtures dùng chung cho integration test kho — tạo dữ liệu thật trên DB dev
// với tiền tố TEST- + hậu tố thời gian (không đụng dữ liệu người dùng), dọn
// sạch bằng cách xoá User (mọi bảng con Cascade theo).
import { ChannelName } from "@prisma/client";
import { prisma } from "../../prisma";

export interface StockFixture {
  userId: string;
  channelId: string;
  suffix: string;
  /** Tạo một sản phẩm kho với tồn ban đầu cho trước. */
  createProduct(stock: number): Promise<string>;
  /** Tạo một đơn 1 dòng hàng (qty) gắn vào sản phẩm — trả về orderId. */
  createOrder(productId: string, qty: number, orderCode?: string): Promise<string>;
  cleanup(): Promise<void>;
}

export async function createStockFixture(name: string): Promise<StockFixture> {
  const suffix = `${name}-${Date.now()}`;
  const user = await prisma.user.create({
    data: {
      email: `test-${suffix}@hubsell.test`,
      passwordHash: "x",
      fullName: `TEST ${suffix}`,
      role: "ADMIN",
    },
  });
  const channel = await prisma.channel.create({
    data: {
      userId: user.id,
      channelName: ChannelName.SHOPEE,
      shopName: `TEST-${suffix}`,
    },
  });

  let productSeq = 0;
  let orderSeq = 0;

  return {
    userId: user.id,
    channelId: channel.id,
    suffix,

    async createProduct(stock: number): Promise<string> {
      productSeq += 1;
      const p = await prisma.product.create({
        data: {
          userId: user.id,
          skuCode: `TEST-${suffix}-SKU${productSeq}`,
          productName: `SP test ${suffix} #${productSeq}`,
          quantityInStock: stock,
        },
      });
      return p.id;
    },

    async createOrder(productId, qty, orderCode): Promise<string> {
      orderSeq += 1;
      const o = await prisma.order.create({
        data: {
          channelId: channel.id,
          orderCode: orderCode ?? `TEST-${suffix}-ORD${orderSeq}`,
          customerName: "Khách test",
          itemCount: 1,
          items: {
            create: {
              productId,
              channelSku: `TEST-${suffix}-CSKU${orderSeq}`,
              productName: `Dòng hàng test ${orderSeq}`,
              quantity: qty,
              price: 100000,
            },
          },
        },
      });
      return o.id;
    },

    async cleanup(): Promise<void> {
      // Xoá user → Cascade: Channel → Order → OrderItem; Product → InventoryLog.
      await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    },
  };
}
