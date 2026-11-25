// ============================================================
// Trợ lý quảng cáo chỉ nạp dòng số KHÁC 0 (25/11/2026, docs/DONG-BO-GIAI-DOAN-3.md mục 8): gian 3.946 chiến dịch, 98 % dòng
// toàn 0, mỗi lượt mở trang Quảng cáo nạp ~30 nghìn dòng → RSS web lên 461 MB, trang Giá vốn bị rào chặn lây.
// Đối chứng: cùng gian giả, đường cũ (ADS_LOAD_ZERO_PERF_ROWS=1, nạp mọi dòng) và đường mới phải cho KẾT QUẢ TRÙNG
// (cửa sổ, verdict, hòa vốn, tự kiểm Lát 4, so nấc hạ, ngày biểu đồ) — chỉ khác số dòng nằm trong row.dailyPerf.
// Chạy trên DB dev với gian tự dựng.
// ============================================================

import "./load-env";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ChannelName } from "@prisma/client";
import { dateKey, dateKeyToDbDate, vnDateKey } from "../../lib/ads-dates";
import { prisma } from "../../lib/prisma";
import { computeChannelAdsInsights, type ChannelAdsInsights } from "../shopee/ads-insights";
import { createStockFixture, type StockFixture } from "./fixtures";

const ledgerReady: boolean = await (async () => {
  try {
    const r = await prisma.$queryRaw<{ r: string | null }[]>`SELECT to_regclass('order_line_ledger')::text AS r`;
    return r[0]?.r != null;
  } catch {
    return false;
  }
})();

type Day = { daysAgo: number; impression?: number; clicks?: number; expense?: number; broadGmv?: number; directGmv?: number; broadOrder?: number };

