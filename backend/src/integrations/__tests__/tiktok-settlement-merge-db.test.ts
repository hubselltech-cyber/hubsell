// ============================================================
// SAO KÊ TIKTOK = TỔNG MỌI DÒNG Ở MỌI BẢN KÊ CỦA ĐƠN (02/10/2026)
//
// Sự cố prod: lượt đối soát theo nhịp chỉ đọc bản kê 7 ngày gần nhất rồi GHI ĐÈ
// sao kê của đơn. Đơn có dòng BÁN ở bản kê cũ và dòng HOÀN ở bản kê mới → sao kê
// chỉ còn dòng hoàn, tiền quyết toán âm gần bằng giá bán (43 đơn / 5 gian, lỗ ảo
// khoảng 11,55 triệu; đơn 586047642877461564 gian LUMI SOLAR ghi −688.636).
//
// Chạy trên DB dev với một gian tự dựng; API bản kê của sàn thay bằng bản giả.
// Cần hai cột mới (migration 20261002210000 + 20261002210100); DB dev chưa áp thì
// cả file tự bỏ qua. Quy tắc quyết định thuần kiểm ở settlement-merge.test.ts.
// ============================================================

import "./load-env";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelName } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { createStockFixture, type StockFixture } from "./fixtures";
import type { TikTokTxBreakdown } from "../tiktok/client";

const api = vi.hoisted(() => ({
  /** Bản kê sàn đang có: id + mốc bản kê (giây). */
  statements: [] as { id: string; statement_time: number }[],
  /** Dòng giao dịch theo bản kê. */
  linesOf: new Map<string, unknown[]>(),
  /** Bản kê đọc dòng bị lỗi (giả lập sàn chập chờn). */
  broken: new Set<string>(),
  /** Các lượt đọc dòng theo bản kê, theo thứ tự gọi. */
  txCalls: [] as string[],
}));
vi.mock("../tiktok/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("../tiktok/client")>();
  return {
    ...real,
    fetchSettlements: async (p: { statementTimeGe?: number; statementTimeLt?: number }) => ({
      statements: api.statements.filter(
        (s) =>
          s.statement_time >= (p.statementTimeGe ?? 0) &&
          s.statement_time < (p.statementTimeLt ?? Number.MAX_SAFE_INTEGER)
      ),
    }),
    fetchStatementTransactionsV2: async (p: { statementId: string }) => {
      api.txCalls.push(p.statementId);
      if (api.broken.has(p.statementId)) throw new Error("giả lập: sàn lỗi bản kê");
      return { transactions: (api.linesOf.get(p.statementId) ?? []) as TikTokTxBreakdown[] };
    },
  };
});

import { syncTiktokSettlements } from "../tiktok/service";

const DAY = 86_400;
const nowSec = () => Math.floor(Date.now() / 1000);

