/**
 * TÀI KHOẢN TRIAL CHO ĐỘI XÉT DUYỆT ISV (Shopee Third-party Partner Platform,
 * sau này dùng lại cho Lazada ISV / TikTok Partner).
 *
 * Shopee yêu cầu (developer-guide/12, cập nhật 19/07/2026): "Submit live
 * versions of (a) your business product's URL, (b) trial account login details
 * and enable ALL features for Shopee's testing purposes". Tài khoản này vì thế:
 *   · gói BUSINESS trả phí 12 tháng (không trial, không trần, mở mọi module);
 *   · 2 gian Shopee + Lazada trạng thái ACTIVE, KHÔNG có token (không gọi API
 *     sàn — worker auto-sync chỉ quét gian có refreshToken nên bỏ qua);
 *   · ~45 ngày đơn hàng ĐẸP (nhịp tăng, cuối tuần cao, đủ trạng thái, có
 *     hoàn/trả ở mọi công đoạn), 12 SKU kho nối đủ 2 gian, chi phí vận hành,
 *     chi phí ads theo ngày, số dư ví sàn — mọi màn Tổng quan / Đơn / Hàng
 *     hóa / Dòng tiền / Hoàn / Gói đều có số.
 *
 * KHÁC seed-landing-demo.ts (chỉ chạy local, phục vụ chụp ảnh landing, giữ
 * nguyên PRNG để ảnh tái lập): script này chạy được trên PRODUCTION nhưng
 * phải khai rõ ý định, và CHỈ đụng tới đúng user có email được truyền vào.
 *
 * Idempotent: chạy lại là xóa user cũ (cascade toàn bộ data) rồi seed mới.
 *
 * Sau seed, worker src/workers/reviewer-demo-topup.ts (mỗi 30 phút trên
 * backend) tự bồi đơn hôm nay + già hóa đơn cũ theo vòng đời thật nên KHÔNG
 * cần seed lại định kỳ; phí đối soát của worker dùng cùng công thức mục 6 —
 * sửa tỷ lệ phí ở đây thì sửa cả settlementFees() bên đó.
 *
 *   # Local (DATABASE_URL trong .env)
 *   npx tsx scripts/seed-isv-reviewer.ts --password=<mật khẩu>
 *
 *   # Production (PowerShell) — bắt buộc --production, chuỗi Supabase có mật
 *   # khẩu chứa ký tự đặc biệt phải URL-encode (vd @ → %40, # → %23)
 *   $env:DATABASE_URL='postgresql://...'; npx tsx scripts/seed-isv-reviewer.ts --production --password=<mật khẩu>
 *
 * Tùy chọn: --email=reviewer@hubsell.vn (mặc định) · --days=45 · --plan=BUSINESS
 *           --shop="Hubsell Demo Store"
 * Không truyền --password mà user đã tồn tại → giữ nguyên mật khẩu cũ.
 */
import "dotenv/config";
import {
  PrismaClient,
  ChannelName,
  ShippingStatus,
  ReturnStatus,
  ReturnSolution,
  Carrier,
} from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

const prisma = new PrismaClient();

// ---------- tham số dòng lệnh ----------
function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const EMAIL = (arg("email") ?? "reviewer@hubsell.vn").toLowerCase();
const PASSWORD = arg("password");
// 62 ngày = đủ HAI cửa sổ 30 ngày trọn vẹn → badge "so với kỳ trước" ra
// mức tăng trưởng thật (~+25%), không phải +130% vì kỳ trước thiếu ngày.
const DAYS = Math.max(7, Number(arg("days") ?? 62));
const PLAN_CODE = (arg("plan") ?? "BUSINESS").toUpperCase();
const SHOP_NAME = arg("shop") ?? "Hubsell Demo Store";
const IS_PRODUCTION_FLAG = flag("production");

// PRNG có seed — chạy lại ra đúng một bộ số (khác seed landing để 2 bộ demo không giống hệt).
function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260910);
const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rnd() * arr.length)];
const between = (lo: number, hi: number) => lo + rnd() * (hi - lo);
const roundTo = (v: number, step: number) => Math.round(v / step) * step;

const DAY_MS = 86_400_000;
const VN_OFFSET_MS = 7 * 3600_000;

