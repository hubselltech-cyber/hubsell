// ============================================================
// BÀI THỬ SANDBOX meINVOICE — các giả định mà thiết kế bước 5 (docs/HANG-DOI-BEN.md
// mục 4.6) dựa vào. Chạy từ thư mục backend/:
//
//   npx tsx scripts/misa-refid-probe.ts
//
// CHỈ chạy với MST sandbox của MISA (tự dừng nếu .env trỏ MST khác). Mỗi lượt
// chạy lập 3–4 hóa đơn SANDBOX (ký hiệu 1K26TYY, không mã CQT) và không xóa được.
//
// Câu hỏi:
//   E1  Tra theo mã tham chiếu CHƯA TỪNG gửi → MISA trả gì?
//   E2  Một mã tham chiếu bị TỪ CHỐI (hai kiểu từ chối) rồi gửi lại hợp lệ → có nhận không?
//       Ngay sau khi lập, tra theo mã tham chiếu có thấy không?
//   E3  Gửi lại mã tham chiếu ĐÃ lập → mã lỗi gì?
//   E4  Hai lệnh CÙNG LÚC cùng một mã tham chiếu → mấy tờ được lập?
//   E5  Điều chỉnh: mã tham chiếu bị từ chối rồi gửi lại hợp lệ; tra ngược theo mã đó.
// ============================================================
import "dotenv/config";

import { buildInvoiceLines } from "../src/integrations/invoice/issue-order";
import { InvoiceProviderError } from "../src/integrations/invoice/invoice-errors";
import {
  getInvoiceStatuses,
  publishStandardInvoice,
  type StandardInvoiceConfig,
} from "../src/integrations/invoice/misa-einvoice";
import type { CreateInvoiceInput } from "../src/integrations/invoice/types";
import { MISA_SANDBOX_TAX_CODE } from "../src/services/tax-pilot";

const SERIES = "1K26TYY";

const cfg: StandardInvoiceConfig = {
  taxCode: process.env.MISA_TAX_CODE ?? null,
  companyName: "CÔNG TY CỔ PHẦN MISA",
  companyAddress: "Tòa nhà Technosoft, Duy Tân, Cầu Giấy, Hà Nội",
  clientId: process.env.MISA_CLIENT_ID ?? null,
  secretKey: process.env.MISA_CLIENT_SECRET ?? null,
  meinvoiceUsername: process.env.MISA_USERNAME ?? null,
  meinvoicePassword: process.env.MISA_PASSWORD ?? null,
  invoicePattern: "1",
  invoiceSeries: SERIES,
  defaultUnitName: "Cái",
  signMethod: "ESIGN_CLOUD",
  esignClientId: null,
  esignSecretKey: null,
  esignUsername: null,
  esignPassword: null,
  certSerial: null,
};

function describeError(err: unknown): Record<string, unknown> {
  if (err instanceof InvoiceProviderError) {
    return { kind: "InvoiceProviderError", ...err.detail, message: err.message.slice(0, 200) };
  }
  return { kind: (err as Error)?.name ?? "Error", message: String((err as Error)?.message ?? err).slice(0, 300) };
}

async function timed<T>(label: string, fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  const started = Date.now();
  try {
    const value = await fn();
    console.log(`\n[${label}] XONG sau ${Date.now() - started} ms`);
    return { ok: true, value };
  } catch (error) {
    console.log(`\n[${label}] HỎNG sau ${Date.now() - started} ms: ${JSON.stringify(describeError(error))}`);
    return { ok: false, error };
  }
}

function saleInput(refId: string, vatRate: number): CreateInvoiceInput {
  const lines = buildInvoiceLines(
    [{ name: "Sản phẩm thử mã tham chiếu (Hubsell)", sku: "HUBSELL-PROBE", quantity: 1, price: 11000, vatRate: null }],
    vatRate,
    0,
    { defaultUnitName: "Cái", salesInvoice: false }
  );
  return { orderCode: refId, buyerName: "Bán cho người tiêu dùng", lines, totalAmount: 11000 };
}

const show = (v: unknown) => console.log(JSON.stringify(v, null, 1).slice(0, 1500));
const lookup = (ref: string) => getInvoiceStatuses([ref], cfg, "refId");
const brief = (items: Awaited<ReturnType<typeof lookup>>) =>
  items.map((i) => ({ tx: i.transactionId, publishStatus: i.publishStatus, invoiceNo: i.invoiceNo, isDeleted: i.isDeleted }));

/**
 * Đo ĐỘ TRỄ của việc tra theo mã tham chiếu: lập một tờ rồi hỏi liên tục tới khi
 * MISA trả về tờ đó. Lần chạy đầu (02/10/2026) thấy một lượt tra ngay sau khi
 * lập trả RỖNG, 400 ms sau mới thấy.
 */
