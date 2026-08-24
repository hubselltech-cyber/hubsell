// ============================================================
// TEST HÓA ĐƠN ĐIỀU CHỈNH GIẢM trên sandbox meInvoice (24/08 khuya):
//
//   npx tsx scripts/misa-adjust-test.ts publish <hậu-tố-RefID>
//   npx tsx scripts/misa-adjust-test.ts download <TransactionID> [file-ra.pdf]
//
// Tham chiếu hóa đơn gốc 00000066 (ký hiệu 1K26TYY, ngày 2026-08-24, đơn
// Lazada 485236838656212: 1 thắt lưng 73.148 + 5.852 VAT 8% = 79.000đ) —
// kịch bản: khách trả hàng hoàn tiền TOÀN BỘ → dòng hàng ghi ÂM.
// Yêu cầu .env: bộ sandbox MISA + MISA_ALLOW_PUBLISH=1.
// ============================================================
import "dotenv/config";
import { writeFileSync } from "node:fs";

import {
  downloadInvoiceFiles,
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
  meinvoiceUsername: process.env.MISA_USERNAME ?? null,
  meinvoicePassword: process.env.MISA_PASSWORD ?? null,
  invoicePattern: "1",
  invoiceSeries: "1K26TYY",
  signMethod: "ESIGN_CLOUD",
  esignClientId: null,
  esignSecretKey: null,
  esignUsername: null,
  esignPassword: null,
  certSerial: null,
};

(async () => {
  const [cmd, arg1, arg2] = process.argv.slice(2);

  switch (cmd) {
    case "publish": {
      const input: CreateInvoiceInput = {
        orderCode: `485236838656212-DC${arg1 ?? "1"}`, // RefID mới — chống trùng
        buyerName: "Bán cho người tiêu dùng",
        lines: [
          {
            name: "Thắt lưng nam da bò thắt lưng nam khóa tự động mặt trượt thông minh TLN009 - Nhóm Màu:Mặt bạc",
            sku: "TLN009",
            quantity: -1, // trả TOÀN BỘ → số lượng ÂM (đơn giá giữ dương)
            unitPrice: 73148,
            vatRate: 8,
            amountWithoutVat: -73148,
            vatAmount: -5852,
          },
        ],
        totalAmount: -79000,
        adjustment: {
          orgInvNo: "00000066",
          orgInvSeries: "1K26TYY",
          orgInvDate: "2026-08-24",
          reason: "Khách trả hàng hoàn tiền toàn bộ đơn 485236838656212",
        },
      };
      console.log(`Phát hành HĐ ĐIỀU CHỈNH: RefID=${input.orderCode} → gốc 00000066`);
      const result = await publishStandardInvoice(input, cfg);
      console.log(`invoiceNo    : ${result.invoiceNo}`);
      console.log(`transactionId: ${result.transactionId}`);
      console.log(JSON.stringify(result.raw, null, 2).slice(0, 3000));
      break;
    }

    case "download": {
      if (!arg1) throw new Error("Thiếu TransactionID");
      const files = await downloadInvoiceFiles([arg1], "Pdf", cfg);
      const f = files[0];
      console.log(`errorCode=${f?.errorCode} dataLength=${f?.data?.length ?? 0}`);
      if (f?.data && arg2) {
        writeFileSync(arg2, Buffer.from(f.data, "base64"));
        console.log(`Đã ghi file: ${arg2}`);
      }
      break;
    }

    default:
      console.log("Lệnh: publish <hậu-tố> | download <txId> [file-ra.pdf]");
  }
})().catch((e) => {
  console.error(`❌ ${(e as Error).message}`);
  process.exit(1);
});
