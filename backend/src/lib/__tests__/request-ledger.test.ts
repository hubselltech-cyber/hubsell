// Sổ request đang chạy + rào route nặng (lib/request-ledger.ts, 03/11/2026).
import { EventEmitter } from "events";
import { describe, expect, it } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { describeInFlight, heavyRouteGuard, inFlightCount, SERVER_BUSY_CODE, trackInFlight } from "../request-ledger";

function fakeReq(path: string): Request {
  return { method: "GET", originalUrl: path, url: path } as unknown as Request;
}
function fakeRes() {
  const em = new EventEmitter() as EventEmitter & {
    statusCode: number;
    body: unknown;
    headers: Record<string, string>;
    status(c: number): typeof res;
    json(b: unknown): typeof res;
    setHeader(k: string, v: string): void;
  };
  const res = Object.assign(em, {
    statusCode: 200,
    body: null as unknown,
    headers: {} as Record<string, string>,
    status(c: number) {
      res.statusCode = c;
      return res;
    },
    json(b: unknown) {
      res.body = b;
      return res;
    },
    setHeader(k: string, v: string) {
      res.headers[k] = v;
    },
  });
  return res;
}
const noop: NextFunction = () => {};

describe("request-ledger — sổ in-flight + rào route nặng", () => {
  it("ghi sổ khi vào, xóa khi response đóng", () => {
    const before = inFlightCount();
    const res = fakeRes();
    trackInFlight(fakeReq("/api/finance/sku-products?channel=all"), res as unknown as Response, noop);
    expect(inFlightCount()).toBe(before + 1);
    expect(describeInFlight()).toContain("GET /api/finance/sku-products");
    expect(describeInFlight()).not.toContain("channel=all"); // không in query
    res.emit("close");
    expect(inFlightCount()).toBe(before);
  });

  it("luồng SSE chuông không che request thật: request thường vẫn được in dù có nhiều luồng cũ", () => {
    const opened = Array.from({ length: 10 }, () => {
      const res = fakeRes();
      trackInFlight(fakeReq("/api/notifications/stream"), res as unknown as Response, noop);
      return res;
    });
    const res = fakeRes();
    trackInFlight(fakeReq("/api/finance/cost-prices/mapping/skus"), res as unknown as Response, noop);
    const line = describeInFlight();
    expect(line).toContain("/api/finance/cost-prices/mapping/skus");
    expect(line).not.toContain("GET /api/notifications/stream");
    expect(line).toContain("+10 luồng chuông");
    res.emit("close");
    opened.forEach((r) => r.emit("close"));
  });

  it("rào: quá số request nặng cùng lúc → 503 SERVER_BUSY + Retry-After; xong một cái thì cho vào lại", () => {
    process.env.HEAVY_ROUTE_MAX_CONCURRENT = "1";
    process.env.HEAVY_ROUTE_RSS_MB = "100000"; // không chặn vì RSS trong test
    const guard = heavyRouteGuard("test-heavy");
    const r1 = fakeReq("/a");
    const res1 = fakeRes();
    trackInFlight(r1, res1 as unknown as Response, noop);
    let passed = 0;
    guard(r1, res1 as unknown as Response, () => passed++);
    expect(passed).toBe(1);

    const r2 = fakeReq("/a");
    const res2 = fakeRes();
    trackInFlight(r2, res2 as unknown as Response, noop);
    guard(r2, res2 as unknown as Response, () => passed++);
    expect(passed).toBe(1);
    expect(res2.statusCode).toBe(503);
    expect((res2.body as { code: string }).code).toBe(SERVER_BUSY_CODE);
    expect(res2.headers["Retry-After"]).toBe("30");

    res1.emit("close");
    res2.emit("close");
    const r3 = fakeReq("/a");
    const res3 = fakeRes();
    trackInFlight(r3, res3 as unknown as Response, noop);
    guard(r3, res3 as unknown as Response, () => passed++);
    expect(passed).toBe(2);
    res3.emit("close");
    delete process.env.HEAVY_ROUTE_MAX_CONCURRENT;
    delete process.env.HEAVY_ROUTE_RSS_MB;
  });

  it("rào: RSS vượt trần → 503 dù chưa có request nặng nào", () => {
    process.env.HEAVY_ROUTE_RSS_MB = "1"; // 1 MB — tiến trình test chắc chắn vượt
    const guard = heavyRouteGuard("test-rss");
    const req = fakeReq("/b");
    const res = fakeRes();
    trackInFlight(req, res as unknown as Response, noop);
    let passed = 0;
    guard(req, res as unknown as Response, () => passed++);
    expect(passed).toBe(0);
    expect(res.statusCode).toBe(503);
    res.emit("close");
    delete process.env.HEAVY_ROUTE_RSS_MB;
  });
});