// 12 SKU thời trang — giá vốn/giá bán thật tay, biên 50-60% để P&L đẹp.
const PRODUCTS = [
  { skuCode: "VAY-HOA-S", productName: "Váy hoa nhí dáng xòe", costPrice: 82_000, sellingPrice: 189_000, quantityInStock: 140, lowStockThreshold: 30 },
  { skuCode: "AO-THUN-M", productName: "Áo thun cotton form rộng", costPrice: 38_000, sellingPrice: 99_000, quantityInStock: 320, lowStockThreshold: 60 },
  { skuCode: "QUAN-JEAN-32", productName: "Quần jean ống rộng", costPrice: 132_000, sellingPrice: 289_000, quantityInStock: 96, lowStockThreshold: 25 },
  { skuCode: "SET-DO-BO-L", productName: "Set đồ bộ thu đông", costPrice: 118_000, sellingPrice: 259_000, quantityInStock: 88, lowStockThreshold: 20 },
  { skuCode: "AO-SOMI-XL", productName: "Áo sơ mi lụa công sở", costPrice: 96_000, sellingPrice: 219_000, quantityInStock: 150, lowStockThreshold: 30 },
  { skuCode: "CHAN-VAY-M", productName: "Chân váy chữ A", costPrice: 71_000, sellingPrice: 159_000, quantityInStock: 175, lowStockThreshold: 30 },
  { skuCode: "AO-KHOAC-L", productName: "Áo khoác gió 2 lớp", costPrice: 156_000, sellingPrice: 329_000, quantityInStock: 64, lowStockThreshold: 20 },
  { skuCode: "TUI-TOTE-01", productName: "Túi tote canvas in chữ", costPrice: 36_000, sellingPrice: 89_000, quantityInStock: 260, lowStockThreshold: 50 },
  { skuCode: "GIAY-SNK-38", productName: "Giày sneaker basic trắng", costPrice: 205_000, sellingPrice: 439_000, quantityInStock: 52, lowStockThreshold: 15 },
  { skuCode: "AO-LEN-M", productName: "Áo len tăm cổ tròn", costPrice: 88_000, sellingPrice: 199_000, quantityInStock: 120, lowStockThreshold: 30 },
  { skuCode: "QUAN-SHORT-L", productName: "Quần short kaki nam", costPrice: 64_000, sellingPrice: 149_000, quantityInStock: 18, lowStockThreshold: 25 }, // cố ý SẮP HẾT → cảnh báo tồn
  { skuCode: "MU-LUOI-TRAI", productName: "Mũ lưỡi trai thêu logo", costPrice: 29_000, sellingPrice: 79_000, quantityInStock: 210, lowStockThreshold: 40 },
] as const;

const FIRST = ["Nguyễn", "Trần", "Lê", "Phạm", "Hoàng", "Vũ", "Đặng", "Bùi", "Đỗ", "Hồ", "Ngô", "Dương"];
const LAST = ["Minh Anh", "Thu Hà", "Quốc Bảo", "Ngọc Lan", "Văn Hùng", "Thảo Vy", "Đức Long", "Kim Ngân", "Gia Hân", "Hải Yến", "Tuấn Kiệt", "Phương Linh", "Bảo Châu", "Anh Thư"];

const SHOPEE_CARRIERS: { carrier: Carrier; name: string }[] = [
  { carrier: Carrier.SPX, name: "SPX Express" },
  { carrier: Carrier.SPX, name: "SPX Express" },
  { carrier: Carrier.GHN, name: "Giao Hàng Nhanh" },
  { carrier: Carrier.JT, name: "J&T Express" },
];
const LAZADA_CARRIERS: { carrier: Carrier; name: string }[] = [
  { carrier: Carrier.NINJA_VAN, name: "Ninja Van" },
  { carrier: Carrier.GHN, name: "Giao Hàng Nhanh" },
  { carrier: Carrier.BEST, name: "BEST Express" },
];

function isLocalDb(url: string) {
  return /localhost|127\.0\.0\.1/.test(url);
}

