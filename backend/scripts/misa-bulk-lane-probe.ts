// ============================================================
// BÀI THỬ SANDBOX meINVOICE — hóa đơn bước 5, lát 9 (docs/HANG-DOI-BEN.md mục 4.6 Q):
// một lô bấm tay đi TRỌN ĐƯỜNG MỚI với ADAPTER MISA THẬT và database dev:
//   nhận yêu cầu (acceptBulkIssue) → làn của shop (runInvoiceLaneOnce) → tiến độ lô.
// Chạy từ thư mục backend/:
//
//   npx tsx scripts/misa-bulk-lane-probe.ts
//
// CHỈ chạy với MST sandbox của MISA (tự dừng nếu .env trỏ MST khác). Mỗi lượt chạy
// lập 3 hóa đơn SANDBOX (ký hiệu 1K26TYY) và không xóa được. Shop + đơn thử dựng
// trong database dev được xóa khi xong.
//
//   B1  Nhận 3 đơn: trả lời ngay, chưa gọi MISA, có 3 dòng chờ + làn của shop.
//   B2  Một lượt của làn: 3 tờ phát hành lần lượt, số hóa đơn liền nhau, hai tờ cách
//       nhau ít nhất khoảng nghỉ MISA yêu cầu (publishGapMs).
//   B3  Tiến độ lô: 3/3, hết dòng chờ; có chuông tổng kết.
//   B4  Bấm lại đúng 3 đơn đó: không nhận (đã có hóa đơn), không gọi MISA.
// ============================================================
import "dotenv/config";

import { InvoiceLogStatus, ShippingStatus } from "@prisma/client";

import { createStockFixture } from "../src/integrations/__tests__/fixtures";
import { encryptInvoiceSecret } from "../src/integrations/invoice/config-secrets";
import { MISA_CAPABILITIES } from "../src/integrations/invoice/misa-provider";
import { prisma } from "../src/lib/prisma";
import { acceptBulkIssue, getBatchProgress } from "../src/services/invoice-requests";
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
  const fx = await createStockFixture("bulkprobe");
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
    const codes: string[] = [];
    for (let i = 0; i < 3; i++) {
      const id = await fx.createOrder(productId, 1);
      const o = await prisma.order.update({
        where: { id },
        data: { shippingStatus: ShippingStatus.DELIVERED, deliveredAt: new Date() },
        select: { orderCode: true },
      });
      codes.push(o.orderCode);
    }

    console.log(`\n=== B1 nhận 3 đơn (${codes.join(", ")}) ===`);
    const t0 = Date.now();
    const accepted = await acceptBulkIssue({ ownerId: fx.userId, channelWhere: { userId: fx.userId }, orderCodes: codes });
    console.log(`  trả lời sau ${Date.now() - t0} ms: ${JSON.stringify(accepted)}`);
    check("nhận đủ 3, không bỏ đơn nào", accepted.queued === 3 && accepted.skipped.length === 0 && !!accepted.batchId);
    check("chưa có dòng nhật ký hóa đơn nào (chưa gọi MISA)", (await prisma.invoiceLog.count({ where: { ownerId: fx.userId } })) === 0);
    check("có làn của shop", (await prisma.invoiceLane.findUnique({ where: { ownerId: fx.userId } })) !== null);

    console.log("\n=== B2 một lượt của làn với MISA thật ===");
    const t1 = Date.now();
    const outcome = await runInvoiceLaneOnce(fx.userId, { forRequests: true });
    const tookMs = Date.now() - t1;
    const logs = await prisma.invoiceLog.findMany({
      where: { ownerId: fx.userId },
      orderBy: { createdAt: "asc" },
      select: { orderCode: true, status: true, invoiceNo: true, transactionId: true, errorMessage: true, issuedAt: true },
    });
    for (const l of logs) console.log(`  ${l.orderCode}: ${l.status} số ${l.invoiceNo ?? "-"} ${l.errorMessage ?? ""}`);
    console.log(`  kết cục lượt: ${outcome}, ${tookMs} ms`);
    check("kết cục DONE", outcome === "DONE");
    check("3 tờ đều đã phát hành, có số + mã tra cứu", logs.length === 3 && logs.every((l) => l.status === InvoiceLogStatus.ISSUED && l.invoiceNo && l.transactionId));
    check("phát hành đúng thứ tự bấm", logs.map((l) => l.orderCode).join() === codes.join());
    const nos = logs.map((l) => Number(l.invoiceNo));
    check("số hóa đơn liền nhau", nos.every((n, i) => i === 0 || n === nos[i - 1] + 1));
    const gap = MISA_CAPABILITIES.publishGapMs;
    const gaps = logs.slice(1).map((l, i) => (l.issuedAt?.getTime() ?? 0) - (logs[i].issuedAt?.getTime() ?? 0));
    console.log(`  khoảng cách giữa hai tờ: ${gaps.join(" ms, ")} ms (MISA yêu cầu ≥ ${gap} ms)`);
    check("hai tờ liền nhau cách ít nhất khoảng nghỉ của MISA", gaps.every((g) => g >= gap));

    console.log("\n=== B3 tiến độ lô ===");
    const p = await getBatchProgress(fx.userId, accepted.batchId!);
    console.log(`  ${JSON.stringify(p)}`);
    check("3/3, hết dòng chờ", !!p && p.total === 3 && p.issued === 3 && p.pending === 0 && !p.active && p.failed === 0);
    const bell = await prisma.notification.findFirst({ where: { ownerId: fx.userId, type: "INVOICE_BULK_DONE" } });
    check("có chuông tổng kết", bell?.title === "Đã xuất 3/3 hóa đơn");
    const lane = await prisma.invoiceLane.findUniqueOrThrow({ where: { ownerId: fx.userId } });
    check("làn đã trả", lane.leasedBy === null);

    console.log("\n=== B4 bấm lại đúng 3 đơn ===");
    const again = await acceptBulkIssue({ ownerId: fx.userId, channelWhere: { userId: fx.userId }, orderCodes: codes });
    console.log(`  ${JSON.stringify(again)}`);
    check("không nhận, lý do đã có hóa đơn", again.batchId === null && again.skipped.length === 3 && again.skipped.every((s) => s.reason.includes("đã có hóa đơn số")));
  } finally {
    await prisma.invoiceRequest.deleteMany({ where: { ownerId: fx.userId } });
    await prisma.notification.deleteMany({ where: { ownerId: fx.userId } });
    await prisma.invoiceStatusHistory.deleteMany({ where: { invoiceLog: { ownerId: fx.userId } } });
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
