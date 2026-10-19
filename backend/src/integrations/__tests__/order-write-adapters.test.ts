// ============================================================
// ADAPTER GHI ĐƠN 3 SÀN (Pha C lát 2) với client + hàm upsert GIẢ, không DB:
// Shopee lấy chi tiết theo lô ≤ 50 sau danh sách; Lazada lấy dòng hàng theo lô;
// TikTok không gọi chi tiết; đơn không đổi → không gọi upsert; đụng unique
// (P2002) → đọc lại rồi ghi tiếp; phiếu đẩy tồn Lazada chốt SAU commit.
// ============================================================

import { describe, expect, it, vi } from "vitest";
import type { Channel } from "@prisma/client";
import { isUniqueRace, lazadaWriteRows, shopeeWriteRows, tiktokWriteRows, writeOrderSpec, type OrderWriteDeps } from "../order-write-adapters";

vi.mock("../../lib/prisma", () => ({
  prisma: {
    order: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ tx: true })),
  },
}));
vi.mock("../inventory-push", () => ({
  stageStockPush: vi.fn(async () => ({ ticket: 1 })),
  finishStockPush: vi.fn(async () => {}),
}));
vi.mock("../../services/marketplace-gateway", async (orig) => {
  const m = await orig<typeof import("../../services/marketplace-gateway")>();
  return { ...m, callMarketplace: (_c: unknown, fn: () => Promise<unknown>) => fn() };
});

import { prisma } from "../../lib/prisma";
import { finishStockPush, stageStockPush } from "../inventory-push";

const T = Date.UTC(2026, 9, 19, 10, 0, 0);
const win = { from: T, to: T + 3_600_000 };
const channel = (channelName: string): Channel =>
  ({ id: "ch1", channelName, shopName: "Gian thử", externalShopId: "999", status: "ACTIVE", feeRate: 0 }) as unknown as Channel;

function makeDeps(over: Partial<{ shopeeExisting: unknown[]; tiktokUpsert: OrderWriteDeps["tiktok"]["upsert"] }> = {}) {
  const calls: Record<string, unknown[]> = { tkFetch: [], spList: [], spDetail: [], lzList: [], lzItems: [], upsert: [] };
  const deps: OrderWriteDeps = {
    tiktok: {
      token: async () => ({ accessToken: "t", shopCipher: "c" }),
      fetch: async (p) => {
        calls.tkFetch.push(p);
        return { total_count: 2, orders: [{ id: "T1", update_time: 7, status: "ON_HOLD" }, { id: "T2", update_time: 8, status: "COMPLETED" }] as never };
      },
      appKey: () => "tk",
      upsert:
        over.tiktokUpsert ??
        (async (_tx, _ch, o, _fee, existing) => {
          calls.upsert.push({ sàn: "TIKTOK", id: o.id, existing });
          return { orderId: "x", created: true, changed: true, itemsCreated: 1 };
        }),
    },
    shopee: {
      token: async () => ({ accessToken: "t", shopId: "999" }),
      list: async (p) => {
        calls.spList.push(p);
        const sns = Array.from({ length: 70 }, (_, i) => ({ order_sn: `S${i}` }));
        return { response: { order_list: sns, more: false } } as never;
      },
      detail: async (_t, _s, sns) => {
        calls.spDetail.push(sns);
        return sns.map((order_sn) => ({ order_sn, order_status: "READY_TO_SHIP", update_time: 5 }));
      },
      appKey: () => "2040029",
      upsert: async (_tx, _ch, o) => {
        calls.upsert.push({ sàn: "SHOPEE", id: o.order_sn });
        return { created: false, changed: true, itemsCreated: 0 };
      },
    },
    lazada: {
      token: async () => "t",
      list: async (p) => {
        calls.lzList.push(p);
        return { count: 1, orders: [{ order_id: 11, order_number: 1101, updated_at: "2026-10-19T17:00:00+0700", statuses: ["pending"] }] };
      },
      items: async (_t, ids) => {
        calls.lzItems.push(ids);
        return new Map([["11", [{ order_item_id: 1 } as never]]]);
      },
      appKey: () => "lz",
      upsert: async (_tx, _ch, o, items) => {
        calls.upsert.push({ sàn: "LAZADA", id: o.order_number, items: items.length });
        return { created: true, changed: true, itemsCreated: 1, stockSync: { productIds: ["p1"], oldAvailable: new Map() } } as never;
      },
    },
  };
  return { deps, calls };
}

