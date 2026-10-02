// ============================================================
// BÀI THỬ SANDBOX meINVOICE — hóa đơn bước 5, lát 6b (docs/HANG-DOI-BEN.md mục 4.6):
// phần lõi "tra lại tờ chưa rõ kết quả" (integrations/invoice/unknown-outcome.ts)
// chạy với ADAPTER MISA THẬT và database dev. Chạy từ thư mục backend/:
//
//   npx tsx scripts/misa-unknown-recheck-probe.ts
//
// CHỈ chạy với MST sandbox của MISA (tự dừng nếu .env trỏ MST khác). Mỗi lượt chạy
// lập 1 hóa đơn SANDBOX (ký hiệu 1K26TYY) và không xóa được. Dữ liệu dựng trong
// database dev (một shop + một đơn thử) được xóa khi xong.
//
//   R1  Lệnh phát hành tới MISA rồi bị Hubsell cắt vì quá thời hạn chờ (150 ms). Dòng
//       nhật ký đang chờ, chưa có mã tra cứu → tra lại phải NỐI đúng số tờ MISA đã lập.
//   R2  Dòng đang chờ mang mã tham chiếu CHƯA TỪNG gửi → tra lại phải ra "không có tờ
//       nào" và trả dòng về hỏng.
// ============================================================
import "dotenv/config";

import { InvoiceLogStatus } from "@prisma/client";

import { createStockFixture } from "../src/integrations/__tests__/fixtures";
import { buildInvoiceLines } from "../src/integrations/invoice/issue-order";
import { MisaInvoiceProvider, type MisaProviderConfig } from "../src/integrations/invoice/misa-provider";
import type { CreateInvoiceInput } from "../src/integrations/invoice/types";
import { keptPendingMessage, recheckUnknownLog, type UnknownLog } from "../src/integrations/invoice/unknown-outcome";
import { prisma } from "../src/lib/prisma";
import { MISA_SANDBOX_TAX_CODE } from "../src/services/tax-pilot";

const cfg: MisaProviderConfig = {
  taxCode: process.env.MISA_TAX_CODE ?? null,
  companyName: "CÔNG TY CỔ PHẦN MISA",
  companyAddress: "Tòa nhà Technosoft, Duy Tân, Cầu Giấy, Hà Nội",
  clientId: process.env.MISA_CLIENT_ID ?? null,
  secretKey: process.env.MISA_CLIENT_SECRET ?? null,
  meinvoiceUsername: process.env.MISA_USERNAME ?? null,
  meinvoicePassword: process.env.MISA_PASSWORD ?? null,
  invoicePattern: "1",
  invoiceSeries: "1K26TYY",
  defaultUnitName: "Cái",
  signMethod: "ESIGN_CLOUD",
  esignClientId: null,
  esignSecretKey: null,
  esignUsername: null,
  esignPassword: null,
  certSerial: null,
  defaultInvoiceType: "STANDARD",
};

function saleInput(refId: string): CreateInvoiceInput {
  const lines = buildInvoiceLines(
    [{ name: "Sản phẩm thử tra lại tờ chưa rõ (Hubsell)", sku: "HUBSELL-PROBE", quantity: 1, price: 11000, vatRate: null }],
    10,
    0,
    { defaultUnitName: "Cái", salesInvoice: false }
  );
  return { orderCode: refId, buyerName: "Bán cho người tiêu dùng", lines, totalAmount: 11000 };
}

let failures = 0;
function check(label: string, ok: boolean): void {
  console.log(`  ${ok ? "ĐẠT " : "HỎNG"} ${label}`);
  if (!ok) failures += 1;
}

