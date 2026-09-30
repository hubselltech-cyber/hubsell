// ============================================================
// QUẢNG CÁO trên DB dev: dòng gọn của đơn đọc từ SỔ CÁI phải giống dòng dựng từ
// đơn gốc qua computePnlRow (đường cũ), trên DỮ LIỆU THẬT của DB dev — vì vậy
// mọi phép tính phía sau (biên lãi Shopee/Lazada, hòa vốn TikTok theo gian /
// chiến dịch / sản phẩm, nhịp bán) cho cùng kết quả.
// (docs/SO-CAI-DON.md mục 9.7). Chưa áp migration sổ cái → cả file tự BỎ QUA.
// ============================================================

import "./load-env";
import { describe, expect, it } from "vitest";
import { ChannelName } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ensureLedgerFresh } from "../../services/order-ledger";
import { marginOverRows, pnlRowsForMargin, type MarginRow } from "../../lib/ads-margin";
import { loadMarginRows } from "../shopee/ads-margin-source";
import {
  salesPaceByGroup,
  tiktokBreakevenBase,
  tiktokBreakevenBaseByGroup,
  type BreakevenPnlRow,
} from "../../lib/tiktok-breakeven";
import { loadBreakevenRows } from "../tiktok-ads/breakeven-source";

const ledgerReady: boolean = await (async () => {
  try {
    const r = await prisma.$queryRaw<{ r: string | null }[]>`SELECT to_regclass('order_ledger')::text AS r`;
    return r[0]?.r != null;
  } catch {
    return false;
  }
})();
if (!ledgerReady) {
  console.log("[ads-rows-ledger-db.test] BỎ QUA: DB dev chưa có bảng order_ledger");
}

const near = (x: number, y: number, tol = 1) => Math.abs(x - y) <= tol;
const itemsKey = (items: { sku: string; price: number; quantity: number }[]) =>
  items.map((i) => `${i.sku}|${Math.round(i.price)}|${i.quantity}`).sort().join(";");

async function channels(names: ChannelName[]) {
  const list = await prisma.channel.findMany({
    where: { channelName: { in: names } },
    select: { id: true, userId: true, channelName: true, shopName: true },
  });
  const owners = [...new Set(list.map((c) => c.userId))];
  for (const userId of owners) {
    const fresh = await ensureLedgerFresh({ userId }, undefined, { maxInline: 20_000 });
    expect(fresh.dirty, `${userId} còn dòng bẩn`).toBe(0);
  }
  return list;
}

