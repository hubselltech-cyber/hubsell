// Bài thử 07/10/2026: cổng ITG có đường nào LẬP TỜ NHÁP CHƯA KÝ (để ký eSign trên web) không?
// Thử /invoice/publishing/token (luồng USB: MISA trả XML chưa ký) với SignType 1.
// CHỈ chạy trên MST sandbox. npx tsx scripts/misa-draft-probe.ts
import "dotenv/config";
import { buildInvoiceLines } from "../src/integrations/invoice/issue-order";
import { getMisaAccessToken, misaApiBase } from "../src/integrations/invoice/misa-auth";
import { buildStandardInvoicePayload, getInvoiceStatuses, type StandardInvoiceConfig } from "../src/integrations/invoice/misa-einvoice";
import { MISA_SANDBOX_TAX_CODE } from "../src/services/tax-pilot";

const cfg: StandardInvoiceConfig = {
  taxCode: process.env.MISA_TAX_CODE ?? null, companyName: "CÔNG TY CỔ PHẦN MISA",
  companyAddress: "Tòa nhà Technosoft, Duy Tân, Cầu Giấy, Hà Nội",
  clientId: process.env.MISA_CLIENT_ID ?? null, secretKey: process.env.MISA_CLIENT_SECRET ?? null,
  meinvoiceUsername: process.env.MISA_USERNAME ?? null, meinvoicePassword: process.env.MISA_PASSWORD ?? null,
  invoicePattern: "1", invoiceSeries: "1K26TYY", defaultUnitName: "Cái", signMethod: "USB_TOKEN",
  esignClientId: null, esignSecretKey: null, esignUsername: null, esignPassword: null, certSerial: null,
};

(async () => {
  if (cfg.taxCode !== MISA_SANDBOX_TAX_CODE) throw new Error("DỪNG: không phải MST sandbox");
  const creds = { clientId: cfg.clientId!, clientSecret: cfg.secretKey!, taxCode: cfg.taxCode!, username: cfg.meinvoiceUsername!, password: cfg.meinvoicePassword! };
  const token = await getMisaAccessToken(creds);
  const refId = `HUBSELL-DRAFT-${Date.now()}`;
  const lines = buildInvoiceLines([{ name: "Thử tờ nháp (Hubsell)", sku: "HUBSELL-DRAFT", quantity: 1, price: 11000, vatRate: null }], 10, 0, { defaultUnitName: "Cái", salesInvoice: false });
  const payload = buildStandardInvoicePayload({ orderCode: refId, buyerName: "Bán cho người tiêu dùng", lines, totalAmount: 11000 }, cfg);
  console.log("SignType gửi:", (payload as { SignType: number }).SignType);
  for (const path of ["/invoice/publishing/token", "/invoice/publishing"]) {
    const res = await fetch(`${misaApiBase()}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ClientID: creds.clientId, Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
    const text = await res.text();
    console.log(`\n=== POST ${path} → HTTP ${res.status}\n${text.slice(0, 1800)}`);
  }
  await new Promise((r) => setTimeout(r, 1500));
  const st = await getInvoiceStatuses([refId], cfg, "refId").catch((e) => ({ error: String(e).slice(0, 300) }));
  console.log("\n=== tra theo RefID sau khi gọi:", JSON.stringify(st, null, 1).slice(0, 1500));
})();
