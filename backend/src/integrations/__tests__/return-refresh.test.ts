// Lát C (29/10/2026): màn quét đơn hoàn hỏi sàn đúng một đơn khi đơn còn "Không
// hoàn" mà kiện đã rời shop. Thuần + mock 3 sàn: luật "đáng hỏi", cooldown theo
// đơn, thứ tự hai bước, lỗi một bước không chặn bước kia, gian không hỏi được.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelName, ReturnStatus, ShippingStatus, type Channel } from "@prisma/client";

const calls = vi.hoisted(() => ({ log: [] as string[], failOrder: false, failReturns: false }));
vi.mock("../tiktok/service", () => ({
  processTiktokOrderEvent: async (_c: unknown, id: string) => {
    calls.log.push(`tt-order:${id}`);
    if (calls.failOrder) throw new Error("giả lập lỗi chi tiết đơn");
    return { found: true, created: false, inventory: "none", stockTicket: { productIds: ["p1"], staged: true, opts: {} } };
  },
}));
vi.mock("../tiktok/returns-sync", () => ({
  syncTiktokReturnsForOrders: async (_c: unknown, ids: string[]) => {
    calls.log.push(`tt-returns:${ids.join(",")}`);
    if (calls.failReturns) throw new Error("giả lập lỗi returns/search");
    return { scanned: 1, flagged: 1, unflagged: 0 };
  },
}));
vi.mock("../shopee/service", () => ({
  processShopeeOrderEvent: async (_c: unknown, sn: string) => {
    calls.log.push(`sp-order:${sn}`);
    return { found: true, created: false, inventory: "none" };
  },
}));
vi.mock("../shopee/returns-sync", () => ({
  syncShopeeReturnsForOrder: async (_c: unknown, sn: string) => {
    calls.log.push(`sp-returns:${sn}`);
    return { scanned: 0, flagged: 0, unflagged: 0 };
  },
}));
vi.mock("../lazada/webhook", () => ({
  processLazadaOrderPush: async (_c: unknown, id: string) => {
    calls.log.push(`lz-order:${id}`);
    return { created: false, itemsCreated: 0 };
  },
}));
vi.mock("../lazada/returns-sync", () => ({
  syncLazadaReturnsForOrder: async (_c: unknown, id: string) => {
    calls.log.push(`lz-returns:${id}`);
    return { scanned: 0, flagged: 0, unflagged: 0 };
  },
}));
vi.mock("../inventory-push", () => ({
  finishStockPush: async (t: unknown) => {
    calls.log.push(`stock-push:${t ? "ticket" : "none"}`);
    return { queued: 0 };
  },
}));
vi.mock("../shopee/config", () => ({ isShopeeConfigured: () => true }));
vi.mock("../tiktok/config", () => ({ isTikTokConfigured: () => true }));
vi.mock("../lazada/config", () => ({ isLazadaConfigured: () => true }));
vi.mock("../../services/plan-hibernation", () => ({ isHibernated: (c: { hibernatedAt?: Date | null }) => !!c.hibernatedAt }));

import {
  RETURN_REFRESH_COOLDOWN_MS,
  canAskPlatform,
  claimReturnRefresh,
  needsReturnRefresh,
  refreshReturnStateForOrder,
  resetReturnRefreshMemory,
} from "../return-refresh";

function channel(over: Partial<Channel> = {}): Channel {
  return {
    id: "c1",
    channelName: ChannelName.TIKTOK,
    shopName: "Hellokityhh",
    status: "ACTIVE",
    refreshToken: "rt",
    hibernatedAt: null,
    ...over,
  } as Channel;
}

beforeEach(() => {
  calls.log = [];
  calls.failOrder = false;
  calls.failReturns = false;
  resetReturnRefreshMemory();
});

describe("needsReturnRefresh — kiện đã rời shop mà trục hoàn còn trống", () => {
  it("SHIPPING / DELIVERED + NONE → hỏi; PENDING / PROCESSED / CANCELLED hoặc đã có cờ → không", () => {
    expect(needsReturnRefresh({ shippingStatus: ShippingStatus.SHIPPING, returnStatus: ReturnStatus.NONE })).toBe(true);
    expect(needsReturnRefresh({ shippingStatus: ShippingStatus.DELIVERED, returnStatus: ReturnStatus.NONE })).toBe(true);
    for (const st of [ShippingStatus.PENDING, ShippingStatus.PROCESSED, ShippingStatus.CANCELLED]) {
      expect(needsReturnRefresh({ shippingStatus: st, returnStatus: ReturnStatus.NONE })).toBe(false);
    }
    for (const rs of [ReturnStatus.AWAITING, ReturnStatus.RECEIVED, ReturnStatus.RECEIVED_INTACT]) {
      expect(needsReturnRefresh({ shippingStatus: ShippingStatus.SHIPPING, returnStatus: rs })).toBe(false);
    }
  });
});

