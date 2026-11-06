// ============================================================
// PROBE CHỈ ĐỌC: sàn có còn trả VẬN ĐƠN cho đơn ĐÃ GIAO THÀNH CÔNG không?
// (06/11/2026 — anh Trung: "nếu sàn cho thì gọi được mà, có cần lưu kho riêng không?";
//  memory hubsell-luu-phieu-van-don-60-ngay-2026-11-06)
//
//   npx tsx scripts/label-delivered-probe.ts "<shopName>" [SHOPEE|TIKTOK|LAZADA] [--gop]
//   vd: npx tsx scripts/label-delivered-probe.ts "ANO Official Store" SHOPEE
//       npx tsx scripts/label-delivered-probe.ts "ANO Official Store" SHOPEE --gop
//
// Làm gì (mặc định): với mỗi mốc tuổi 1 / 7 / 15 / 30 / 45 / 60 / 90 ngày kể từ lúc giao thành
// công, lấy MỘT đơn Đã giao của gian (đọc theo chỉ mục channelId + deliveredAt, không quét bảng)
// rồi gọi đúng hàm đang dùng để in phiếu (adapter.fetchLabels, từng đơn một). In ra: sàn trả tệp
// hay từ chối, lý do sàn nêu, cỡ tệp, số trang. Chạy cho cả ba sàn → biết sàn nào gọi lại được,
// tới bao nhiêu ngày; sàn nào từ chối thì mới cần lưu kho riêng.
//
// --gop (chỉ Shopee): lấy tối đa 5 đơn Đã xử lý / Đang giao gần nhất, tải MỘT tệp gộp rồi tải lại
// từng đơn, so số trang → kiểm giả định "tệp gộp = 1 trang / đơn, đúng thứ tự".
//
// KHÔNG ghi bảng nghiệp vụ, KHÔNG lưu tệp, KHÔNG in tên / SĐT / địa chỉ người mua (chỉ mã đơn).
// Lệnh gọi sàn đều là lệnh lấy phiếu: Shopee có bước yêu cầu sàn dựng tệp phiếu
// (create_shipping_document) — không đổi trạng thái đơn. Token hết hạn thì được làm mới như mọi
// probe khác. Chạy trên Render shell worker (token gian chỉ có ở DB prod).
// ============================================================

import "dotenv/config";
import { ChannelName, ShippingStatus } from "@prisma/client";
import { PDFDocument } from "pdf-lib";
import { prisma } from "../src/lib/prisma";
import { getFulfillmentAdapter, type FulfillOrderRef } from "../src/services/fulfillment";

/** Mốc tuổi (ngày kể từ deliveredAt) — 60 là hạn anh chốt, 90 là hạn Shopee cho giữ dữ liệu. */
const AGE_DAYS = [1, 7, 15, 30, 45, 60, 90];
/** Tìm đơn giao trong [mốc, mốc + ngần này ngày] — đủ rộng để gian nhỏ cũng có đơn. */
const AGE_WINDOW_DAYS = 7;
const DAY_MS = 24 * 3600_000;

const REF_SELECT = {
  id: true,
  orderCode: true,
  trackingCode: true,
  platformPackageId: true,
  deliveredAt: true,
  labelPrintedAt: true,
  shippingStatus: true,
} as const;

async function pageCount(pdf: Buffer): Promise<string> {
  try {
    const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
    return String(doc.getPageCount());
  } catch {
    return "? (không đọc được PDF)";
  }
}

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
const toRef = (o: FulfillOrderRef): FulfillOrderRef => ({
  id: o.id,
  orderCode: o.orderCode,
  trackingCode: o.trackingCode,
  platformPackageId: o.platformPackageId,
});

