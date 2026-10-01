import { afterEach, describe, expect, it, vi } from "vitest";
import { percentile, platformFetch, platformTimeoutMs, summaryLine } from "../platform-http";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.PLATFORM_HTTP_TIMEOUT_MS;
});

describe("percentile + summaryLine", () => {
  it("phân vị theo thứ hạng gần nhất; dãy rỗng → null", () => {
    const s = [50, 10, 40, 20, 30, 60, 70, 80, 90, 100];
    expect(percentile(s, 50)).toBe(50);
    expect(percentile(s, 95)).toBe(100);
    expect(percentile(s, 99)).toBe(100);
    expect(percentile([7], 99)).toBe(7);
    expect(percentile([], 50)).toBeNull();
  });

  it("dòng tổng hợp đủ số lệnh, phân vị, max, lỗi, quá hạn", () => {
    expect(summaryLine("SHOPEE", { count: 3, errors: 1, timeouts: 0, maxMs: 900, samples: [100, 200, 900] })).toBe(
      "[SanHTTP] SHOPEE n=3 p50=200ms p95=900ms p99=900ms max=900ms loi=1 qua_han=0"
    );
  });
});

describe("platformTimeoutMs", () => {
  it("chưa đặt / đặt sai → null (không có thời hạn chờ)", () => {
    expect(platformTimeoutMs({})).toBeNull();
    expect(platformTimeoutMs({ PLATFORM_HTTP_TIMEOUT_MS: "0" })).toBeNull();
    expect(platformTimeoutMs({ PLATFORM_HTTP_TIMEOUT_MS: "abc" })).toBeNull();
    expect(platformTimeoutMs({ PLATFORM_HTTP_TIMEOUT_MS: "15000" })).toBe(15000);
  });
});

describe("platformFetch", () => {
  it("chưa bật thời hạn: gọi fetch với đúng url + init, không thêm signal, trả nguyên Response", async () => {
    const res = new Response("{}", { status: 200 });
    const spy = vi.fn().mockResolvedValue(res);
    vi.stubGlobal("fetch", spy);
    const init = { method: "POST", body: "x" };
    const out = await platformFetch("SHOPEE", "https://partner.shopeemobile.com/api/v2/order/get?sign=BIMAT", init);
    expect(out).toBe(res);
    expect(spy).toHaveBeenCalledWith("https://partner.shopeemobile.com/api/v2/order/get?sign=BIMAT", init);
  });

  it("fetch ném lỗi: ném lại ĐÚNG lỗi đó, log chỉ có đường dẫn (không lộ query)", async () => {
    const boom = new TypeError("fetch failed");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(boom));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(
      platformFetch("LAZADA", "https://api.lazada.vn/rest/order/get?access_token=BIMAT&sign=ABC")
    ).rejects.toBe(boom);
    const logged = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("LOI LAZADA /rest/order/get");
    expect(logged).not.toContain("BIMAT");
  });

  it("đã bật thời hạn: sàn không trả lời thì ném lỗi nói rõ quá bao nhiêu giây", async () => {
    process.env.PLATFORM_HTTP_TIMEOUT_MS = "50";
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
          })
      )
    );
    await expect(platformFetch("TIKTOK", "https://open-api.tiktokglobalshop.com/order/202309/orders?x=1")).rejects.toThrow(
      /TIKTOK không trả lời trong 0 giây \(\/order\/202309\/orders\)/
    );
  });

  it("đã bật thời hạn mà sàn trả lời kịp thì kết quả như thường", async () => {
    process.env.PLATFORM_HTTP_TIMEOUT_MS = "5000";
    const res = new Response("ok");
    const spy = vi.fn().mockResolvedValue(res);
    vi.stubGlobal("fetch", spy);
    expect(await platformFetch("TIKTOK_ADS", "https://business-api.tiktok.com/x")).toBe(res);
    expect(spy.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});
