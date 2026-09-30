// ============================================================
// LƯỚI ĐỠ của biên lãi quảng cáo Shopee/Lazada (anh Trung chốt 30/09/2026):
// câu gom trong database lỗi → lượt đó tính bằng đường duyệt mảng đơn, khách vẫn
// thấy số, lỗi ghi log; gian đó nghỉ câu gom 5 phút rồi tự thử lại. Đường được
// chỉ định tường minh (công cụ đối chiếu) thì KHÔNG đỡ — lỗi phải lộ ra.
// Chạy trên DB dev với một gian tự dựng; câu gom bị thay bằng bản giả điều khiển được.
// ============================================================

import "./load-env";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ChannelName } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { createStockFixture, type StockFixture } from "./fixtures";

const sqlMode = vi.hoisted(() => ({ fail: false, calls: 0 }));
vi.mock("../../services/order-ledger", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../services/order-ledger")>();
  return {
    ...real,
    ledgerMarginByGroup: (...args: Parameters<typeof real.ledgerMarginByGroup>) => {
      sqlMode.calls += 1;
      if (sqlMode.fail) return Promise.reject(new Error("giả lập: database quá thời gian"));
      return real.ledgerMarginByGroup(...args);
    },
  };
});

import { ensureLedgerFresh } from "../../services/order-ledger";
import {
  MARGIN_SQL_FAILURE_COOLDOWN_MS,
  computeChannelAdsInsights,
  computeChannelProductBreakeven,
} from "../shopee/ads-insights";
import { computeChannelAdsRecommendations } from "../shopee/ads-recommend-data";

const ledgerReady: boolean = await (async () => {
  try {
    const r = await prisma.$queryRaw<{ r: string | null }[]>`SELECT to_regclass('order_line_ledger')::text AS r`;
    return r[0]?.r != null;
  } catch {
    return false;
  }
})();

describe.skipIf(!ledgerReady)("Quảng cáo Shopee/Lazada — lưới đỡ khi câu gom trong database lỗi", () => {
  let fx: StockFixture;
  const channel = () => ({ id: fx.channelId, userId: fx.userId, channelName: ChannelName.SHOPEE });

  beforeAll(async () => {
    vi.stubEnv("ADS_MARGIN_SOURCE", "");
    vi.stubEnv("LEDGER_REPORTS_SOURCE", "");
    fx = await createStockFixture("adsfallback");
    const sku = `TEST-${fx.suffix}-A`;
    await prisma.channelProduct.create({
      data: { channelId: fx.channelId, channelSku: sku, productName: "SP sàn test A", externalId: "100" },
    });
    await prisma.adsCampaign.create({
      data: { channelId: fx.channelId, campaignId: `TEST-${fx.suffix}`, status: "ongoing", itemIds: "100" },
    });
    for (let i = 1; i <= 6; i++) {
      await prisma.order.create({
        data: {
          channelId: fx.channelId,
          orderCode: `TEST-${fx.suffix}-O${i}`,
          customerName: "Khách test",
          itemCount: 1,
          items: { create: { channelSku: sku, productName: "Dòng A", quantity: 1, price: 100_000, costPriceAtSale: 40_000 } },
        },
      });
    }
    const fresh = await ensureLedgerFresh({ userId: fx.userId }, undefined, { maxInline: 1000 });
    expect(fresh.dirty).toBe(0);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await fx?.cleanup();
  });

  it("câu gom lỗi → ba phép tính vẫn ra số của đường rows, lỗi vào log; trong 5 phút không gọi lại câu gom; hết 5 phút tự thử lại", async () => {
    const viaRows = {
      insights: (await computeChannelAdsInsights(channel(), { marginSource: "rows" })).shop,
      breakeven: await computeChannelProductBreakeven(channel(), { marginSource: "rows" }),
      recommendations: await computeChannelAdsRecommendations(channel(), { marginSource: "rows" }),
    };
    expect(viaRows.insights.pnlOrders).toBe(6);

    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    sqlMode.fail = true;
    sqlMode.calls = 0;
    const t0 = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(t0);

    const insights = await computeChannelAdsInsights(channel());
    expect(sqlMode.calls).toBe(1);
    expect(insights.shop).toEqual(viaRows.insights);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toContain("[Ads-margin]");
    expect(String(log.mock.calls[0][0])).toContain(fx.channelId);

    // Còn trong thời gian nghỉ: đi thẳng đường rows, không chạm câu gom, không ghi log thêm.
    now.mockReturnValue(t0 + MARGIN_SQL_FAILURE_COOLDOWN_MS - 1);
    expect(await computeChannelProductBreakeven(channel())).toEqual(viaRows.breakeven);
    expect(await computeChannelAdsRecommendations(channel())).toEqual(viaRows.recommendations);
    expect(sqlMode.calls).toBe(1);
    expect(log).toHaveBeenCalledTimes(1);

    // Hết thời gian nghỉ, database đã hồi: thử lại câu gom và dùng kết quả của nó.
    sqlMode.fail = false;
    now.mockReturnValue(t0 + MARGIN_SQL_FAILURE_COOLDOWN_MS);
    const recovered = await computeChannelAdsInsights(channel());
    expect(sqlMode.calls).toBe(2);
    expect(recovered.shop.pnlOrders).toBe(6);
    expect(log).toHaveBeenCalledTimes(1);
    // Đã hồi thì lượt sau dùng kết quả nhớ đệm của câu gom, không nghỉ nữa.
    await computeChannelProductBreakeven(channel());
    expect(sqlMode.calls).toBe(2);
  });

  it("đường sql được chỉ định tường minh: lỗi ném ra nguyên vẹn, không lui về rows", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    // Bộ nhóm khác đi một chút để không trúng kết quả nhớ đệm của test trước.
    await prisma.adsCampaign.create({
      data: { channelId: fx.channelId, campaignId: `TEST-${fx.suffix}-2`, status: "ongoing", itemIds: "100" },
    });
    sqlMode.fail = true;
    await expect(computeChannelAdsInsights(channel(), { marginSource: "sql" })).rejects.toThrow(/giả lập/);
    expect(log).not.toHaveBeenCalled();
    sqlMode.fail = false;
  });
});
