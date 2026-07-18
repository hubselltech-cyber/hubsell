import { PrismaClient, ChannelName, InventoryLogType } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Bắt đầu tạo dữ liệu mẫu...");

  // Xoá dữ liệu cũ (theo đúng thứ tự phụ thuộc)
  await prisma.productMapping.deleteMany();
  await prisma.inventoryLog.deleteMany();
  await prisma.order.deleteMany();
  await prisma.product.deleteMany();
  await prisma.channel.deleteMany();
  await prisma.user.deleteMany();

  // 1) Người dùng — tài khoản demo: admin@hubsell.vn / hubsell123
  const user = await prisma.user.create({
    data: {
      email: "admin@hubsell.vn",
      passwordHash: await bcrypt.hash("hubsell123", 10),
      fullName: "Chủ Shop Hubsell",
      role: "ADMIN",
    },
  });

  // 2) Kênh bán
  const [shopee, tiktok, offline] = await Promise.all([
    prisma.channel.create({
      data: { userId: user.id, channelName: ChannelName.SHOPEE, status: "ACTIVE" },
    }),
    prisma.channel.create({
      data: { userId: user.id, channelName: ChannelName.TIKTOK, status: "ACTIVE" },
    }),
    prisma.channel.create({
      data: { userId: user.id, channelName: ChannelName.OFFLINE, status: "ACTIVE" },
    }),
  ]);

  // 3) Sản phẩm
  const productsData = [
    { skuCode: "SP001", productName: "Áo thun cotton nam", costPrice: 65000, sellingPrice: 129000, quantityInStock: 120 },
    { skuCode: "SP002", productName: "Quần jean nữ ống rộng", costPrice: 150000, sellingPrice: 299000, quantityInStock: 45 },
    { skuCode: "SP003", productName: "Giày sneaker trắng", costPrice: 220000, sellingPrice: 459000, quantityInStock: 8 },
    { skuCode: "SP004", productName: "Túi tote canvas", costPrice: 40000, sellingPrice: 89000, quantityInStock: 200 },
  ];

  const products = [];
  for (const p of productsData) {
    products.push(
      await prisma.product.create({ data: { ...p, userId: user.id } })
    );
  }

  // 4) Nhật ký tồn kho (nhập kho ban đầu)
  await Promise.all(
    products.map((p) =>
      prisma.inventoryLog.create({
        data: {
          productId: p.id,
          changeQuantity: p.quantityInStock,
          type: InventoryLogType.IMPORT,
          reason: "Nhập kho ban đầu",
        },
      })
    )
  );

  // 5) Đơn hàng
  const ordersData = [
    { channelId: shopee.id, orderCode: "SPX-10001", customerName: "Nguyễn Văn A", totalAmount: 258000, paymentStatus: "PAID", shippingStatus: "DELIVERED" },
    { channelId: tiktok.id, orderCode: "TT-20045", customerName: "Trần Thị B", totalAmount: 459000, paymentStatus: "PAID", shippingStatus: "SHIPPING" },
    { channelId: shopee.id, orderCode: "SPX-10002", customerName: "Lê Văn C", totalAmount: 89000, paymentStatus: "UNPAID", shippingStatus: "PENDING" },
    { channelId: offline.id, orderCode: "OFF-0007", customerName: "Khách lẻ tại quầy", totalAmount: 129000, paymentStatus: "PAID", shippingStatus: "DELIVERED" },
    { channelId: tiktok.id, orderCode: "TT-20046", customerName: "Phạm Thị D", totalAmount: 299000, paymentStatus: "PAID", shippingStatus: "PENDING" },
  ];

  for (const o of ordersData) {
    await prisma.order.create({ data: o });
  }

  console.log("✅ Đã tạo xong dữ liệu mẫu:");
  console.log(`   - ${1} người dùng`);
  console.log(`   - ${3} kênh bán`);
  console.log(`   - ${products.length} sản phẩm`);
  console.log(`   - ${ordersData.length} đơn hàng`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error("❌ Lỗi khi tạo dữ liệu mẫu:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
