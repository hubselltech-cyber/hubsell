// ============================================================
// BÀI THỬ SANDBOX meINVOICE — hóa đơn bước 5, lát 5 (docs/HANG-DOI-BEN.md mục 4.6):
// adapter có báo đúng "CHƯA RÕ KẾT QUẢ" khi lệnh phát hành đã tới MISA mà Hubsell
// mất câu trả lời không, và lượt làm lại có nối đúng tờ đã lập không.
// Chạy từ thư mục backend/:
//
//   npx tsx scripts/misa-outcome-unknown-probe.ts               (K1 + K2, lập 2 tờ)
//   npx tsx scripts/misa-outcome-unknown-probe.ts timeout 150   (K3 của lát 6a, lập 1 tờ)
//
// CHỈ chạy với MST sandbox của MISA (tự dừng nếu .env trỏ MST khác). Mỗi lượt chạy
// lập 2 hóa đơn SANDBOX (ký hiệu 1K26TYY, không mã CQT) và không xóa được.
//
// Cách giả "mất câu trả lời": bọc fetch toàn cục. Lệnh /invoice/publishing vẫn gửi
// THẬT sang MISA và chờ MISA xử lý xong, rồi:
//   K1  ném lỗi mạng thay cho câu trả lời (đứt ngay sau khi gửi);
//   K2  trả tiêu đề thành công nhưng đọc thân thì đứt (đứt giữa lúc đọc).
// Sau mỗi ca: adapter phải trả FAILED + outcomeUnknown; tra ngược phải THẤY tờ đã
// lập; gọi lại createInvoice với đúng mã cũ phải ra ISSUED với đúng số của tờ đó.
// ============================================================
import "dotenv/config";

import { buildInvoiceLines } from "../src/integrations/invoice/issue-order";
import { MisaInvoiceProvider, type MisaProviderConfig } from "../src/integrations/invoice/misa-provider";
import type { CreateInvoiceInput } from "../src/integrations/invoice/types";
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
    [{ name: "Sản phẩm thử chưa rõ kết quả (Hubsell)", sku: "HUBSELL-PROBE", quantity: 1, price: 11000, vatRate: null }],
    10,
    0,
    { defaultUnitName: "Cái", salesInvoice: false }
  );
  return { orderCode: refId, buyerName: "Bán cho người tiêu dùng", lines, totalAmount: 11000 };
}

type Sabotage = "drop-response" | "cut-body";
const realFetch = globalThis.fetch;

/** Lệnh phát hành vẫn tới MISA; câu trả lời bị vứt theo kiểu `mode`. In ra thứ MISA đã trả để đối chiếu. */
function sabotagePublish(mode: Sabotage): void {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    if (!url.includes("/invoice/publishing")) return realFetch(input, init);
    const res = await realFetch(input, init);
    const body = await res.text();
    console.log(`  MISA đã trả HTTP ${res.status}: ${body.slice(0, 400)}`);
    if (mode === "drop-response") throw new TypeError("fetch failed (bài thử: vứt câu trả lời)");
    return {
      ok: res.ok,
      status: res.status,
      text: async () => {
        throw new Error("terminated (bài thử: đứt giữa lúc đọc thân)");
      },
    } as unknown as Response;
  }) as typeof fetch;
}

const brief = (r: Record<string, unknown>) => JSON.stringify(r).slice(0, 600);
let failures = 0;
function check(label: string, ok: boolean): void {
  console.log(`  ${ok ? "ĐẠT " : "HỎNG"} ${label}`);
  if (!ok) failures += 1;
}

async function runCase(name: string, mode: Sabotage, refId: string): Promise<void> {
  console.log(`\n=== ${name} — mã tham chiếu ${refId} ===`);
  const provider = new MisaInvoiceProvider(cfg);
  const input = saleInput(refId);

  sabotagePublish(mode);
  const first = await provider.createInvoice(input).finally(() => {
    globalThis.fetch = realFetch;
  });
  console.log(`  adapter trả: ${brief(first as unknown as Record<string, unknown>)}`);
  check("lượt đầu: FAILED + outcomeUnknown, không có số hóa đơn", first.status === "FAILED" && first.outcomeUnknown === true && !first.invoiceNo);

  const found = await provider.findByReference(refId);
  console.log(`  tra ngược: ${brief(found as unknown as Record<string, unknown>)}`);
  check("tờ ĐÃ được lập bên MISA dù Hubsell không nhận được câu trả lời", found.state === "FOUND" && found.issued && !found.deleted);

  const again = await provider.createInvoice(input);
  console.log(`  làm lại: ${brief(again as unknown as Record<string, unknown>)}`);
  check(
    "làm lại với đúng mã cũ: ĐÃ PHÁT HÀNH, đúng số của tờ đã lập, không lập thêm",
    again.status === "ISSUED" && found.state === "FOUND" && again.invoiceNo === found.invoiceNo && again.transactionId === found.transactionId
  );

  const after = await provider.findByReference(refId);
  check("MISA chỉ có MỘT tờ cho mã này", after.state === "FOUND" && after.matches === 1);
}

