// ============================================================
// NGHIỆM THU LUỒNG ĐƠN SHOPEE bằng payload chuẩn get_order_detail — KHÔNG cần
// Test Order live. Nạp đơn giả (đúng cấu trúc ShopeeOrderDetail) vào ĐÚNG hàm
// production `upsertShopeeOrderTx`, rồi đọc lại Order + OrderItem để kiểm:
//   1. Đơn 2 phân loại (XANH+TÍM) → 2 dòng RIÊNG, khoá SPE-{item}-{model} (không gộp).
//   2. Item map đúng ChannelProduct đã liên kết → snapshot giá vốn (nếu có).
//   3. Idempotent: chạy lại KHÔNG nhân đôi.
// Cuối cùng XOÁ đơn test để không bẩn DB.
//
// Chạy:  cd backend && npx tsx scripts/shopee-order-e2e.ts [shop_id] [--keep]
// ============================================================

import "dotenv/config";
import { ChannelName } from "@prisma/client";
import { prisma } from "../src/prisma";
import { PLATFORM_FEE_RATE } from "../src/mockMarketplace";
import { upsertShopeeOrderTx } from "../src/integrations/shopee/service";
import type { ShopeeOrderDetail } from "../src/integrations/shopee/client";

const ITEM_ID = 802716941; // Túi đeo chéo TC008
const M_XANH = 11873061;
const M_TIM = 11873062;
const ORDER_SN = "TEST-E2E-TC008-MULTI"; // cố định → chạy lại là idempotent

function ok(cond: boolean, label: string) {
  console.log(`${cond ? "✅" : "❌"} ${label}`);
  return cond;
}

