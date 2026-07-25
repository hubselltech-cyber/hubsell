// ============================================================
// SINH ĐƠN THỬ NGHIỆM HÀNG LOẠT (Shopee) theo kịch bản thực tế, để test toàn
// diện: trạng thái đơn, phí & dòng tiền, quyết toán, và các màn Thống kê/Báo cáo.
//
// Vì sao KHÔNG chỉ gọi upsertShopeeOrderTx:
//   - upsert chỉ ghi totalAmount + platformFee TẠM TÍNH, KHÔNG trừ kho, KHÔNG
//     ghi field quyết toán. Mà:
//       • Màn Tổng quan (/analytics) tính giá vốn từ InventoryLog → phải TẠO LOG.
//       • Báo cáo dùng phí thực tế chỉ khi isSettled=true → phải QUYẾT TOÁN.
//   Nên: (1) ingest qua đúng hàm production để có OrderItem + snapshot giá vốn,
//        (2) tạo log trừ kho (mirror deductStockTx), (3) update field quyết toán.
//
// Mã đơn: TEST-BULK-*  → dễ lọc & tự dọn khi chạy lại (idempotent).
// Chạy:  cd backend && npx tsx scripts/shopee-bulk-test-scenarios.ts [shop_id]
//   (GIỮ đơn trong DB — KHÔNG xoá sau khi chạy, đúng yêu cầu xem trên UI.)
// ============================================================

import "dotenv/config";
import {
  ChannelName,
  InventoryLogType,
  ReturnStatus,
  ShippingDisputeStatus,
} from "@prisma/client";
import { prisma } from "../src/prisma";
import { PLATFORM_FEE_RATE } from "../src/mockMarketplace";
import { upsertShopeeOrderTx } from "../src/integrations/shopee/service";
import type { ShopeeOrderDetail } from "../src/integrations/shopee/client";

const ITEM_ID = 802716941; // Túi đeo chéo TC008
const BASE_STOCK = 500; // tồn kho gốc reset mỗi lần chạy → số cuối kỳ tất định

// 3 phân loại + SP nội bộ (đã liên kết ở phiên trước). Reset giá vốn/tồn để chạy lại ổn định.
const VARIANTS = {
  XANH: { modelId: 11873061, sku: `SPE-${ITEM_ID}-11873061`, name: "Túi đeo chéo TC008 - XANH", skuCode: "TC008-XANH", cost: 55000, price: 90000 },
  TIM:  { modelId: 11873062, sku: `SPE-${ITEM_ID}-11873062`, name: "Túi đeo chéo TC008 - TÍM",  skuCode: "TC008-TIM",  cost: 58000, price: 90000 },
  DEN:  { modelId: 11873060, sku: `SPE-${ITEM_ID}-11873060`, name: "Túi đeo chéo TC008 - ĐEN",  skuCode: "TC008-DEN",  cost: 60000, price: 90000 },
} as const;
type VKey = keyof typeof VARIANTS;

interface Line { v: VKey; qty: number }
interface Settle {
  fixedFee?: number; serviceFee?: number; paymentFee?: number; affiliateFee?: number;
  sellerVoucher?: number; platformSubsidy?: number;
  shippingFeeQuoted?: number; shippingFeeActual?: number; shippingFeeDiff?: number;
  shippingDisputeStatus?: ShippingDisputeStatus;
}
interface Spec {
  code: string;
  status: string;           // order_status của SHOPEE (mapShopeeStatus sẽ quy đổi)
  lines: Line[];
  daysAgo: number;          // để rải createdAt cho biểu đồ theo thời gian
  settle?: Settle;          // có = mô phỏng đã quyết toán (GĐ2)
  returnStatus?: ReturnStatus;
  paymentStatus?: string;   // ghi đè (vd REFUNDED cho đơn hoàn)
  totalOverride?: number;   // ghi đè totalAmount (vd Đơn 6)
  note?: string;
}

const now = Math.floor(Date.now() / 1000);
const lineTotal = (lines: Line[]) => lines.reduce((s, l) => s + VARIANTS[l.v].price * l.qty, 0);

function settledFee(s: Settle): number {
  return (s.fixedFee ?? 0) + (s.serviceFee ?? 0) + (s.paymentFee ?? 0) + (s.affiliateFee ?? 0) +
    (s.sellerVoucher ?? 0) + (s.shippingFeeDiff ?? 0) - (s.platformSubsidy ?? 0);
}

