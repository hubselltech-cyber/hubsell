/**
 * SEED DATA DEMO CHỤP ẢNH LANDING — tạo shop "Sunny Closet" với ~16 ngày đơn
 * hàng ĐẸP trên 2 sàn Shopee + Lazada (TikTok cố ý KHÔNG có — tích hợp chưa
 * thương mại, landing ghi "sắp ra mắt") để chụp màn Tổng quan thật.
 *
 * CHỈ CHẠY TRÊN DB LOCAL. Idempotent: chạy lại là xóa sạch data của đúng user
 * demo rồi seed mới — không đụng bất kỳ user nào khác.
 *
 *   npx tsx scripts/seed-landing-demo.ts
 *
 * Đăng nhập: demo@hubsell.tech / demo-hubsell-2026
 */
import { PrismaClient, ChannelName, ShippingStatus, ReturnStatus } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// PRNG có seed — chạy lại ra đúng một bộ số, ảnh chụp tái lập được.
function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260823);
const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rnd() * arr.length)];
const between = (lo: number, hi: number) => lo + rnd() * (hi - lo);

const DEMO_EMAIL = "demo@hubsell.tech";

const PRODUCTS = [
  { skuCode: "VAY-HOA-S", productName: "Váy hoa nhí dáng xòe", costPrice: 82000, sellingPrice: 189000, quantityInStock: 140 },
  { skuCode: "AO-THUN-M", productName: "Áo thun cotton form rộng", costPrice: 38000, sellingPrice: 99000, quantityInStock: 320 },
  { skuCode: "QUAN-JEAN-32", productName: "Quần jean ống rộng", costPrice: 132000, sellingPrice: 289000, quantityInStock: 96 },
  { skuCode: "SET-DO-BO-L", productName: "Set đồ bộ thu đông", costPrice: 118000, sellingPrice: 259000, quantityInStock: 88 },
  { skuCode: "AO-SOMI-XL", productName: "Áo sơ mi lụa công sở", costPrice: 96000, sellingPrice: 219000, quantityInStock: 150 },
  { skuCode: "CHAN-VAY-M", productName: "Chân váy chữ A", costPrice: 71000, sellingPrice: 159000, quantityInStock: 175 },
  { skuCode: "AO-KHOAC-L", productName: "Áo khoác gió 2 lớp", costPrice: 156000, sellingPrice: 329000, quantityInStock: 64 },
  { skuCode: "TUI-TOTE-01", productName: "Túi tote canvas in chữ", costPrice: 36000, sellingPrice: 89000, quantityInStock: 260 },
  { skuCode: "GIAY-SNK-38", productName: "Giày sneaker basic trắng", costPrice: 205000, sellingPrice: 439000, quantityInStock: 52 },
  { skuCode: "AO-LEN-M", productName: "Áo len tăm cổ tròn", costPrice: 88000, sellingPrice: 199000, quantityInStock: 120 },
] as const;

const FIRST = ["Nguyễn", "Trần", "Lê", "Phạm", "Hoàng", "Vũ", "Đặng", "Bùi", "Đỗ", "Hồ"];
const LAST = ["Minh Anh", "Thu Hà", "Quốc Bảo", "Ngọc Lan", "Văn Hùng", "Thảo Vy", "Đức Long", "Kim Ngân", "Gia Hân", "Hải Yến", "Tuấn Kiệt", "Phương Linh"];

const DAY_MS = 86_400_000;