describe("dòng ghi từ trang sàn (thuần)", () => {
  it("TikTok giữ tổng + token; Shopee gắn chi tiết; Lazada gắn dòng hàng theo order_id", () => {
    const tk = tiktokWriteRows({ total_count: 3, next_page_token: "n", orders: [{ id: "a" } as never] }, 50);
    expect(tk.total).toBe(3);
    expect(tk.nextToken).toBe("n");
    expect(tk.rows[0]).toMatchObject({ platform: "TIKTOK", orderCode: "a" });
    const sp = shopeeWriteRows({ response: { order_list: [{ order_sn: "s" }], more: true, next_cursor: "c" } } as never, [{ order_sn: "s" }], 100);
    expect(sp.nextToken).toBe("c");
    expect(sp.rows[0]).toMatchObject({ platform: "SHOPEE", orderCode: "s" });
    const lz = lazadaWriteRows({ count: 1, orders: [{ order_id: 5, order_number: 500 }] }, new Map([["5", [{} as never]]]), 0, 100);
    expect(lz.rows[0]).toMatchObject({ platform: "LAZADA", orderCode: "500", items: [{}] });
    expect(isUniqueRace({ code: "P2002" })).toBe(true);
    expect(isUniqueRace(new Error("x"))).toBe(false);
  });
});

describe("writeOrderSpec", () => {
  it("Shopee: 70 mã → 2 lệnh chi tiết (50 + 20); persist gọi upsert từng đơn, đếm sửa", async () => {
    const { deps, calls } = makeDeps();
    const { spec, stats } = writeOrderSpec(channel("SHOPEE"), deps);
    const page = await spec.fetchPage(win, undefined);
    expect(calls.spList).toHaveLength(1);
    expect(calls.spDetail.map((b) => (b as string[]).length)).toEqual([50, 20]);
    expect(page.rows).toHaveLength(70);
    await spec.persist(page.rows, {} as never);
    expect(calls.upsert).toHaveLength(70);
    expect(stats).toMatchObject({ fetched: 70, updated: 70, created: 0, raced: 0 });
  });

  it("TikTok: không gọi chi tiết; đơn đã có mà không đổi → không upsert", async () => {
    const { deps, calls } = makeDeps();
    vi.mocked(prisma.order.findMany).mockResolvedValueOnce([
      // Đơn T2 đã có y hệt (COMPLETED, paid, total 0) → plan rỗng → bỏ qua; createdAt mới → không bù ảnh.
      {
        id: "o2", orderCode: "T2", createdAt: new Date(), shippingStatus: "DELIVERED", paymentStatus: "PAID", totalAmount: 0,
        platformSubsidy: 0, trackingCode: null, platformPackageId: null, deliveredAt: new Date(), carrier: null, shippingCarrierName: null,
        isSettled: false, returnStatus: "NONE", returnRequestedAt: null, cancelledAt: null, lineIdReady: true,
      } as never,
    ]);
    const { spec, stats } = writeOrderSpec(channel("TIKTOK"), deps);
    const page = await spec.fetchPage(win, undefined);
    await spec.persist(page.rows, {} as never);
    expect(calls.upsert.map((u) => (u as { id: string }).id)).toEqual(["T1"]);
    expect(stats.created).toBe(1);
    expect(stats.unchanged + stats.updated).toBe(1);
  });

  it("đụng unique (P2002) → đọc lại rồi ghi lần hai, đếm raced", async () => {
    let n = 0;
    const { deps, calls } = makeDeps({
      tiktokUpsert: async (_tx, _ch, o, _f, existing) => {
        calls.upsert.push({ id: o.id, existing });
        if (n++ === 0) throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
        return { orderId: "x", created: false, changed: true, itemsCreated: 0 };
      },
    });
    const { spec, stats } = writeOrderSpec(channel("TIKTOK"), deps);
    const page = await spec.fetchPage(win, undefined);
    await spec.persist(page.rows.slice(0, 1), {} as never);
    expect(calls.upsert).toHaveLength(2);
    expect((calls.upsert[1] as { existing: unknown }).existing).toBeUndefined(); // lần hai để hàm upsert tự đọc lại
    expect(stats).toMatchObject({ raced: 1, updated: 1 });
  });

  it("Lazada: dòng hàng theo lô; phiếu đẩy tồn chốt SAU commit (afterCommit)", async () => {
    const { deps, calls } = makeDeps();
    const { spec } = writeOrderSpec(channel("LAZADA"), deps);
    const page = await spec.fetchPage(win, undefined);
    expect(calls.lzItems).toEqual([[11]]);
    await spec.persist(page.rows, {} as never);
    expect(calls.upsert[0]).toMatchObject({ sàn: "LAZADA", id: 1101, items: 1 });
    expect(stageStockPush).toHaveBeenCalledTimes(1);
    expect(finishStockPush).not.toHaveBeenCalled();
    await spec.afterCommit!();
    expect(finishStockPush).toHaveBeenCalledTimes(1);
    await spec.afterCommit!();
    expect(finishStockPush).toHaveBeenCalledTimes(1); // phiếu đã chốt không chốt lại
  });

  it("lỗi khác P2002 ném nguyên vẹn (làn hẹn lại, không nuốt)", async () => {
    const { deps } = makeDeps({
      tiktokUpsert: async () => {
        throw new Error("DB rớt");
      },
    });
    const { spec } = writeOrderSpec(channel("TIKTOK"), deps);
    const page = await spec.fetchPage(win, undefined);
    await expect(spec.persist(page.rows, {} as never)).rejects.toThrow("DB rớt");
  });
});
