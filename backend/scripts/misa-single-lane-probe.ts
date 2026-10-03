// ============================================================
// BÀI THỬ SANDBOX meINVOICE — hóa đơn bước 5, lát 10 (docs/HANG-DOI-BEN.md mục 4.6 R):
// xuất MỘT đơn rồi ĐIỀU CHỈNH TAY, cả hai đi qua làn của shop với ADAPTER MISA THẬT
// và database dev: ghi yêu cầu (submitSingleRequest) → làn (runInvoiceLaneOnce) →
// nơi chờ nhận kết quả (awaitRequest). Chạy từ thư mục backend/:
//
//   npx tsx scripts/misa-single-lane-probe.ts
//
// CHỈ chạy với MST sandbox của MISA (tự dừng nếu .env trỏ MST khác). Mỗi lượt chạy
// lập 2 tờ SANDBOX (1 hóa đơn bán + 1 hóa đơn điều chỉnh, ký hiệu 1K26TYY), không
// xóa được. Shop + đơn thử dựng trong database dev được xóa khi xong.
//
//   S1  Xuất một đơn: nơi chờ nhận 201 + dòng nhật ký có số và mã tra cứu.
//   S2  Điều chỉnh giảm toàn bộ tờ vừa lập: nơi chờ nhận 201, dòng điều chỉnh trỏ đúng
//       hóa đơn gốc, mã tham chiếu <mã đơn>-DC1.
//   S3  Điều chỉnh lần nữa: bị từ chối (đã có điều chỉnh), không lập thêm tờ nào.
// ============================================================
import "dotenv/config";

import { InvoiceLogStatus, ShippingStatus } from "@prisma/client";

import { createStockFixture } from "../src/integrations/__tests__/fixtures";
import { encryptInvoiceSecret } from "../src/integrations/invoice/config-secrets";
import { prisma } from "../src/lib/prisma";
import { awaitRequest, REQUEST_KIND_ADJUST, REQUEST_KIND_ISSUE, submitSingleRequest } from "../src/services/invoice-requests";
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
  const fx = await createStockFixture("singleprobe");
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
        meinvoiceUsername: process.env.MISA_USERNAME ?? null,
        meinvoicePassword: encryptInvoiceSecret(fx.userId, "meinvoicePassword", process.env.MISA_PASSWORD),
      },
    });
    const productId = await fx.createProduct(10);
    const orderId = await fx.createOrder(productId, 1);
    const { orderCode } = await prisma.order.update({
      where: { id: orderId },
      data: { shippingStatus: ShippingStatus.DELIVERED, deliveredAt: new Date() },
      select: { orderCode: true },
    });
    const lane = () => runInvoiceLaneOnce(fx.userId, { forRequests: true });

    console.log(`\n=== S1 xuất một đơn (${orderCode}) ===`);
    let t = Date.now();
    const s1 = await submitSingleRequest({ ownerId: fx.userId, kind: REQUEST_KIND_ISSUE, targetKey: orderCode });
    const w1 = awaitRequest(fx.userId, s1!.id, 30_000);
    await lane();
    const d1 = await w1;
    const original = d1?.resultLogId ? await prisma.invoiceLog.findUnique({ where: { id: d1.resultLogId } }) : null;
    console.log(`  ${Date.now() - t} ms: ${JSON.stringify({ status: d1?.status, result: d1?.result, invoiceNo: original?.invoiceNo })}`);
    check("nơi chờ nhận 201", d1?.status === "DONE" && d1.result?.httpStatus === 201);
    check("dòng nhật ký đã phát hành, có số + mã tra cứu", original?.status === InvoiceLogStatus.ISSUED && !!original.invoiceNo && !!original.transactionId);
    if (!original) throw new Error("không có hóa đơn gốc để thử điều chỉnh");

    console.log(`\n=== S2 điều chỉnh giảm toàn bộ tờ ${original.invoiceNo} ===`);
    t = Date.now();
    const s2 = await submitSingleRequest({
      ownerId: fx.userId,
      kind: REQUEST_KIND_ADJUST,
      targetKey: original.id,
      params: { reason: "Khách trả hàng hoàn tiền (thử lát 10)", scope: { kind: "FULL" } },
    });
    const w2 = awaitRequest(fx.userId, s2!.id, 30_000);
    await lane();
    const d2 = await w2;
    const adj = d2?.resultLogId ? await prisma.invoiceLog.findUnique({ where: { id: d2.resultLogId } }) : null;
    console.log(`  ${Date.now() - t} ms: ${JSON.stringify({ status: d2?.status, result: d2?.result, invoiceNo: adj?.invoiceNo, ref: adj?.providerRef })}`);
    check("nơi chờ nhận 201", d2?.status === "DONE" && d2.result?.httpStatus === 201);
    check("dòng điều chỉnh đã phát hành, trỏ đúng hóa đơn gốc", adj?.status === InvoiceLogStatus.ISSUED && adj.adjustmentForLogId === original.id && !!adj.invoiceNo);
    check("mã tham chiếu <mã đơn>-DC1", adj?.providerRef === `${orderCode}-DC1`);

    console.log("\n=== S3 điều chỉnh lần nữa ===");
    const s3 = await submitSingleRequest({
      ownerId: fx.userId,
      kind: REQUEST_KIND_ADJUST,
      targetKey: original.id,
      params: { reason: "Bấm lần hai", scope: { kind: "FULL" } },
    });
    const w3 = awaitRequest(fx.userId, s3!.id, 30_000);
    await lane();
    const d3 = await w3;
    console.log(`  ${JSON.stringify({ status: d3?.status, result: d3?.result })}`);
    check("bị từ chối, không phải 201", d3?.status === "FAILED" && d3.result?.httpStatus !== 201);
    check("vẫn chỉ MỘT tờ điều chỉnh", (await prisma.invoiceLog.count({ where: { adjustmentForLogId: original.id, status: InvoiceLogStatus.ISSUED } })) === 1);
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