async function measureLookupLag(refId: string, input: CreateInvoiceInput): Promise<void> {
  const published = await timed(`lập ${refId}`, () => publishStandardInvoice(input, cfg));
  if (!published.ok) return;
  const doneAt = Date.now();
  const seen: string[] = [];
  for (let i = 0; i < 60; i++) {
    const at = Date.now() - doneAt;
    const items = await lookup(refId).catch(() => null);
    const found = !!items && items.some((it) => it.publishStatus === 1);
    seen.push(`${at}ms:${items === null ? "lỗi" : found ? "THẤY" : `rỗng(${items.length})`}`);
    if (found) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log(`  số ${published.value.invoiceNo} — các lượt tra: ${seen.join("  ")}`);
}

(async () => {
  if (cfg.taxCode !== MISA_SANDBOX_TAX_CODE) {
    throw new Error("DỪNG: MISA_TAX_CODE trong .env không phải MST sandbox của MISA — bài thử này chỉ chạy trên sandbox.");
  }
  const prefix = `HUBSELL-PROBE-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(2, 14)}`;
  console.log(`Tiền tố mã tham chiếu: ${prefix}`);

  // npx tsx scripts/misa-refid-probe.ts lag <số tờ bán> [số HĐ gốc để điều chỉnh] — chỉ đo độ trễ tra ngược.
  if (process.argv[2] === "lag") {
    const sales = Math.min(5, Math.max(1, Number(process.argv[3] ?? 2)));
    for (let i = 1; i <= sales; i++) await measureLookupLag(`${prefix}-L${i}`, saleInput(`${prefix}-L${i}`, 10));
    const orgInvNo = process.argv[4];
    if (orgInvNo) {
      const base = saleInput("x", 10);
      const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
      const ref = `${prefix}-L-DC1`;
      await measureLookupLag(ref, {
        orderCode: ref,
        buyerName: "Bán cho người tiêu dùng",
        lines: base.lines.map((l) => ({ ...l, quantity: -l.quantity, amountWithoutVat: -l.amountWithoutVat, vatAmount: -l.vatAmount })),
        totalAmount: -11000,
        adjustment: { orgInvNo, orgInvSeries: SERIES, orgInvDate: today, reason: "Đo độ trễ tra ngược của hóa đơn điều chỉnh" },
      });
    }
    return;
  }

  // npx tsx scripts/misa-refid-probe.ts adj-reuse <số HĐ gốc> — mã tham chiếu của tờ ĐIỀU CHỈNH
  // bị từ chối (thuế suất sai) rồi gửi lại hợp lệ có được nhận không. Lập 1 tờ điều chỉnh sandbox.
  if (process.argv[2] === "adj-reuse") {
    const orgInvNo = process.argv[3];
    if (!orgInvNo) throw new Error("Thiếu số hóa đơn gốc");
    const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
    const ref = `${prefix}-R-DC1`;
    const adj = (vatRate: number): CreateInvoiceInput => ({
      orderCode: ref,
      buyerName: "Bán cho người tiêu dùng",
      lines: saleInput("x", vatRate).lines.map((l) => ({
        ...l,
        quantity: -l.quantity,
        amountWithoutVat: -l.amountWithoutVat,
        vatAmount: -l.vatAmount,
      })),
      totalAmount: -11000,
      adjustment: { orgInvNo, orgInvSeries: SERIES, orgInvDate: today, reason: "Thử dùng lại mã tham chiếu điều chỉnh bị từ chối" },
    });
    await timed("R1 điều chỉnh với thuế suất 7% (mong bị từ chối)", () => publishStandardInvoice(adj(7), cfg));
    const r2 = await timed("R2 tra mã sau lượt bị từ chối", () => lookup(ref));
    if (r2.ok) show(brief(r2.value));
    const r3 = await timed("R3 điều chỉnh hợp lệ, DÙNG LẠI mã", () => publishStandardInvoice(adj(10), cfg));
    if (r3.ok) show({ invoiceNo: r3.value.invoiceNo, transactionId: r3.value.transactionId });
    await new Promise((r) => setTimeout(r, 1000));
    const r4 = await timed("R4 tra mã 1 giây sau khi lập", () => lookup(ref));
    if (r4.ok) show(brief(r4.value));
    return;
  }

  // ---- E1: tra mã chưa từng gửi ----
  const e1 = await timed("E1 tra mã chưa từng gửi", () => lookup(`${prefix}-NEVER`));
  if (e1.ok) show({ soDong: e1.value.length, raw: e1.value.map((i) => i.raw) });

  // ---- E2: từ chối rồi gửi lại ----
  const refA = `${prefix}-A`;
  const badSeries = { ...cfg, invoiceSeries: "1K26ZZZ" };
  await timed("E2a gửi A với ký hiệu không tồn tại (mong bị từ chối)", () => publishStandardInvoice(saleInput(refA, 10), badSeries));
  await timed("E2a2 gửi A với thuế suất 7% (mong bị từ chối)", () => publishStandardInvoice(saleInput(refA, 7), cfg));
  const e2b = await timed("E2b tra A sau hai lượt bị từ chối", () => lookup(refA));
  if (e2b.ok) show(brief(e2b.value));
  const e2c = await timed("E2c gửi A hợp lệ", () => publishStandardInvoice(saleInput(refA, 10), cfg));
  let invA: { invoiceNo: string | null; transactionId: string | null } | null = null;
  if (e2c.ok) {
    invA = { invoiceNo: e2c.value.invoiceNo, transactionId: e2c.value.transactionId };
    show(invA);
  }
  const e2d = await timed("E2d tra A NGAY sau khi lập (theo mã tham chiếu)", () => lookup(refA));
  if (e2d.ok) show(brief(e2d.value));

  // ---- E3: gửi lại mã đã lập ----
  await timed("E3 gửi lại A (mong báo trùng)", () => publishStandardInvoice(saleInput(refA, 10), cfg));
  const e3b = await timed("E3b tra A sau lượt báo trùng", () => lookup(refA));
  if (e3b.ok) show(brief(e3b.value));

  // ---- E4: hai lệnh cùng lúc, cùng mã ----
  const refB = `${prefix}-B`;
  const started = Date.now();
  const pair = await Promise.allSettled([
    publishStandardInvoice(saleInput(refB, 10), cfg),
    publishStandardInvoice(saleInput(refB, 10), cfg),
  ]);
  console.log(`\n[E4 hai lệnh cùng lúc cho B] xong sau ${Date.now() - started} ms`);
  show(
    pair.map((p) =>
      p.status === "fulfilled"
        ? { ketQua: "LẬP ĐƯỢC", invoiceNo: p.value.invoiceNo, transactionId: p.value.transactionId }
        : { ketQua: "HỎNG", ...describeError(p.reason) }
    )
  );
  const e4b = await timed("E4b tra B", () => lookup(refB));
  if (e4b.ok) show(brief(e4b.value));

  // ---- E5: điều chỉnh ----
  if (invA?.invoiceNo) {
    const refAdj = `${refA}-DC1`;
    const base = saleInput(refA, 10);
    const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
    const adjInput = (orgInvNo: string): CreateInvoiceInput => ({
      orderCode: refAdj,
      buyerName: "Bán cho người tiêu dùng",
      lines: base.lines.map((l) => ({ ...l, quantity: -l.quantity, amountWithoutVat: -l.amountWithoutVat, vatAmount: -l.vatAmount })),
      totalAmount: -11000,
      adjustment: { orgInvNo, orgInvSeries: SERIES, orgInvDate: today, reason: "Thử mã tham chiếu điều chỉnh" },
    });
    // 02/10/2026: sandbox KHÔNG từ chối — lập luôn tờ điều chỉnh trỏ vào số hóa đơn
    // gốc không tồn tại. MISA không kiểm hóa đơn gốc; Hubsell phải tự bảo đảm.
    const e5a = await timed("E5a điều chỉnh với số hóa đơn gốc không tồn tại", () =>
      publishStandardInvoice(adjInput("99999999"), cfg)
    );
    if (e5a.ok) show({ invoiceNo: e5a.value.invoiceNo, transactionId: e5a.value.transactionId });
    const e5b = await timed("E5b tra mã điều chỉnh sau lượt bị từ chối", () => lookup(refAdj));
    if (e5b.ok) show(brief(e5b.value));
    const e5c = await timed("E5c điều chỉnh hợp lệ, DÙNG LẠI mã tham chiếu", () => publishStandardInvoice(adjInput(invA!.invoiceNo!), cfg));
    if (e5c.ok) show({ invoiceNo: e5c.value.invoiceNo, transactionId: e5c.value.transactionId });
    const e5d = await timed("E5d tra mã điều chỉnh ngay sau khi lập", () => lookup(refAdj));
    if (e5d.ok) show(brief(e5d.value));
    await timed("E5e gửi lại điều chỉnh cùng mã (mong báo trùng)", () => publishStandardInvoice(adjInput(invA!.invoiceNo!), cfg));
  } else {
    console.log("\n[E5] bỏ qua: không lập được hóa đơn A.");
  }
})().catch((err) => {
  console.error("Bài thử dừng:", (err as Error).message);
  process.exit(1);
});