describe("claimReturnRefresh — mỗi đơn 5 phút một lần", () => {
  it("lần đầu cho; trong 5 phút không; hết 5 phút cho lại; đơn khác độc lập", () => {
    expect(claimReturnRefresh("o1", 1_000)).toBe(true);
    expect(claimReturnRefresh("o1", 1_000 + RETURN_REFRESH_COOLDOWN_MS - 1)).toBe(false);
    expect(claimReturnRefresh("o2", 1_000 + 10)).toBe(true);
    expect(claimReturnRefresh("o1", 1_000 + RETURN_REFRESH_COOLDOWN_MS)).toBe(true);
  });
});

describe("canAskPlatform", () => {
  it("gian ACTIVE có token, không ngủ đông → hỏi; mất token / ngắt / ngủ đông / Offline → không", () => {
    expect(canAskPlatform(channel())).toBe(true);
    expect(canAskPlatform(channel({ refreshToken: null }))).toBe(false);
    expect(canAskPlatform(channel({ status: "INACTIVE" as Channel["status"] }))).toBe(false);
    expect(canAskPlatform(channel({ hibernatedAt: new Date() }))).toBe(false);
    expect(canAskPlatform(channel({ channelName: ChannelName.OFFLINE }))).toBe(false);
  });
});

describe("refreshReturnStateForOrder", () => {
  const order = { id: "o1", orderCode: "586686865006495180" };

  it("TikTok: kéo chi tiết đơn (chốt phiếu đẩy tồn) rồi hỏi yêu cầu hoàn — đúng thứ tự, đúng mã", async () => {
    const r = await refreshReturnStateForOrder(channel(), order, 1_000);
    expect(r).toEqual({ asked: true, orderRefreshed: true, returnsChecked: true });
    expect(calls.log).toEqual(["tt-order:586686865006495180", "stock-push:ticket", "tt-returns:586686865006495180"]);
  });

  it("Shopee / Lazada đi đúng hàm của sàn mình", async () => {
    await refreshReturnStateForOrder(channel({ channelName: ChannelName.SHOPEE }), { id: "o2", orderCode: "SN1" }, 1_000);
    await refreshReturnStateForOrder(channel({ channelName: ChannelName.LAZADA }), { id: "o3", orderCode: "LZ1" }, 1_000);
    expect(calls.log).toEqual(["sp-order:SN1", "stock-push:none", "sp-returns:SN1", "lz-order:LZ1", "lz-returns:LZ1"]);
  });

  it("bước chi tiết đơn lỗi → vẫn hỏi yêu cầu hoàn; bước yêu cầu hoàn lỗi → không ném ra ngoài", async () => {
    calls.failOrder = true;
    const r1 = await refreshReturnStateForOrder(channel(), order, 1_000);
    expect(r1).toEqual({ asked: true, orderRefreshed: false, returnsChecked: true });
    expect(calls.log).toEqual(["tt-order:586686865006495180", "tt-returns:586686865006495180"]);

    calls.log = [];
    calls.failOrder = false;
    calls.failReturns = true;
    const r2 = await refreshReturnStateForOrder(channel(), { id: "o9", orderCode: "X" }, 1_000);
    expect(r2).toEqual({ asked: true, orderRefreshed: true, returnsChecked: false });
  });

  it("quét lại cùng đơn trong 5 phút → không hỏi sàn; gian không hỏi được → không hỏi, nêu lý do", async () => {
    await refreshReturnStateForOrder(channel(), order, 1_000);
    calls.log = [];
    const again = await refreshReturnStateForOrder(channel(), order, 1_000 + 60_000);
    expect(again.asked).toBe(false);
    expect(again.skipped).toMatch(/5 phút/);
    expect(calls.log).toEqual([]);

    const off = await refreshReturnStateForOrder(channel({ refreshToken: null }), { id: "o5", orderCode: "Y" }, 1_000);
    expect(off.asked).toBe(false);
    expect(off.skipped).toMatch(/không hỏi sàn được/);
    expect(calls.log).toEqual([]);
  });
});
