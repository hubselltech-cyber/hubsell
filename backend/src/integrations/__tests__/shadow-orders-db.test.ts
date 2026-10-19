// ============================================================
// ĐỌC BÓNG ĐƠN trên DB dev: máy đọc con trỏ + kho con trỏ Postgres + ghi bảng
// bóng trong CÙNG giao dịch; trùng mã trong trang; cột trạng thái/mốc gộp đúng;
// handler làn bỏ qua gian ngủ đông mà không gọi sàn. Chưa áp migration
// 20261019130000_sync_shadow_orders → tự BỎ QUA.
// ============================================================

import "./load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Channel } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { createStockFixture, type StockFixture } from "./fixtures";
import { prismaCursorStore, readByCursor } from "../../services/cursor-reader";
import { enrollStream } from "../../services/sync-lanes";
import { persistShadowRows, SHADOW_STREAM, shadowOrderSpec, type OrderReadDeps } from "../order-read-adapters";
import { handleReadItem } from "../../workers/read-lanes";

const ready: boolean = await (async () => {
  try {
    const r = await prisma.$queryRaw<{ r: string | null }[]>`SELECT to_regclass('sync_shadow_orders')::text AS r`;
    return r[0]?.r != null;
  } catch {
    return false;
  }
})();
if (!ready) console.log("[shadow-orders-db.test] BỎ QUA: DB dev chưa có bảng sync_shadow_orders");

describe.skipIf(!ready)("đọc bóng đơn trên DB", () => {
  let fx: StockFixture;
  let channel: Channel;
  beforeAll(async () => {
    fx = await createStockFixture("shadow");
    channel = (await prisma.channel.update({ where: { id: fx.channelId }, data: { channelName: "TIKTOK", externalShopId: "sh-1" } }))!;
  });
  afterAll(async () => {
    await fx?.cleanup();
  });

  it("persistShadowRows: trùng mã trong trang gộp một dòng, lần sau tăng seenCount và giữ mốc mới nhất", async () => {
    await prisma.$transaction((tx) =>
      persistShadowRows(
        channel.id,
        [
          { orderCode: "A", updateTime: 10, status: "x" },
          { orderCode: "A", updateTime: 12, status: "y" },
          { orderCode: "B", updateTime: null, status: null },
        ],
        tx
      )
    );
    await prisma.$transaction((tx) => persistShadowRows(channel.id, [{ orderCode: "A", updateTime: 11, status: null }], tx));
    const a = await prisma.syncShadowOrder.findUnique({ where: { channelId_orderCode: { channelId: channel.id, orderCode: "A" } } });
    expect(a?.platformUpdatedAt?.getTime()).toBe(12_000);
    expect(a?.status).toBe("y");
    expect(a?.seenCount).toBe(2);
    const b = await prisma.syncShadowOrder.findUnique({ where: { channelId_orderCode: { channelId: channel.id, orderCode: "B" } } });
    expect(b?.platformUpdatedAt).toBeNull();
  });

  it("đọc qua con trỏ Postgres với client TikTok giả: 3 trang → con trỏ tiến, bảng bóng đủ 150 mã", async () => {
    let page = 0;
    const deps: OrderReadDeps = {
      tiktok: {
        token: async () => ({ accessToken: "t", shopCipher: "c" }),
        fetch: async () => {
          page++;
          const orders = Array.from({ length: 50 }, (_, i) => ({ id: `P${page}-${i}`, update_time: 1_700_000_000 + i, status: "COMPLETED" }) as never);
          return { total_count: 150, orders, next_page_token: page < 3 ? `tok${page}` : undefined };
        },
        appKey: () => "tk",
      },
      shopee: { token: async () => ({ accessToken: "", shopId: "" }), list: async () => ({}) as never, appKey: () => "" },
      lazada: { token: async () => "", list: async () => ({ count: 0, orders: [] }), appKey: () => "" },
    };
    const spec = shadowOrderSpec(channel, deps);
    const r = await readByCursor(spec, prismaCursorStore, { config: { settleMs: 0 } });
    expect(r.status).toBe("caught_up");
    expect(page).toBe(3);
    expect(await prisma.syncShadowOrder.count({ where: { channelId: channel.id, orderCode: { startsWith: "P" } } })).toBe(150);
    const cur = await prisma.syncCursor.findUnique({ where: { channelId_stream: { channelId: channel.id, stream: SHADOW_STREAM } } });
    expect(cur?.cursorAt.getTime()).toBe(r.cursorAt);
  });

  it("handleReadItem: gian ngủ đông → không gọi sàn, hẹn lại 1 giờ; enrollStream tạo dòng tới hạn ngay", async () => {
    await prisma.channel.update({ where: { id: channel.id }, data: { hibernatedAt: new Date() } });
    const ms = await handleReadItem({ channelId: channel.id, stream: SHADOW_STREAM, lane: "orders" }, new AbortController().signal);
    expect(ms).toBe(60 * 60_000);
    await prisma.channel.update({ where: { id: channel.id }, data: { hibernatedAt: null } });
    await prisma.syncCursor.deleteMany({ where: { channelId: channel.id } });
    await enrollStream(channel.id, SHADOW_STREAM, "orders", new Date(Date.now() - 1_800_000), 3_600_000);
    const row = await prisma.syncCursor.findUnique({ where: { channelId_stream: { channelId: channel.id, stream: SHADOW_STREAM } } });
    expect(row?.lane).toBe("orders");
    expect(row!.dueAt.getTime()).toBeLessThanOrEqual(Date.now());
  });
});
