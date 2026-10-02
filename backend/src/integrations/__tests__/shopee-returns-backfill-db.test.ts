// ============================================================
// QUÉT BÙ YÊU CẦU HOÀN SHOPEE THEO MÃ ĐƠN (02/10/2026) — chạy trên DB dev với
// một gian tự dựng; API sàn (get_escrow_detail, get_return_detail) + token thay
// bằng bản giả.
//
// Cùng bệnh với TikTok (tiktok-returns-backfill-db.test.ts): đơn có tiền hoàn
// trên sao kê mà yêu cầu hoàn đã xong trước ngày nối gian → Lãi/Lỗ coi là khách
// giữ hàng, trừ nguyên giá vốn. Shopee không tra được yêu cầu hoàn theo mã đơn
// trong get_return_list nên đi qua return_order_sn_list của get_escrow_detail.
//
// Cần cột Order.returnLookupAt (migration 20261002200000); DB dev chưa áp thì
// cả file tự bỏ qua.
// ============================================================

import "./load-env";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ReturnSolution, ReturnStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { createStockFixture, type StockFixture } from "./fixtures";
import type { ShopeeReturnDetail } from "../shopee/client";

const api = vi.hoisted(() => ({
  escrowCalls: [] as string[],
  detailCalls: [] as string[],
  /** order_sn → danh sách return_sn sàn trả trong get_escrow_detail. */
  returnsOf: new Map<string, string[]>(),
  /** return_sn → chi tiết yêu cầu hoàn; thiếu = get_return_detail ném lỗi. */
  detailOf: new Map<string, unknown>(),
}));
vi.mock("../shopee/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("../shopee/client")>();
  return {
    ...real,
    getEscrowDetail: async (p: { orderSn: string }) => {
      api.escrowCalls.push(p.orderSn);
      return { response: { order_sn: p.orderSn, return_order_sn_list: api.returnsOf.get(p.orderSn) ?? [] } };
    },
    getReturnDetail: async (_token: string, _shop: string, returnSn: string) => {
      api.detailCalls.push(returnSn);
      const d = api.detailOf.get(returnSn);
      if (!d) throw new Error("giả lập: sàn lỗi chi tiết yêu cầu hoàn");
      return d as ShopeeReturnDetail;
    },
  };
});
vi.mock("../shopee/service", async (importOriginal) => {
  const real = await importOriginal<typeof import("../shopee/service")>();
  return { ...real, getValidShopeeAccessToken: async () => ({ accessToken: "t", shopId: "1" }) };
});

import { computePnlRow, PNL_INCLUDE } from "../../lib/pnl-formula";
import { backfillShopeeReturnsByOrder } from "../shopee/returns-sync";

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

