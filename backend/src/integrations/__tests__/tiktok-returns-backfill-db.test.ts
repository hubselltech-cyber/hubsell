// ============================================================
// QUÉT BÙ YÊU CẦU HOÀN TIKTOK THEO MÃ ĐƠN (02/10/2026) — chạy trên DB dev với
// một gian tự dựng; API sàn (returns/search) + token thay bằng bản giả.
//
// Ca gốc: đơn 585860564513293743 gian Giày Dép Đức Khải (nối 02/10) — bản kê
// có tiền hoàn 249.000, tiền quyết toán −4.620, giá vốn 140.000, nhưng yêu cầu
// trả hàng đã xong từ tháng 9 nên lượt quét 2 / 7 ngày không đọc được → Lãi/Lỗ
// coi là khách giữ hàng, lỗ −144.620. Sau quét bù phải ra −4.620.
//
// Cần cột Order.returnLookupAt (migration 20261002200000); DB dev chưa áp thì
// cả file tự bỏ qua.
// ============================================================

import "./load-env";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelName, ReturnSolution, ReturnStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { createStockFixture, type StockFixture } from "./fixtures";
import type { TikTokReturnOrder } from "../tiktok/client";

const api = vi.hoisted(() => ({
  calls: [] as string[][],
  fail: false,
  respond: (_orderIds: string[]): unknown[] => [],
}));
vi.mock("../tiktok/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("../tiktok/client")>();
  return {
    ...real,
    searchReturns: async (p: { orderIds?: string[] }) => {
      api.calls.push(p.orderIds ?? []);
      if (api.fail) throw new Error("giả lập: sàn lỗi");
      return { return_orders: api.respond(p.orderIds ?? []) as TikTokReturnOrder[] };
    },
  };
});
vi.mock("../tiktok/service", async (importOriginal) => {
  const real = await importOriginal<typeof import("../tiktok/service")>();
  return { ...real, getValidAccessToken: async () => ({ accessToken: "t", shopCipher: "c" }) };
});

import { computePnlRow, PNL_INCLUDE } from "../../lib/pnl-formula";
import { backfillTiktokReturnsByOrder } from "../tiktok/returns-sync";