async function main() {
  const dbUrl = process.env.DATABASE_URL ?? "";
  if (!dbUrl) throw new Error("Thiếu DATABASE_URL.");
  if (!isLocalDb(dbUrl) && !IS_PRODUCTION_FLAG) {
    throw new Error(
      "TỪ CHỐI CHẠY: DATABASE_URL không phải localhost. Muốn seed lên production phải thêm cờ --production."
    );
  }
  const masked = dbUrl.replace(/:\/\/([^:]+):[^@]+@/, "://$1:***@");
  console.log(`DB: ${masked}`);
  console.log(`Tài khoản: ${EMAIL} · gói ${PLAN_CODE} · ${DAYS} ngày đơn · shop "${SHOP_NAME}"`);

  // ---- 1) Gói dịch vụ: production đã có sẵn thang 5 bậc, local có thể chưa ----
  let plan = await prisma.servicePlan.findUnique({ where: { code: PLAN_CODE } });
  if (!plan) {
    if (!isLocalDb(dbUrl)) throw new Error(`Không thấy gói ${PLAN_CODE} trên DB — kiểm tra lại mã gói.`);
    plan = await prisma.servicePlan.create({
      data: {
        code: PLAN_CODE, name: "Business", tier: 4,
        priceMonthly: 699_000, maxOrdersPerMonth: 10_000, isActive: true,
        description: "Gói tạo bởi seed-isv-reviewer (local)",
      },
    });
    console.log(`(local) Tạo gói ${PLAN_CODE} vì DB chưa có.`);
  }

  // ---- 2) User reviewer (xóa cũ → tạo mới; giữ mật khẩu cũ nếu không truyền) ----
  const existing = await prisma.user.findUnique({
    where: { email: EMAIL },
    select: { id: true, passwordHash: true, isPlatformAdmin: true, ownerId: true },
  });
  if (existing?.isPlatformAdmin) {
    throw new Error("TỪ CHỐI: email này là tài khoản quản trị nền tảng (HQ) — không seed đè.");
  }
  if (existing?.ownerId) {
    throw new Error("TỪ CHỐI: email này là tài khoản nhân viên của shop khác.");
  }
  if (!existing && !PASSWORD) {
    throw new Error("User chưa tồn tại — phải truyền --password=<mật khẩu> để tạo mới.");
  }
  const passwordHash = PASSWORD ? await bcrypt.hash(PASSWORD, 10) : existing!.passwordHash;
  if (existing) {
    await prisma.user.delete({ where: { id: existing.id } }); // cascade dọn channel/order/product/expense/subscription
    console.log("🧹 Đã xóa user reviewer cũ (cascade toàn bộ data của riêng user này).");
  }
  const user = await prisma.user.create({
    data: {
      email: EMAIL,
      passwordHash,
      fullName: SHOP_NAME,
      role: "ADMIN",
      lastActiveAt: new Date(),
    },
  });

  // ---- 3) Thuê bao BUSINESS 12 tháng, không trial ----
  await prisma.subscription.create({
    data: {
      userId: user.id, planId: plan.id, status: "ACTIVE", isTrial: false,
      currentPeriodStart: new Date(Date.now() - 20 * DAY_MS),
      currentPeriodEnd: new Date(Date.now() + 345 * DAY_MS),
    },
  });

  // ---- 4) Kênh bán: Shopee + Lazada (TikTok "sắp ra mắt", cố ý không có) ----
  // apiToken theo đúng khuôn gian thủ công của app (TOKEN_PREFIX + hex) để
  // trang Kênh bán hiện "shp_…" thay vì cảnh báo "chưa có API Token"; KHÔNG
  // đặt refreshToken → apiConnected=false, worker auto-sync/refresh token/làm
  // mới ví đều bỏ qua gian này (không gọi sàn với token giả).
  const fakeToken = (prefix: string) => `${prefix}_${randomBytes(20).toString("hex")}`;
  const [shopee, lazada] = await Promise.all([
    prisma.channel.create({
      data: {
        userId: user.id, channelName: ChannelName.SHOPEE, shopName: SHOP_NAME,
        externalShopName: SHOP_NAME, apiToken: fakeToken("shp"),
        status: "ACTIVE", lastSyncAt: new Date(),
        walletBalance: 31_874_500, walletBalanceSyncedAt: new Date(),
        stockSyncEnabled: true, stockSyncEnabledAt: new Date(Date.now() - 30 * DAY_MS),
        lastStockReconcileAt: new Date(Date.now() - 2 * 3600_000), lastStockReconcileMismatch: 0,
      },
    }),
    prisma.channel.create({
      data: {
        userId: user.id, channelName: ChannelName.LAZADA, shopName: SHOP_NAME,
        externalShopName: SHOP_NAME, apiToken: fakeToken("laz"),
        status: "ACTIVE", lastSyncAt: new Date(),
        walletBalance: 12_405_000, walletBalanceSyncedAt: new Date(),
        stockSyncEnabled: true, stockSyncEnabledAt: new Date(Date.now() - 30 * DAY_MS),
        lastStockReconcileAt: new Date(Date.now() - 2 * 3600_000), lastStockReconcileMismatch: 0,
      },
    }),
  ]);

  // ---- 5) Sản phẩm kho + SKU trên từng gian nối về kho ----
  const products: { id: string; skuCode: string; costPrice: number; sellingPrice: number; productName: string; stock: number }[] = [];
  for (const p of PRODUCTS) {
    const row = await prisma.product.create({ data: { ...p, userId: user.id } });
    products.push({ id: row.id, skuCode: p.skuCode, costPrice: p.costPrice, sellingPrice: p.sellingPrice, productName: p.productName, stock: p.quantityInStock });
    for (const ch of [shopee, lazada]) {
      await prisma.channelProduct.create({
        data: {
          channelId: ch.id,
          channelSku: p.skuCode,
          itemSku: p.skuCode,
          productName: p.productName,
          price: p.sellingPrice,
          costPrice: p.costPrice,
          externalId: String(100_000_000 + Math.floor(rnd() * 899_999_999)),
          channelStock: p.quantityInStock,
          status: "ACTIVE",
          lastSyncedAt: new Date(),
          productId: row.id,
        },
      });
    }
  }

  // ---- 6) Đơn hàng DAYS ngày — nhịp tăng dần, cuối tuần cao, đủ trạng thái ----
  const now = new Date();
  const vnMidnightUtc = new Date(Math.floor((now.getTime() + VN_OFFSET_MS) / DAY_MS) * DAY_MS - VN_OFFSET_MS);

  let orderSeq = 71_300;
  let totalOrders = 0;
  let returnOrders = 0;
  const t0 = Date.now();

  for (let d = DAYS - 1; d >= 0; d--) {
    const dayStartUtc = new Date(vnMidnightUtc.getTime() - d * DAY_MS);
    const vnDow = new Date(dayStartUtc.getTime() + VN_OFFSET_MS).getUTCDay();
    const weekendBoost = vnDow === 0 || vnDow === 6 ? 1.25 : 1;
    const growth = 1 + (DAYS - 1 - d) * 0.008;
    // Hôm nay nhỉnh hơn hôm qua một chút → badge so sánh xanh. Biên độ ngẫu
    // nhiên hẹp (48-58) để badge % không nhảy ±40% trông như số bịa.
    const dayShare = d === 0 ? 1.06 : 1;
    const count = Math.round(between(48, 58) * weekendBoost * growth * dayShare);

    for (let i = 0; i < count; i++) {
      const isShopee = rnd() < 0.64;
      const channel = isShopee ? shopee : lazada;
      orderSeq += 1 + Math.floor(rnd() * 3);
      const orderCode = isShopee ? `2609${orderSeq}SPVN` : `LZD26${orderSeq}`;

      const lineCount = rnd() < 0.7 ? 1 : rnd() < 0.8 ? 2 : 3;
      const lines: { p: (typeof products)[number]; qty: number }[] = [];
      for (let l = 0; l < lineCount; l++) lines.push({ p: pick(products), qty: rnd() < 0.85 ? 1 : 2 });
      const gross = lines.reduce((s, l) => s + l.p.sellingPrice * l.qty, 0);

      // Trạng thái theo tuổi đơn
      const r = rnd();
      let shippingStatus: ShippingStatus;
      if (d >= 4) {
        shippingStatus = r < 0.91 ? ShippingStatus.DELIVERED : r < 0.95 ? ShippingStatus.SHIPPING : ShippingStatus.CANCELLED;
      } else if (d >= 1) {
        shippingStatus = r < 0.4 ? ShippingStatus.DELIVERED : r < 0.85 ? ShippingStatus.SHIPPING : r < 0.95 ? ShippingStatus.PROCESSED : ShippingStatus.CANCELLED;
      } else {
        shippingStatus = r < 0.25 ? ShippingStatus.SHIPPING : r < 0.7 ? ShippingStatus.PROCESSED : ShippingStatus.PENDING;
      }
      const cancelled = shippingStatus === ShippingStatus.CANCELLED;
      const delivered = shippingStatus === ShippingStatus.DELIVERED;

      const sellerVoucher = rnd() < 0.3 ? roundTo(gross * between(0.02, 0.06), 500) : 0;
      const actualRevenue = gross - sellerVoucher;

      // Quyết toán: đơn DELIVERED từ 3 ngày tuổi (Shopee ~3 ngày, Lazada ~5 ngày)
      const settled = delivered && d >= (isShopee ? 3 : 5);
      const fixedFee = settled ? Math.round(actualRevenue * (isShopee ? 0.04 : 0.03)) : 0;
      const paymentFee = settled ? Math.round(actualRevenue * (isShopee ? 0.045 : 0.0245)) : 0;
      const serviceFee = settled ? Math.round(actualRevenue * (isShopee ? 0.06 : 0.05)) : 0;
      const sellerProtectionFee = settled && isShopee ? Math.round(actualRevenue * 0.005) : 0;
      const affiliateFee = settled && rnd() < 0.22 ? Math.round(actualRevenue * 0.03) : 0;
      const taxWithheld = settled ? Math.round(actualRevenue * 0.015) : 0;
      const shippingFeeQuoted = settled ? roundTo(between(16_500, 32_000), 500) : 0;
      const shippingFeeActual = settled ? shippingFeeQuoted + (rnd() < 0.12 ? roundTo(between(2_000, 9_000), 500) : 0) : 0;
      const shippingFeeDiff = shippingFeeActual - shippingFeeQuoted;
      const platformSubsidy = settled && rnd() < 0.35 ? roundTo(actualRevenue * between(0.01, 0.03), 500) : 0;
      const actualPayout = settled
        ? actualRevenue - fixedFee - paymentFee - serviceFee - sellerProtectionFee - affiliateFee - taxWithheld - shippingFeeDiff
        : 0;

      const createdAt = new Date(dayStartUtc.getTime() + between(7.5, 22.5) * 3600_000);
      const deliveredAt = delivered ? new Date(createdAt.getTime() + between(1.5, 3.5) * DAY_MS) : null;

      // Hoàn/trả: ~2,5% đơn đã giao từ 5 ngày tuổi, rải đủ công đoạn để màn Hoàn có việc.
      let returnStatus: ReturnStatus = ReturnStatus.NONE;
      let returnSolution: ReturnSolution | null = null;
      let refundedAmount = 0;
      let returnedAt: Date | null = null;
      let returnRequestedAt: Date | null = null;
      let returnTrackingCode: string | null = null;
      let returnNote: string | null = null;
      if (delivered && d >= 5 && rnd() < 0.025) {
        const rr = rnd();
        returnStatus =
          d < 9 ? ReturnStatus.AWAITING
          : rr < 0.25 ? ReturnStatus.RECEIVED
          : rr < 0.7 ? ReturnStatus.RECEIVED_INTACT
          : rr < 0.85 ? ReturnStatus.DAMAGED
          : rr < 0.95 ? ReturnStatus.CLAIM_SETTLED
          : ReturnStatus.WRITTEN_OFF;
        returnSolution = ReturnSolution.RETURN_REFUND;
        refundedAmount = actualRevenue;
        // Sàn báo hoàn 1-3 ngày sau giao; kiện quay về kho mất thêm 2-7 ngày
        // (cột "Thời gian chờ" = số ngày kiện đi đường, không phải 1 ngày đồng loạt).
        returnRequestedAt = new Date(deliveredAt!.getTime() + between(1, 3) * DAY_MS);
        returnedAt =
          returnStatus === ReturnStatus.AWAITING
            ? null
            : new Date(returnRequestedAt.getTime() + between(2, 7) * DAY_MS);
        returnTrackingCode = `${isShopee ? "SPXVN" : "LEXVN"}R${orderSeq}${Math.floor(rnd() * 90 + 10)}`;
        returnNote = pick(["Khách đổi ý", "Sai size", "Không đúng mô tả", "Giao chậm, khách hủy nhận"]);
        returnOrders++;
      }

      const carrierPick = isShopee ? pick(SHOPEE_CARRIERS) : pick(LAZADA_CARRIERS);
      const order = await prisma.order.create({
        data: {
          channelId: channel.id,
          orderCode,
          customerName: `${pick(FIRST)} ${pick(LAST)}`,
          customerPhone: `09${String(Math.floor(between(10_000_000, 99_999_999)))}`,
          totalAmount: actualRevenue,
          paymentStatus: cancelled ? "UNPAID" : "PAID",
          shippingStatus,
          returnStatus,
          returnSolution,
          returnNote,
          returnedAt,
          returnTrackingCode,
          returnRequestedAt,
          refundedAmount,
          platformRefundAmount: refundedAmount,
          itemCount: lines.reduce((s, l) => s + l.qty, 0),
          createdAt,
          deliveredAt,
          packedAt: shippingStatus === ShippingStatus.PENDING ? null : new Date(createdAt.getTime() + between(0.5, 6) * 3600_000),
          isSettled: settled,
          settledAt: settled ? new Date(deliveredAt!.getTime() + (isShopee ? 1 : 2) * DAY_MS) : null,
          fixedFee, paymentFee, serviceFee, sellerProtectionFee, affiliateFee,
          sellerVoucher, taxWithheld, platformSubsidy,
          shippingFeeQuoted, shippingFeeActual, shippingFeeDiff,
          actualPayout: cancelled ? 0 : actualPayout,
          carrier: carrierPick.carrier,
          shippingCarrierName: carrierPick.name,
          trackingCode: shippingStatus === ShippingStatus.PENDING ? null : `${isShopee ? "SPXVN0" : "LEXVN0"}${orderSeq}${Math.floor(rnd() * 90 + 10)}`,
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
          returnedQuantity: returnStatus === ReturnStatus.NONE ? 0 : l.qty,
          returnRestocked: returnStatus === ReturnStatus.RECEIVED_INTACT,
        })),
      });
      totalOrders++;
    }
    if (d % 10 === 0) console.log(`   … còn ${d} ngày (${totalOrders} đơn)`);
  }

  // ---- 7) Chi phí ads theo ngày (đồng bộ từ sàn) + chi phí vận hành ----
  for (let d = DAYS - 1; d >= 0; d--) {
    const dayStartUtc = new Date(vnMidnightUtc.getTime() - d * DAY_MS);
    await prisma.adSpend.createMany({
      data: [
        { channelId: shopee.id, date: dayStartUtc, amount: roundTo(between(650_000, 1_150_000), 1000) },
        { channelId: lazada.id, date: dayStartUtc, amount: roundTo(between(250_000, 480_000), 1000) },
      ],
    });
    if (d % 5 === 0) {
      await prisma.operatingExpense.create({
        data: {
          userId: user.id, name: "Vật tư đóng gói (túi, băng keo, tem)",
          category: "PACKAGING", type: "VARIABLE",
          amount: roundTo(between(320_000, 520_000), 1000),
          expenseDate: new Date(dayStartUtc.getTime() + 10 * 3600_000),
        },
      });
    }
  }
  // Khoản cố định đầu mỗi tháng trong cửa sổ
  for (let d = DAYS - 1; d >= 0; d--) {
    const dayStartUtc = new Date(vnMidnightUtc.getTime() - d * DAY_MS);
    const vnDate = new Date(dayStartUtc.getTime() + VN_OFFSET_MS).getUTCDate();
    if (vnDate !== 1 && d !== DAYS - 1) continue;
    const at = new Date(dayStartUtc.getTime() + 9 * 3600_000);
    await prisma.operatingExpense.createMany({
      data: [
        { userId: user.id, name: "Lương nhân viên kho + đóng gói", category: "SALARY", type: "FIXED", amount: 9_500_000, expenseDate: at },
        { userId: user.id, name: "Thuê kho 40m²", category: "RENT", type: "FIXED", amount: 4_000_000, expenseDate: at },
        { userId: user.id, name: "Phần mềm & tiện ích", category: "OTHER", type: "FIXED", amount: 1_200_000, expenseDate: at },
      ],
    });
  }

  console.log(
    `✅ Seed reviewer xong: ${totalOrders} đơn / ${DAYS} ngày (${returnOrders} đơn hoàn), 2 gian, ${products.length} SKU nối đủ 2 sàn (${((Date.now() - t0) / 1000).toFixed(1)}s)`
  );
  console.log(`   Đăng nhập: ${EMAIL}${PASSWORD ? " / " + PASSWORD : " (mật khẩu giữ nguyên)"} · gói ${plan.name} tới ${new Date(Date.now() + 345 * DAY_MS).toLocaleDateString("vi-VN")}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("❌", e);
    await prisma.$disconnect();
    process.exit(1);
  });
