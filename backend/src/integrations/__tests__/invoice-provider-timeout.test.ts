import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { InvoiceLogStatus } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { clearMisaTokenCache } from "../invoice/misa-auth";
import { MisaInvoiceProvider, type MisaProviderConfig } from "../invoice/misa-provider";
import {
  flushProviderHttpStats,
  isProviderTimeout,
  providerFetch,
  providerHttpTimeoutMs,
  readProviderBody,
} from "../invoice/provider-http";
import type { CreateInvoiceInput } from "../invoice/types";

// ============================================================
// THỜI HẠN CHỜ LỆNH GỌI NHÀ CUNG CẤP HÓA ĐƠN — bước 5, lát 6a (03/10/2026).
//
// Dùng MỘT MÁY CHỦ HTTP THẬT trên máy (không giả fetch) để kiểm đúng hành vi của
// thư viện khi bị cắt giữa chừng:
//   1. Máy chủ nhận lệnh rồi im lặng → quá hạn, ném ProviderTimeoutError.
//   2. Máy chủ trả tiêu đề rồi ngừng giữa thân → quá hạn lúc đọc thân.
//   3. INVOICE_HTTP_TIMEOUT_MS=0 tắt thời hạn; giá trị lạ về mặc định 60 giây.
//   4. Adapter MISA: quá hạn ở bước PHÁT HÀNH (lệnh đã tới máy chủ) = chưa rõ kết quả;
//      quá hạn ở bước lấy token = chưa gửi, không gắn cờ; quá hạn khi tra ngược =
//      "không tra được", không phải "không thấy".
// ============================================================

type Mode = "ok" | "stall" | "stall-body";
const modes: Record<string, Mode> = {};
const hits: Record<string, number> = {};
let server: Server;
let base = "";

const TOKEN_OK = JSON.stringify({ Success: true, Data: "TOKEN-GIA" });
const PUBLISH_OK = JSON.stringify({
  Success: true,
  PublishInvoiceResult: JSON.stringify([{ RefID: "DH-QUA-HAN-001", TransactionID: "TX-OK", InvNo: "00000150", ErrorCode: "" }]),
});
const STATUS_EMPTY = JSON.stringify({ Success: true, Data: "[]" });

function handle(req: IncomingMessage, res: ServerResponse): void {
  const path = (req.url ?? "").split("?")[0];
  hits[path] = (hits[path] ?? 0) + 1;
  req.resume();
  const mode = modes[path] ?? "ok";
  if (mode === "stall") return; // nhận lệnh rồi im lặng
  const body = path.endsWith("/token") ? TOKEN_OK : path.endsWith("/publishing") ? PUBLISH_OK : STATUS_EMPTY;
  if (mode === "stall-body") {
    res.writeHead(200, { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)), Connection: "close" });
    res.write(body.slice(0, 10)); // gửi tiêu đề + một mẩu thân rồi ngừng
    return;
  }
  // "Connection: close": không cho thư viện giữ lại kết nối để dùng tiếp, vì sau mỗi
  // test máy chủ cắt mọi kết nối (nhả các lệnh đang bị giữ im lặng).
  res.writeHead(200, { "Content-Type": "application/json", Connection: "close" });
  res.end(body);
}

const CFG: MisaProviderConfig = {
  taxCode: "0101243150-732",
  companyName: "Shop test",
  companyAddress: "HN",
  clientId: "c",
  secretKey: "s",
  meinvoiceUsername: "u",
  meinvoicePassword: "p",
  invoicePattern: "1",
  invoiceSeries: "1C26TAA",
  defaultUnitName: "Cái",
  signMethod: "ESIGN_CLOUD",
  esignClientId: null,
  esignSecretKey: null,
  esignUsername: null,
  esignPassword: null,
  certSerial: null,
  defaultInvoiceType: "STANDARD",
};

const INPUT: CreateInvoiceInput = {
  orderCode: "DH-QUA-HAN-001",
  buyerName: "Bán cho người tiêu dùng",
  lines: [
    { name: "Áo", sku: "A1", quantity: 1, unitPrice: 10_000, vatRate: 10, amountWithoutVat: 10_000, vatAmount: 1_000 },
  ],
  totalAmount: 11_000,
};

const saved = {
  timeout: process.env.INVOICE_HTTP_TIMEOUT_MS,
  apiBase: process.env.MISA_API_BASE,
  allow: process.env.MISA_ALLOW_PUBLISH,
};
const restore = (name: string, value: string | undefined) => {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
};

beforeAll(async () => {
  server = createServer(handle);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.MISA_API_BASE = base;
  process.env.MISA_ALLOW_PUBLISH = "1";
});