describe.skipIf(!ledgerReady)("Quảng cáo — dòng gọn từ sổ cái = dòng từ đơn gốc trên DB dev", () => {
  it("Shopee/Lazada: từng dòng + biên lãi toàn gian + biên lãi từng SKU", { timeout: 300_000 }, async () => {
    let withOrders = 0;
    for (const ch of await channels([ChannelName.SHOPEE, ChannelName.LAZADA])) {
      const tag = `${ch.shopName} (${ch.channelName})`;
      const [ledger, orders] = await Promise.all([loadMarginRows(ch, "ledger"), loadMarginRows(ch, "orders")]);
      expect(ledger.length, `${tag} số đơn`).toBe(orders.length);
      for (let i = 0; i < orders.length; i++) {
        const a = ledger[i];
        const b = orders[i] as MarginRow;
        expect(a.createdAt.getTime(), `${tag} #${i} createdAt`).toBe(b.createdAt.getTime());
        expect(a.shippingStatus, `${tag} #${i} trạng thái`).toBe(b.shippingStatus);
        expect(a.isSettled, `${tag} #${i} quyết toán`).toBe(b.isSettled);
        expect(a.missingCostPrice, `${tag} #${i} thiếu giá vốn`).toBe(b.missingCostPrice);
        expect(near(a.actualRevenue, b.actualRevenue, 0.01), `${tag} #${i} doanh thu`).toBe(true);
        expect(near(a.profit, b.profit, 0.01), `${tag} #${i} lợi nhuận`).toBe(true);
        expect(itemsKey(a.items), `${tag} #${i} dòng hàng`).toBe(itemsKey(b.items));
        expect(
          a.items.map((x) => `${x.sku}|${Math.round(x.costPriceAtSale)}`).sort(),
          `${tag} #${i} giá vốn dòng`
        ).toEqual(b.items.map((x) => `${x.sku}|${Math.round(x.costPriceAtSale)}`).sort());
      }
      if (orders.length === 0) continue;
      withOrders += 1;
      // Biên lãi toàn gian + riêng từng SKU (đúng tập lọc của sàn: bỏ đơn hủy; Lazada chỉ đơn đã đối soát).
      const ra = pnlRowsForMargin(ledger, ch.channelName);
      const rb = pnlRowsForMargin(orders, ch.channelName);
      const sets: (Set<string> | null)[] = [null];
      const skus = [...new Set(rb.flatMap((r) => r.items.map((i) => i.sku)))].slice(0, 25);
      for (const s of skus) sets.push(new Set([s]));
      if (skus.length >= 3) sets.push(new Set(skus.slice(0, 3)));
      for (const set of sets) {
        const x = marginOverRows(ra, set);
        const y = marginOverRows(rb, set);
        const name = set ? [...set].join("+") : "toàn gian";
        expect(x.orders, `${tag} ${name} orders`).toBe(y.orders);
        expect(x.missingCostOrders, `${tag} ${name} missingCostOrders`).toBe(y.missingCostOrders);
        expect(x.costCoveragePct, `${tag} ${name} độ phủ`).toBe(y.costCoveragePct);
        expect(near(x.revenue, y.revenue), `${tag} ${name} revenue`).toBe(true);
        expect(near(x.profit, y.profit), `${tag} ${name} profit`).toBe(true);
        expect(near(x.missingCostRevenue, y.missingCostRevenue), `${tag} ${name} missingCostRevenue`).toBe(true);
      }
    }
    expect(withOrders, "DB dev phải có gian Shopee/Lazada có đơn 30 ngày để phép so có nghĩa").toBeGreaterThan(0);
  });

  it("TikTok: từng dòng (kể cả cờ đối soát THẬT, phí GMV Max) + hòa vốn gian / từng SKU + nhịp bán", { timeout: 300_000 }, async () => {
    for (const ch of await channels([ChannelName.TIKTOK])) {
      const tag = `${ch.shopName} (TIKTOK)`;
      const [ledger, orders] = await Promise.all([loadBreakevenRows(ch, "ledger"), loadBreakevenRows(ch, "orders")]);
      expect(ledger.length, `${tag} số đơn`).toBe(orders.length);
      for (let i = 0; i < orders.length; i++) {
        const a: BreakevenPnlRow = ledger[i];
        const b: BreakevenPnlRow = orders[i];
        expect(a.createdAt.getTime(), `${tag} #${i} createdAt`).toBe(b.createdAt.getTime());
        expect(a.shippingStatus, `${tag} #${i} trạng thái`).toBe(b.shippingStatus);
        expect(a.isSettled, `${tag} #${i} đối soát thật`).toBe(b.isSettled);
        expect(a.missingCostPrice, `${tag} #${i} thiếu giá vốn`).toBe(b.missingCostPrice);
        expect(a.tiktok === null, `${tag} #${i} có bản kê`).toBe(b.tiktok === null);
        expect(near(a.tiktok?.feeGmvMax ?? 0, b.tiktok?.feeGmvMax ?? 0, 0.01), `${tag} #${i} phí GMV Max`).toBe(true);
        expect(near(a.actualRevenue, b.actualRevenue, 0.01), `${tag} #${i} doanh thu`).toBe(true);
        expect(near(a.profit, b.profit, 0.01), `${tag} #${i} lợi nhuận`).toBe(true);
        expect(itemsKey(a.items), `${tag} #${i} dòng hàng`).toBe(itemsKey(b.items));
      }
      if (orders.length === 0) continue;
      const x = tiktokBreakevenBase(ledger, null);
      const y = tiktokBreakevenBase(orders, null);
      for (const k of ["settledOrders", "cancelledOrders", "pendingOrders"] as const) expect(x[k], `${tag} ${k}`).toBe(y[k]);
      for (const k of ["revenue", "profitBeforeAds", "adFee", "missingCostRevenue"] as const) {
        expect(near(x[k], y[k]), `${tag} ${k}: sổ ${x[k]} ≠ đơn ${y[k]}`).toBe(true);
      }
      const groupOfSku = new Map<string, string>();
      for (const r of orders) for (const it of r.items) groupOfSku.set(it.sku, it.sku);
      const gx = tiktokBreakevenBaseByGroup(ledger, groupOfSku);
      const gy = tiktokBreakevenBaseByGroup(orders, groupOfSku);
      expect([...gx.keys()].sort()).toEqual([...gy.keys()].sort());
      for (const [g, by] of gy) {
        const bx = gx.get(g)!;
        expect(bx.settledOrders, `${tag} ${g} settledOrders`).toBe(by.settledOrders);
        expect(bx.pendingOrders, `${tag} ${g} pendingOrders`).toBe(by.pendingOrders);
        expect(near(bx.revenue, by.revenue), `${tag} ${g} revenue`).toBe(true);
        expect(near(bx.profitBeforeAds, by.profitBeforeAds), `${tag} ${g} profitBeforeAds`).toBe(true);
      }
      const now = new Date();
      expect([...salesPaceByGroup(ledger, groupOfSku, now)].sort()).toEqual([...salesPaceByGroup(orders, groupOfSku, now)].sort());
    }
  });
});