async function main() {
  const dbUrl = process.env.DATABASE_URL ?? "";
  if (!/localhost|127\.0\.0\.1/.test(dbUrl)) {
    throw new Error("TỪ CHỐI CHẠY: DATABASE_URL không phải localhost — script này chỉ dành cho DB local.");
  }

  // ---- 1) User demo (dọn sạch nếu đã tồn tại) ----
  const existing = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (existing) {
    await prisma.user.delete({ where: { id: existing.id } }); // cascade dọn channel/order/product
    console.log("🧹 Đã xóa user demo cũ (cascade toàn bộ data).");
  }
  const user = await prisma.user.create({
    data: {
      email: DEMO_EMAIL,
      passwordHash: await bcrypt.hash("demo-hubsell-2026", 10),
      fullName: "Sunny Closet",
      role: "ADMIN",
    },
  });

  // ---- 2) Gói Pro + thuê bao (widget trần đơn hiển thị đẹp) ----
  const plan = await prisma.servicePlan.upsert({
    where: { code: "PRO" },
    update: {},
    create: {
      code: "PRO", name: "Pro", tier: 3,
      priceMonthly: 399000, maxOrdersPerMonth: 3000, isActive: false,
      description: "Gói demo local",
    },
  });
  await prisma.subscription.create({
    data: {
      userId: user.id, planId: plan.id, status: "ACTIVE", isTrial: false,
      currentPeriodStart: new Date(Date.now() - 5 * DAY_MS),
      currentPeriodEnd: new Date(Date.now() + 25 * DAY_MS),
    },
  });

  // ---- 3) Kênh bán: Shopee + Lazada (TikTok cố ý không có) ----
  const [shopee, lazada] = await Promise.all([
    prisma.channel.create({
      data: {
        userId: user.id, channelName: ChannelName.SHOPEE, shopName: "Sunny Closet",
        status: "ACTIVE", lastSyncAt: new Date(),
        walletBalance: 23_461_500, walletBalanceSyncedAt: new Date(),
      },
    }),
    prisma.channel.create({
      data: {
        userId: user.id, channelName: ChannelName.LAZADA, shopName: "Sunny Closet",
        status: "ACTIVE", lastSyncAt: new Date(),
      },
    }),
  ]);

  // ---- 4) Sản phẩm ----
  const products = [] as { id: string; skuCode: string; costPrice: number; sellingPrice: number; productName: string }[];
  for (const p of PRODUCTS) {
    const row = await prisma.product.create({ data: { ...p, userId: user.id } });
    products.push({ id: row.id, skuCode: p.skuCode, costPrice: p.costPrice, sellingPrice: p.sellingPrice, productName: p.productName });
  }

  // ---- 5) Đơn hàng 16 ngày — nhịp tăng dần, cuối tuần cao ----
  const DAYS = 16;
  const now = new Date();
  // 00:00 GIỜ VN của hôm nay (UTC+7)
  const vnMidnightUtc = new Date(Math.floor((now.getTime() + 7 * 3600_000) / DAY_MS) * DAY_MS - 7 * 3600_000);

  let orderSeq = 41200;
  let totalOrders = 0;
  const t0 = Date.now();

  for (let d = DAYS - 1; d >= 0; d--) {
    const dayStartUtc = new Date(vnMidnightUtc.getTime() - d * DAY_MS);
    const vnDow = new Date(dayStartUtc.getTime() + 7 * 3600_000).getUTCDay();
    const weekendBoost = vnDow === 0 || vnDow === 6 ? 1.25 : 1;
    const growth = 1 + (DAYS - 1 - d) * 0.012; // tăng trưởng nhẹ theo ngày
    // Hôm nay bơm NHỈNH hơn hôm qua một chút — badge "so với hôm qua" trên
    // ảnh chụp marketing phải XANH (ngày chụp demo, không phải ngày thật).
    const dayShare = d === 0 ? 1.18 : 1;
    const count = Math.round(between(55, 78) * weekendBoost * growth * dayShare);

    for (let i = 0; i < count; i++) {
      const isShopee = rnd() < 0.62;
      const channel = isShopee ? shopee : lazada;
      orderSeq += 1 + Math.floor(rnd() * 3);
      const orderCode = isShopee ? `2508${orderSeq}SPVN` : `LZD25${orderSeq}`;

      // 1-2 dòng hàng
      const lineCount = rnd() < 0.72 ? 1 : 2;
      const lines: { p: (typeof products)[number]; qty: number }[] = [];
      for (let l = 0; l < lineCount; l++) {
        lines.push({ p: pick(products), qty: rnd() < 0.85 ? 1 : 2 });
      }
      const gross = lines.reduce((s, l) => s + l.p.sellingPrice * l.qty, 0);

      // Trạng thái theo tuổi đơn
      const r = rnd();
      let shippingStatus: ShippingStatus;
      let returnStatus: ReturnStatus = ReturnStatus.NONE;
      if (d >= 3) {
        shippingStatus = r < 0.9 ? ShippingStatus.DELIVERED : r < 0.96 ? ShippingStatus.SHIPPING : ShippingStatus.CANCELLED;
        if (shippingStatus === ShippingStatus.DELIVERED && rnd() < 0.02) returnStatus = ReturnStatus.AWAITING;
      } else if (d >= 1) {
        shippingStatus = r < 0.45 ? ShippingStatus.DELIVERED : r < 0.85 ? ShippingStatus.SHIPPING : r < 0.95 ? ShippingStatus.PROCESSED : ShippingStatus.CANCELLED;
      } else {
        shippingStatus = r < 0.3 ? ShippingStatus.SHIPPING : r < 0.75 ? ShippingStatus.PROCESSED : ShippingStatus.PENDING;
      }
      const cancelled = shippingStatus === ShippingStatus.CANCELLED;

      // Voucher shop trên ~30% đơn
      const sellerVoucher = rnd() < 0.3 ? Math.round((gross * between(0.02, 0.06)) / 500) * 500 : 0;
      const actualRevenue = gross - sellerVoucher;

      // Quyết toán: đơn DELIVERED từ 2 ngày tuổi trở lên
      const settled = shippingStatus === ShippingStatus.DELIVERED && d >= 2;
      const fixedFee = settled ? Math.round(actualRevenue * 0.04) : 0;
      const paymentFee = settled ? Math.round(actualRevenue * 0.045) : 0;
      const serviceFee = settled ? Math.round(actualRevenue * 0.06) : 0;
      const sellerProtectionFee = settled && isShopee ? Math.round(actualRevenue * 0.005) : 0;
      const affiliateFee = settled && rnd() < 0.25 ? Math.round(actualRevenue * 0.03) : 0;
      const taxWithheld = settled ? Math.round(actualRevenue * 0.015) : 0;
      const actualPayout = settled
        ? actualRevenue - fixedFee - paymentFee - serviceFee - sellerProtectionFee - affiliateFee - taxWithheld
        : 0;

      // Giờ phát sinh: 8h–22h VN (hôm nay rải cả ngày cho đủ nhịp demo)
      const createdAt = new Date(dayStartUtc.getTime() + between(8, 22) * 3600_000);

      const order = await prisma.order.create({
        data: {
          channelId: channel.id,
          orderCode,
          customerName: `${pick(FIRST)} ${pick(LAST)}`,
          customerPhone: `09${String(Math.floor(between(10_000_000, 99_999_999)))}`,
          totalAmount: gross - sellerVoucher,
          paymentStatus: cancelled ? "UNPAID" : "PAID",
          shippingStatus,
          returnStatus,
          itemCount: lines.length,
          createdAt,
          isSettled: settled,
          settledAt: settled ? new Date(createdAt.getTime() + 2 * DAY_MS) : null,
          fixedFee, paymentFee, serviceFee, sellerProtectionFee, affiliateFee,
          sellerVoucher, taxWithheld,
          actualPayout: cancelled ? 0 : actualPayout,
          carrier: isShopee ? "SPX" : "NINJA_VAN",
          trackingCode: `${isShopee ? "SPXVN0" : "LEXVN0"}${orderSeq}${Math.floor(rnd() * 90 + 10)}`,
        },
      });
      await prisma.orderItem.createMany({
        data: lines.map((l) => ({
          orderId: order.id,
          productId: l.p.id,
          channelSku: l.p.skuCode,
          productName: l.p.productName,
          quantity: l.qty,
          price: l.p.sellingPrice,
          costPriceAtSale: l.p.costPrice,
        })),
      });
      totalOrders++;
    }
  }

  // ---- 6) Chi phí vận hành: ads mỗi ngày + vài khoản cố định ----
  for (let d = DAYS - 1; d >= 0; d--) {
    const dayStartUtc = new Date(vnMidnightUtc.getTime() - d * DAY_MS);
    const expenseDate = new Date(dayStartUtc.getTime() + 10 * 3600_000);
    await prisma.operatingExpense.create({
      data: {
        userId: user.id,
        name: "Quảng cáo Shopee + Lazada",
        category: "ADS", type: "VARIABLE",
        amount: Math.round(between(900_000, 1_450_000) / 1000) * 1000,
        expenseDate,
      },
    });
    if (d % 4 === 0) {
      await prisma.operatingExpense.create({
        data: {
          userId: user.id,
          name: "Vật tư đóng gói",
          category: "PACKAGING", type: "VARIABLE",
          amount: Math.round(between(280_000, 460_000) / 1000) * 1000,
          expenseDate,
        },
      });
    }
  }
  await prisma.operatingExpense.create({
    data: {
      userId: user.id, name: "Lương nhân viên kho", category: "SALARY", type: "FIXED",
      amount: 6_500_000, expenseDate: new Date(vnMidnightUtc.getTime() - (DAYS - 1) * DAY_MS + 9 * 3600_000),
    },
  });

  console.log(`✅ Seed demo xong: ${totalOrders} đơn / ${DAYS} ngày, 2 kênh, ${products.length} SP (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  console.log("   Đăng nhập: demo@hubsell.tech / demo-hubsell-2026");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("❌", e);
    await prisma.$disconnect();
    process.exit(1);
  });
