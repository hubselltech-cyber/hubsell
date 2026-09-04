/**
 * PROBE XỬ LÝ ĐƠN TẬP TRUNG — chạy tay trên gian THẬT để kiểm chứng API sàn
 * trước khi tin giao diện. Không có bước nào tự ship_order.
 *
 *   npx tsx scripts/probe-fulfillment.ts options <orderCode>
 *       → get_shipping_parameter (READ-ONLY): địa chỉ lấy hàng, khung giờ, info_needed
 *   npx tsx scripts/probe-fulfillment.ts labels <orderCode> [...]
 *       → tải vận đơn PDF chính chủ cho đơn ĐÃ sắp xếp (create/get_result/download)
 *         + ghép phiếu nhặt hàng, ghi ra scripts/out/phieu-<code>.pdf
 *   npx tsx scripts/probe-fulfillment.ts arrange <orderCode> PICKUP|DROPOFF
 *       → ⚠ GHI THẬT: ship_order cho đúng MỘT đơn (dùng khi anh Trung tự tay test)
 */
import fs from "fs";
import path from "path";
import { prisma } from "../src/lib/prisma";
import { getFulfillmentAdapter, buildPickListPdf, mergePdfParts } from "../src/services/fulfillment";
import { CARRIER_LABEL, isExpressShipping } from "../src/services/shipping";

async function main() {
  const [mode, ...codes] = process.argv.slice(2);
  if (!mode || codes.length === 0) {
    console.log("Cách dùng: options <orderCode> | labels <orderCode...> | arrange <orderCode> PICKUP|DROPOFF");
    process.exit(1);
  }
  const orderCode = codes[0];
  const order = await prisma.order.findFirst({
    where: { orderCode },
    include: { channel: true, items: true },
  });
  if (!order) throw new Error(`Không thấy đơn ${orderCode} trong DB`);
  const adapter = getFulfillmentAdapter(order.channel.channelName);
  if (!adapter) throw new Error("Kênh không có adapter");
  console.log(`Gian: ${order.channel.shopName} (${order.channel.channelName}) · trạng thái ${order.shippingStatus}`);
  const ref = {
    id: order.id,
    orderCode: order.orderCode,
    trackingCode: order.trackingCode,
    platformPackageId: order.platformPackageId,
  };

  if (mode === "options") {
    const opts = await adapter.getShippingOptions(order.channel, ref);
    console.log(JSON.stringify(opts, null, 2));
    return;
  }

  if (mode === "arrange") {
    const method = codes[1] === "DROPOFF" ? "DROPOFF" : "PICKUP";
    console.log(`⚠ ship_order THẬT cho ${orderCode} (${method}) sau 3 giây… Ctrl+C để hủy`);
    await new Promise((r) => setTimeout(r, 3000));
    const r = await adapter.arrangeShipment(order.channel, ref, { method });
    console.log(JSON.stringify(r, null, 2));
    if (r.ok) {
      await prisma.order.update({
        where: { id: order.id },
        data: {
          shippingStatus: "PROCESSED",
          packedAt: new Date(),
          ...(r.trackingCode ? { trackingCode: r.trackingCode } : {}),
          ...(r.packageId ? { platformPackageId: r.packageId } : {}),
        },
      });
      console.log("→ DB đã ghi PROCESSED");
    }
    return;
  }

  if (mode === "labels") {
    const orders = await prisma.order.findMany({
      where: { orderCode: { in: codes }, channelId: order.channelId },
      include: { channel: true, items: true },
    });
    const refs = orders.map((o) => ({
      id: o.id,
      orderCode: o.orderCode,
      trackingCode: o.trackingCode,
      platformPackageId: o.platformPackageId,
    }));
    const t0 = Date.now();
    const r = await adapter.fetchLabels(order.channel, refs);
    console.log(`fetchLabels: ${r.pdfs.size} PDF, ${r.failed.length} lỗi, ${Date.now() - t0}ms`);
    for (const f of r.failed) console.log("  ✗", f.orderCode, f.reason);
    for (const [id, d] of r.discovered) console.log("  ↳ khám phá", id, d);
    const parts = [];
    for (const o of orders) {
      const pdf = r.pdfs.get(o.id);
      if (pdf) console.log(`  ✓ ${o.orderCode}: ${pdf.length} bytes`);
      parts.push({
        label: pdf ?? null,
        pickList: await buildPickListPdf({
          orderCode: o.orderCode,
          channelLabel: o.channel.channelName,
          shopName: o.channel.shopName,
          trackingCode: o.trackingCode,
          carrierLabel: o.carrier ? CARRIER_LABEL[o.carrier] : o.shippingCarrierName || "Chưa gán",
          isExpress: isExpressShipping(o.shippingCarrierName),
          createdAt: o.createdAt,
          items: o.items.map((i) => ({ sku: i.channelSku, name: i.productName, quantity: i.quantity })),
        }),
      });
    }
    const merged = await mergePdfParts(parts);
    const outDir = path.join(__dirname, "out");
    fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, `phieu-${codes[0]}.pdf`);
    fs.writeFileSync(file, merged.pdf);
    console.log(`→ ${file} (${merged.pages} trang, ${merged.broken} phần hỏng)`);
    return;
  }
  throw new Error(`mode lạ: ${mode}`);
}

main()
  .catch((err) => {
    console.error("LỖI:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
