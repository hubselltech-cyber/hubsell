// Bài thử 07/10/2026 đêm: nhóm API WEB APP (HÓA ĐƠN NHÁP) trên developer.misa.vn —
// /invoiceweb/token → /invoiceweb/templates → /invoiceweb/insert (tờ nháp CHƯA KÝ, hiện ở
// app3.meinvoice.vn/v3/hoa-don "Chưa phát hành") → /invoiceweb/getlist theo RefID.
// Kết quả 07/10: token OK (Data = JSON string, lấy access_token) → 2 mẫu → insert 200 → getlist thấy
// PublishStatus 0 / InvNo "<Chưa cấp số>" → paging thấy → delete 200 → getlist rỗng.
// CHỈ chạy trên MST sandbox. npx tsx scripts/misa-invoiceweb-probe.ts
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { MISA_SANDBOX_TAX_CODE } from "../src/services/tax-pilot";

const BASE = "https://developer.misa.vn/apis/itg/meinvoice";
const env = (k: string) => process.env[k]?.trim() ?? "";
const creds = { clientId: env("MISA_CLIENT_ID"), clientSecret: env("MISA_CLIENT_SECRET"), taxCode: env("MISA_TAX_CODE"), username: env("MISA_USERNAME"), password: env("MISA_PASSWORD") };
const show = (l: string, v: unknown) => console.log(l, typeof v === "string" ? v.slice(0, 900) : JSON.stringify(v).slice(0, 900));
const unwrap = (raw: unknown) => { const d = (raw as { Data?: unknown; data?: unknown }).Data ?? (raw as { data?: unknown }).data; if (typeof d === "string") { try { return JSON.parse(d); } catch { return d; } } return d; };

(async () => {
  if (creds.taxCode !== MISA_SANDBOX_TAX_CODE) throw new Error("DỪNG: không phải MST sandbox");
  // 1) token webapp
  let res = await fetch(`${BASE}/invoiceweb/token`, { method: "POST", headers: { "Content-Type": "application/json", ClientID: creds.clientId, ClientSecret: creds.clientSecret }, body: JSON.stringify({ TaxCode: creds.taxCode, UserName: creds.username, Password: creds.password }) });
  let text = await res.text(); let raw: unknown = JSON.parse(text);
  show(`1) /invoiceweb/token HTTP ${res.status}:`, { ...(raw as object), Data: typeof (raw as { Data?: unknown }).Data === "string" ? `<token ${(raw as { Data: string }).Data.length} ký tự>` : (raw as { Data?: unknown }).Data });
  // GOTCHA (07/10): Data là JSON STRING {access_token, token_type, expires_in, UserID, CompanyID…}
  // — dùng nguyên chuỗi Data làm Bearer thì mọi API sau trả 401 UnAuthorize.
  const tokenData = unwrap(raw) as { access_token?: string } | string;
  const token = typeof tokenData === "string" ? tokenData : tokenData?.access_token;
  if (!token) throw new Error("không có token");
  const H = { "Content-Type": "application/json", ClientID: creds.clientId, Authorization: `Bearer ${token}`, TaxCode: creds.taxCode };

  // 2) templates (không mã — sandbox chỉ có 1K26TYY/2K26TYY)
  res = await fetch(`${BASE}/invoiceweb/templates?invoiceWithCode=false`, { method: "POST", headers: { "Content-Type": "application/json", ClientID: creds.clientId }, body: JSON.stringify({ TypeInvoice: 0, TaxCode: creds.taxCode, UserName: creds.username, Password: creds.password }) });
  text = await res.text(); raw = JSON.parse(text);
  const templates = unwrap(raw) as Array<Record<string, unknown>>;
  show(`2) /invoiceweb/templates HTTP ${res.status}: ${Array.isArray(templates) ? templates.length : "?"} mẫu →`, Array.isArray(templates) ? templates.map((t) => ({ IPTemplateID: t.IPTemplateID, InvSeries: t.InvSeries, InvTemplateNo: t.InvTemplateNo, Inactive: t.Inactive, TemplateType: t.TemplateType })) : raw);
  const tpl = Array.isArray(templates) ? templates.find((t) => t.InvSeries === "1K26TYY" && !t.Inactive) ?? templates[0] : null;
  if (!tpl) throw new Error("không có mẫu");

  // 3) insert một tờ nháp
  const refId = randomUUID();
  const now = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10) + "T00:00:00+07:00";
  const body = [{
    RefID: refId, InvoiceTemplateID: tpl.IPTemplateID, InvSeries: tpl.InvSeries, InvDate: now,
    AccountObjectName: "Khách thử nháp Hubsell", ContactName: "Nguyễn Văn Thử", AccountObjectAddress: "Hà Nội",
    PaymentMethod: "TM/CK", CurrencyCode: "VND", CurrencyID: "VND", ExchangeRate: 1, DiscountRate: 0, VATRate: -1,
    TotalSaleAmountOC: 99000, TotalSaleAmount: 99000, TotalDiscountAmountOC: 0, TotalDiscountAmount: 0,
    TotalVATAmountOC: 0, TotalVATAmount: 0, TotalAmountOC: 99000, TotalAmount: 99000,
    CreatedDate: now, ModifiedDate: now, EInvoiceStatus: 1,
    InvoiceDetails: [{ InventoryItemType: 0, Description: "Phí dịch vụ phần mềm Hubsell — thử tờ nháp", UnitName: "Tháng", Quantity: 1, UnitPrice: 99000, AmountOC: 99000, Amount: 99000, DiscountRate: 0, DiscountAmountOC: 0, DiscountAmount: 0, VATRate: -1, VATAmountOC: 0, VATAmount: 0, SortOrder: 1, SortOrderView: 1 }],
    CustomField1: "HUBSELL-DRAFT-PROBE",
  }];
  res = await fetch(`${BASE}/invoiceweb/insert`, { method: "POST", headers: H, body: JSON.stringify(body) });
  text = await res.text();
  show(`3) /invoiceweb/insert HTTP ${res.status} (RefID ${refId}):`, text);

  // 4) getlist theo RefID
  await new Promise((r) => setTimeout(r, 1500));
  res = await fetch(`${BASE}/invoiceweb/getlist?invoiceWithCode=false`, { method: "POST", headers: H, body: JSON.stringify([refId]) });
  text = await res.text();
  show(`4) /invoiceweb/getlist HTTP ${res.status}:`, text);
})();
