import { afterEach, describe, expect, it, vi } from "vitest";

import { getMisaAccessToken, clearMisaTokenCache } from "../invoice/misa-auth";
import { getInvoiceStatuses } from "../invoice/misa-einvoice";
import { flushProviderHttpStats, providerFetch, providerSummaryLine } from "../invoice/provider-http";

// ============================================================
// CỬA GỌI NHÀ CUNG CẤP HÓA ĐƠN — lát 4 bước 5 (02/10/2026): CHỈ ĐO thời gian.
//   1. Hành vi y như fetch: đúng url + init, trả nguyên Response, ném lại đúng lỗi.
//   2. Số đo tách theo NCC + loại lệnh; log không lộ địa chỉ, token hay thân lệnh.
//   3. Các lệnh MISA của luồng hóa đơn đầu ra đi qua cửa này với đúng tên loại lệnh.
// ============================================================

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearMisaTokenCache();
  flushProviderHttpStats();
});

describe("providerFetch", () => {
  it("gọi fetch với đúng url + init, không thêm gì, trả nguyên Response", async () => {
    const res = new Response("{}", { status: 200 });
    const spy = vi.fn().mockResolvedValue(res);
    vi.stubGlobal("fetch", spy);
    const init = { method: "POST", body: "x" };
    expect(await providerFetch("MISA", "publishing", "https://ncc.example/invoice/publishing", init)).toBe(res);
    expect(spy).toHaveBeenCalledWith("https://ncc.example/invoice/publishing", init);
  });

  it("fetch ném lỗi: ném lại ĐÚNG lỗi đó; log chỉ có NCC + loại lệnh", async () => {
    const boom = new TypeError("fetch failed");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(boom));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(
      providerFetch("MISA", "status", "https://ncc.example/invoice/status?token=BIMAT", { body: "MST-NGUOI-MUA" })
    ).rejects.toBe(boom);
    const logged = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("[NccHTTP] LOI MISA status");
    expect(logged).not.toContain("BIMAT");
    expect(logged).not.toContain("MST-NGUOI-MUA");
    expect(logged).not.toContain("ncc.example");
  });

  it("dòng tổng hợp in theo từng cặp NCC + loại lệnh, đếm cả lệnh lỗi", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    flushProviderHttpStats(); // bỏ số đo của các test trước
    log.mockClear();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("ok")));
    await providerFetch("MISA", "publishing", "https://ncc.example/a");
    await providerFetch("MISA", "publishing", "https://ncc.example/a");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("mạng")));
    await providerFetch("MISA", "status", "https://ncc.example/b").catch(() => undefined);
    flushProviderHttpStats();
    const lines = log.mock.calls.map((c) => String(c[0]));
    expect(lines.find((l) => l.startsWith("[NccHTTP] MISA publishing "))).toMatch(/ n=2 .* loi=0$/);
    expect(lines.find((l) => l.startsWith("[NccHTTP] MISA status "))).toMatch(/ n=1 .* loi=1$/);
  });

  it("định dạng dòng tổng hợp", () => {
    expect(providerSummaryLine("MISA publishing", { count: 3, errors: 1, maxMs: 900, samples: [100, 200, 900] })).toBe(
      "[NccHTTP] MISA publishing n=3 p50=200ms p95=900ms p99=900ms max=900ms loi=1"
    );
  });
});

describe("Lệnh MISA đi qua cửa đo với đúng loại lệnh", () => {
  it("lấy token → 'token'; hỏi trạng thái → 'status'", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    flushProviderHttpStats();
    log.mockClear();
    const spy = vi.fn(async (url: string) =>
      String(url).endsWith("/invoice/token")
        ? new Response(JSON.stringify({ Success: true, Data: "TOKEN-GIA" }))
        : new Response(JSON.stringify({ Success: true, Data: "[]" }))
    );
    vi.stubGlobal("fetch", spy);
    const creds = { clientId: "c", clientSecret: "s", taxCode: "0101243150-732", username: "u", password: "p" };
    expect(await getMisaAccessToken(creds)).toBe("TOKEN-GIA");
    const cfg = {
      taxCode: creds.taxCode,
      companyName: "x",
      companyAddress: "x",
      clientId: creds.clientId,
      secretKey: creds.clientSecret,
      meinvoiceUsername: creds.username,
      meinvoicePassword: creds.password,
      invoicePattern: "1",
      invoiceSeries: "1C26TAA",
      signMethod: "ESIGN_CLOUD",
      esignClientId: null,
      esignSecretKey: null,
      esignUsername: null,
      esignPassword: null,
      certSerial: null,
    };
    expect(await getInvoiceStatuses(["TX1"], cfg)).toEqual([]);
    flushProviderHttpStats();
    const lines = log.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.startsWith("[NccHTTP] MISA token n=1 "))).toBe(true);
    expect(lines.some((l) => l.startsWith("[NccHTTP] MISA status n=1 "))).toBe(true);
  });
});