// ---------- KỊCH BẢN ----------
const SPECS: Spec[] = [
  // NHÓM 1 — TRẠNG THÁI ĐƠN
  { code: "TEST-BULK-READY",     status: "READY_TO_SHIP", lines: [{ v: "XANH", qty: 1 }], daysAgo: 1, note: "Chờ giao shipper (→PENDING)" },
  { code: "TEST-BULK-PROCESSED", status: "PROCESSED",     lines: [{ v: "TIM", qty: 2 }],  daysAgo: 2, note: "Đã xử lý/đang giao (→PROCESSED)" },
  { code: "TEST-BULK-COMPLETED", status: "COMPLETED",     lines: [{ v: "DEN", qty: 1 }, { v: "XANH", qty: 1 }], daysAgo: 3, note: "Đã giao (→DELIVERED)" },
  { code: "TEST-BULK-CANCELLED", status: "CANCELLED",     lines: [{ v: "TIM", qty: 1 }],  daysAgo: 2, note: "Khách hủy trước giao (→CANCELLED)" },
  { code: "TEST-BULK-RETURN",    status: "TO_RETURN",     lines: [{ v: "DEN", qty: 1 }],  daysAgo: 4, returnStatus: ReturnStatus.DAMAGED, paymentStatus: "REFUNDED", note: "Hoàn trả/bom hàng (→DELIVERED + RETURNING)" },

  // NHÓM 2 — PHÍ & DÒNG TIỀN (đều COMPLETED + đã quyết toán để báo cáo dùng phí THỰC)
  { code: "TEST-BULK-DISCOUNT",  status: "COMPLETED", lines: [{ v: "XANH", qty: 1 }], daysAgo: 5,
    settle: { fixedFee: 4500 }, note: "Voucher Shopee trợ giá: khách trả 30k nhưng DOANH THU GỐC vẫn 90k (buyer_paid không có field lưu)" },
  { code: "TEST-BULK-HIGH-SHIP", status: "COMPLETED", lines: [{ v: "TIM", qty: 1 }], daysAgo: 5,
    settle: { fixedFee: 4500, shippingFeeQuoted: 30000, shippingFeeActual: 45000, shippingFeeDiff: 15000, shippingDisputeStatus: ShippingDisputeStatus.CHO_KHIEU_NAI },
    note: "Phí ship thực 45k > báo 30k → chênh 15k trừ vào lợi nhuận + vào màn Đối soát ship" },
  { code: "TEST-BULK-HIGH-FEE",  status: "COMPLETED", lines: [{ v: "DEN", qty: 2 }], daysAgo: 6,
    settle: { fixedFee: 18000, serviceFee: 25000, paymentFee: 8000 }, note: "Phí cố định + dịch vụ (Freeship/Voucher Xtra) cao — test bóc tách chi phí sàn" },

  // NHÓM 3 — SỐ LƯỢNG LỚN (COMPLETED, XANH & ĐEN vượt trội) cho Top SP + biểu đồ doanh thu
  { code: "TEST-BULK-COMPLETED-01", status: "COMPLETED", lines: [{ v: "XANH", qty: 3 }], daysAgo: 0 },
  { code: "TEST-BULK-COMPLETED-02", status: "COMPLETED", lines: [{ v: "DEN", qty: 2 }, { v: "XANH", qty: 1 }], daysAgo: 1 },
  { code: "TEST-BULK-COMPLETED-03", status: "COMPLETED", lines: [{ v: "XANH", qty: 4 }], daysAgo: 3, settle: { fixedFee: 18000, paymentFee: 7200 } },
  { code: "TEST-BULK-COMPLETED-04", status: "COMPLETED", lines: [{ v: "DEN", qty: 3 }], daysAgo: 5 },
  { code: "TEST-BULK-COMPLETED-05", status: "COMPLETED", lines: [{ v: "XANH", qty: 2 }, { v: "DEN", qty: 2 }], daysAgo: 6, settle: { fixedFee: 18000, serviceFee: 6000, paymentFee: 7200 } },
  { code: "TEST-BULK-COMPLETED-06", status: "COMPLETED", lines: [{ v: "DEN", qty: 4 }], daysAgo: 8 },
  { code: "TEST-BULK-COMPLETED-07", status: "COMPLETED", lines: [{ v: "XANH", qty: 5 }], daysAgo: 10, settle: { fixedFee: 22500, paymentFee: 9000 } },
  { code: "TEST-BULK-COMPLETED-08", status: "COMPLETED", lines: [{ v: "DEN", qty: 3 }, { v: "XANH", qty: 2 }], daysAgo: 12 },
];

