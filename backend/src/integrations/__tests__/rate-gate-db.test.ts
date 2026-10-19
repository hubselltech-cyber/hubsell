// ============================================================
// HÀM SQL CỔNG GỌI SÀN (api_rate_take / api_rate_penalize) trên DB dev — cùng
// công thức với lib/rate-gate.ts; thêm điều RAM không kiểm được: nhiều kết nối
// tranh cùng khóa vẫn đúng trần. Chưa áp migration 20261019110000_api_rate_keys
// → tự BỎ QUA.
// ============================================================

import "./load-env";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { pgRateStore } from "../../services/marketplace-gateway";

const P = `TEST-rate-${Date.now()}`;

const ready: boolean = await (async () => {
  try {
    const r = await prisma.$queryRaw<{ r: string | null }[]>`SELECT to_regprocedure('api_rate_take(text[],double precision[],integer[],integer,double precision)')::text AS r`;
    return r[0]?.r != null;
  } catch {
    return false;
  }
})();
if (!ready) console.log("[rate-gate-db.test] BỎ QUA: DB dev chưa có hàm api_rate_take");

describe.skipIf(!ready)("cổng gọi sàn — hàm SQL", () => {
  afterAll(async () => {
    await prisma.apiRateKey.deleteMany({ where: { key: { startsWith: P } } });
  });

  it("1 lượt/giây dồn 2: hai lượt qua, lượt ba phải chờ ≤ 1 s", async () => {
    const lim = [{ key: `${P}:a`, emissionMs: 1000, burst: 2 }];
    const w = [];
    for (let i = 0; i < 3; i++) w.push((await pgRateStore.take(lim, 1)).waitMs);
    expect(w[0]).toBe(0);
    expect(w[1]).toBe(0);
    expect(w[2]).toBeGreaterThan(0);
    expect(w[2]).toBeLessThanOrEqual(1000);
  });

  it("tất cả hoặc không: khóa chặt chặn thì khóa lỏng không bị trừ", async () => {
    const loose = { key: `${P}:loose`, emissionMs: 100, burst: 10 };
    const tight = { key: `${P}:tight`, emissionMs: 60_000, burst: 1 };
    expect((await pgRateStore.take([loose, tight], 1)).waitMs).toBe(0);
    const before = (await prisma.apiRateKey.findUnique({ where: { key: loose.key } }))!.tatMs;
    expect((await pgRateStore.take([loose, tight], 1)).waitMs).toBeGreaterThan(50_000);
    const after = (await prisma.apiRateKey.findUnique({ where: { key: loose.key } }))!.tatMs;
    expect(after).toBe(before);
  });

  it("20 kết nối tranh cùng khóa dồn 5 → đúng 5 lượt qua", async () => {
    const lim = [{ key: `${P}:race`, emissionMs: 600_000, burst: 5 }];
    const res = await Promise.all(Array.from({ length: 20 }, () => pgRateStore.take(lim, 1)));
    expect(res.filter((r) => r.waitMs === 0)).toHaveLength(5);
  });

  it("lùi: đếm lỗi, mốc lùi chặn lượt sau, khóa không trần chỉ đọc; thành công xóa đếm", async () => {
    const key = `${P}:shop`;
    const now = Date.now();
    const until = await pgRateStore.penalize(key, { baseMs: 5_000, capMs: 60_000, jitter: false }, null, "429 giả");
    expect(until).toBeGreaterThanOrEqual(now + 4_000);
    expect(until).toBeLessThanOrEqual(now + 6_000);
    const t = await pgRateStore.take([{ key, emissionMs: 0, burst: 1 }], 1);
    expect(t.waitMs).toBeGreaterThan(3_000);
    expect(t.failedKeys).toEqual([key]);
    const second = await pgRateStore.penalize(key, { baseMs: 5_000, capMs: 60_000, jitter: false }, 30_000, "429 giả");
    expect(second).toBeGreaterThanOrEqual(now + 29_000); // Retry-After 30 s thắng 10 s
    await pgRateStore.reset([key]);
    const row = await prisma.apiRateKey.findUnique({ where: { key } });
    expect(row!.failures).toBe(0);
    expect(row!.hits).toBe(2);
  });

  it("AIMD: hạ nhịp một nửa, lần hạ kế không dưới sàn", async () => {
    const key = `${P}:ep`;
    const rule = { baseMs: 1, capMs: 1, jitter: true, decrease: true, minFactor: 0.3 };
    await pgRateStore.penalize(key, rule, null, "x");
    expect((await prisma.apiRateKey.findUnique({ where: { key } }))!.factor).toBeCloseTo(0.5, 3);
    await pgRateStore.penalize(key, rule, null, "x");
    expect((await prisma.apiRateKey.findUnique({ where: { key } }))!.factor).toBeCloseTo(0.3, 3);
  });
});
