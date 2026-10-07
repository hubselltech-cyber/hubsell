// Bài thử 08/10/2026: chạy MODULE misa-invoiceweb.ts (không phải fetch tay) trên sandbox
// để chứng minh payload Hubsell dựng được MISA nhận ở cả 3 ca trước khi nối vào HQ:
//   1) HĐ GTGT 1K26TYY, dòng KCT (như bán gói Hubsell), người mua CÓ MST + email;
//   2) HĐ GTGT 1K26TYY, dòng 10% bóc ngược, khách lẻ;
//   3) HĐ BÁN HÀNG 2K26TYY (không dòng thuế).
// Mỗi tờ: insert → getlist theo RefID (phải thấy, PublishStatus 0) → gọi insert LẠI cùng mã
// (MISA phải báo trùng, không ra tờ 2) → delete → getlist rỗng.
// CHỈ chạy trên MST sandbox. npx tsx scripts/misa-invoiceweb-module-probe.ts
import "dotenv/config";
import { MISA_SANDBOX_TAX_CODE } from "../src/services/tax-pilot";
import type { StandardInvoiceConfig } from "../src/integrations/invoice/misa-einvoice";
import {
  buildWebDraftPayload,
  deleteWebDraft,
  findWebTemplate,
  getWebInvoices,
  insertWebDraft,
  listWebTemplates,
  webRefIdFor,
} from "../src/integrations/invoice/misa-invoiceweb";
import { buildHqInvoiceInput } from "../src/integrations/invoice/issue-hq";
import type { CreateInvoiceInput } from "../src/integrations/invoice/types";
import { explainInvoiceError } from "../src/integrations/invoice/invoice-errors";

const env = (k: string) => process.env[k]?.trim() ?? "";
const base: StandardInvoiceConfig = {
  taxCode: env("MISA_TAX_CODE"),
  companyName: "Công ty sandbox",
  companyAddress: "Hà Nội",
  clientId: null,
  secretKey: null,
  meinvoiceUsername: env("MISA_USERNAME"),
  meinvoicePassword: env("MISA_PASSWORD"),
  invoicePattern: "1",
  invoiceSeries: "1K26TYY",
  signMethod: "ESIGN_CLOUD",
  esignClientId: null,
  esignSecretKey: null,
  esignUsername: null,
  esignPassword: null,
  certSerial: null,
};
const show = (l: string, v: unknown) => console.log(l, JSON.stringify(v).slice(0, 700));

async function lifecycle(label: string, input: CreateInvoiceInput, cfg: StandardInvoiceConfig) {
  console.log(`\n===== ${label} (${cfg.invoiceSeries}) =====`);
  const tpl = await findWebTemplate(cfg);
  show("payload:", buildWebDraftPayload(input, cfg, tpl));
  const r = await insertWebDraft(input, cfg);
  show("insert →", { refId: r.refId, data: (r.raw as { Data?: unknown }).Data });
  await new Promise((s) => setTimeout(s, 1200));
  const found = await getWebInvoices([r.refId], cfg);
  show("getlist →", found.map(({ raw: _raw, ...rest }) => rest));
  if (found.length !== 1) throw new Error(`${label}: getlist không thấy tờ vừa đẩy`);
  try {
    await insertWebDraft(input, cfg);
    console.log("insert LẠI cùng mã → MISA NHẬN (⚠️ không chặn trùng?)");
    const again = await getWebInvoices([r.refId], cfg);
    show("getlist sau insert lại →", again.map((x) => ({ refId: x.refId, publishStatus: x.publishStatus })));
  } catch (err) {
    const ex = explainInvoiceError(err);
    console.log(`insert LẠI cùng mã → bị từ chối ✅ code=${ex.code} · ${ex.message.slice(0, 160)}`);
  }
  await deleteWebDraft(r.refId, cfg);
  const after = await getWebInvoices([r.refId], cfg);
  console.log(`delete → getlist còn ${after.length} dòng ${after.length === 0 ? "✅" : "⚠️"}`);
}

(async () => {
  if (base.taxCode !== MISA_SANDBOX_TAX_CODE) throw new Error("DỪNG: không phải MST sandbox");
  process.env.MISA_ALLOW_PUBLISH = "1";
  const stamp = Date.now();
  show("templates (không mã):", (await listWebTemplates(base, false)).map((t) => `${t.invSeries}${t.inactive ? "(off)" : ""}`));
  console.log("webRefIdFor ổn định:", webRefIdFor("HQLEDGER-abc") === webRefIdFor("HQLEDGER-abc"), webRefIdFor("HQLEDGER-abc"));

  // 1) KCT, người mua có MST + email (đúng ca bán gói Hubsell)
  await lifecycle(
    "1) GTGT KCT, đơn vị có MST",
    buildHqInvoiceInput({
      refId: `PROBE-KCT-${stamp}`,
      buyerName: "CÔNG TY TNHH KHÁCH THỬ HUBSELL",
      buyerTaxCode: "0101243150",
      buyerAddress: "12 Phố Thử, Hà Nội",
      buyerEmail: "ketoan@khach-thu.test",
      itemName: "Phí dịch vụ phần mềm Hubsell — gói Pro, 1 năm (thử tờ nháp)",
      amount: 2990000,
      vatMode: "KCT",
    }),
    base
  );

  // 2) 10% bóc ngược, khách lẻ
  await lifecycle(
    "2) GTGT 10%, khách lẻ",
    buildHqInvoiceInput({
      refId: `PROBE-VAT10-${stamp}`,
      buyerName: "Nguyễn Văn Thử",
      itemName: "Phí dịch vụ phần mềm Hubsell — thử 10%",
      amount: 110000,
      vatMode: "10",
    }),
    base
  );

  // 3) Hóa đơn bán hàng 2K26TYY (không dòng thuế)
  await lifecycle(
    "3) BÁN HÀNG 2K26TYY",
    {
      orderCode: `PROBE-SALES-${stamp}`,
      buyerName: "Trần Thị Thử",
      lines: [
        { name: "Áo thun thử", sku: "AT-01", unitName: "Cái", quantity: 2, unitPrice: 50000, vatRate: 0, amountWithoutVat: 100000, vatAmount: 0 },
      ],
      totalAmount: 100000,
    },
    { ...base, invoicePattern: "2", invoiceSeries: "2K26TYY" }
  );
  console.log("\nXONG.");
})().catch((err) => {
  console.error("LỖI:", explainInvoiceError(err).message, err);
  process.exit(1);
});
