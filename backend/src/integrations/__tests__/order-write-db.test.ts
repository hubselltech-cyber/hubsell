// ============================================================
// GHI ĐƠN QUA ĐƯỜNG MỚI trên DB dev (Pha C lát 2): TikTok search giả → máy đọc
// con trỏ + kho con trỏ Postgres → upsertTiktokOrderTx THẬT → Order + OrderItem
// tạo đúng; lượt hai không đổi → không ghi; đơn đổi trạng thái → sửa đúng cột;
// con trỏ tiến. Chưa áp migration sync_cursors → tự BỎ QUA.
// ============================================================

import "./load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Channel } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { createStockFixture, type StockFixture } from "./fixtures";
import { prismaCursorStore, readByCursor } from "../../services/cursor-reader";
import { defaultOrderWriteDeps, WRITE_STREAM, writeOrderSpec, type OrderWriteDeps } from "../order-write-adapters";
import type { TikTokOrder } from "../tiktok/client";

const ready: boolean = await (async () => {
  try {
    const r = await prisma.$queryRaw<{ r: string | null }[]>`SELECT to_regclass('sync_cursors')::text AS r`;
    return r[0]?.r != null;
  } catch {
    return false;
  }
})();
if (!ready) console.log("[order-write-db.test] BỎ QUA: DB dev chưa có bảng sync_cursors");

describe.skipIf(!ready)("ghi đơn qua đường mới (TikTok, DB thật)", () => {
  let fx: StockFixture;
  let channel: Channel;
  let sku: string;
  const orders = new Map<string, TikTokOrder>();
  const nowSec = Math.floor(Date.now() / 1000);

  const order = (id: string, status: string, qty: number, updateTime: number): TikTokOrder =>
    ({
      id,
      status,
      create_time: nowSec - 600,
      update_time: updateTime,
      payment: { total_amount: String(150_000 * qty), currency: "VND" },
      recipient_address: { name: "Khách thử", phone_number: "0900000000" },
      line_items: Array.from({ length: qty }, (_, i) => ({ id: `li-${id}-${i}`, seller_sku: sku, product_name: "SP thử", sale_price: "150000" })),
    }) as unknown as TikTokOrder;

  const deps: OrderWriteDeps = {
    ...defaultOrderWriteDeps,
    tiktok: {
      ...defaultOrderWriteDeps.tiktok,
      token: async () => ({ accessToken: "t", shopCipher: "c" }),
      appKey: () => "tk-test",
      fetch: async (p) => {
        // total_count phải là tổng TRONG cửa sổ — báo sai thì máy đọc tưởng tập đổi giữa lúc đọc và đọc lại (đúng luật H8).
        const inWin = [...orders.values()].filter((o) => (o.update_time ?? 0) >= (p.updateTimeGe ?? 0) && (o.update_time ?? 0) < (p.updateTimeLt ?? Infinity));
        return { total_count: inWin.length, orders: inWin };
      },
    },
  };

  beforeAll(async () => {
    fx = await createStockFixture("owrite");
    channel = await prisma.channel.update({ where: { id: fx.channelId }, data: { channelName: "TIKTOK", externalShopId: "sh-w" } });
    const productId = await fx.createProduct(10);
    sku = await fx.createMapping(productId, "ext-w-1");
  });
  afterAll(async () => {
    await fx?.cleanup();
  });

  it("lượt 1 tạo 2 đơn + dòng hàng; lượt 2 không đổi → không ghi; đổi trạng thái → sửa", async () => {
    orders.set("W1", order("W1", "AWAITING_SHIPMENT", 2, nowSec - 300));
    orders.set("W2", order("W2", "COMPLETED", 1, nowSec - 200));
    const { spec, stats } = writeOrderSpec(channel, deps);
    const r1 = await readByCursor(spec, prismaCursorStore, { config: { settleMs: 0 } });
    expect(r1.status).toBe("caught_up");
    expect(stats).toMatchObject({ fetched: 2, created: 2, updated: 0, raced: 0 });
    const w1 = await prisma.order.findUnique({ where: { channelId_orderCode: { channelId: channel.id, orderCode: "W1" } }, include: { items: true } });
    expect(w1?.shippingStatus).toBe("PENDING");
    expect(Number(w1?.totalAmount)).toBe(300_000);
    expect(w1?.items[0]?.quantity).toBe(2);
    const cur = await prisma.syncCursor.findUnique({ where: { channelId_stream: { channelId: channel.id, stream: WRITE_STREAM } } });
    expect(cur?.cursorAt.getTime()).toBe(r1.cursorAt);

    // Lượt 2: cùng đơn đổi update_time (sàn bump) nhưng nội dung y hệt → không ghi.
    orders.set("W1", order("W1", "AWAITING_SHIPMENT", 2, nowSec + 5));
    const run2 = writeOrderSpec(channel, deps);
    const r2 = await readByCursor(run2.spec, prismaCursorStore, { now: () => Date.now() + 10_000, config: { settleMs: 0 } });
    expect(r2.status).toBe("caught_up");
    expect(run2.stats).toMatchObject({ fetched: 1, created: 0, updated: 0, unchanged: 1 });

    // Lượt 3: W1 giao xong → sửa đúng cột.
    orders.set("W1", order("W1", "COMPLETED", 2, nowSec + 15));
    const run3 = writeOrderSpec(channel, deps);
    const r3 = await readByCursor(run3.spec, prismaCursorStore, { now: () => Date.now() + 20_000, config: { settleMs: 0 } });
    expect(r3.status).toBe("caught_up");
    expect(run3.stats).toMatchObject({ fetched: 1, updated: 1 });
    const w1b = await prisma.order.findUnique({ where: { channelId_orderCode: { channelId: channel.id, orderCode: "W1" } } });
    expect(w1b?.shippingStatus).toBe("DELIVERED");
  });
});