afterAll(async () => {
  restore("INVOICE_HTTP_TIMEOUT_MS", saved.timeout);
  restore("MISA_API_BASE", saved.apiBase);
  restore("MISA_ALLOW_PUBLISH", saved.allow);
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  for (const k of Object.keys(modes)) delete modes[k];
  for (const k of Object.keys(hits)) delete hits[k];
  process.env.INVOICE_HTTP_TIMEOUT_MS = "200";
  clearMisaTokenCache();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(async () => {
  server.closeAllConnections(); // nhả các kết nối đang bị giữ im lặng
  await new Promise((r) => setTimeout(r, 50)); // để phía gọi kịp thấy kết nối đã đóng trước test kế
  vi.restoreAllMocks();
  flushProviderHttpStats();
});

describe("providerHttpTimeoutMs", () => {
  it("mặc định 60 giây; '0' = tắt; giá trị lạ về mặc định", () => {
    expect(providerHttpTimeoutMs({})).toBe(60_000);
    expect(providerHttpTimeoutMs({ INVOICE_HTTP_TIMEOUT_MS: "" })).toBe(60_000);
    expect(providerHttpTimeoutMs({ INVOICE_HTTP_TIMEOUT_MS: "0" })).toBe(0);
    expect(providerHttpTimeoutMs({ INVOICE_HTTP_TIMEOUT_MS: " 1500 " })).toBe(1500);
    expect(providerHttpTimeoutMs({ INVOICE_HTTP_TIMEOUT_MS: "abc" })).toBe(60_000);
    expect(providerHttpTimeoutMs({ INVOICE_HTTP_TIMEOUT_MS: "-5" })).toBe(60_000);
  });
});

describe("providerFetch với máy chủ thật", () => {
  it("máy chủ nhận lệnh rồi im lặng → ProviderTimeoutError đúng thời hạn; log không lộ địa chỉ", async () => {
    modes["/x/stall"] = "stall";
    const started = Date.now();
    const err = await providerFetch("MISA", "publishing", `${base}/x/stall?token=BIMAT`, { method: "POST", body: "MST" }).then(
      () => null,
      (e: unknown) => e
    );
    const took = Date.now() - started;
    expect(isProviderTimeout(err)).toBe(true);
    expect((err as Error).message).toBe("quá thời hạn chờ 200 ms");
    expect(took).toBeGreaterThanOrEqual(180);
    expect(took).toBeLessThan(2_000);
    expect(hits["/x/stall"]).toBe(1); // lệnh ĐÃ tới máy chủ
    const logged = vi.mocked(console.warn).mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("[NccHTTP] QUA HAN MISA publishing");
    expect(logged).not.toContain("BIMAT");
    expect(logged).not.toContain("127.0.0.1");
  });

  it("máy chủ trả tiêu đề rồi ngừng giữa thân → quá hạn lúc đọc thân", async () => {
    modes["/x/body"] = "stall-body";
    const res = await providerFetch("MISA", "status", `${base}/x/body`);
    expect(res.status).toBe(200);
    const err = await readProviderBody(res).then(
      () => null,
      (e: unknown) => e
    );
    expect(isProviderTimeout(err)).toBe(true);
  });

  it("máy chủ trả lời kịp → không ảnh hưởng", async () => {
    const res = await providerFetch("MISA", "status", `${base}/invoice/status`);
    expect(await readProviderBody(res)).toBe(STATUS_EMPTY);
  });

  it("INVOICE_HTTP_TIMEOUT_MS=0 → không đặt thời hạn (lệnh chờ quá 200 ms vẫn chưa bị cắt)", async () => {
    process.env.INVOICE_HTTP_TIMEOUT_MS = "0";
    modes["/x/stall"] = "stall";
    const outcome = await Promise.race([
      providerFetch("MISA", "publishing", `${base}/x/stall`).then(
        () => "tra-loi",
        () => "loi"
      ),
      new Promise<string>((resolve) => setTimeout(() => resolve("van-dang-cho"), 600)),
    ]);
    expect(outcome).toBe("van-dang-cho");
  });
});

describe("Adapter MISA khi nhà cung cấp không trả lời kịp", () => {
  const provider = () => new MisaInvoiceProvider(CFG);

  it("quá hạn ở bước PHÁT HÀNH: lệnh đã tới máy chủ → hỏng + CHƯA RÕ KẾT QUẢ", async () => {
    modes["/invoice/publishing"] = "stall";
    const r = await provider().createInvoice(INPUT);
    expect(hits["/invoice/publishing"]).toBe(1);
    expect(r.status).toBe(InvoiceLogStatus.FAILED);
    expect(r.outcomeUnknown).toBe(true);
    expect(r.errorScope).toBe("TRANSIENT");
    expect(r.errorMessage).toContain("không trả lời trong thời hạn chờ");
  });

  it("quá hạn lúc đọc câu trả lời của lệnh phát hành → cũng là chưa rõ", async () => {
    modes["/invoice/publishing"] = "stall-body";
    const r = await provider().createInvoice(INPUT);
    expect(r.status).toBe(InvoiceLogStatus.FAILED);
    expect(r.outcomeUnknown).toBe(true);
    expect(r.errorMessage).toContain("không trả lời trong thời hạn chờ");
  });

  it.each(["stall", "stall-body"] as const)("quá hạn ở bước lấy token (%s): lệnh phát hành CHƯA gửi → không gắn cờ", async (mode) => {
    modes["/invoice/token"] = mode;
    const r = await provider().createInvoice(INPUT);
    expect(hits["/invoice/publishing"]).toBeUndefined();
    expect(r.status).toBe(InvoiceLogStatus.FAILED);
    expect(r.errorScope).toBe("TRANSIENT");
    expect(r.outcomeUnknown).toBeUndefined();
  });

  it("quá hạn khi tra ngược → 'không tra được' (sự cố tạm), KHÔNG phải 'không thấy'", async () => {
    modes["/invoice/status"] = "stall";
    const found = await provider().findByReference("DH-QUA-HAN-001");
    expect(found.state).toBe("LOOKUP_FAILED");
    if (found.state === "LOOKUP_FAILED") {
      expect(found.accountProblem).toBe(false);
      expect(found.message).toContain("quá thời hạn chờ");
    }
  });

  it("máy chủ trả lời kịp → phát hành bình thường", async () => {
    const r = await provider().createInvoice(INPUT);
    expect(r).toMatchObject({ status: InvoiceLogStatus.ISSUED, invoiceNo: "00000150", transactionId: "TX-OK" });
  });
});
