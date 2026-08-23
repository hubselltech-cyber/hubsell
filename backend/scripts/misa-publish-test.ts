// ============================================================
// TEST LUỒNG HÓA ĐƠN SANDBOX meINVOICE — chạy từ thư mục backend/:
//
//   npx tsx scripts/misa-publish-test.ts publish <hậu-tố-RefID>
//        (hậu tố phải MỚI mỗi lần — RefID là khóa chống trùng phía MISA)
//   npx tsx scripts/misa-publish-test.ts status <TransactionID>
//   npx tsx scripts/misa-publish-test.ts download <TransactionID> [Pdf|Xml] [file-ra]
//
// Yêu cầu .env: bộ sandbox MISA (MST 0101243150-732); riêng publish cần thêm
// MISA_ALLOW_PUBLISH=1 (misa-safety.ts).
// ĐÃ PHÁT HÀNH THÀNH CÔNG 23/08/2026: RefID HUBSELL-TEST-003 → HĐ số 00000050
// ký hiệu 1K26TYY, ký bởi chứng thư TEST-SANDBOX-MEINVOICE-02, tra được tại
// meinvoice.vn/tra-cuu với mã _PFVIPVV413Q.
// ============================================================
import "dotenv/config";
import { writeFileSync } from "node:fs";

import {
  downloadInvoiceFiles,
  getInvoiceStatuses,
  publishStandardInvoice,
  type StandardInvoiceConfig,
} from "../src/integrations/invoice/misa-einvoice";
import type { CreateInvoiceInput } from "../src/integrations/invoice/types";

const cfg: StandardInvoiceConfig = {
  taxCode: process.env.MISA_TAX_CODE ?? null,
  companyName: "CÔNG TY CỔ PHẦN MISA",
  companyAddress: "Tòa nhà Technosoft, Duy Tân, Cầu Giấy, Hà Nội",
  clientId: process.env.MISA_CLIENT_ID ?? null,
  secretKey: process.env.MISA_CLIENT_SECRET ?? null,
  invoicePattern: "1",
  invoiceSeries: "1K26TYY",
  signMethod: "ESIGN_CLOUD", // SignType 2 — HSM, meInvoice ký nền
  esignClientId: null,
  esignSecretKey: null,
  esignUsername: null,
  esignPassword: null,
  certSerial: null,
};

(async () => {
  const [cmd, arg1, arg2, arg3] = process.argv.slice(2);

  switch (cmd) {
    case "publish": {
      const input: CreateInvoiceInput = {
        orderCode: `HUBSELL-TEST-${arg1 ?? "001"}`,
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
      console.log(`Phát hành thử: RefID=${input.orderCode}, ký hiệu=${cfg.invoiceSeries}`);
      const result = await publishStandardInvoice(input, cfg);
      console.log(`invoiceNo    : ${result.invoiceNo}`);
      console.log(`transactionId: ${result.transactionId}`);
      console.log(JSON.stringify(result.raw, null, 2).slice(0, 2000));
      break;
    }

    case "status": {
      if (!arg1) throw new Error("Thiếu TransactionID");
      const items = await getInvoiceStatuses([arg1], cfg);
      console.log(JSON.stringify(items, null, 2).slice(0, 3000));
      break;
    }

    case "download": {
      if (!arg1) throw new Error("Thiếu TransactionID");
      const type = (arg2 === "Xml" ? "Xml" : "Pdf") as "Pdf" | "Xml";
      const files = await downloadInvoiceFiles([arg1], type, cfg);
      const f = files[0];
      console.log(
        `transactionId=${f?.transactionId} errorCode=${f?.errorCode} dataLength=${f?.data?.length ?? 0}`
      );
      if (f?.data && arg3) {
        if (type === "Pdf") writeFileSync(arg3, Buffer.from(f.data, "base64"));
        else writeFileSync(arg3, f.data, "utf8");
        console.log(`Đã ghi file: ${arg3}`);
      }
      break;
    }

    default:
      console.log("Lệnh: publish <hậu-tố> | status <txId> | download <txId> [Pdf|Xml] [file-ra]");
  }
})().catch((e) => {
  console.error(`❌ ${(e as Error).message}`);
  process.exit(1);
});
