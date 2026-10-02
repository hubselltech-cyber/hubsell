// ============================================================
// GIỚI HẠN GỌI API TIKTOK SHOP — lớp một cửa ở callApi (02/10/2026)
//
// Căn cứ: tài liệu "Rate limits" của TikTok Shop — quá tải = HTTP 429 hoặc mã
// 36009002; phải làm mượt theo gian, nghỉ tăng dần có lệch ngẫu nhiên, tôn
// trọng Retry-After, lệnh ghi không tự thử lại. Sự cố gốc: tối 02/10 lượt dựng
// lại sao kê của ba gian bị sàn trả 36009002 giữa chừng.
//
// Không DB, không gọi sàn: fetch được thay bằng bản giả; đồng hồ / nghỉ / số
// ngẫu nhiên của lớp giới hạn thay bằng bản điều khiển được.
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callApi } from "../tiktok/client";
import type { TikTokConfig } from "../tiktok/config";
import {
  acquireTiktokSlot,
  isTiktokRateLimited,
  isTiktokThrottleSignal,
  noteTiktokThrottled,
  parseRetryAfterMs,
  resetTiktokRateLimitLanes,
  TIKTOK_RATE_LIMIT,
  tiktokBackoffMs,
  tiktokCallKind,
  tiktokRateLimitDeps,
  type TiktokRateLimitError,
} from "../tiktok/rate-limit";

const cfg: TikTokConfig = { appKey: "k", appSecret: "s", serviceId: "1", redirectUri: "https://x/cb" };

/** Đồng hồ giả: nghỉ = cộng thẳng vào đồng hồ, ghi lại từng lần nghỉ. */
let clock = 0;
let sleeps: number[] = [];
const realDeps = { ...tiktokRateLimitDeps };
const fetchSpy = vi.fn();

const ok = (data: unknown) => ({ status: 200, headers: new Headers(), json: async () => ({ code: 0, message: "Success", data }) });
const throttledBody = (headers: Record<string, string> = {}) => ({
  status: 200,
  headers: new Headers(headers),
  json: async () => ({
    code: 36009002,
    message: "Too many requests. A dependent service is temporarily rate limited.",
    request_id: "REQ-1",
    data: null,
  }),
});
const http429NoBody = () => ({
  status: 429,
  headers: new Headers(),
  json: async () => {
    throw new SyntaxError("Unexpected end of JSON input");
  },
});

beforeEach(() => {
  clock = 1_000_000;
  sleeps = [];
  tiktokRateLimitDeps.now = () => clock;
  tiktokRateLimitDeps.sleep = async (ms: number) => {
    sleeps.push(ms);
    clock += ms;
  };
  tiktokRateLimitDeps.random = () => 0; // không lệch → số nghỉ tròn, dễ kiểm
  resetTiktokRateLimitLanes();
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  Object.assign(tiktokRateLimitDeps, realDeps);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Nhận diện và phân loại", () => {
  it("quá tải = HTTP 429 HOẶC mã 36009002", () => {
    expect(isTiktokThrottleSignal(429, null)).toBe(true);
    expect(isTiktokThrottleSignal(200, 36009002)).toBe(true);
    expect(isTiktokThrottleSignal(429, 36009002)).toBe(true);
    expect(isTiktokThrottleSignal(200, 0)).toBe(false);
    expect(isTiktokThrottleSignal(503, 105005)).toBe(false); // 503 không phải quá tải
  });

  it("GET và các API tìm kiếm (POST …/search) là lệnh đọc; POST / PUT khác là lệnh ghi", () => {
    expect(tiktokCallKind("GET", "/finance/202501/statements/1/statement_transactions")).toBe("read");
    expect(tiktokCallKind("POST", "/order/202309/orders/search")).toBe("read");
    expect(tiktokCallKind("POST", "/return_refund/202309/returns/search")).toBe("read");
    expect(tiktokCallKind("POST", "/fulfillment/202309/packages/9/ship")).toBe("write");
    expect(tiktokCallKind("POST", "/product/202309/products/7/inventory/update")).toBe("write");
  });

  it("Retry-After: số giây, ngày giờ HTTP, hoặc không đọc được", () => {
    expect(parseRetryAfterMs("7", 0)).toBe(7_000);
    expect(parseRetryAfterMs("Fri, 02 Oct 2026 13:40:10 GMT", Date.parse("2026-10-02T13:40:00Z"))).toBe(10_000);
    expect(parseRetryAfterMs("Fri, 02 Oct 2026 13:40:10 GMT", Date.parse("2026-10-02T13:41:00Z"))).toBe(0);
    expect(parseRetryAfterMs("khong-phai-so", 0)).toBeNull();
    expect(parseRetryAfterMs(null, 0)).toBeNull();
  });

  it("nghỉ tăng dần 1 → 2 → 4 → 8 → 16 giây, trần 60 giây, cộng lệch tối đa 0,5 giây; Retry-After dài hơn thì theo Retry-After", () => {
    expect([0, 1, 2, 3, 4].map((n) => tiktokBackoffMs(n, null, 0))).toEqual([1_000, 2_000, 4_000, 8_000, 16_000]);
    expect(tiktokBackoffMs(10, null, 0)).toBe(60_000);
    expect(tiktokBackoffMs(0, null, 1)).toBe(1_500);
    expect(tiktokBackoffMs(0, 9_000, 0)).toBe(9_000);
    expect(tiktokBackoffMs(3, 2_000, 0)).toBe(8_000);
  });
});

