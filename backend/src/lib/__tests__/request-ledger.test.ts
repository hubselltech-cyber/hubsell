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
