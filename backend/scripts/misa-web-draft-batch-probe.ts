// ============================================================
// BÀI THỬ SANDBOX meINVOICE — GOM NHIỀU TỜ NHÁP MỘT LỆNH /invoiceweb/insert (10/10/2026,
// anh Trung chốt "gửi chốt cứng 20 tờ 1 lệnh" cho đường tờ nháp; docs/HANG-DOI-BEN.md
// mục 4.7 "Đợt 6c"). CHỈ chạy trên MST sandbox; tờ nháp xóa được nên cuối bài dọn hết.
//
//   D1  Lô 5 tờ hợp lệ: thời gian, hình dạng Data (mỗi tờ một phần tử? có RefID?), getlist đủ 5.
//   D2  Lô 5 có MỘT tờ sai ở giữa (ký hiệu + mẫu không tồn tại): hỏng cả lô hay chỉ tờ đó;
//       4 tờ còn lại có lên web không.
//   D3  Lô 5 có MỘT tờ trùng RefID tờ đã có: hỏng cả lô hay chỉ tờ đó.
//   D4  Lô 20 tờ hợp lệ: thời gian so với 20 lệnh lẻ (ước từ D1).
//
//   npx tsx scripts/misa-web-draft-batch-probe.ts
// ============================================================
import "dotenv/config";

import { MISA_SANDBOX_TAX_CODE } from "../src/services/tax-pilot";
import type { StandardInvoiceConfig } from "../src/integrations/invoice/misa-einvoice";
import {
  buildWebDraftPayload,
  deleteWebDraft,
  findWebTemplate,
  getWebInvoices,
  insertWebDraftPayloads,
  type WebDraftPayload,
} from "../src/integrations/invoice/misa-invoiceweb";
import { explainInvoiceError, InvoiceProviderError } from "../src/integrations/invoice/invoice-errors";
import type { CreateInvoiceInput } from "../src/integrations/invoice/types";