const columnReady: boolean = await (async () => {
  try {
    const r = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM information_schema.columns
      WHERE table_name = 'Order' AND column_name = 'returnLookupAt'`;
    return Number(r[0]?.n ?? 0) > 0;
  } catch {
    return false;
  }
})();

describe.skipIf(!columnReady)("TikTok — quét bù yêu cầu hoàn theo mã đơn", () => {
  let fx: StockFixture;
  let seq = 0;

  const channel = () => prisma.channel.findUniqueOrThrow({ where: { id: fx.channelId } });

  /** Đơn đã giao, đã đối soát, bản kê có tiền hoàn — khuôn ca Đức Khải. */
  async function createRefundedOrder(over: Record<string, unknown> = {}): Promise<{ id: string; code: string }> {
    seq += 1;
    const code = `TEST-${fx.suffix}-R${seq}`;
    const o = await prisma.order.create({
      data: {
        channelId: fx.channelId,
        orderCode: code,
        customerName: "Khách test",
        itemCount: 1,
        totalAmount: 224_100,
        shippingStatus: "DELIVERED",
        isSettled: true,
        actualPayout: -4_620,
        refundedAmount: 249_000,
        items: {
          create: { channelSku: `SKU-${seq}`, productName: "Giày test", quantity: 1, price: 224_100, costPriceAtSale: 140_000 },
        },
        tiktokSettlement: {
          create: { estimated: false, grossSales: 309_000, sellerDiscount: -60_000, settlementAmount: -4_620 },
        },
        ...over,
      },
    });
    return { id: o.id, code };
  }

  const completedReturn = (code: string, over: Partial<TikTokReturnOrder> = {}): TikTokReturnOrder => ({
    return_id: `RET-${code}`,
    order_id: code,
    return_type: "RETURN_AND_REFUND",
    return_status: "RETURN_OR_REFUND_REQUEST_COMPLETE",
    create_time: 1_757_000_000,
    update_time: 1_757_500_000,
    refund_amount: { currency: "VND", refund_total: "224100" },
    return_line_items: [{ return_line_item_id: "L1", seller_sku: "" }],
    ...over,
  });

  const pnlOf = async (id: string) =>
    computePnlRow(await prisma.order.findUniqueOrThrow({ where: { id }, include: PNL_INCLUDE }));

  beforeAll(async () => {
    fx = await createStockFixture("ttretbackfill");
    await prisma.channel.update({ where: { id: fx.channelId }, data: { channelName: ChannelName.TIKTOK } });
  });

  beforeEach(async () => {
    api.calls = [];
    api.fail = false;
    api.respond = () => [];
    // Mỗi ca tự dựng đơn của mình — đóng mốc đơn của ca trước để không lẫn.
    await prisma.order.updateMany({
      where: { channelId: fx.channelId, returnLookupAt: null },
      data: { returnLookupAt: new Date() },
    });
  });

  afterAll(async () => {
    await fx?.cleanup();
  });

  it("đơn có tiền hoàn, sàn báo TRẢ HÀNG đã xong → thu hồi giá vốn, lỗ chỉ còn tiền sàn trừ; không cắm chờ hàng", async () => {
    const o = await createRefundedOrder();
    expect((await pnlOf(o.id)).profitAfterTax).toBe(-144_620); // trước quét bù: coi là khách giữ hàng
    expect((await pnlOf(o.id)).returnType).toBe("REFUND_ONLY");

    api.respond = (ids) => ids.filter((c) => c === o.code).map((c) => completedReturn(c));
    const r = await backfillTiktokReturnsByOrder(await channel());

    expect(api.calls).toEqual([[o.code]]);
    expect(r).toMatchObject({ candidates: 1, looked: 1, withReturns: 1, delivered: 1, flagged: 0, keptByBuyer: 0, more: false });
    const after = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(after.returnSolution).toBe(ReturnSolution.RETURN_REFUND);
    expect(after.returnStatus).toBe(ReturnStatus.NONE);
    expect(after.platformReturnStatus).toBe("RETURN_OR_REFUND_REQUEST_COMPLETE");
    expect(after.returnDeliveredAt?.getTime()).toBe(1_757_500_000 * 1000);
    expect(after.returnLookupAt).not.toBeNull();

    const pnl = await pnlOf(o.id);
    expect(pnl.returnType).toBe("FULL_RETURN");
    expect(pnl.costSnapshot).toBe(0);
    expect(pnl.recoveredCost).toBe(140_000);
    expect(pnl.profitAfterTax).toBe(-4_620);
  });

  it("sàn cho khách GIỮ HÀNG dù là yêu cầu trả hàng → vẫn mất nguyên giá vốn", async () => {
    const o = await createRefundedOrder();
    api.respond = (ids) => ids.map((c) => completedReturn(c, { can_buyer_keep_item: true }));
    const r = await backfillTiktokReturnsByOrder(await channel());

    expect(r).toMatchObject({ looked: 1, withReturns: 1, keptByBuyer: 1, delivered: 0 });
    const after = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(after.returnSolution).toBe(ReturnSolution.REFUND_ONLY);
    expect(after.returnDeliveredAt).toBeNull();
    const pnl = await pnlOf(o.id);
    expect(pnl.returnType).toBe("REFUND_ONLY");
    expect(pnl.profitAfterTax).toBe(-144_620);
  });

  it("sàn không có yêu cầu hoàn nào → giữ cách tính cũ, đóng mốc, lượt sau KHÔNG hỏi lại", async () => {
    const o = await createRefundedOrder();
    const r1 = await backfillTiktokReturnsByOrder(await channel());
    expect(r1).toMatchObject({ candidates: 1, looked: 1, withReturns: 0 });
    const after = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(after.returnSolution).toBeNull();
    expect(after.returnLookupAt).not.toBeNull();
    expect((await pnlOf(o.id)).profitAfterTax).toBe(-144_620);

    api.calls = [];
    const r2 = await backfillTiktokReturnsByOrder(await channel());
    expect(r2.candidates).toBe(0);
    expect(api.calls).toHaveLength(0);
  });

  it("đơn HỦY có tiền hoàn, đơn không có tiền hoàn, đơn đã có giải pháp hoàn → không hỏi sàn", async () => {
    await createRefundedOrder({ shippingStatus: "CANCELLED" });
    await createRefundedOrder({ refundedAmount: 0 });
    await createRefundedOrder({
      returnSolution: ReturnSolution.RETURN_REFUND,
      platformReturnStatus: "RETURN_OR_REFUND_REQUEST_COMPLETE",
      returnDeliveredAt: new Date(1_757_500_000 * 1000),
    });
    const r = await backfillTiktokReturnsByOrder(await channel());
    expect(r.candidates).toBe(0);
    expect(api.calls).toHaveLength(0);
  });

  it("sàn lỗi → không đóng mốc, lượt sau hỏi lại", async () => {
    const o = await createRefundedOrder();
    api.fail = true;
    await expect(backfillTiktokReturnsByOrder(await channel())).rejects.toThrow("sàn lỗi");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).returnLookupAt).toBeNull();

    api.fail = false;
    api.respond = (ids) => ids.map((c) => completedReturn(c));
    const r = await backfillTiktokReturnsByOrder(await channel());
    expect(r).toMatchObject({ looked: 1, delivered: 1 });
  });

  it("sàn trả yêu cầu của đơn KHÔNG hỏi (bộ lọc order_ids vô hiệu) → dừng, không ghi, không đóng mốc", async () => {
    const o = await createRefundedOrder();
    api.respond = () => [completedReturn("DON-KHAC")];
    await expect(backfillTiktokReturnsByOrder(await channel())).rejects.toThrow("không nằm trong order_ids");
    const after = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(after.returnLookupAt).toBeNull();
    expect(after.returnSolution).toBeNull();
  });

  it("nhiều đơn → hỏi theo lô (mặc định 20 đơn mỗi lượt gọi), đóng mốc đủ", async () => {
    const made: string[] = [];
    for (let i = 0; i < 23; i++) made.push((await createRefundedOrder()).code);
    api.respond = (ids) => ids.map((c) => completedReturn(c));
    const r = await backfillTiktokReturnsByOrder(await channel());

    expect(api.calls.map((c) => c.length)).toEqual([20, 3]);
    expect(new Set(api.calls.flat())).toEqual(new Set(made));
    expect(r).toMatchObject({ candidates: 23, looked: 23, withReturns: 23, delivered: 23 });
    const left = await prisma.order.count({ where: { channelId: fx.channelId, returnLookupAt: null } });
    expect(left).toBe(0);
  });
});
