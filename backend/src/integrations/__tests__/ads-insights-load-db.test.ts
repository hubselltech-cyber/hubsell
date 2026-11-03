// ============================================================
// Trợ lý quảng cáo không nạp chiến dịch đã kết thúc mà không có số (sự cố 03/11/2026:
// gian 5.000 chiến dịch cũ + 131.162 dòng số toàn 0 làm web 512 MB chết mỗi lần mở trang).
// Chiến dịch còn hiệu lực hoặc có số vẫn phải được nạp đủ. Chạy trên DB dev với gian tự dựng.
// ============================================================

import "./load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChannelName } from "@prisma/client";
import { dateKeyToDbDate, vnDateKey } from "../../lib/ads-dates";
import { prisma } from "../../lib/prisma";
import { computeChannelAdsInsights } from "../shopee/ads-insights";
import { createStockFixture, type StockFixture } from "./fixtures";

const ledgerReady: boolean = await (async () => {
  try {
    const r = await prisma.$queryRaw<{ r: string | null }[]>`SELECT to_regclass('order_line_ledger')::text AS r`;
    return r[0]?.r != null;
  } catch {
    return false;
  }
})();

describe.skipIf(!ledgerReady)("Trợ lý quảng cáo — chiến dịch nào được nạp", () => {
  let fx: StockFixture;
  const channel = () => ({ id: fx.channelId, userId: fx.userId, channelName: ChannelName.SHOPEE });

  async function addCampaign(
    name: string,
    status: string,
    perf: { daysAgo: number; impression?: number; expense?: number; directGmv?: number }[] = []
  ): Promise<void> {
    await prisma.adsCampaign.create({
      data: {
        channelId: fx.channelId,
        campaignId: `TEST-${fx.suffix}-${name}`,
        name,
        status,
        dailyPerf: {
          create: perf.map(({ daysAgo, ...metrics }) => ({ date: dateKeyToDbDate(vnDateKey(daysAgo)), ...metrics })),
        },
      },
    });
  }

  beforeAll(async () => {
    fx = await createStockFixture("adsload");
    await addCampaign("chay", "ongoing");
    await addCampaign("tam-dung", "paused");
    await addCampaign("trong", "");
    await addCampaign("ket-thuc-co-tien", "ended", [{ daysAgo: 3, expense: 5_000 }]);
    await addCampaign("ket-thuc-co-hien-thi", "closed", [{ daysAgo: 3, impression: 10 }]);
    await addCampaign("ket-thuc-co-gmv", "ended", [{ daysAgo: 3, directGmv: 90_000 }]);
    await addCampaign("ket-thuc-toan-0", "ended", [{ daysAgo: 1 }, { daysAgo: 2 }]);
    await addCampaign("dong-khong-dong-so", "closed");
    await addCampaign("xoa-toan-0", "deleted", [{ daysAgo: 1 }]);
    await addCampaign("ket-thuc-so-cu", "ended", [{ daysAgo: 45, expense: 5_000 }]);
  });
  afterAll(async () => {
    await fx.cleanup();
  });

  const namesOf = async (perfFromKey?: string) =>
    (await computeChannelAdsInsights(channel(), { perfFromKey })).items.map((it) => it.row.name).sort();

  it("bỏ chiến dịch đã kết thúc toàn số 0, giữ chiến dịch còn hiệu lực hoặc có số", async () => {
    expect(await namesOf()).toEqual(
      ["chay", "ket-thuc-co-gmv", "ket-thuc-co-hien-thi", "ket-thuc-co-tien", "tam-dung", "trong"].sort()
    );
  });

  it("xem lùi xa hơn 30 ngày thì chiến dịch có số cũ hiện lại", async () => {
    expect(await namesOf(vnDateKey(60))).toContain("ket-thuc-so-cu");
  });
});
