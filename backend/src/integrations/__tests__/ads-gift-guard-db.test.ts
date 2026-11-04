// ============================================================
// LỚP 2 (05/11/2026): đơn có giá vốn quà cao hơn doanh thu đơn đứng ngoài biên lãi, đường SQL phải bằng đường duyệt mảng,
// cho cả TikTok lẫn Shopee. Dựng theo ca thật Hellokityhh: đơn kèm quà 0 đ mang giá vốn lớn làm hòa vốn thành "Lỗ sẵn".
// (docs/TAI-CHINH-GIA-VON-0-ROI-ROAS-KHAO-SAT-02-11.md mục 12). Chưa áp migration sổ cái → BỎ QUA.
// ============================================================

import "./load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChannelName, ShippingStatus } from "@prisma/client";
import {
  SHOP_GROUP,
  campaignGroupKey,
  itemKey,
  marginBaseFromSums,
  marginOverRows,
  marginWindowRange,
  pnlRowsForMargin,
  type AdsGroupSets,
} from "../../lib/ads-margin";
import { prisma } from "../../lib/prisma";
import { tiktokBreakevenBase, tiktokMarginWindowRange, toTiktokBreakeven } from "../../lib/tiktok-breakeven";
import { ensureLedgerFresh, ledgerMarginByGroup, ledgerTiktokBreakevenByGroup } from "../../services/order-ledger";
import { loadMarginRows } from "../shopee/ads-margin-source";
import { loadBreakevenRows } from "../tiktok-ads/breakeven-source";
import { createStockFixture, type StockFixture } from "./fixtures";

const ledgerReady: boolean = await (async () => {
  try {
    const r = await prisma.$queryRaw<{ r: string | null }[]>`SELECT to_regclass('order_line_ledger')::text AS r`;
    return r[0]?.r != null;
  } catch {
    return false;
  }
})();

type Line = { sku: string; price: number; cost: number; quantity?: number; externalId?: string };

async function makeOrder(fx: StockFixture, code: string, lines: Line[], data: { settled?: boolean; cancelled?: boolean; daysAgo: number }) {
  return prisma.order.create({
    data: {
      channelId: fx.channelId,
      orderCode: `TEST-${fx.suffix}-${code}`,
      customerName: "Khách test",
      itemCount: lines.length,
      createdAt: new Date(Date.now() - data.daysAgo * 86_400_000),
      shippingStatus: data.cancelled ? ShippingStatus.CANCELLED : ShippingStatus.DELIVERED,
      isSettled: data.settled ?? false,
      items: {
        create: lines.map((l) => ({
          channelSku: `TEST-${fx.suffix}-${l.sku}`,
          externalId: l.externalId ?? null,
          productName: `Dòng ${l.sku}`,
          quantity: l.quantity ?? 1,
          price: l.price,
          costPriceAtSale: l.cost,
        })),
      },
      ...(data.settled ? { tiktokSettlement: { create: { estimated: false, feeGmvMax: 0 } } } : {}),
    },
  });
}

const sold = { sku: "A", price: 100_000, cost: 30_000, externalId: "100-1" };
const sold2 = { sku: "A2", price: 50_000, cost: 10_000, externalId: "100-2" };
const hugeGift = { sku: "Q", price: 0, cost: 730_000, externalId: "200-1" };
const smallGift = { sku: "Q2", price: 0, cost: 1, externalId: "200-2" };
const unlinkedSold = { sku: "A3", price: 40_000, cost: 10_000 };