describe.skipIf(!columnReady)("Shopee — quét bù yêu cầu hoàn theo mã đơn", () => {
  let fx: StockFixture;
  let seq = 0;

  const channel = () => prisma.channel.findUniqueOrThrow({ where: { id: fx.channelId } });

  /** Đơn đã giao, đã đối soát, sao kê có tiền hoàn đủ, ví âm 4.620, giá vốn 140.000. */
  async function createRefundedOrder(over: Record<string, unknown> = {}): Promise<{ id: string; code: string }> {
    seq += 1;
    const code = `TEST-${fx.suffix}-R${seq}`;
    const o = await prisma.order.create({
      data: {
        channelId: fx.channelId,
        orderCode: code,
        customerName: "Khách test",
        itemCount: 1,
        totalAmount: 249_000,
        shippingStatus: "DELIVERED",
        isSettled: true,
        actualPayout: -4_620,
        refundedAmount: 249_000,
        items: {
          create: { channelSku: `SKU-${seq}`, productName: "Giày test", quantity: 1, price: 249_000, costPriceAtSale: 140_000 },
        },
        ...over,
      },
    });
    return { id: o.id, code };
  }

  /** Sàn có một yêu cầu hoàn cho đơn — mặc định: trả hàng, đã hoàn tiền, kiện đã về tay. */
  function platformReturn(code: string, over: Partial<ShopeeReturnDetail> = {}): string {
    const sn = `RET-${code}`;
    api.returnsOf.set(code, [sn]);
    api.detailOf.set(sn, {
      return_sn: sn,
      order_sn: code,
      status: "ACCEPTED",
      return_solution: 0,
      needs_logistics: true,
      refund_amount: 249_000,
      create_time: 1_757_000_000,
      update_time: 1_757_500_000,
      tracking_number: "SPXVNRET1",
      reverse_logistics_status: "LOGISTICS_DELIVERY_DONE",
      ...over,
    });
    return sn;
  }

  const pnlOf = async (id: string) =>
    computePnlRow(await prisma.order.findUniqueOrThrow({ where: { id }, include: PNL_INCLUDE }));

  beforeAll(async () => {
    fx = await createStockFixture("spretbackfill"); // gian mặc định của fixture là SHOPEE
  });

  beforeEach(async () => {
    api.escrowCalls = [];
    api.detailCalls = [];
    api.returnsOf.clear();
    api.detailOf.clear();
    // Mỗi ca tự dựng đơn của mình — đóng mốc đơn của ca trước để không lẫn.
    await prisma.order.updateMany({
      where: { channelId: fx.channelId, returnLookupAt: null },
      data: { returnLookupAt: new Date() },
    });
  });

  afterAll(async () => {
    await fx?.cleanup();
  });

  it("sàn báo TRẢ HÀNG đã hoàn tiền + kiện đã về tay → thu hồi giá vốn, lỗ chỉ còn tiền sàn trừ; không cắm chờ hàng", async () => {
    const o = await createRefundedOrder();
    expect((await pnlOf(o.id)).profitAfterTax).toBe(-144_620); // trước quét bù: coi là khách giữ hàng
    expect((await pnlOf(o.id)).returnType).toBe("REFUND_ONLY");
    const sn = platformReturn(o.code);

    const r = await backfillShopeeReturnsByOrder(await channel());

    expect(api.escrowCalls).toEqual([o.code]);
    expect(api.detailCalls).toEqual([sn]); // chi tiết đọc MỘT lần, không hỏi lại khi kiểm kiện về
    expect(r).toMatchObject({ candidates: 1, looked: 1, withReturns: 1, delivered: 1, flagged: 0, failed: 0, more: false });
    const after = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(after.returnSolution).toBe(ReturnSolution.RETURN_REFUND);
    expect(after.returnStatus).toBe(ReturnStatus.NONE);
    expect(after.platformReturnStatus).toBe("ACCEPTED");
    expect(after.returnDeliveredAt?.getTime()).toBe(1_757_500_000 * 1000);
    expect(after.returnLookupAt).not.toBeNull();

    const pnl = await pnlOf(o.id);
    expect(pnl.returnType).toBe("FULL_RETURN");
    expect(pnl.recoveredCost).toBe(140_000);
    expect(pnl.profitAfterTax).toBe(-4_620);
  });

  it("sàn báo CHỈ HOÀN TIỀN (khách giữ hàng) → vẫn mất nguyên giá vốn", async () => {
    const o = await createRefundedOrder();
    platformReturn(o.code, { return_solution: 1, needs_logistics: false, reverse_logistics_status: undefined });

    const r = await backfillShopeeReturnsByOrder(await channel());

    expect(r).toMatchObject({ looked: 1, withReturns: 1, delivered: 0, flagged: 0 });
    const after = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(after.returnSolution).toBe(ReturnSolution.REFUND_ONLY);
    expect(after.returnDeliveredAt).toBeNull();
    expect(after.returnStatus).toBe(ReturnStatus.NONE);
    const pnl = await pnlOf(o.id);
    expect(pnl.returnType).toBe("REFUND_ONLY");
    expect(pnl.profitAfterTax).toBe(-144_620);
  });

  it("trả hàng đã hoàn tiền nhưng sàn CHƯA báo kiện về tay → cắm chờ kho xác nhận, chưa thu hồi vốn", async () => {
    const o = await createRefundedOrder();
    platformReturn(o.code, { reverse_logistics_status: "LOGISTICS_LOST" });

    const r = await backfillShopeeReturnsByOrder(await channel());

    expect(r).toMatchObject({ looked: 1, withReturns: 1, delivered: 0, flagged: 1 });
    const after = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(after.returnSolution).toBe(ReturnSolution.RETURN_REFUND);
    expect(after.returnStatus).toBe(ReturnStatus.AWAITING);
    expect(after.returnDeliveredAt).toBeNull();
    expect((await pnlOf(o.id)).profitAfterTax).toBe(-144_620);
  });

  it("sàn không có yêu cầu hoàn nào → giữ cách tính cũ, đóng mốc, lượt sau KHÔNG hỏi lại", async () => {
    const o = await createRefundedOrder();
    const r1 = await backfillShopeeReturnsByOrder(await channel());
    expect(r1).toMatchObject({ candidates: 1, looked: 1, withReturns: 0 });
    expect(api.detailCalls).toHaveLength(0);
    const after = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(after.returnSolution).toBeNull();
    expect(after.returnLookupAt).not.toBeNull();
    expect((await pnlOf(o.id)).profitAfterTax).toBe(-144_620);

    api.escrowCalls = [];
    const r2 = await backfillShopeeReturnsByOrder(await channel());
    expect(r2.candidates).toBe(0);
    expect(api.escrowCalls).toHaveLength(0);
  });

  it("sàn lỗi ở bước chi tiết → không ghi, không đóng mốc; đơn nghỉ, lượt kế không hỏi lại ngay; đơn khác vẫn chạy", async () => {
    const bad = await createRefundedOrder();
    api.returnsOf.set(bad.code, [`RET-${bad.code}`]); // có mã yêu cầu nhưng get_return_detail ném lỗi
    const good = await createRefundedOrder();
    platformReturn(good.code);

    const r = await backfillShopeeReturnsByOrder(await channel());
    expect(r).toMatchObject({ candidates: 2, looked: 1, failed: 1, delivered: 1 });
    const badAfter = await prisma.order.findUniqueOrThrow({ where: { id: bad.id } });
    expect(badAfter.returnLookupAt).toBeNull();
    expect(badAfter.returnSolution).toBeNull();
    expect((await prisma.order.findUniqueOrThrow({ where: { id: good.id } })).returnLookupAt).not.toBeNull();

    api.escrowCalls = [];
    const r2 = await backfillShopeeReturnsByOrder(await channel());
    expect(r2.candidates).toBe(0); // đơn lỗi đang nghỉ 6 giờ
    expect(api.escrowCalls).toHaveLength(0);
  });

  it("đơn HỦY có tiền hoàn, đơn không có tiền hoàn, đơn đã có giải pháp hoàn → không hỏi sàn", async () => {
    await createRefundedOrder({ shippingStatus: "CANCELLED" });
    await createRefundedOrder({ refundedAmount: 0 });
    await createRefundedOrder({ returnSolution: ReturnSolution.REFUND_ONLY });
    const r = await backfillShopeeReturnsByOrder(await channel());
    expect(r.candidates).toBe(0);
    expect(api.escrowCalls).toHaveLength(0);
  });

  it("đơn có hai yêu cầu (một bị hủy, một đã xong) → đọc cả hai, quyết theo yêu cầu còn sống", async () => {
    const o = await createRefundedOrder();
    const live = platformReturn(o.code);
    const dead = `RET-${o.code}-CU`;
    api.returnsOf.set(o.code, [dead, live]);
    api.detailOf.set(dead, { return_sn: dead, order_sn: o.code, status: "CANCELLED", return_solution: 1, update_time: 1_757_600_000 });

    const r = await backfillShopeeReturnsByOrder(await channel());

    expect(api.detailCalls).toEqual([dead, live]);
    expect(r).toMatchObject({ looked: 1, withReturns: 1, scanned: 2, delivered: 1 });
    const after = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(after.returnSolution).toBe(ReturnSolution.RETURN_REFUND);
    expect((await pnlOf(o.id)).profitAfterTax).toBe(-4_620);
  });
});