describe("Làm mượt theo gian × loại thao tác", () => {
  it("các lượt đọc cùng gian cách nhau 1/3 giây dù gọi dồn cùng lúc; gian khác và lệnh ghi đi làn riêng", async () => {
    const start = clock;
    // Bốn lượt gọi CÙNG một thời điểm: đồng hồ đứng yên, chỉ ghi lại mỗi lượt phải chờ bao lâu.
    tiktokRateLimitDeps.sleep = async (ms: number) => {
      sleeps.push(ms);
    };
    await Promise.all([1, 2, 3, 4].map(() => acquireTiktokSlot("shopA", "read")));
    // 4 lượt: lượt đầu đi ngay, ba lượt sau xếp hàng 333 / 667 / 1000 ms.
    expect(sleeps.map((ms) => Math.round(ms))).toEqual([333, 667, 1000]);

    sleeps = [];
    clock = start;
    await acquireTiktokSlot("shopB", "read");
    await acquireTiktokSlot("shopA", "write");
    expect(sleeps).toEqual([]); // làn khác → không phải chờ
  });

  it("bị chặn → giảm nửa nhịp (không dưới 0,2 lượt/giây); yên 10 phút → tăng lại 25%, không vượt nhịp khởi điểm", () => {
    expect(noteTiktokThrottled("shopA", "read")).toBe(1.5);
    expect(noteTiktokThrottled("shopA", "read")).toBe(0.75);
    for (let i = 0; i < 10; i++) noteTiktokThrottled("shopA", "read");
    expect(noteTiktokThrottled("shopA", "read")).toBe(TIKTOK_RATE_LIMIT.FLOOR_RPS);

    resetTiktokRateLimitLanes();
    noteTiktokThrottled("shopA", "read"); // 1,5 lượt/giây
    clock += TIKTOK_RATE_LIMIT.RAMP_EVERY_MS;
    // Sau một quãng yên: 1,5 × 1,25 = 1,875 → hai lượt cách nhau 533 ms.
    sleeps = [];
    void acquireTiktokSlot("shopA", "read");
    void acquireTiktokSlot("shopA", "read");
    expect(Math.round(sleeps[0])).toBe(533);

    clock += 10 * TIKTOK_RATE_LIMIT.RAMP_EVERY_MS; // yên rất lâu → về đúng nhịp khởi điểm, không hơn
    sleeps = [];
    void acquireTiktokSlot("shopA", "read");
    void acquireTiktokSlot("shopA", "read");
    expect(Math.round(sleeps[0])).toBe(333);
  });
});

