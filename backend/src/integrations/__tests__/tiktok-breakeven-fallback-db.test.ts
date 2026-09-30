// ============================================================
// LƯỚI ĐỠ + BỘ ĐỆM của hòa vốn quảng cáo TikTok ở đường "sql"
// (docs/QUANG-CAO-GOM-TRONG-DATABASE.md mục 12):
//   · câu gom trong database lỗi → lượt đó tính bằng đường duyệt mảng đơn, khách
//     vẫn thấy số, lỗi ghi log; gian đó nghỉ câu gom 5 phút rồi tự thử lại;
//   · đường được chỉ định tường minh (công cụ đối chiếu) thì KHÔNG đỡ;
//   · hòa vốn chiến dịch và tab Hòa vốn sản phẩm dùng chung MỘT lượt gom; kết
//     quả gom nhớ 30 phút (ADS_PNL_CACHE_MIN); nhập giá vốn xóa bộ đệm của gian.
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
    ledgerTiktokBreakevenByGroup: (...args: Parameters<typeof real.ledgerTiktokBreakevenByGroup>) => {
      sqlMode.calls += 1;
      if (sqlMode.fail) return Promise.reject(new Error("giả lập: database quá thời gian"));
      return real.ledgerTiktokBreakevenByGroup(...args);
    },
  };
});

import { invalidateCostCaches } from "../../lib/cost-cache-invalidation";
import { ensureLedgerFresh } from "../../services/order-ledger";
import { BREAKEVEN_MIN_COVERAGE_PCT } from "../tiktok-ads/auto-rules";
import { computeTiktokAdsBreakevenUncached, computeTiktokProductBreakevensUncached } from "../tiktok-ads/breakeven";
import { BREAKEVEN_SQL_FAILURE_COOLDOWN_MS } from "../tiktok-ads/breakeven-source";

const ledgerReady: boolean = await (async () => {
  try {
    const r = await prisma.$queryRaw<{ r: string | null }[]>`SELECT to_regclass('order_line_ledger')::text AS r`;
    return r[0]?.r != null;
  } catch {
    return false;
  }
})();

describe.skipIf(!ledgerReady)("Quảng cáo TikTok — lưới đỡ và bộ đệm của đường gom trong database", () => {
  let fx: StockFixture;
  const channel = () => ({ id: fx.channelId, userId: fx.userId });

  beforeAll(async () => {
    vi.stubEnv("TIKTOK_BREAKEVEN_SOURCE", "");
    vi.stubEnv("LEDGER_REPORTS_SOURCE", "");
    expect(process.env.ADS_PNL_CACHE_MIN ?? "30", "test giả định thời hạn đệm mặc định 30 phút").toBe("30");
    fx = await createStockFixture("ttfallback");
    await prisma.channel.update({ where: { id: fx.channelId }, data: { channelName: ChannelName.TIKTOK } });
    const sku = `TEST-${fx.suffix}-A`;
    await prisma.channelProduct.create({
      data: { channelId: fx.channelId, channelSku: sku, productName: "SP sàn test A", externalId: "100-1" },
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
          createdAt: new Date(Date.now() - (20 + i) * 86_400_000),
          shippingStatus: "DELIVERED",
          isSettled: true,
          items: { create: { channelSku: sku, productName: "Dòng A", quantity: 1, price: 100_000, costPriceAtSale: 40_000 } },
          tiktokSettlement: { create: { estimated: false, feeGmvMax: -5_000 } },
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

  it("câu gom lỗi → hai phép tính vẫn ra số của đường rows, lỗi vào log; trong 5 phút không gọi lại câu gom; hết 5 phút tự thử lại; hai phép tính chung một lượt gom", async () => {
    const viaRows = {
      campaigns: await computeTiktokAdsBreakevenUncached(channel(), { source: "rows" }),
      products: await computeTiktokProductBreakevensUncached(channel(), BREAKEVEN_MIN_COVERAGE_PCT, { source: "rows" }),
    };
    expect(viaRows.campaigns.shop.orders).toBe(6);
    expect(viaRows.products.products.map((p) => p.productId)).toEqual(["100"]);

    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    sqlMode.fail = true;
    sqlMode.calls = 0;
    const t0 = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(t0);

    const campaigns = await computeTiktokAdsBreakevenUncached(channel());
    expect(sqlMode.calls).toBe(1);
    expect(campaigns).toEqual(viaRows.campaigns);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toContain("[Tiktok-breakeven]");
    expect(String(log.mock.calls[0][0])).toContain(fx.channelId);

    // Còn trong thời gian nghỉ: đi thẳng đường rows, không chạm câu gom, không ghi log thêm.
    now.mockReturnValue(t0 + BREAKEVEN_SQL_FAILURE_COOLDOWN_MS - 1);
    expect(await computeTiktokProductBreakevensUncached(channel(), BREAKEVEN_MIN_COVERAGE_PCT)).toEqual(viaRows.products);
    expect(sqlMode.calls).toBe(1);
    expect(log).toHaveBeenCalledTimes(1);

    // Hết thời gian nghỉ, database đã hồi: thử lại câu gom và dùng kết quả của nó.
    sqlMode.fail = false;
    now.mockReturnValue(t0 + BREAKEVEN_SQL_FAILURE_COOLDOWN_MS);
    const recovered = await computeTiktokAdsBreakevenUncached(channel());
    expect(sqlMode.calls).toBe(2);
    expect(recovered.shop.orders).toBe(6);
    expect(log).toHaveBeenCalledTimes(1);
    // Tab Hòa vốn sản phẩm mở ngay sau đó dùng chung lượt gom vừa rồi.
    const products = await computeTiktokProductBreakevensUncached(channel(), BREAKEVEN_MIN_COVERAGE_PCT);
    expect(sqlMode.calls).toBe(2);
    expect(products.products.map((p) => p.productId)).toEqual(["100"]);

    // Kết quả gom nhớ 30 phút: sát 30 phút vẫn dùng lại, đủ 30 phút thì gom lại.
    const gomAt = t0 + BREAKEVEN_SQL_FAILURE_COOLDOWN_MS;
    now.mockReturnValue(gomAt + 30 * 60_000 - 1);
    await computeTiktokAdsBreakevenUncached(channel());
    expect(sqlMode.calls).toBe(2);
    now.mockReturnValue(gomAt + 30 * 60_000);
    await computeTiktokAdsBreakevenUncached(channel());
    expect(sqlMode.calls).toBe(3);

    // Nhập giá vốn → bộ đệm của gian bị xóa → lượt sau gom lại ngay.
    invalidateCostCaches([fx.channelId]);
    await computeTiktokAdsBreakevenUncached(channel());
    expect(sqlMode.calls).toBe(4);
  });

  it("đường sql được chỉ định tường minh: lỗi ném ra nguyên vẹn, không lui về rows", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    invalidateCostCaches([fx.channelId]); // không trúng kết quả nhớ đệm của test trước
    sqlMode.fail = true;
    await expect(computeTiktokAdsBreakevenUncached(channel(), { source: "sql" })).rejects.toThrow(/giả lập/);
    expect(log).not.toHaveBeenCalled();
    sqlMode.fail = false;
  });
});
