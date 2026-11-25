// ============================================================
// Gợi ý chạy ads — LỊCH SỬ ADS THEO SẢN PHẨM cộng trong database (25/11/2026, docs/DONG-BO-GIAI-DOAN-3.md mục 8.13).
// Bản cũ nạp từng dòng số theo ngày của mọi chiến dịch có sản phẩm (gian lớn ~120 nghìn dòng / lượt, +187 MB RSS trên
// prod) rồi cộng bằng JS. Bản mới cộng bằng SQL, mỗi sản phẩm một dòng.
// Đối chứng: cùng gian giả, đường cũ (ADS_LOAD_ZERO_PERF_ROWS=1) và đường mới phải ra CÙNG tập sản phẩm, CÙNG tổng —
// kể cả sản phẩm có chiến dịch nhưng không có dòng số (phải có mặt với 0 / 0), chiến dịch nhiều sản phẩm (phải vắng),
// dấu phẩy thừa trong itemIds, số lẻ 2 chữ số, và ranh giới cửa sổ ngày.
// Tự dựng gian rồi xóa; không nối được DB → cả file tự BỎ QUA.
// ============================================================

import "./load-env";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { dateKeyToDbDate, vnDateKey } from "../../lib/ads-dates";
import { prisma } from "../../lib/prisma";
import { loadSingleItemAdsHistory } from "../shopee/ads-recommend-data";
import { createStockFixture, type StockFixture } from "./fixtures";

const dbReady: boolean = await (async () => {
  try {
    await prisma.$queryRaw`SELECT "itemIds" FROM "AdsCampaign" LIMIT 1`;
    await prisma.$queryRaw`SELECT "broadGmv" FROM "AdsCampaignDailyPerf" LIMIT 1`;
    return true;
  } catch {
    return false;
  }
})();

type Day = { daysAgo: number; expense?: number; broadGmv?: number; impression?: number };