// Dòng [Đo request] (25/11/2026, docs/DONG-BO-GIAI-DOAN-3.md mục 8.7).
import { formatFinishedRequest, sampleInFlightRss } from "../request-ledger";

describe("request-ledger — dòng [Đo request]", () => {
  const base = {
    method: "GET",
    path: "/api/orders",
    status: 200,
    durationMs: 800,
    rssStartMb: 200,
    rssPeakMb: 205,
    rssEndMb: 204,
    ownerId: "owner1",
    channelId: undefined as string | undefined,
    concurrent: 3,
    heavy: null as string | null,
  };
  const th = { rssMb: 20, slowMs: 5000 };

  it("request nhanh, RSS gần như không đổi → không ghi", () => {
    expect(formatFinishedRequest(base, th)).toBeNull();
  });

  it("chạy lâu → ghi LÂU, kèm chủ shop + số cùng chạy", () => {
    const line = formatFinishedRequest({ ...base, durationMs: 11_200 }, th)!;
    expect(line).toContain("[Đo request] LÂU GET /api/orders 200 11.2s");
    expect(line).toContain("chủ shop owner1");
    expect(line).toContain("cùng chạy 3");
  });

  it("RSS tăng tới đỉnh rồi hạ vẫn tính theo đỉnh", () => {
    const line = formatFinishedRequest({ ...base, rssPeakMb: 260, rssEndMb: 230, channelId: "ch1" }, th)!;
    expect(line).toContain("[Đo request] RSS ");
    expect(line).toContain("RSS 200→260→230 MB (+60)");
    expect(line).toContain("gian ch1");
  });

  it("cả hai điều kiện → RSS+LÂU; ngưỡng 0 = tắt điều kiện đó", () => {
    const heavy = { ...base, rssPeakMb: 300, durationMs: 9000 };
    expect(formatFinishedRequest(heavy, th)).toContain("RSS+LÂU");
    expect(formatFinishedRequest(heavy, { rssMb: 0, slowMs: 0 })).toBeNull();
  });

  it("luồng SSE chuông không bao giờ ghi dù mở hàng giờ", () => {
    expect(formatFinishedRequest({ ...base, path: "/api/notifications/stream", durationMs: 3_600_000 }, th)).toBeNull();
  });

  it("sampleInFlightRss nâng đỉnh của request đang chạy, ghi ra khi request đóng", () => {
    const logs: string[] = [];
    const orig = console.log;
    console.log = (m: string) => logs.push(m);
    try {
      const res = fakeRes();
      trackInFlight(fakeReq("/api/do-thu-rss"), res as unknown as Response, noop);
      sampleInFlightRss(process.memoryUsage().rss + 300 * 1024 * 1024);
      res.emit("close");
    } finally {
      console.log = orig;
    }
    const line = logs.find((l) => l.includes("/api/do-thu-rss"));
    expect(line).toBeDefined();
    expect(line).toMatch(/\[Đo request\] RSS GET \/api\/do-thu-rss 200/);
  });
});

// Trần dòng [Đo request] mỗi phút — quy mô lớn, phần vượt không im lặng (25/11/2026).
import { admitLogLine } from "../request-ledger";

describe("request-ledger — trần dòng [Đo request]/phút", () => {
  it("quá trần thì bỏ, hết phút in một dòng tổng kèm dòng RSS tăng nhiều nhất", () => {
    process.env.REQUEST_LOG_MAX_PER_MIN = "3";
    const logs: string[] = [];
    const orig = console.log;
    console.log = (m: string) => logs.push(m);
    try {
      const t0 = 9_000_000_000_000; // mốc xa (sau Date.now()) để mở cửa sổ mới, không lẫn ca khác
      const admitted = [1, 2, 3, 4, 5, 6].map((i) =>
        admitLogLine(`[Đo request] LÂU GET /api/r${i} 200 6.0s RSS 1→${i * 10}→1 MB (+${i * 10})`, i * 10, t0 + i)
      );
      expect(admitted).toEqual([true, true, true, false, false, false]);
      expect(logs).toHaveLength(0);
      sampleInFlightRss(1, t0 + 61_000); // tick memory-watch sang phút mới
      expect(logs).toHaveLength(1);
      expect(logs[0]).toContain("bỏ qua 3 dòng trong phút trước (trần 3/phút)");
      expect(logs[0]).toContain("/api/r6"); // dòng tăng nhiều nhất (+60) không mất
      expect(admitLogLine("x", 0, t0 + 61_001)).toBe(true); // phút mới đếm lại
    } finally {
      console.log = orig;
      delete process.env.REQUEST_LOG_MAX_PER_MIN;
    }
  });
});