(async () => {
  if (cfg.taxCode !== MISA_SANDBOX_TAX_CODE) {
    throw new Error("DỪNG: MISA_TAX_CODE trong .env không phải MST sandbox của MISA — bài thử này chỉ chạy trên sandbox.");
  }
  const provider = new MisaInvoiceProvider(cfg);
  const ref = `HUBSELL-UNK-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(2, 14)}-R1`;
  const fx = await createStockFixture("unkprobe");
  try {
    const productId = await fx.createProduct(10);
    const orderId = await fx.createOrder(productId, 1);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });

    // Dòng "đang chờ, chưa có mã tra cứu", tuổi 10 phút — đúng hình dạng dòng mà issue-order để lại.
    const pendingRow = (providerRef: string) =>
      prisma.invoiceLog.create({
        data: {
          ownerId: fx.userId,
          orderId,
          orderCode: order.orderCode,
          provider: "MISA",
          providerRef,
          status: InvoiceLogStatus.PENDING,
          errorMessage: keptPendingMessage("MISA"),
          createdAt: new Date(Date.now() - 10 * 60_000),
        },
      });
    const asUnknown = (row: Awaited<ReturnType<typeof pendingRow>>): UnknownLog => ({
      id: row.id,
      ownerId: row.ownerId,
      orderId: row.orderId,
      orderCode: row.orderCode,
      provider: row.provider,
      providerRef: row.providerRef,
      adjustmentForLogId: row.adjustmentForLogId,
      createdAt: row.createdAt,
    });

    console.log(`\n=== R2 mã tham chiếu chưa từng gửi (${ref}-CHUA-GUI) ===`);
    const never = await pendingRow(`${ref}-CHUA-GUI`);
    const r2 = await recheckUnknownLog(asUnknown(never), provider, new Date());
    console.log(`  kết quả tra lại: ${JSON.stringify(r2)}`);
    const neverAfter = await prisma.invoiceLog.findUniqueOrThrow({ where: { id: never.id } });
    check("không có tờ nào → dòng chuyển HỎNG, lời nhắn nói đơn quay lại hàng chờ", r2.kind === "NOT_ISSUED" && neverAfter.status === "FAILED" && (neverAfter.errorMessage ?? "").includes("Hàng chờ xuất hóa đơn"));
    check("trạng thái hóa đơn của đơn = hỏng", (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).einvoiceStatus === "FAILED");

    console.log(`\n=== R1 lệnh phát hành bị cắt vì quá thời hạn chờ 150 ms — mã tham chiếu ${ref} ===`);
    process.env.INVOICE_HTTP_TIMEOUT_MS = "150"; // token đã có sẵn từ lượt tra của R2
    const first = await provider.createInvoice(saleInput(ref)).finally(() => {
      delete process.env.INVOICE_HTTP_TIMEOUT_MS;
    });
    check("adapter báo chưa rõ kết quả", first.status === "FAILED" && first.outcomeUnknown === true);
    const lost = await pendingRow(ref);
    await new Promise((r) => setTimeout(r, 3000));

    const r1 = await recheckUnknownLog(asUnknown(lost), provider, new Date());
    console.log(`  kết quả tra lại: ${JSON.stringify(r1)}`);
    const lostAfter = await prisma.invoiceLog.findUniqueOrThrow({ where: { id: lost.id } });
    const atMisa = await provider.findByReference(ref);
    console.log(`  dòng nhật ký sau tra lại: ${JSON.stringify({ status: lostAfter.status, invoiceNo: lostAfter.invoiceNo, transactionId: lostAfter.transactionId, errorMessage: lostAfter.errorMessage })}`);
    check(
      "tờ MISA đã lập được NỐI vào dòng: đã phát hành, đúng số + mã tra cứu của MISA, hết lời nhắn",
      r1.kind === "LINKED" &&
        lostAfter.status === "ISSUED" &&
        atMisa.state === "FOUND" &&
        lostAfter.invoiceNo === atMisa.invoiceNo &&
        lostAfter.transactionId === atMisa.transactionId &&
        lostAfter.errorMessage === null
    );
    check("ngày phát hành = lúc gửi lượt đó", lostAfter.issuedAt?.getTime() === lostAfter.createdAt.getTime());
    check("trạng thái hóa đơn của đơn = đã phát hành", (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).einvoiceStatus === "ISSUED");
    check("MISA chỉ có MỘT tờ cho mã này", atMisa.state === "FOUND" && atMisa.matches === 1);

    const again = await recheckUnknownLog(asUnknown(lost), provider, new Date());
    check("tra lại lần nữa trên dòng đã có kết luận → bỏ qua, không ghi gì", again.kind === "SKIPPED");
  } finally {
    await fx.cleanup();
    await prisma.$disconnect();
  }
  console.log(failures === 0 ? "\nTẤT CẢ ĐẠT" : `\nCÓ ${failures} ĐIỂM HỎNG`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error("Bài thử dừng vì lỗi:", err);
  process.exit(1);
});
