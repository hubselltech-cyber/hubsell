// ============================================================
// BÀI THỬ SANDBOX meINVOICE — hóa đơn bước 5, lát 11 (docs/HANG-DOI-BEN.md mục 4.6 S):
// điều chỉnh TỰ ĐỘNG khi sàn chốt hoàn đi trọn đường yêu cầu bền với ADAPTER MISA THẬT
// và database dev. Chạy từ thư mục backend/:
//
//   npx tsx scripts/misa-auto-adjust-lane-probe.ts
//
// CHỈ chạy với MST sandbox của MISA (tự dừng nếu .env trỏ MST khác). Mỗi lượt chạy
// lập 2 tờ SANDBOX (1 hóa đơn bán + 1 hóa đơn điều chỉnh giảm MỘT PHẦN, ký hiệu
// 1K26TYY), không xóa được. Shop + đơn thử dựng trong database dev được xóa khi xong.
//
//   T1  Sàn chốt hoàn nhưng CHƯA báo số tiền: yêu cầu được ghi, làn chạy tới thì hẹn
//       lại 60 phút, KHÔNG gọi MISA lập gì.
//   T2  Sàn báo hoàn một nửa tiền: lượt sau lập hóa đơn điều chỉnh giảm đúng phần đó,
//       mã tham chiếu <mã đơn>-DC1.
//   T3  Lượt đồng bộ sau thấy lại (gọi "before" lần nữa): không ghi yêu cầu mới, không lập thêm.
// ============================================================
import "dotenv/config";

process.env.INVOICE_AUTO_ADJUST_MODE = "queue";

import { InvoiceLogStatus, ShippingStatus } from "@prisma/client";

import { createStockFixture } from "../src/integrations/__tests__/fixtures";
import { PLATFORM_RETURN_DONE_STATUSES } from "../src/integrations/invoice/adjust-order";
import { encryptInvoiceSecret } from "../src/integrations/invoice/config-secrets";
import { issueInvoiceForOrder } from "../src/integrations/invoice/issue-order";
import { prisma } from "../src/lib/prisma";
import { AUTO_ADJUST_RETRY_MS, autoAdjustOnPlatformReturn } from "../src/services/invoice-requests";
import { MISA_SANDBOX_TAX_CODE } from "../src/services/tax-pilot";
import { runInvoiceLaneOnce } from "../src/workers/invoice-lanes";

let failures = 0;
function check(label: string, ok: boolean): void {
  console.log(`  ${ok ? "ĐẠT " : "HỎNG"} ${label}`);
  if (!ok) failures += 1;
}