describe.skipIf(!dbReady)("Gợi ý chạy ads — lịch sử theo sản phẩm: cộng ở database khớp đường cũ", () => {
  let fx: StockFixture;
  let other: StockFixture;

  async function addCampaign(channelId: string, name: string, itemIds: string, days: Day[]): Promise<void> {
    await prisma.adsCampaign.create({
      data: {
        channelId,
        campaignId: `TEST-${name}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        status: "ongoing",
        itemIds,
        dailyPerf: { create: days.map(({ daysAgo, ...m }) => ({ date: dateKeyToDbDate(vnDateKey(daysAgo)), ...m })) },
      },
    });
  }
  const span = (from: number, to: number, hits: Record<number, Omit<Day, "daysAgo">> = {}): Day[] =>
    Array.from({ length: from - to + 1 }, (_, i) => from - i).map((d) => ({ daysAgo: d, ...(hits[d] ?? {}) }));

  beforeAll(async () => {
    fx = await createStockFixture("adsrh");
    other = await createStockFixture("adsrh2");
    const ch = fx.channelId;
    // Một sản phẩm, số rải rác giữa nhiều ngày toàn 0, có số lẻ.
    await addCampaign(ch, "mot-sp", "111", span(40, 0, { 35: { expense: 99_999.99, broadGmv: 1 }, 12: { expense: 40_000.55, broadGmv: 90_000.1 }, 3: { expense: 8_000.2, broadGmv: 0.3 }, 0: { impression: 10 } }));
    // HAI chiến dịch cùng một sản phẩm → cộng dồn.
    await addCampaign(ch, "mot-sp-lan-2", "111", span(10, 0, { 5: { expense: 1_234.56, broadGmv: 6_543.21 } }));
    // Một sản phẩm, mọi dòng trong cửa sổ đều 0 → phải có mặt với 0 / 0.
    await addCampaign(ch, "toan-0", "222", span(20, 0));
    // Một sản phẩm, KHÔNG có dòng số nào → vẫn phải có mặt với 0 / 0.
    await addCampaign(ch, "khong-dong", "333", []);
    // Một sản phẩm, chỉ có số NGOÀI cửa sổ → có mặt với 0 / 0.
    await addCampaign(ch, "so-cu", "444", span(60, 45, { 50: { expense: 7_000, broadGmv: 21_000 } }));
    // Nhiều sản phẩm → không quy được về sản phẩm, phải vắng.
    await addCampaign(ch, "nhieu-sp", "555,556", span(5, 0, { 2: { expense: 5_000, broadGmv: 9_000 } }));
    // Dấu phẩy thừa: vẫn là đúng một sản phẩm.
    await addCampaign(ch, "phay-cuoi", "666,", span(5, 0, { 1: { expense: 300, broadGmv: 900 } }));
    await addCampaign(ch, "phay-dau", ",777", span(5, 0, { 4: { expense: 10.01, broadGmv: 20.02 } }));
    // Dấu phẩy thừa ở GIỮA: vẫn là hai sản phẩm.
    await addCampaign(ch, "phay-giua", "888,,889", span(3, 0, { 1: { expense: 1, broadGmv: 2 } }));
    // Chỉ có dấu phẩy / rỗng → không có sản phẩm nào.
    await addCampaign(ch, "chi-phay", ",", span(3, 0, { 1: { expense: 1, broadGmv: 2 } }));
    await addCampaign(ch, "rong", "", span(3, 0, { 1: { expense: 1, broadGmv: 2 } }));
    // Ranh giới cửa sổ: dòng đúng 29 / 30 / 31 ngày trước.
    await addCampaign(ch, "ranh-gioi", "999", [
      { daysAgo: 29, expense: 100, broadGmv: 1_000 },
      { daysAgo: 30, expense: 20, broadGmv: 200 },
      { daysAgo: 31, expense: 3, broadGmv: 30 },
    ]);
    // Gian của shop khác, cùng mã sản phẩm → không được lẫn.
    await addCampaign(other.channelId, "shop-khac", "111", span(5, 0, { 2: { expense: 777_777, broadGmv: 888_888 } }));
  });
  afterAll(async () => {
    delete process.env.ADS_LOAD_ZERO_PERF_ROWS;
    await fx?.cleanup();
    await other?.cleanup();
  });
  afterEach(() => {
    delete process.env.ADS_LOAD_ZERO_PERF_ROWS;
  });

  async function both(since: Date) {
    process.env.ADS_LOAD_ZERO_PERF_ROWS = "1";
    const oldWay = await loadSingleItemAdsHistory(fx.channelId, since);
    delete process.env.ADS_LOAD_ZERO_PERF_ROWS;
    const newWay = await loadSingleItemAdsHistory(fx.channelId, since);
    return { oldWay, newWay };
  }

  function expectSame(
    oldWay: Map<string, { spend: number; gmv: number }>,
    newWay: Map<string, { spend: number; gmv: number }>
  ) {
    expect([...newWay.keys()].sort()).toEqual([...oldWay.keys()].sort());
    for (const [item, o] of oldWay) {
      const n = newWay.get(item)!;
      // Đường cũ cộng số thực bằng JS, đường mới cộng số thập phân chính xác ở database → cho lệch dưới nửa xu.
      expect(n.spend, `tiền tiêu của ${item}`).toBeCloseTo(o.spend, 2);
      expect(n.gmv, `doanh số của ${item}`).toBeCloseTo(o.gmv, 2);
    }
  }

  it("cửa sổ 30 ngày: cùng tập sản phẩm, cùng tổng tiền tiêu + doanh số", async () => {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const { oldWay, newWay } = await both(since);
    expectSame(oldWay, newWay);
    // Chốt các ca có chủ đích (tránh "trùng vì cả hai cùng sai"):
    expect([...newWay.keys()].sort()).toEqual(["111", "222", "333", "444", "666", "777", "999"]);
    expect(newWay.get("111")!.spend).toBeCloseTo(40_000.55 + 8_000.2 + 1_234.56, 2); // bỏ dòng 35 ngày trước
    expect(newWay.get("111")!.gmv).toBeCloseTo(90_000.1 + 0.3 + 6_543.21, 2);
    for (const zero of ["222", "333", "444"]) expect(newWay.get(zero)).toEqual({ spend: 0, gmv: 0 });
    expect(newWay.get("666")).toEqual({ spend: 300, gmv: 900 });
    expect(newWay.has("555")).toBe(false);
    expect(newWay.has("888")).toBe(false);
  });

  it("ranh giới ngày: mọi mốc bắt đầu quanh 29–32 ngày trước, hai đường cắt cùng một chỗ", async () => {
    for (const hoursAgo of [29 * 24, 29 * 24 + 7, 30 * 24 - 1, 30 * 24, 30 * 24 + 1, 30 * 24 + 17, 31 * 24, 31 * 24 + 12, 32 * 24]) {
      const { oldWay, newWay } = await both(new Date(Date.now() - hoursAgo * 3_600_000));
      expectSame(oldWay, newWay);
    }
  });

  it("cửa sổ 90 ngày và cửa sổ tương lai (không dòng nào): vẫn khớp", async () => {
    const far = await both(new Date(Date.now() - 90 * 86_400_000));
    expectSame(far.oldWay, far.newWay);
    expect(far.newWay.get("444")).toEqual({ spend: 7_000, gmv: 21_000 });
    const none = await both(new Date(Date.now() + 5 * 86_400_000));
    expectSame(none.oldWay, none.newWay);
    expect(none.newWay.get("111")).toEqual({ spend: 0, gmv: 0 });
  });

  it("gian không có chiến dịch nào → bảng rỗng", async () => {
    const empty = await createStockFixture("adsrh3");
    try {
      expect((await loadSingleItemAdsHistory(empty.channelId, new Date(0))).size).toBe(0);
    } finally {
      await empty.cleanup();
    }
  });
});