async function main() {
  const args = process.argv.slice(2);
  const combinedMode = args.includes("--gop");
  const [shopName, platformArg] = args.filter((a) => !a.startsWith("--"));
  if (!shopName) throw new Error('cách dùng: "<shopName>" [SHOPEE|TIKTOK|LAZADA] [--gop]');

  const channel = await prisma.channel.findFirst({
    where: {
      shopName,
      status: "ACTIVE",
      refreshToken: { not: null },
      ...(platformArg ? { channelName: platformArg.toUpperCase() as ChannelName } : {}),
    },
  });
  if (!channel) throw new Error(`không thấy gian đang hoạt động "${shopName}"`);
  const adapter = getFulfillmentAdapter(channel.channelName);
  if (!adapter) throw new Error(`sàn ${channel.channelName} không có adapter xử lý đơn`);
  console.log(`Gian "${channel.shopName}" (${channel.channelName}, ${channel.id})`);

  if (combinedMode) {
    if (channel.channelName !== ChannelName.SHOPEE) throw new Error("--gop chỉ dùng cho gian Shopee (chỉ Shopee trả tệp gộp)");
    const rows = await prisma.order.findMany({
      where: {
        channelId: channel.id,
        shippingStatus: { in: [ShippingStatus.PROCESSED, ShippingStatus.SHIPPING] },
        trackingCode: { not: null },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: REF_SELECT,
    });
    if (rows.length < 2) throw new Error(`gian chỉ có ${rows.length} đơn Đã xử lý / Đang giao có mã vận đơn — cần ít nhất 2 để sàn trả tệp gộp`);
    console.log(`\n[TỆP GỘP] xin ${rows.length} đơn: ${rows.map((r) => r.orderCode).join(", ")}`);
    const combined = await adapter.fetchLabels(channel, rows.map(toRef), { combined: true });
    for (const f of combined.failed) console.log(`  ✗ ${f.orderCode}: ${f.reason}`);
    for (const part of combined.combined ?? []) {
      console.log(`  tệp gộp ${part.orderIds.length} đơn → ${await pageCount(part.pdf)} trang, ${kb(part.pdf.length)}`);
    }
    if (combined.pdfs.size > 0) console.log(`  ${combined.pdfs.size} đơn sàn trả tệp riêng (không gộp được)`);

    console.log(`\n[TỪNG ĐƠN] cùng ${rows.length} đơn đó, tải riêng để so số trang:`);
    const single = await adapter.fetchLabels(channel, rows.map(toRef));
    let sum = 0;
    for (const r of rows) {
      const pdf = single.pdfs.get(r.id);
      if (!pdf) {
        console.log(`  ✗ ${r.orderCode}: ${single.failed.find((f) => f.orderId === r.id)?.reason ?? "không có tệp"}`);
        continue;
      }
      const pages = await pageCount(pdf);
      sum += Number(pages) || 0;
      console.log(`  ✓ ${r.orderCode}: ${pages} trang, ${kb(pdf.length)}`);
    }
    console.log(`\nTổng trang khi tải từng đơn: ${sum}. Tệp gộp có số trang = số đơn VÀ mọi đơn đều 1 trang thì giả định "1 trang / đơn" đúng với mẻ này.`);
    return;
  }

  const now = Date.now();
  let ok = 0;
  let refused = 0;
  let none = 0;
  for (const days of AGE_DAYS) {
    const order = await prisma.order.findFirst({
      where: {
        channelId: channel.id,
        shippingStatus: ShippingStatus.DELIVERED,
        deliveredAt: {
          lte: new Date(now - days * DAY_MS),
          gte: new Date(now - (days + AGE_WINDOW_DAYS) * DAY_MS),
        },
      },
      orderBy: { deliveredAt: "desc" },
      select: REF_SELECT,
    });
    if (!order || !order.deliveredAt) {
      none += 1;
      console.log(`\n[~${days} ngày] không có đơn Đã giao nào trong khoảng ${days}–${days + AGE_WINDOW_DAYS} ngày trước`);
      continue;
    }
    const age = ((now - order.deliveredAt.getTime()) / DAY_MS).toFixed(1);
    console.log(
      `\n[~${days} ngày] đơn ${order.orderCode} — giao ${age} ngày trước, ` +
        `${order.labelPrintedAt ? "đã in qua Hubsell" : "chưa in qua Hubsell"}, ` +
        `mã vận đơn: ${order.trackingCode ? "có" : "KHÔNG"}, mã kiện: ${order.platformPackageId ? "có" : "KHÔNG"}`
    );
    const t = Date.now();
    try {
      const r = await adapter.fetchLabels(channel, [toRef(order)]);
      const secs = ((Date.now() - t) / 1000).toFixed(1);
      const pdf = r.pdfs.get(order.id);
      if (pdf) {
        ok += 1;
        console.log(`  ✓ SÀN TRẢ TỆP: ${kb(pdf.length)}, ${await pageCount(pdf)} trang (${secs} giây)`);
      } else {
        refused += 1;
        console.log(`  ✗ SÀN KHÔNG TRẢ: ${r.failed[0]?.reason ?? "không có tệp, không nêu lý do"} (${secs} giây)`);
      }
    } catch (err) {
      refused += 1;
      console.log(`  ✗ LỖI CẢ LƯỢT: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(
    `\nKẾT QUẢ gian "${channel.shopName}" (${channel.channelName}): ${ok} mốc sàn trả tệp, ${refused} mốc sàn không trả, ${none} mốc không có đơn để thử.`
  );
}

main()
  .catch((err) => {
    console.error("LỖI:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