async function main() {
  const wantShopId = process.argv[2]?.trim();
  const channel = await prisma.channel.findFirst({
    where: { channelName: "SHOPEE", status: "ACTIVE", ...(wantShopId ? { externalShopId: wantShopId } : {}) },
    orderBy: { createdAt: "desc" },
  });
  if (!channel) { console.log("❌ Không thấy gian Shopee trong DB."); return; }
  console.log(`SHOP: ${channel.shopName} | shop_id=${channel.externalShopId}\n`);

  const feeRate = Number(channel.feeRate) > 0 ? Number(channel.feeRate) : PLATFORM_FEE_RATE[ChannelName.SHOPEE];

  // (0) Đảm bảo 3 SP nội bộ có giá vốn + reset tồn kho gốc (để chạy lại tất định).
  const productIdByKey: Record<VKey, string> = {} as any;
  for (const key of Object.keys(VARIANTS) as VKey[]) {
    const v = VARIANTS[key];
    const p = await prisma.product.upsert({
      where: { userId_skuCode: { userId: channel.userId, skuCode: v.skuCode } },
      update: { costPrice: v.cost, sellingPrice: v.price, productName: v.name, quantityInStock: BASE_STOCK },
      create: { userId: channel.userId, skuCode: v.skuCode, productName: v.name, costPrice: v.cost, sellingPrice: v.price, quantityInStock: BASE_STOCK },
    });
    productIdByKey[key] = p.id;
    // Nối ChannelProduct → Product (nếu chưa) để snapshot giá vốn chạy.
    await prisma.channelProduct.updateMany({
      where: { channelId: channel.id, channelSku: v.sku },
      data: { productId: p.id },
    });
  }

  // (1) Dọn đơn TEST-BULK-* cũ (xoá log trước vì InventoryLog.orderId là SetNull).
  const old = await prisma.order.findMany({
    where: { channelId: channel.id, orderCode: { startsWith: "TEST-BULK-" } },
    select: { id: true },
  });
  if (old.length) {
    const ids = old.map((o) => o.id);
    await prisma.inventoryLog.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.order.deleteMany({ where: { id: { in: ids } } }); // cascade OrderItem
    console.log(`🧹 Đã dọn ${ids.length} đơn TEST-BULK-* cũ.\n`);
  }

  const created: { code: string; status: string; total: number; settled: boolean; note?: string }[] = [];

  for (const spec of SPECS) {
    const total = spec.totalOverride ?? lineTotal(spec.lines);
    const createTime = now - spec.daysAgo * 86400;

    const order: ShopeeOrderDetail = {
      order_sn: spec.code,
      order_status: spec.status,
      create_time: createTime,
      total_amount: total,
      buyer_username: "buyer_sandbox",
      recipient_address: { name: "Khách Test", phone: "0900000000" },
      item_list: spec.lines.map((l) => ({
        item_id: ITEM_ID,
        item_name: "Túi đeo chéo TC008",
        item_sku: "TC008",
        model_id: VARIANTS[l.v].modelId,
        model_name: l.v,
        model_sku: "",
        model_quantity_purchased: l.qty,
        model_discounted_price: VARIANTS[l.v].price,
      })),
    };

    // (a) Ingest qua hàm production → Order + OrderItem + snapshot giá vốn.
    await prisma.$transaction((tx) => upsertShopeeOrderTx(tx, channel, order, feeRate));
    const dbOrder = await prisma.order.findUniqueOrThrow({
      where: { channelId_orderCode: { channelId: channel.id, orderCode: spec.code } },
      select: { id: true, shippingStatus: true, items: { select: { productId: true, quantity: true } } },
    });

    // (b) Trừ kho + tạo InventoryLog (mirror deductStockTx) — KHÔNG làm với đơn HỦY.
    if (dbOrder.shippingStatus !== "CANCELLED") {
      for (const it of dbOrder.items) {
        if (!it.productId) continue;
        await prisma.product.update({ where: { id: it.productId }, data: { quantityInStock: { decrement: it.quantity } } });
        await prisma.inventoryLog.create({
          data: { productId: it.productId, changeQuantity: -it.quantity, type: InventoryLogType.SYNC, reason: `Trừ kho test — đơn ${spec.code}`, orderId: dbOrder.id },
        });
      }
      await prisma.order.update({ where: { id: dbOrder.id }, data: { stockDeductedAt: new Date() } });
    }

    // (c) Quyết toán / hoàn trả — set các field mà upsert không đụng.
    const patch: Record<string, unknown> = {};
    if (spec.settle) {
      const s = spec.settle;
      const fee = settledFee(s);
      Object.assign(patch, {
        isSettled: true,
        settledAt: new Date(createTime * 1000),
        fixedFee: s.fixedFee ?? 0, serviceFee: s.serviceFee ?? 0, paymentFee: s.paymentFee ?? 0,
        affiliateFee: s.affiliateFee ?? 0, sellerVoucher: s.sellerVoucher ?? 0, platformSubsidy: s.platformSubsidy ?? 0,
        shippingFeeQuoted: s.shippingFeeQuoted ?? 0, shippingFeeActual: s.shippingFeeActual ?? 0, shippingFeeDiff: s.shippingFeeDiff ?? 0,
        ...(s.shippingDisputeStatus ? { shippingDisputeStatus: s.shippingDisputeStatus } : {}),
        actualPayout: total - fee,
        paymentStatus: "PAID",
      });
    }
    if (spec.returnStatus) patch.returnStatus = spec.returnStatus;
    if (spec.paymentStatus) patch.paymentStatus = spec.paymentStatus;
    if (Object.keys(patch).length) {
      await prisma.order.update({ where: { id: dbOrder.id }, data: patch });
    }

    created.push({ code: spec.code, status: dbOrder.shippingStatus, total, settled: !!spec.settle, note: spec.note });
  }

  // ---------- BÁO CÁO ----------
  console.log("── ĐÃ TẠO ĐƠN ──");
  for (const c of created) {
    console.log(`  ✅ ${c.code.padEnd(24)} | ${c.status.padEnd(9)} | ${String(c.total).padStart(7)}đ | ${c.settled ? "đã QT" : "tạm tính"}${c.note ? " | " + c.note : ""}`);
  }

  // Đối chiếu nhanh với dữ liệu vừa ghi
  const grp = await prisma.order.groupBy({
    by: ["shippingStatus"],
    _count: { _all: true },
    where: { channelId: channel.id, orderCode: { startsWith: "TEST-BULK-" } },
  });
  const items = await prisma.orderItem.findMany({
    where: { order: { channelId: channel.id, orderCode: { startsWith: "TEST-BULK-" }, shippingStatus: "DELIVERED" } },
    select: { productName: true, quantity: true },
  });
  const qtyByProduct = new Map<string, number>();
  for (const it of items) qtyByProduct.set(it.productName, (qtyByProduct.get(it.productName) ?? 0) + it.quantity);

  console.log("\n── PHỄU TRẠNG THÁI (đơn TEST-BULK-*) ──");
  for (const g of grp) console.log(`  ${g.shippingStatus.padEnd(10)}: ${g._count._all}`);
  const returning = await prisma.order.count({ where: { channelId: channel.id, orderCode: { startsWith: "TEST-BULK-" }, returnStatus: { in: ["AWAITING", "DAMAGED"] } } });
  console.log(`  RETURNING : ${returning} (đếm theo returnStatus)`);

  console.log("\n── TOP SL BÁN (chỉ đơn DELIVERED — dùng cho biểu đồ Top SP) ──");
  for (const [name, qty] of [...qtyByProduct.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${name.padEnd(28)}: ${qty}`);
  }

  console.log(`\n🎉 XONG. Tổng ${created.length} đơn TEST-BULK-* đã tạo & GIỮ trong DB (không xoá).`);
  console.log("   Xem trên Hubsell: màn Đơn hàng (lọc mã TEST-BULK-), Tổng quan, Báo cáo dòng tiền, SKU P&L, Đối soát phí ship.");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
