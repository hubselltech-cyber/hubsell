// ============================================================
// ADAPTER ĐỌC BÓNG ĐƠN 3 SÀN — phần thuần (cửa sổ → tham số, trang sàn → PageResult)
// + dựng spec với client giả: đúng endpoint/tham số, token trang, tổng, qua cổng.
// ============================================================

import { describe, expect, it } from "vitest";
import type { Channel } from "@prisma/client";
import {
  lazadaPage,
  lazadaWindowParams,
  shadowOrderSpec,
  shopeePage,
  shopeeWindowParams,
  tiktokPage,
  tiktokWindowParams,
  type OrderReadDeps,
} from "../order-read-adapters";

const T = Date.UTC(2026, 9, 19, 10, 0, 0, 500);
const win = { from: T, to: T + 3_600_000 };

describe("cửa sổ → tham số từng sàn", () => {
  it("TikTok: ge đóng / lt mở, giây; Shopee: hai đầu đóng phủ rộng ở ranh; Lazada: ISO", () => {
    expect(tiktokWindowParams(win)).toEqual({ updateTimeGe: Math.floor(T / 1000), updateTimeLt: Math.ceil((T + 3_600_000) / 1000) });
    const s = shopeeWindowParams(win);
    expect(s.timeFrom * 1000).toBeLessThanOrEqual(win.from);
    expect(s.timeTo * 1000).toBeGreaterThanOrEqual(win.to);
    expect(lazadaWindowParams(win)).toEqual({ updatedAfter: new Date(T).toISOString(), updatedBefore: new Date(T + 3_600_000).toISOString() });
  });
});

describe("trang sàn → PageResult", () => {
  it("TikTok mang tổng + token; thiếu token = trang cuối", () => {
    const p = tiktokPage({ total_count: 120, next_page_token: "abc", orders: [{ id: "1", update_time: 5, status: "COMPLETED" } as never] }, 50);
    expect(p).toEqual({ rows: [{ orderCode: "1", updateTime: 5, status: "COMPLETED" }], nextToken: "abc", total: 120, pageSize: 50 });
    expect(tiktokPage({ orders: [] }, 50).nextToken).toBeNull();
  });
  it("Shopee không tổng, không update_time; more=false = trang cuối", () => {
    const p = shopeePage({ response: { order_list: [{ order_sn: "S1", order_status: "READY_TO_SHIP" }], more: true, next_cursor: "c2" } } as never, 100);
    expect(p.rows).toEqual([{ orderCode: "S1", updateTime: null, status: "READY_TO_SHIP" }]);
    expect(p.nextToken).toBe("c2");
    expect(p.total).toBeUndefined();
    expect(shopeePage({ response: { order_list: [], more: false, next_cursor: "x" } } as never, 100).nextToken).toBeNull();
  });
  it("Lazada offset: token = offset kế khi trang đầy và còn tổng", () => {
    const orders = Array.from({ length: 100 }, (_, i) => ({ order_number: i + 1, updated_at: "2026-10-19T17:00:00+0700", statuses: ["pending"] }));
    const p = lazadaPage({ count: 250, orders }, 0, 100);
    expect(p.nextToken).toBe("100");
    expect(p.total).toBe(250);
    expect(p.rows[0]).toEqual({ orderCode: "1", updateTime: Math.floor(Date.parse("2026-10-19T17:00:00+0700") / 1000), status: "pending" });
    expect(lazadaPage({ count: 250, orders: orders.slice(0, 50) }, 200, 100).nextToken).toBeNull();
    expect(lazadaPage({ count: 100, orders }, 0, 100).nextToken).toBeNull();
  });
});

describe("shadowOrderSpec với client giả", () => {
  const channel = (channelName: string): Channel =>
    ({ id: "ch1", channelName, shopName: "Gian thử", externalShopId: "999", status: "ACTIVE" }) as Channel;
  const calls: unknown[] = [];
  const deps: OrderReadDeps = {
    tiktok: {
      token: async () => ({ accessToken: "t", shopCipher: "c" }),
      fetch: async (p) => {
        calls.push(p);
        return { total_count: 1, orders: [{ id: "T1", update_time: 7, status: "ON_HOLD" } as never] };
      },
      appKey: () => "tk-app",
    },
    shopee: {
      token: async () => ({ accessToken: "t", shopId: "999" }),
      list: async (p) => {
        calls.push(p);
        return { response: { order_list: [{ order_sn: "S1" }], more: false } } as never;
      },
      appKey: () => "2040029",
    },
    lazada: {
      token: async () => "t",
      list: async (p) => {
        calls.push(p);
        return { count: 1, orders: [{ order_number: 5, updated_at: "2026-10-19T17:00:00+0700" }] };
      },
      appKey: () => "lz-app",
    },
  };

  it("TikTok gửi sort_field=update_time DESC + page_size 50; Shopee trục update_time; Lazada offset từ token", async () => {
    calls.length = 0;
    const tk = shadowOrderSpec(channel("TIKTOK"), deps);
    expect((await tk.fetchPage(win, undefined)).rows[0].orderCode).toBe("T1");
    expect(calls[0]).toMatchObject({ sortField: "update_time", sortOrder: "DESC", pageSize: 50, updateTimeGe: Math.floor(T / 1000) });
    const sp = shadowOrderSpec(channel("SHOPEE"), deps);
    expect((await sp.fetchPage(win, "cur")).nextToken).toBeNull();
    expect(calls[1]).toMatchObject({ timeRangeField: "update_time", cursor: "cur", pageSize: 100 });
    const lz = shadowOrderSpec(channel("LAZADA"), deps);
    expect((await lz.fetchPage(win, "200")).rows[0].orderCode).toBe("5");
    expect(calls[2]).toMatchObject({ offset: 200, limit: 100 });
    expect(tk.stream).toBe("orders-shadow");
    expect(tk.maxWindowMs).toBe(15 * 86_400_000);
  });

  it("sàn không hỗ trợ (OFFLINE) → ném ngay khi dựng", () => {
    expect(() => shadowOrderSpec(channel("OFFLINE"), deps)).toThrow("không hỗ trợ");
  });
});