describe.skipIf(!ledgerReady)("Trợ lý quảng cáo — nạp dòng khác 0 cho kết quả trùng đường cũ", () => {
  let fx: StockFixture;
  const channel = () => ({ id: fx.channelId, userId: fx.userId, channelName: ChannelName.SHOPEE });

  async function addCampaign(
    name: string,
    status: string,
    days: Day[],
    extra: { itemIds?: string; roasTarget?: number; roasTargetPrev?: number; changedDaysAgo?: number } = {}
  ): Promise<void> {
    await prisma.adsCampaign.create({
      data: {
        channelId: fx.channelId,
        campaignId: `TEST-${fx.suffix}-${name}`,
        name,
        status,
        itemIds: extra.itemIds ?? "",
        roasTarget: extra.roasTarget ?? null,
        roasTargetPrev: extra.roasTargetPrev ?? null,
        roasTargetChangedAt: extra.changedDaysAgo != null ? new Date(Date.now() - extra.changedDaysAgo * 86_400_000) : null,
        dailyPerf: {
          create: days.map(({ daysAgo, ...m }) => ({ date: dateKeyToDbDate(vnDateKey(daysAgo)), ...m })),
        },
      },
    });
  }

  /** n ngày liên tiếp từ `from` ngày trước, mặc định toàn 0, `hits` là các ngày có số. */
  const span = (from: number, to: number, hits: Record<number, Omit<Day, "daysAgo">> = {}): Day[] =>
    Array.from({ length: from - to + 1 }, (_, i) => from - i).map((d) => ({ daysAgo: d, ...(hits[d] ?? {}) }));

  beforeAll(async () => {
    fx = await createStockFixture("adsnz");
    // Chạy: số rải rác giữa 30 ngày toàn 0; ngày đầu có dòng (29 ngày trước) là dòng 0 → mốc tự kiểm phải giữ nguyên.
    await addCampaign("chay-thua", "ongoing", span(29, 0, { 12: { expense: 40_000, clicks: 9, broadGmv: 90_000, directGmv: 50_000, broadOrder: 1 }, 3: { impression: 500, expense: 8_000 } }), { itemIds: "111" });
    // Vừa HẠ mục tiêu 5 ngày trước, có số cả trước lẫn sau → so nấc hạ đếm ngày, xen ngày 0.
    await addCampaign(
      "ha-nac",
      "ongoing",
      span(20, 0, { 9: { expense: 30_000, broadGmv: 120_000 }, 6: { expense: 25_000, broadGmv: 70_000 }, 3: { expense: 20_000, broadGmv: 90_000 }, 1: { expense: 15_000, broadGmv: 40_000 } }),
      { itemIds: "222", roasTarget: 4, roasTargetPrev: 5, changedDaysAgo: 5 }
    );
    // Đã kết thúc nhưng có số trong khoảng → được nạp; toàn bộ dòng của nó trong 2 ngày cuối là 0.
    await addCampaign("ket-thuc-co-so", "ended", span(15, 0, { 15: { directGmv: 30_000, expense: 5_000 } }), { itemIds: "333" });
    // Tạm dừng, toàn 0 → vẫn nạp (còn hiệu lực) nhưng không có dòng khác 0 nào; ngày 25 chỉ chiến dịch này có dòng.
    await addCampaign("tam-dung-toan-0", "paused", span(25, 0), { itemIds: "444" });
    // Không có itemIds → không vào tự kiểm.
    await addCampaign("khong-sp", "ongoing", span(10, 0, { 2: { expense: 1_000 } }));
    // Số cũ hơn 30 ngày: chỉ hiện khi xem lùi xa.
    await addCampaign("so-cu", "ended", span(60, 40, { 50: { expense: 7_000, broadGmv: 21_000 } }), { itemIds: "555" });
  });
  afterAll(async () => {
    delete process.env.ADS_LOAD_ZERO_PERF_ROWS;
    await fx.cleanup();
  });
  afterEach(() => {
    delete process.env.ADS_LOAD_ZERO_PERF_ROWS;
  });

  /** Kết quả bỏ đúng phần được phép khác (số dòng trong row.dailyPerf), thay bằng tổng cộng dồn của nó. */
  function comparable(r: ChannelAdsInsights) {
    return {
      shop: r.shop,
      perfDays: r.perfDays,
      items: r.items
        .map((it) => {
          const { dailyPerf, ...row } = it.row;
          const sums = dailyPerf.reduce(
            (a, p) => ({
              expense: a.expense + Number(p.expense),
              broadGmv: a.broadGmv + Number(p.broadGmv),
              directGmv: a.directGmv + Number(p.directGmv),
              impression: a.impression + p.impression,
              clicks: a.clicks + p.clicks,
              broadOrder: a.broadOrder + p.broadOrder,
            }),
            { expense: 0, broadGmv: 0, directGmv: 0, impression: 0, clicks: 0, broadOrder: 0 }
          );
          return { ...it, row: { ...row, sums } };
        })
        .sort((a, b) => a.row.name.localeCompare(b.row.name)),
    };
  }

  async function both(perfFromKey?: string) {
    process.env.ADS_LOAD_ZERO_PERF_ROWS = "1";
    const oldWay = await computeChannelAdsInsights(channel(), { perfFromKey });
    delete process.env.ADS_LOAD_ZERO_PERF_ROWS;
    const newWay = await computeChannelAdsInsights(channel(), { perfFromKey });
    return { oldWay, newWay };
  }

  it("30 ngày mặc định: mọi con số, verdict, tự kiểm, ngày biểu đồ trùng đường cũ", async () => {
    const { oldWay, newWay } = await both();
    expect(JSON.parse(JSON.stringify(comparable(newWay)))).toEqual(JSON.parse(JSON.stringify(comparable(oldWay))));
    // Mốc tự kiểm của "chay-thua" là ngày có dòng 0 (29 ngày trước), không phải ngày đầu có số.
    const chay = newWay.items.find((it) => it.row.name === "chay-thua")!;
    expect(chay.check?.from).toBe(vnDateKey(29));
    // Ngày chỉ có dòng 0 vẫn nằm trong ngày biểu đồ.
    expect(newWay.perfDays).toContain(vnDateKey(25));
  });

  it("xem lùi 60 ngày: vẫn trùng", async () => {
    const { oldWay, newWay } = await both(vnDateKey(60));
    expect(JSON.parse(JSON.stringify(comparable(newWay)))).toEqual(JSON.parse(JSON.stringify(comparable(oldWay))));
  });

  it("nạp ít dòng hơn thật: chiến dịch thường chỉ còn dòng khác 0, chiến dịch vừa hạ nấc giữ đủ ngày", async () => {
    const { oldWay, newWay } = await both();
    const rows = (r: ChannelAdsInsights) => r.items.reduce((s, it) => s + it.row.dailyPerf.length, 0);
    expect(rows(newWay)).toBeLessThan(rows(oldWay) / 2);
    const lenOf = (r: ChannelAdsInsights, name: string) => r.items.find((it) => it.row.name === name)!.row.dailyPerf.length;
    expect(lenOf(newWay, "chay-thua")).toBe(2);
    expect(lenOf(newWay, "tam-dung-toan-0")).toBe(0);
    expect(lenOf(newWay, "ha-nac")).toBe(lenOf(oldWay, "ha-nac"));
    expect(newWay.items.find((it) => it.row.name === "ha-nac")!.row.dailyPerf.every((p) => dateKey(p.date) <= vnDateKey(0))).toBe(true);
  });

  it("hai lượt cùng lúc cùng gian dùng chung một lần tính; lượt sau khi xong tính lại", async () => {
    const spy = vi.spyOn(prisma.adsCampaign, "findMany");
    const [a, b] = await Promise.all([computeChannelAdsInsights(channel()), computeChannelAdsInsights(channel())]);
    expect(a).toBe(b);
    expect(spy).toHaveBeenCalledTimes(1);
    const c = await computeChannelAdsInsights(channel());
    expect(c).not.toBe(a);
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});
