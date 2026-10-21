// ============================================================
// GHI HIỆU SUẤT ADS THEO LÔ (checklist M2, 21/10/2026) — ads-perf-batch.ts
//
// Phần thuần (chạy mọi nơi): gộp dòng trùng khóa, dòng sau thắng; mảng rỗng
// không chạm DB.
// Phần DB (cần Postgres dev, tự skip): một câu INSERT … unnest … ON CONFLICT
// phải cho KẾT QUẢ Y HỆT upsert từng dòng cũ — tạo mới, đè đúng cột được ghi,
// KHÔNG đè cột sàn không trả (TikTok không có impression/clicks), Decimal giữ
// 2 số lẻ, lô > CHUNK chia nhiều câu vẫn đủ dòng.
// ============================================================
import "./load-env";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../lib/prisma";
import { dateKeyToDbDate } from "../../lib/ads-dates";
import { ADS_PERF_CHUNK, ADS_PERF_METRICS, dedupeAdsPerfRows, upsertAdsPerfBatch } from "../ads-perf-batch";
import { createStockFixture, type StockFixture } from "./fixtures";

const d = (key: string) => dateKeyToDbDate(key);

describe("ads-perf-batch — thuần", () => {
  it("gộp trùng khóa (chiến dịch, ngày): dòng SAU thắng, giữ thứ tự xuất hiện", () => {
    const out = dedupeAdsPerfRows([
      { adsCampaignId: "a", date: d("2026-10-01"), expense: 1 },
      { adsCampaignId: "b", date: d("2026-10-01"), expense: 2 },
      { adsCampaignId: "a", date: d("2026-10-01"), expense: 3 },
      { adsCampaignId: "a", date: d("2026-10-02"), expense: 4 },
    ]);
    expect(out.map((r) => [r.adsCampaignId, r.date.toISOString().slice(0, 10), r.expense])).toEqual([
      ["a", "2026-10-01", 3],
      ["b", "2026-10-01", 2],
      ["a", "2026-10-02", 4],
    ]);
  });

  it("mảng rỗng / không cột → trả 0, không gọi DB", async () => {
    const db = { $executeRaw: vi.fn() };
    expect(await upsertAdsPerfBatch([], ADS_PERF_METRICS, db as never)).toBe(0);
    expect(await upsertAdsPerfBatch([{ adsCampaignId: "a", date: d("2026-10-01") }], [], db as never)).toBe(0);
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });

  it("chia lô theo ADS_PERF_CHUNK: 2.001 dòng → 3 câu lệnh", async () => {
    const db = { $executeRaw: vi.fn().mockResolvedValue(1) };
    const rows = Array.from({ length: ADS_PERF_CHUNK * 2 + 1 }, (_, i) => ({
      adsCampaignId: `c${i}`,
      date: d("2026-10-01"),
      expense: i,
    }));
    expect(await upsertAdsPerfBatch(rows, ["expense"], db as never)).toBe(rows.length);
    expect(db.$executeRaw).toHaveBeenCalledTimes(3);
  });
});

const dbReady: boolean = await (async () => {
  try {
    const r = await prisma.$queryRaw<{ r: string | null }[]>`SELECT to_regclass('"AdsCampaignDailyPerf"')::text AS r`;
    return r[0]?.r != null;
  } catch {
    return false;
  }
})();