/**
 * K3 (lát 6a) — THỜI HẠN CHỜ THẬT: không bọc fetch. Đặt INVOICE_HTTP_TIMEOUT_MS ngắn
 * hơn thời gian MISA xử lý lệnh phát hành (sandbox 350–580 ms) để lệnh tới MISA
 * rồi bị Hubsell cắt vì quá hạn. Token lấy sẵn từ trước để chỉ lệnh phát hành bị cắt.
 * MISA có lập tờ đó hay không sau khi bị cắt là điều bài thử ĐO, không giả định:
 * cả hai đường đều phải kết thúc bằng đúng MỘT tờ sau lượt làm lại.
 */
async function runTimeoutCase(refId: string, timeoutMs: number): Promise<void> {
  console.log(`\n=== K3 quá thời hạn chờ ${timeoutMs} ms ở lệnh phát hành — mã tham chiếu ${refId} ===`);
  const provider = new MisaInvoiceProvider(cfg);
  const input = saleInput(refId);
  const warm = await provider.findByReference(`${refId}-CHUA-CO`);
  check("lấy token + tra mã chưa có (thời hạn mặc định): không thấy", warm.state === "NOT_FOUND");

  const saved = process.env.INVOICE_HTTP_TIMEOUT_MS;
  process.env.INVOICE_HTTP_TIMEOUT_MS = String(timeoutMs);
  const first = await provider.createInvoice(input).finally(() => {
    if (saved === undefined) delete process.env.INVOICE_HTTP_TIMEOUT_MS;
    else process.env.INVOICE_HTTP_TIMEOUT_MS = saved;
  });
  console.log(`  adapter trả: ${brief(first as unknown as Record<string, unknown>)}`);
  check(
    "lượt đầu: FAILED + outcomeUnknown, câu báo nói không trả lời trong thời hạn chờ",
    first.status === "FAILED" && first.outcomeUnknown === true && (first.errorMessage ?? "").includes("không trả lời trong thời hạn chờ")
  );

  await new Promise((r) => setTimeout(r, 3000));
  const found = await provider.findByReference(refId);
  console.log(`  tra ngược sau 3 giây: ${brief(found as unknown as Record<string, unknown>)}`);
  console.log(`  → MISA ${found.state === "FOUND" ? "ĐÃ LẬP tờ này dù Hubsell đã cắt lệnh" : "KHÔNG lập tờ nào sau khi bị cắt"}`);

  const again = await provider.createInvoice(input);
  console.log(`  làm lại: ${brief(again as unknown as Record<string, unknown>)}`);
  check(
    "làm lại với đúng mã cũ: ĐÃ PHÁT HÀNH" + (found.state === "FOUND" ? ", đúng số của tờ đã lập" : ""),
    again.status === "ISSUED" && (found.state !== "FOUND" || again.invoiceNo === found.invoiceNo)
  );
  const after = await provider.findByReference(refId);
  check("MISA chỉ có MỘT tờ cho mã này", after.state === "FOUND" && after.matches === 1);
}

(async () => {
  if (cfg.taxCode !== MISA_SANDBOX_TAX_CODE) {
    throw new Error("DỪNG: MISA_TAX_CODE trong .env không phải MST sandbox của MISA — bài thử này chỉ chạy trên sandbox.");
  }
  const prefix = `HUBSELL-UNK-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(2, 14)}`;
  // npx tsx scripts/misa-outcome-unknown-probe.ts timeout [ms] — chỉ chạy K3 (lập 1 tờ sandbox).
  if (process.argv[2] === "timeout") {
    await runTimeoutCase(`${prefix}-K3`, Math.max(20, Number(process.argv[3] ?? 150)));
    console.log(failures === 0 ? "\nTẤT CẢ ĐẠT" : `\nCÓ ${failures} ĐIỂM HỎNG`);
    process.exit(failures === 0 ? 0 : 1);
  }
  await runCase("K1 đứt ngay sau khi gửi lệnh", "drop-response", `${prefix}-K1`);
  await runCase("K2 đứt giữa lúc đọc câu trả lời", "cut-body", `${prefix}-K2`);
  console.log(failures === 0 ? "\nTẤT CẢ ĐẠT" : `\nCÓ ${failures} ĐIỂM HỎNG`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error("Bài thử dừng vì lỗi:", err);
  process.exit(1);
});