describe("callApi — xử lý quá tải", () => {
  const read = () =>
    callApi<{ v: number }>({ path: "/finance/202501/statements/1/statement_transactions", accessToken: "t", shopCipher: "shopA" }, cfg);

  it("lệnh đọc bị chặn hai lần (mã 36009002, HTTP 200) rồi qua → trả dữ liệu, nghỉ 1 giây rồi 2 giây", async () => {
    fetchSpy.mockResolvedValueOnce(throttledBody()).mockResolvedValueOnce(throttledBody()).mockResolvedValueOnce(ok({ v: 7 }));
    await expect(read()).resolves.toEqual({ v: 7 });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(sleeps.filter((ms) => ms >= 1_000)).toEqual([1_000, 2_000]);
  });

  it("HTTP 429 không kèm thân JSON cũng được coi là quá tải và thử lại", async () => {
    fetchSpy.mockResolvedValueOnce(http429NoBody()).mockResolvedValueOnce(ok({ v: 1 }));
    await expect(read()).resolves.toEqual({ v: 1 });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("sàn trả Retry-After dài hơn mức tự tính → chờ theo Retry-After", async () => {
    fetchSpy.mockResolvedValueOnce(throttledBody({ "retry-after": "12" })).mockResolvedValueOnce(ok({ v: 2 }));
    await read();
    expect(sleeps).toContain(12_000);
  });

  it("hết 5 lượt thử lại vẫn bị chặn → ném TiktokRateLimitError kèm đủ thông tin tra cứu", async () => {
    fetchSpy.mockResolvedValue(throttledBody());
    const err = await read().catch((e) => e);
    expect(isTiktokRateLimited(err)).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1 + TIKTOK_RATE_LIMIT.MAX_RETRIES);
    expect(err.info).toMatchObject({ kind: "read", httpStatus: 200, code: 36009002, requestId: "REQ-1", attempts: 6 });
    expect(String(err.message)).toContain("36009002");
  });

  it("lệnh GHI bị chặn → KHÔNG tự thử lại (tránh ghi trùng), ném ngay", async () => {
    fetchSpy.mockResolvedValue(throttledBody());
    const err = await callApi<unknown>(
      { method: "POST", path: "/fulfillment/202309/packages/9/ship", accessToken: "t", shopCipher: "shopA", body: { handover_method: "PICKUP" } },
      cfg
    ).catch((e: TiktokRateLimitError) => e);
    if (!isTiktokRateLimited(err)) throw new Error("phải ném TiktokRateLimitError");
    expect(isTiktokRateLimited(err)).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(err.info.kind).toBe("write");
  });

  it("lệnh ghi được khai là gọi lặp vẫn một kết quả (retryWhenThrottled) → có thử lại", async () => {
    fetchSpy.mockResolvedValueOnce(throttledBody()).mockResolvedValueOnce(ok({ v: 3 }));
    await expect(
      callApi<{ v: number }>(
        { method: "POST", path: "/product/202309/products/7/inventory/update", accessToken: "t", shopCipher: "shopA", body: {}, retryWhenThrottled: true },
        cfg
      )
    ).resolves.toEqual({ v: 3 });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("bị chặn làm giảm nhịp của đúng gian đó: lượt đọc kế của gian cách xa hơn, gian khác không bị ảnh hưởng", async () => {
    fetchSpy.mockResolvedValueOnce(throttledBody()).mockResolvedValue(ok({ v: 1 }));
    await read(); // shopA bị chặn một lần → nhịp 1,5 lượt/giây
    sleeps = [];
    void acquireTiktokSlot("shopA", "read");
    void acquireTiktokSlot("shopA", "read");
    expect(Math.round(sleeps[sleeps.length - 1])).toBeGreaterThanOrEqual(667);

    sleeps = [];
    void acquireTiktokSlot("shopB", "read");
    void acquireTiktokSlot("shopB", "read");
    expect(Math.round(sleeps[0])).toBe(333);
  });

  it("lỗi nghiệp vụ khác (không phải quá tải) → ném ngay như cũ, không thử lại", async () => {
    fetchSpy.mockResolvedValue({ status: 200, headers: new Headers(), json: async () => ({ code: 105005, message: "no access scope", data: null }) });
    const err = await read().catch((e) => e);
    expect(isTiktokRateLimited(err)).toBe(false);
    expect(String(err.message)).toBe("TikTok API lỗi (code 105005): no access scope");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