describe.skipIf(!dbReady)("ads-perf-batch — trên DB: kết quả y hệt upsert từng dòng", () => {
  let fx: StockFixture;
  let campA = "";
  let campB = "";

  beforeAll(async () => {
    fx = await createStockFixture("adsperfbatch");
    const mk = async (suffix: string) =>
      (
        await prisma.adsCampaign.create({
          data: { channelId: fx.channelId, campaignId: `TEST-${fx.suffix}-${suffix}`, name: `CD ${suffix}`, status: "ongoing" },
        })
      ).id;
    campA = await mk("A");
    campB = await mk("B");
  });
  afterAll(async () => {
    await fx.cleanup();
  });

  const read = async (id: string, key: string) =>
    prisma.adsCampaignDailyPerf.findUnique({ where: { adsCampaignId_date: { adsCampaignId: id, date: d(key) } } });

  it("tạo mới đủ cột Shopee, Decimal giữ 2 số lẻ, cột không ghi về mặc định 0", async () => {
    const n = await upsertAdsPerfBatch(
      [
        {
          adsCampaignId: campA,
          date: d("2026-10-01"),
          impression: 1000,
          clicks: 50,
          expense: 123456.78,
          broadOrder: 7,
          broadGmv: 2500000.5,
          directOrder: 5,
          directGmv: 1800000,
          broadOrderAmount: 9,
          directOrderAmount: 6,
        },
        { adsCampaignId: campB, date: d("2026-10-01"), expense: 10, broadOrder: 1, broadGmv: 20, directOrder: 1, directGmv: 20 },
      ],
      ADS_PERF_METRICS
    );
    expect(n).toBe(2);
    const a = await read(campA, "2026-10-01");
    expect(a).toMatchObject({ impression: 1000, clicks: 50, broadOrder: 7, directOrder: 5, broadOrderAmount: 9, directOrderAmount: 6 });
    expect(Number(a!.expense)).toBe(123456.78);
    expect(Number(a!.broadGmv)).toBe(2500000.5);
    expect(Number(a!.directGmv)).toBe(1800000);
    const b = await read(campB, "2026-10-01");
    expect(b).toMatchObject({ impression: 0, clicks: 0, broadOrder: 1, broadOrderAmount: 0 });
    expect(Number(b!.expense)).toBe(10);
  });

  it("đè đúng cột được ghi (TikTok 5 cột), impression/clicks cũ GIỮ NGUYÊN, updatedAt tiến", async () => {
    const before = await read(campA, "2026-10-01");
    await new Promise((r) => setTimeout(r, 20));
    const n = await upsertAdsPerfBatch(
      [{ adsCampaignId: campA, date: d("2026-10-01"), expense: 99.5, broadOrder: 2, broadGmv: 300, directOrder: 2, directGmv: 300 }],
      ["expense", "broadOrder", "broadGmv", "directOrder", "directGmv"]
    );
    expect(n).toBe(1);
    const after = await read(campA, "2026-10-01");
    expect(after!.id).toBe(before!.id); // cùng dòng, không tạo trùng
    expect(after).toMatchObject({ impression: 1000, clicks: 50, broadOrder: 2, directOrder: 2, broadOrderAmount: 9 });
    expect(Number(after!.expense)).toBe(99.5);
    expect(Number(after!.broadGmv)).toBe(300);
    expect(after!.updatedAt.getTime()).toBeGreaterThan(before!.updatedAt.getTime());
  });

  it("cùng khóa lặp trong một lô → dòng sau thắng, không lỗi 'affect row a second time'", async () => {
    const n = await upsertAdsPerfBatch(
      [
        { adsCampaignId: campB, date: d("2026-10-02"), expense: 1, broadOrder: 1, broadGmv: 1, directOrder: 1, directGmv: 1 },
        { adsCampaignId: campB, date: d("2026-10-02"), expense: 2, broadOrder: 2, broadGmv: 2, directOrder: 2, directGmv: 2 },
      ],
      ["expense", "broadOrder", "broadGmv", "directOrder", "directGmv"]
    );
    expect(n).toBe(1);
    const b = await read(campB, "2026-10-02");
    expect(Number(b!.expense)).toBe(2);
    expect(b!.broadOrder).toBe(2);
  });

  it("lô lớn hơn CHUNK vẫn ghi đủ dòng, mỗi ngày một dòng", async () => {
    const start = new Date(Date.UTC(2020, 0, 1));
    const rows = Array.from({ length: ADS_PERF_CHUNK + 5 }, (_, i) => ({
      adsCampaignId: campA,
      date: new Date(start.getTime() + i * 86_400_000),
      expense: i,
    }));
    expect(await upsertAdsPerfBatch(rows, ["expense"])).toBe(rows.length);
    const count = await prisma.adsCampaignDailyPerf.count({
      where: { adsCampaignId: campA, date: { gte: start, lt: new Date(start.getTime() + rows.length * 86_400_000) } },
    });
    expect(count).toBe(rows.length);
    const last = await prisma.adsCampaignDailyPerf.findUnique({
      where: { adsCampaignId_date: { adsCampaignId: campA, date: rows[rows.length - 1].date } },
    });
    expect(Number(last!.expense)).toBe(rows.length - 1);
  });
});