(async () => {
  const wantShopId = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : undefined;
  const keep = process.argv.includes("--keep");

  const channel = await prisma.channel.findFirst({
    where: {
      channelName: "SHOPEE",
      status: "ACTIVE",
      ...(wantShopId ? { externalShopId: wantShopId } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  if (!channel) {
    console.log("❌ Không thấy gian Shopee trong DB.");
    await prisma.$disconnect();
    return;
  }
  console.log(`SHOP: ${channel.shopName} | shop_id=${channel.externalShopId}\n`);

  const feeRate =
    Number(channel.feeRate) > 0 ? Number(channel.feeRate) : PLATFORM_FEE_RATE[ChannelName.SHOPEE];

  // ---- Payload giả: 1 đơn, 2 phân loại khác nhau, đều để TRỐNG model_sku ----
  const order: ShopeeOrderDetail = {
    order_sn: ORDER_SN,
    order_status: "READY_TO_SHIP",
    create_time: Math.floor(Date.now() / 1000),
    total_amount: 270000, // 90k (XANH ×1) + 180k (TÍM ×2)
    buyer_username: "buyer_sandbox",
    recipient_address: { name: "Nguyễn Văn Test", phone: "0900000000" },
    item_list: [
      {
        item_id: ITEM_ID,
        item_name: "Túi đeo chéo TC008",
        item_sku: "TC008",
        model_id: M_XANH,
        model_name: "XANH",
        model_sku: "",
        model_quantity_purchased: 1,
        model_discounted_price: 90000,
      },
      {
        item_id: ITEM_ID,
        item_name: "Túi đeo chéo TC008",
        item_sku: "TC008",
        model_id: M_TIM,
        model_name: "TÍM",
        model_sku: "",
        model_quantity_purchased: 2,
        model_discounted_price: 90000,
      },
    ],
  };

  // Dọn lần chạy cũ để in số liệu "created" cho trực quan (idempotency test riêng bên dưới).
  const prev = await prisma.order.findUnique({
    where: { channelId_orderCode: { channelId: channel.id, orderCode: ORDER_SN } },
    select: { id: true },
  });
  if (prev) {
    await prisma.orderItem.deleteMany({ where: { orderId: prev.id } });
    await prisma.order.delete({ where: { id: prev.id } });
  }

  // ---- (1) Lần 1: tạo mới ----
  const r1 = await prisma.$transaction((tx) => upsertShopeeOrderTx(tx, channel, order, feeRate));
  console.log("Lần 1 (tạo mới):", r1);

  const created = await prisma.order.findUnique({
    where: { channelId_orderCode: { channelId: channel.id, orderCode: ORDER_SN } },
    include: { items: { orderBy: { channelSku: "asc" } } },
  });
  if (!created) {
    console.log("❌ Không thấy đơn sau khi tạo.");
    await prisma.$disconnect();
    return;
  }

  console.log("\n── ĐƠN ĐÃ TẠO ──");
  console.log(`  orderCode=${created.orderCode} | KH=${created.customerName} | tổng=${created.totalAmount} | phí sàn=${created.platformFee} | itemCount=${created.itemCount}`);
  console.log("  Dòng hàng:");
  for (const it of created.items) {
    console.log(
      `    • ${it.channelSku} | ${it.productName} | SL=${it.quantity} | giá=${it.price} | productId=${it.productId ?? "chưa liên kết"} | giá vốn snapshot=${it.costPriceAtSale}`
    );
  }

  // ---- KIỂM CHỨNG ----
  console.log("\n── KIỂM CHỨNG ──");
  const skus = created.items.map((i) => i.channelSku).sort();
  let pass = true;
  pass = ok(created.items.length === 2, "Đơn 2 phân loại → 2 dòng RIÊNG (không gộp)") && pass;
  pass = ok(skus.includes(`SPE-${ITEM_ID}-${M_XANH}`), `Có dòng XANH khoá SPE-${ITEM_ID}-${M_XANH}`) && pass;
  pass = ok(skus.includes(`SPE-${ITEM_ID}-${M_TIM}`), `Có dòng TÍM khoá SPE-${ITEM_ID}-${M_TIM}`) && pass;
  pass = ok(!skus.includes("TC008"), "KHÔNG có dòng gộp 'TC008'") && pass;
  const tim = created.items.find((i) => i.channelSku === `SPE-${ITEM_ID}-${M_TIM}`);
  pass = ok(tim?.quantity === 2, "SL phân loại TÍM = 2 (cộng dồn đúng)") && pass;

  const mapped = created.items.filter((i) => i.productId);
  console.log(
    mapped.length
      ? `ℹ️  ${mapped.length}/2 dòng đã liên kết SP nội bộ → có snapshot giá vốn.`
      : "ℹ️  2 dòng CHƯA liên kết SP nội bộ (productId=null, giá vốn=0) — đúng nhánh chưa map. Liên kết ở màn 'Liên kết SP' rồi đơn sau sẽ tự snapshot giá vốn."
  );

  // ---- (3) Idempotency: chạy lại ----
  const r2 = await prisma.$transaction((tx) => upsertShopeeOrderTx(tx, channel, order, feeRate));
  const after = await prisma.orderItem.count({ where: { orderId: created.id } });
  console.log("\nLần 2 (chạy lại):", r2);
  pass = ok(r2.created === false, "Chạy lại KHÔNG tạo đơn trùng (created=false)") && pass;
  pass = ok(after === 2, "Vẫn đúng 2 dòng hàng sau khi chạy lại (không nhân đôi)") && pass;

  // ---- Dọn ----
  if (!keep) {
    await prisma.orderItem.deleteMany({ where: { orderId: created.id } });
    await prisma.order.delete({ where: { id: created.id } });
    console.log("\n🧹 Đã xoá đơn test khỏi DB (dùng --keep nếu muốn giữ lại để xem trên UI).");
  } else {
    console.log("\n📌 Giữ lại đơn test trong DB (--keep). Xoá tay khi cần.");
  }

  console.log("\n" + (pass ? "🎉 TẤT CẢ KIỂM CHỨNG ĐỀU ĐẠT." : "⚠️  CÓ KIỂM CHỨNG KHÔNG ĐẠT — xem ở trên."));
  await prisma.$disconnect();
  process.exit(pass ? 0 : 1);
})();