(async () => {
  if (process.env.MISA_TAX_CODE !== MISA_SANDBOX_TAX_CODE) {
    throw new Error("DỪNG: MISA_TAX_CODE trong .env không phải MST sandbox của MISA — bài thử này chỉ chạy trên sandbox.");
  }
  const fx = await createStockFixture("autoadjprobe");
  try {
    await prisma.invoiceConfig.create({
      data: {
        ownerId: fx.userId,
        provider: "MISA",
        taxCode: process.env.MISA_TAX_CODE,
        companyName: "CÔNG TY CỔ PHẦN MISA",
        companyAddress: "Tòa nhà Technosoft, Duy Tân, Cầu Giấy, Hà Nội",
        invoicePattern: "1",
        invoiceSeries: "1K26TYY",
        defaultVatRate: 10,
        defaultUnitName: "Cái",
        signMethod: "ESIGN_CLOUD",
        autoAdjustEnabled: true,
        meinvoiceUsername: process.env.MISA_USERNAME ?? null,
        meinvoicePassword: encryptInvoiceSecret(fx.userId, "meinvoicePassword", process.env.MISA_PASSWORD),
      },
    });
    const productId = await fx.createProduct(10);
    const orderId = await fx.createOrder(productId, 2);
    const { orderCode } = await prisma.order.update({
      where: { id: orderId },
      data: { shippingStatus: ShippingStatus.DELIVERED, deliveredAt: new Date() },
      select: { orderCode: true },
    });
    const issued = await issueInvoiceForOrder(fx.userId, { userId: fx.userId }, orderCode);
    if (!issued.ok || !issued.log) throw new Error(`không lập được hóa đơn gốc: ${issued.error}`);
    const original = issued.log;
    console.log(`Hóa đơn gốc ${original.invoiceNo} cho đơn ${orderCode}, tổng ${original.totalAmount}`);
    await new Promise((r) => setTimeout(r, 1500)); // khoảng nghỉ MISA yêu cầu giữa hai lệnh phát hành

    const doneStatus = [...PLATFORM_RETURN_DONE_STATUSES][0];
    const lane = () => runInvoiceLaneOnce(fx.userId, { forRequests: true });
    const row = () => prisma.invoiceRequest.findFirstOrThrow({ where: { ownerId: fx.userId, source: "AUTO_RETURN" } });
    const adjustments = () => prisma.invoiceLog.findMany({ where: { adjustmentForLogId: original.id } });

    console.log("\n=== T1 sàn chốt hoàn, chưa báo số tiền ===");
    await autoAdjustOnPlatformReturn(fx.userId, orderId, "before");
    await prisma.order.update({ where: { id: orderId }, data: { platformReturnStatus: doneStatus, platformRefundAmount: 0 } });
    await autoAdjustOnPlatformReturn(fx.userId, orderId, "after");
    await lane();
    let r = await row();
    console.log(`  ${JSON.stringify({ status: r.status, attempts: r.attempts, error: r.error })}`);
    check("yêu cầu còn chờ, hẹn lại khoảng 60 phút", r.status === "PENDING" && Math.abs(r.nextRetryAt.getTime() - (Date.now() + AUTO_ADJUST_RETRY_MS)) < 10_000);
    check("chưa lập tờ điều chỉnh nào", (await adjustments()).length === 0);

    console.log("\n=== T2 sàn báo hoàn một nửa tiền ===");
    const half = Math.round(original.totalAmount / 2);
    await prisma.order.update({ where: { id: orderId }, data: { platformRefundAmount: half } });
    await prisma.invoiceRequest.update({ where: { id: r.id }, data: { nextRetryAt: new Date(Date.now() - 1000) } });
    const t = Date.now();
    await lane();
    r = await row();
    const adj = await adjustments();
    console.log(`  ${Date.now() - t} ms: ${JSON.stringify({ status: r.status, adj: adj.map((a) => ({ status: a.status, invoiceNo: a.invoiceNo, total: Number(a.totalAmount), ref: a.providerRef })) })}`);
    check("yêu cầu xong", r.status === "DONE");
    check("một tờ điều chỉnh đã phát hành, có số", adj.length === 1 && adj[0].status === InvoiceLogStatus.ISSUED && !!adj[0].invoiceNo);
    check("giảm đúng phần sàn hoàn, không giảm toàn bộ", adj.length === 1 && Math.abs(Number(adj[0].totalAmount)) === half);
    check("mã tham chiếu <mã đơn>-DC1", adj[0]?.providerRef === `${orderCode}-DC1`);

    console.log("\n=== T3 lượt đồng bộ sau thấy lại ===");
    await autoAdjustOnPlatformReturn(fx.userId, orderId, "before");
    await autoAdjustOnPlatformReturn(fx.userId, orderId, "after");
    await lane();
    check("không ghi yêu cầu mới", (await prisma.invoiceRequest.count({ where: { ownerId: fx.userId } })) === 1);
    check("vẫn một tờ điều chỉnh", (await adjustments()).length === 1);
    check("không có chuông báo hỏng", (await prisma.notification.count({ where: { ownerId: fx.userId, type: "INVOICE_AUTO_ADJUST_FAILED" } })) === 0);
  } finally {
    await prisma.invoiceRequest.deleteMany({ where: { ownerId: fx.userId } });
    await prisma.notification.deleteMany({ where: { ownerId: fx.userId } });
    await prisma.invoiceStatusHistory.deleteMany({ where: { invoiceLog: { ownerId: fx.userId } } });
    await prisma.invoiceLog.deleteMany({ where: { ownerId: fx.userId, adjustmentForLogId: { not: null } } });
    await prisma.invoiceLog.deleteMany({ where: { ownerId: fx.userId } });
    await fx.cleanup();
    await prisma.$disconnect();
  }
  console.log(failures === 0 ? "\nKẾT QUẢ: ĐẠT HẾT" : `\nKẾT QUẢ: ${failures} điểm HỎNG`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