const env = (k: string) => process.env[k]?.trim() ?? "";
const cfg: StandardInvoiceConfig = {
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
const show = (l: string, v: unknown) => console.log(l, JSON.stringify(v).slice(0, 900));
const created: string[] = [];

function input(code: string, i: number): CreateInvoiceInput {
  // 10% bóc ngược, khách lẻ — giống đơn sàn thật.
  const price = 110000 + i * 1000;
  const amount = Math.round(price / 1.1);
  return {
    orderCode: code,
    buyerName: `Khách thử lô ${i + 1}`,
    lines: [
      { name: `Áo thun thử lô ${i + 1}`, sku: `AT-LO-${i + 1}`, unitName: "Cái", quantity: 1, unitPrice: amount, vatRate: 10, amountWithoutVat: amount, vatAmount: price - amount },
    ],
    totalAmount: price,
  };
}

async function sendBatch(label: string, payloads: WebDraftPayload[]) {
  const t0 = Date.now();
  try {
    const r = await insertWebDraftPayloads(payloads, cfg);
    const ms = Date.now() - t0;
    const data = (r.raw as { Data?: unknown })?.Data;
    console.log(`${label}: NHẬN sau ${ms} ms · Data kiểu ${Array.isArray(data) ? `mảng ${data.length}` : typeof data}`);
    show("  Data:", data);
    for (const it of r.items) {
      console.log(`  · ${it.refId.slice(0, 8)} → ${it.errorCode ? `LỖI ${it.errorCode} ${it.description ?? ""}` : "ok"}`);
      if (!it.errorCode) created.push(it.refId);
    }
    return { ok: true as const, ms, r };
  } catch (err) {
    const ms = Date.now() - t0;
    const ex = explainInvoiceError(err);
    const detail = err instanceof InvoiceProviderError ? err.detail : null;
    console.log(`${label}: TỪ CHỐI CẢ LÔ sau ${ms} ms · code=${ex.code} http=${detail?.httpStatus ?? "-"} · ${ex.message.slice(0, 200)}`);
    if (detail?.description) console.log("  mô tả:", String(detail.description).slice(0, 300));
    return { ok: false as const, ms, err };
  }
}

async function onWeb(label: string, refIds: string[]) {
  await new Promise((s) => setTimeout(s, 1500));
  const found = await getWebInvoices(refIds, cfg);
  const seen = new Set(found.map((f) => f.refId.toLowerCase()));
  const hit = refIds.filter((r) => seen.has(r.toLowerCase()));
  console.log(`${label}: getlist thấy ${hit.length}/${refIds.length} tờ`);
  for (const r of hit) if (!created.includes(r)) created.push(r);
  return hit;
}

(async () => {
  if (cfg.taxCode !== MISA_SANDBOX_TAX_CODE) throw new Error("DỪNG: không phải MST sandbox");
  process.env.MISA_ALLOW_PUBLISH = "1";
  const stamp = Date.now();
  const tpl = await findWebTemplate(cfg);
  console.log("mẫu:", tpl.invSeries, tpl.templateId);
  const mk = (tag: string, n: number) => Array.from({ length: n }, (_, i) => buildWebDraftPayload(input(`LO-${tag}-${stamp}-${i + 1}`, i), cfg, tpl));

  // D1
  const d1 = mk("D1", 5);
  const r1 = await sendBatch("D1 lô 5 hợp lệ", d1);
  await onWeb("D1", d1.map((p) => p.RefID));

  // D2: tờ #3 sai ký hiệu + mẫu
  const d2 = mk("D2", 5);
  const bad = d2[2] as Record<string, unknown>;
  for (const k of Object.keys(bad)) {
    if (/^InvSeries$/i.test(k)) bad[k] = "1K26ZZZ";
    if (/TemplateID$/i.test(k)) bad[k] = "00000000-0000-0000-0000-000000000000";
  }
  show("D2 tờ #3 sau khi làm sai (các khóa ký hiệu/mẫu):", Object.fromEntries(Object.entries(bad).filter(([k]) => /InvSeries|TemplateID|InvTemplateNo/i.test(k))));
  await sendBatch("D2 lô 5 có tờ #3 sai", d2);
  await onWeb("D2 (4 tờ lành)", d2.filter((_, i) => i !== 2).map((p) => p.RefID));
  await onWeb("D2 (tờ sai)", [d2[2].RefID]);

  // D3: tờ #2 trùng RefID với tờ D1 #1
  const d3 = mk("D3", 5);
  d3[1] = { ...d1[0] };
  await sendBatch("D3 lô 5 có tờ #2 trùng RefID", d3);
  await onWeb("D3 (4 tờ mới)", d3.filter((_, i) => i !== 1).map((p) => p.RefID));

  // D4: lô 20
  const d4 = mk("D4", 20);
  const r4 = await sendBatch("D4 lô 20 hợp lệ", d4);
  await onWeb("D4", d4.map((p) => p.RefID));
  if (r1.ok && r4.ok) console.log(`So sánh: lô 5 ${r1.ms} ms · lô 20 ${r4.ms} ms · 20 lệnh lẻ ước ≈ ${Math.round((r1.ms / 5) * 20)} ms chưa kể nghỉ 1 s/tờ`);

  // Dọn
  let gone = 0;
  for (const ref of created) {
    try {
      await deleteWebDraft(ref, cfg);
      gone += 1;
    } catch (err) {
      console.log("  không xóa được", ref.slice(0, 8), explainInvoiceError(err).message.slice(0, 100));
    }
  }
  const left = await getWebInvoices(created.slice(0, 50), cfg);
  console.log(`Dọn: xóa ${gone}/${created.length} tờ nháp, getlist còn ${left.length} ${left.length === 0 ? "✅" : "⚠️"}`);
  console.log("XONG.");
})().catch((err) => {
  console.error("LỖI:", explainInvoiceError(err).message, err);
  process.exit(1);
});