describe.skipIf(!ledgerReady)("Đơn quà bất thường: SQL = duyệt mảng, TikTok", () => {
  let fx: StockFixture;
  const sets = (): AdsGroupSets => new Map([[campaignGroupKey("c1"), new Set([itemKey("100")])]]);
  const mapping = { groups: [campaignGroupKey("c1")], keys: [itemKey("100")] };

  beforeAll(async () => {
    fx = await createStockFixture("giftguardtt");
    await prisma.channel.update({ where: { id: fx.channelId }, data: { channelName: ChannelName.TIKTOK } });
    await makeOrder(fx, "OK1", [sold], { settled: true, daysAgo: 20 });
    await makeOrder(fx, "OK2", [sold, smallGift], { settled: true, daysAgo: 19 }); // quà 1 đ: vẫn tính
    await makeOrder(fx, "BAD1", [sold, hugeGift], { settled: true, daysAgo: 18 });
    await makeOrder(fx, "BAD2", [sold, sold2, hugeGift], { settled: true, daysAgo: 17 }); // hai dòng có giá, đếm một đơn
    await makeOrder(fx, "BAD3", [sold, unlinkedSold, hugeGift], { settled: true, daysAgo: 16 }); // dòng chưa id sang unlinkedRevenue
    await makeOrder(fx, "BADX", [sold, hugeGift], { cancelled: true, daysAgo: 21 }); // hủy cùng lứa
    await makeOrder(fx, "BADP", [sold, hugeGift], { daysAgo: 5 }); // chưa có kết cục: chờ, không phải bất thường
    await makeOrder(fx, "BOTH", [{ ...sold, cost: 0 }, hugeGift], { settled: true, daysAgo: 15 }); // thiếu giá vốn thắng
    expect((await ensureLedgerFresh({ userId: fx.userId }, undefined, { maxInline: 1000 })).dirty).toBe(0);
  });
  afterAll(async () => {
    await fx?.cleanup();
  });

  it("số kỳ vọng theo cách dựng, biên lãi không bị quà làm âm", async () => {
    const range = tiktokMarginWindowRange();
    const scope = { userId: fx.userId, id: fx.channelId, channelName: ChannelName.TIKTOK };
    const g = await ledgerTiktokBreakevenByGroup(scope, range, mapping, { paceNow: new Date() });
    const shop = g.get(SHOP_GROUP)!;
    expect(shop.settledOrders).toBe(2); // OK1, OK2
    expect(shop.suspectGiftOrders).toBe(4); // BAD1, BAD2, BAD3, BADX
    expect(shop.pendingOrders).toBe(1); // BADP
    expect(shop.revenue).toBeCloseTo(200_000, 2);
    expect(shop.suspectGiftRevenue).toBeCloseTo(100_000 + 150_000 + 140_000 + 100_000, 2);
    expect(toTiktokBreakeven(shop, "shop").negativeMargin).toBe(false);
    expect(toTiktokBreakeven(shop, "shop").suspectGiftOrders).toBe(4);
  });

  it("đường SQL bằng đường duyệt mảng ở nhóm toàn gian và nhóm chiến dịch", async () => {
    const range = tiktokMarginWindowRange();
    const scope = { userId: fx.userId, id: fx.channelId, channelName: ChannelName.TIKTOK };
    const rows = await loadBreakevenRows({ id: fx.channelId, userId: fx.userId }, range);
    const g = await ledgerTiktokBreakevenByGroup(scope, range, mapping, { paceNow: new Date() });
    const pairs = [
      [g.get(SHOP_GROUP)!, tiktokBreakevenBase(rows, null)],
      [g.get(campaignGroupKey("c1"))!, tiktokBreakevenBase(rows, sets().get(campaignGroupKey("c1"))!)],
    ] as const;
    for (const [sql, pure] of pairs) {
      for (const k of ["settledOrders", "cancelledOrders", "pendingOrders", "suspectGiftOrders"] as const) expect(sql[k], k).toBe(pure[k]);
      for (const k of ["revenue", "profitBeforeAds", "missingCostRevenue", "unlinkedRevenue", "suspectGiftRevenue"] as const) {
        expect(sql[k], k).toBeCloseTo(pure[k], 1);
      }
    }
    const camp = g.get(campaignGroupKey("c1"))!;
    expect(camp.suspectGiftOrders).toBe(4);
    expect(camp.unlinkedRevenue).toBeCloseTo(0, 2); // nhóm chỉ có khóa id → dòng chưa id của BAD3 không khớp
  });
});

describe.skipIf(!ledgerReady)("Đơn quà bất thường: SQL = duyệt mảng, Shopee", () => {
  let fx: StockFixture;

  beforeAll(async () => {
    fx = await createStockFixture("giftguardsp");
    await prisma.channel.update({ where: { id: fx.channelId }, data: { channelName: ChannelName.SHOPEE } });
    await makeOrder(fx, "OK1", [sold], { daysAgo: 10 });
    await makeOrder(fx, "OK2", [sold, smallGift], { daysAgo: 9 });
    await makeOrder(fx, "BAD1", [sold, hugeGift], { daysAgo: 8 });
    await makeOrder(fx, "BAD2", [sold, sold2, hugeGift], { daysAgo: 7 });
    await makeOrder(fx, "BADX", [sold, hugeGift], { cancelled: true, daysAgo: 6 }); // hủy: Shopee bỏ hẳn khỏi biên lãi
    expect((await ensureLedgerFresh({ userId: fx.userId }, undefined, { maxInline: 1000 })).dirty).toBe(0);
  });
  afterAll(async () => {
    await fx?.cleanup();
  });

  it("đường SQL bằng đường duyệt mảng, đếm đúng và độ phủ dưới 90 %", async () => {
    const range = marginWindowRange();
    const channel = { id: fx.channelId, userId: fx.userId, channelName: ChannelName.SHOPEE };
    const scope = { userId: fx.userId, id: fx.channelId, channelName: ChannelName.SHOPEE };
    const rows = pnlRowsForMargin(await loadMarginRows(channel, range), ChannelName.SHOPEE);
    const pure = marginOverRows(rows, null);
    const g = await ledgerMarginByGroup(scope, range, { groups: [], keys: [] }, { settledOnly: false, recentSince: new Date(range.lte.getTime() - 7 * 86_400_000) });
    const sql = marginBaseFromSums(g.get(SHOP_GROUP)!);
    expect(sql.orders).toBe(2);
    expect(sql.suspectGiftOrders).toBe(2);
    expect(sql.orders).toBe(pure.orders);
    expect(sql.suspectGiftOrders).toBe(pure.suspectGiftOrders);
    expect(sql.revenue).toBeCloseTo(pure.revenue, 1);
    expect(sql.profit).toBeCloseTo(pure.profit, 1);
    expect(sql.suspectGiftRevenue).toBeCloseTo(pure.suspectGiftRevenue, 1);
    expect(sql.costCoveragePct).toBe(pure.costCoveragePct);
    expect(sql.costCoveragePct).toBeLessThan(90);
  });
});
