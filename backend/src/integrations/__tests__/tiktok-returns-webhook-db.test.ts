// ============================================================
// HỎI YÊU CẦU HOÀN TIKTOK THEO MÃ ĐƠN NGAY KHI WEBHOOK TYPE 12 BÁO (lát B,
// 29/10/2026) — chạy trên DB dev với một gian tự dựng; returns/search + token
// thay bằng bản giả. Cùng khuôn tiktok-returns-backfill-db.test.ts.
//
// Mục tiêu: cờ "Chờ hàng về" lên NGAY theo nhịp webhook thay vì chờ lượt quét
// 10'–60' (docs DON-HOAN-VA-SAO-KE.md mục 8.2 lớp 2). Khác quét bù: yêu cầu
// đang sống vẫn cắm AWAITING (không phải lịch sử), KHÔNG đóng/đọc mốc
// returnLookupAt của đơn khác.
// ============================================================

import "./load-env";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelName, ReturnSolution, ReturnStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { createStockFixture, type StockFixture } from "./fixtures";
import type { TikTokReturnOrder } from "../tiktok/client";

const api = vi.hoisted(() => ({
  calls: [] as string[][],
  respond: (_orderIds: string[]): unknown[] => [],
}));
vi.mock("../tiktok/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("../tiktok/client")>();
  return {
    ...real,
    searchReturns: async (p: { orderIds?: string[] }) => {
      api.calls.push(p.orderIds ?? []);
      return { return_orders: api.respond(p.orderIds ?? []) as TikTokReturnOrder[] };
    },
  };
});
vi.mock("../tiktok/service", async (importOriginal) => {
  const real = await importOriginal<typeof import("../tiktok/service")>();
  return { ...real, getValidAccessToken: async () => ({ accessToken: "t", shopCipher: "c" }) };
});

import { syncTiktokReturnsForOrders } from "../tiktok/returns-sync";

describe("TikTok — webhook type 12 hỏi yêu cầu hoàn đúng đơn", () => {
  let fx: StockFixture;
  let seq = 0;

  const channel = () => prisma.channel.findUniqueOrThrow({ where: { id: fx.channelId } });

  /** Đơn đã giao, chưa có gì trên trục hoàn — khuôn khách vừa gửi yêu cầu trả hàng. */
  async function createDeliveredOrder(): Promise<{ id: string; code: string }> {
    seq += 1;
    const code = `TEST-${fx.suffix}-W${seq}`;
    const o = await prisma.order.create({
      data: {
        channelId: fx.channelId,
        orderCode: code,
        customerName: "Khách test",
        itemCount: 1,
        totalAmount: 224_100,
        shippingStatus: "DELIVERED",
        items: {
          create: { channelSku: `SKU-${seq}`, productName: "Giày test", quantity: 1, price: 224_100, costPriceAtSale: 140_000 },
        },
      },
    });
    return { id: o.id, code };
  }

  const pendingReturn = (code: string, over: Partial<TikTokReturnOrder> = {}): TikTokReturnOrder => ({
    return_id: `RET-${code}`,
    order_id: code,
    return_type: "RETURN_AND_REFUND",
    return_status: "RETURN_OR_REFUND_REQUEST_PENDING",
    create_time: 1_793_182_626,
    update_time: 1_793_182_626,
    refund_amount: { currency: "VND", refund_total: "224100" },
    return_line_items: [{ return_line_item_id: "L1", seller_sku: "" }],
    ...over,
  });

  beforeAll(async () => {
    fx = await createStockFixture("ttretwebhook");
    await prisma.channel.update({ where: { id: fx.channelId }, data: { channelName: ChannelName.TIKTOK } });
  });

  beforeEach(() => {
    api.calls = [];
    api.respond = () => [];
  });

  afterAll(async () => {
    await fx?.cleanup();
  });

  it("khách vừa xin trả hàng (yêu cầu đang chờ) → hỏi đúng 1 đơn, cắm Chờ hàng về + mốc sàn + giải pháp hàng về", async () => {
    const o = await createDeliveredOrder();
    api.respond = (ids) => ids.filter((c) => c === o.code).map((c) => pendingReturn(c));
    const r = await syncTiktokReturnsForOrders(await channel(), [o.code]);

    expect(api.calls).toEqual([[o.code]]);
    expect(r).toMatchObject({ scanned: 1, withReturns: 1, flagged: 1, unflagged: 0, delivered: 0, ordersNotFound: 0 });
    const after = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(after.returnStatus).toBe(ReturnStatus.AWAITING);
    expect(after.returnRequestedAt?.getTime()).toBe(1_793_182_626 * 1000);
    expect(after.returnSolution).toBe(ReturnSolution.RETURN_REFUND);
    expect(after.platformReturnStatus).toBe("RETURN_OR_REFUND_REQUEST_PENDING");
    expect(after.returnDeliveredAt).toBeNull();
  });

  it("webhook lặp cùng trạng thái → không ghi lại (idempotent); sàn từ chối yêu cầu → hạ cờ", async () => {
    const o = await createDeliveredOrder();
    api.respond = (ids) => ids.map((c) => pendingReturn(c));
    await syncTiktokReturnsForOrders(await channel(), [o.code]);
    const again = await syncTiktokReturnsForOrders(await channel(), [o.code]);
    expect(again).toMatchObject({ scanned: 1, flagged: 0, unflagged: 0 });

    api.respond = (ids) => ids.map((c) => pendingReturn(c, { return_status: "RETURN_OR_REFUND_REQUEST_REJECT" }));
    const rejected = await syncTiktokReturnsForOrders(await channel(), [o.code]);
    expect(rejected).toMatchObject({ unflagged: 1 });
    const after = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(after.returnStatus).toBe(ReturnStatus.NONE);
  });

  it("sàn không có yêu cầu nào / đơn chưa có trong DB / mã rỗng → không ghi, không ném lỗi", async () => {
    const o = await createDeliveredOrder();
    expect(await syncTiktokReturnsForOrders(await channel(), [o.code])).toMatchObject({ scanned: 0, withReturns: 0 });
    api.respond = (ids) => ids.map((c) => pendingReturn(c));
    expect(await syncTiktokReturnsForOrders(await channel(), ["TEST-KHONG-CO"])).toMatchObject({ scanned: 1, ordersNotFound: 1, flagged: 0 });
    expect(await syncTiktokReturnsForOrders(await channel(), ["", "  "])).toMatchObject({ scanned: 0 });
    expect(api.calls).toEqual([[o.code], ["TEST-KHONG-CO"]]);
  });

  it("sàn trả yêu cầu của đơn KHÔNG hỏi (bộ lọc order_ids vô hiệu) → ném lỗi, không ghi", async () => {
    const o = await createDeliveredOrder();
    const other = await createDeliveredOrder();
    api.respond = () => [pendingReturn(other.code)];
    await expect(syncTiktokReturnsForOrders(await channel(), [o.code])).rejects.toThrow(/không nằm trong order_ids/);
    const after = await prisma.order.findUniqueOrThrow({ where: { id: other.id } });
    expect(after.returnStatus).toBe(ReturnStatus.NONE);
  });
});