const columnsReady: boolean = await (async () => {
  try {
    const r = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM information_schema.columns
      WHERE (table_name = 'tiktok_order_settlements' AND column_name = 'statementIds')
         OR (table_name = 'Channel' AND column_name = 'settlementRebuildPending')`;
    return Number(r[0]?.n ?? 0) === 2;
  } catch {
    return false;
  }
})();

describe.skipIf(!columnsReady)("TikTok — sao kê của đơn không bị lượt quét hẹp ghi đè", () => {
  let fx: StockFixture;
  let seq = 0;

  const channel = () => prisma.channel.findUniqueOrThrow({ where: { id: fx.channelId } });

  async function createOrder(daysAgo: number): Promise<{ id: string; code: string }> {
    seq += 1;
    const code = `TEST-${fx.suffix}-S${seq}`;
    const o = await prisma.order.create({
      data: {
        channelId: fx.channelId,
        orderCode: code,
        customerName: "Khách test",
        itemCount: 1,
        totalAmount: 620_000,
        shippingStatus: "DELIVERED",
        createdAt: new Date(Date.now() - daysAgo * DAY * 1000),
        items: { create: { channelSku: `SKU-${seq}`, productName: "Đèn test", quantity: 1, price: 620_000 } },
      },
    });
    return { id: o.id, code };
  }

  /** Dòng BÁN: giá gốc 1.390.000, chiết khấu shop 770.000, hoa hồng 60.000 → về ví 560.000. */
  const saleLine = (code: string): TikTokTxBreakdown => ({
    type: "ORDER",
    order_id: code,
    settlement_amount: "560000",
    revenue_amount: "620000",
    fee_tax_amount: "-60000",
    revenue_breakdown: { subtotal_before_discount_amount: "1390000", seller_discount_amount: "-770000" },
    fee_tax_breakdown: { fee: { platform_commission_amount: "-60000" } },
  });
  /** Dòng HOÀN: đảo doanh thu 620.000 + phí ship trả hàng → trừ ví 688.636 (số ca LUMI). */
  const refundLine = (code: string): TikTokTxBreakdown => ({
    type: "REFUND",
    order_id: code,
    settlement_amount: "-688636",
    revenue_amount: "-620000",
    shipping_cost_amount: "-68636",
    revenue_breakdown: {
      refund_subtotal_before_discount_amount: "-1390000",
      seller_discount_refund_amount: "770000",
    },
    shipping_cost_breakdown: { return_shipping_fee_amount: "-68636" },
  });

  function statement(id: string, daysAgo: number, lines: TikTokTxBreakdown[]) {
    api.statements.push({ id, statement_time: nowSec() - daysAgo * DAY });
    api.linesOf.set(id, lines);
  }

  const rowOf = (id: string) =>
    prisma.order.findUniqueOrThrow({ where: { id }, include: { tiktokSettlement: true } });

  beforeAll(async () => {
    fx = await createStockFixture("ttsettlemerge");
    await prisma.channel.update({
      where: { id: fx.channelId },
      data: {
        channelName: ChannelName.TIKTOK,
        apiToken: "test-access-token",
        shopCipher: "test-cipher",
        accessTokenExpireAt: new Date(Date.now() + 3_600_000),
      },
    });
  });

  beforeEach(() => {
    api.statements = [];
    api.linesOf.clear();
    api.broken.clear();
    api.txCalls = [];
  });

  afterAll(async () => {
    await fx?.cleanup();
  });

  it("dòng bán ở bản kê cũ, dòng hoàn ở bản kê mới: lượt 7 ngày cộng đủ hai bản kê, lượt sau không đọc lại", async () => {
    const o = await createOrder(25);
    statement("ST-A1", 20, [saleLine(o.code)]);

    // Lượt đầu (gian vừa nối, cửa sổ rộng): chỉ mới có bản kê bán.
    await syncTiktokSettlements(await channel(), { daysBack: 30 });
    let row = await rowOf(o.id);
    expect(Number(row.actualPayout)).toBe(560_000);
    expect(row.tiktokSettlement?.statementIds).toEqual(["ST-A1"]);

    // Ba tuần sau khách trả hàng: dòng hoàn rơi vào bản kê mới; lượt nhịp giờ chỉ thấy bản kê này.
    statement("ST-A2", 1, [refundLine(o.code)]);
    api.txCalls = [];
    await syncTiktokSettlements(await channel(), { daysBack: 7 });

    expect(api.txCalls).toEqual(["ST-A2", "ST-A1"]); // đọc bản kê mới, rồi đọc lại bản kê cũ của đơn
    row = await rowOf(o.id);
    const st = row.tiktokSettlement!;
    expect(Number(st.grossSales)).toBe(1_390_000); // dòng bán CÒN NGUYÊN
    expect(Number(st.refundGross)).toBe(-1_390_000);
    expect(Number(st.settlementAmount)).toBe(560_000 - 688_636);
    expect(Number(row.actualPayout)).toBe(-128_636); // không phải −688.636
    expect(st.statementIds).toEqual(["ST-A1", "ST-A2"]);
    expect(st.statementId).toBe("ST-A2");

    // Lượt giờ kế: không có bản kê mới → không đọc lại bản kê cũ, sao kê giữ nguyên.
    api.txCalls = [];
    await syncTiktokSettlements(await channel(), { daysBack: 7 });
    expect(api.txCalls).toEqual(["ST-A2"]);
    row = await rowOf(o.id);
    expect(Number(row.actualPayout)).toBe(-128_636);
    expect(row.tiktokSettlement?.statementIds).toEqual(["ST-A1", "ST-A2"]);
  });

  it("hai bản kê cùng nằm trong cửa sổ → ghi một lượt, không phải đọc lại", async () => {
    const o = await createOrder(10);
    statement("ST-B1", 5, [saleLine(o.code)]);
    statement("ST-B2", 2, [refundLine(o.code)]);

    await syncTiktokSettlements(await channel(), { daysBack: 7 });

    expect([...api.txCalls].sort()).toEqual(["ST-B1", "ST-B2"]);
    const row = await rowOf(o.id);
    expect(Number(row.actualPayout)).toBe(-128_636);
    expect(row.tiktokSettlement?.statementIds).toEqual(["ST-B1", "ST-B2"]);
  });

  it("bản kê cũ đọc lại bị lỗi → KHÔNG ghi nửa chừng, giữ sao kê đang lưu; lượt sau sàn ổn thì cộng đủ", async () => {
    const o = await createOrder(25);
    statement("ST-C1", 20, [saleLine(o.code)]);
    await syncTiktokSettlements(await channel(), { daysBack: 30 });

    statement("ST-C2", 1, [refundLine(o.code)]);
    api.broken.add("ST-C1");
    await syncTiktokSettlements(await channel(), { daysBack: 7 });
    let row = await rowOf(o.id);
    expect(Number(row.actualPayout)).toBe(560_000); // vẫn là sao kê cũ, chưa cộng dòng hoàn
    expect(row.tiktokSettlement?.statementIds).toEqual(["ST-C1"]);

    api.broken.clear();
    await syncTiktokSettlements(await channel(), { daysBack: 7 });
    row = await rowOf(o.id);
    expect(Number(row.actualPayout)).toBe(-128_636);
    expect(row.tiktokSettlement?.statementIds).toEqual(["ST-C1", "ST-C2"]);
  });

  it("DỰNG LẠI: sao kê đã bị ghi đè từ trước (chỉ còn dòng hoàn) được sửa khi đọc lại toàn bộ bản kê", async () => {
    const o = await createOrder(50);
    // Trạng thái hỏng trên prod: dòng ghi kiểu cũ (chưa có danh sách bản kê), chỉ còn dòng hoàn.
    await prisma.tiktokOrderSettlement.create({
      data: {
        orderId: o.id,
        estimated: false,
        statementId: "ST-D2",
        refundGross: -1_390_000,
        sellerDiscountRefund: 770_000,
        settlementAmount: -688_636,
        settledAt: new Date(Date.now() - 5 * DAY * 1000),
      },
    });
    await prisma.order.update({ where: { id: o.id }, data: { isSettled: true, actualPayout: -688_636 } });
    statement("ST-D1", 40, [saleLine(o.code)]); // nằm ở cửa sổ 30 ngày đầu
    statement("ST-D2", 5, [refundLine(o.code)]); // nằm ở cửa sổ sau

    await syncTiktokSettlements(await channel()); // không truyền mốc = đọc từ đơn cũ nhất

    const row = await rowOf(o.id);
    const st = row.tiktokSettlement!;
    expect(Number(st.grossSales)).toBe(1_390_000);
    expect(Number(st.settlementAmount)).toBe(-128_636);
    expect(Number(row.actualPayout)).toBe(-128_636);
    expect(st.statementIds).toEqual(["ST-D1", "ST-D2"]);
  });

  it("đơn chỉ có một bản kê: mọi lượt đều ghi lại như cũ, không gọi thừa", async () => {
    const o = await createOrder(6);
    statement("ST-E1", 3, [saleLine(o.code)]);
    await syncTiktokSettlements(await channel(), { daysBack: 7 });
    api.txCalls = [];
    await syncTiktokSettlements(await channel(), { daysBack: 7 });

    expect(api.txCalls).toEqual(["ST-E1"]);
    const row = await rowOf(o.id);
    expect(Number(row.actualPayout)).toBe(560_000);
    expect(row.isSettled).toBe(true);
    expect(row.tiktokSettlement?.statementIds).toEqual(["ST-E1"]);
  });
});
