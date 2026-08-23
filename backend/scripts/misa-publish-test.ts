// ============================================================
// TEST PHÁT HÀNH HÓA ĐƠN SANDBOX meINVOICE.
//
// Chạy:  npx tsx scripts/misa-publish-test.ts <hậu-tố-RefID>
//        (hậu tố phải MỚI mỗi lần — RefID là khóa chống trùng phía MISA)
//
// Yêu cầu .env: bộ sandbox MISA (MST 0101243150-732) + MISA_ALLOW_PUBLISH=1.
// ĐÃ PHÁT HÀNH THÀNH CÔNG 23/08/2026: RefID HUBSELL-TEST-003 → HĐ số 00000050
// ký hiệu 1K26TYY, ký bởi chứng thư TEST-SANDBOX-MEINVOICE-02, tra được tại
// meinvoice.vn/tra-cuu với mã _PFVIPVV413Q.
// ============================================================
import "dotenv/config";
import { publishStandardInvoice } from "../src/integrations/invoice/misa-einvoice";
import type { CreateInvoiceInput } from "../src/integrations/invoice/types";

const cfg = {
  taxCode: process.env.MISA_TAX_CODE ?? null,
  companyName: "CÔNG TY CỔ PHẦN MISA",
  companyAddress: "Tòa nhà Technosoft, Duy Tân, Cầu Giấy, Hà Nội",
  clientId: process.env.MISA_CLIENT_ID ?? null,
  secretKey: process.env.MISA_CLIENT_SECRET ?? null,
  invoicePattern: "1",
  invoiceSeries: "1K26TYY",
  signMethod: "ESIGN_CLOUD", // SignType 2 — HSM, meInvoice ký nền (SignType 1 bị APINotSupportTypeInvoice)
  esignClientId: null,
  esignSecretKey: null,
  esignUsername: null,
  esignPassword: null,
  certSerial: null,
};

const input: CreateInvoiceInput = {
  orderCode: `HUBSELL-TEST-${process.argv[2] ?? "001"}`,
  buyerName: "Khách lẻ không lấy hóa đơn (test tích hợp Hubsell)",
  lines: [
    {
      name: "Sản phẩm test tích hợp Hubsell",
      sku: "HUBSELL-SKU-TEST",
      quantity: 1,
      unitPrice: 100000,
      vatRate: 10,
    },
  ],
  totalAmount: 110000,
};

(async () => {
  console.log(`Phát hành thử: RefID=${input.orderCode}, ký hiệu=${cfg.invoiceSeries}`);
  const result = await publishStandardInvoice(input, cfg);
  console.log("\n=== KẾT QUẢ ===");
  console.log(`invoiceNo    : ${result.invoiceNo}`);
  console.log(`transactionId: ${result.transactionId}`);
  console.log("raw response :");
  console.log(JSON.stringify(result.raw, null, 2).slice(0, 4000));
})().catch((e) => {
  console.error(`❌ ${(e as Error).message}`);
  process.exit(1);
});
