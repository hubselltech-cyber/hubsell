// ============================================================
// SAO KÊ LAZADA = TỔNG MỌI DÒNG Ở MỌI NGÀY CỦA ĐƠN (02/10/2026)
//
// Cùng lỗi với TikTok (tiktok-settlement-merge-db.test.ts): lượt đối soát theo
// nhịp chỉ đọc sao kê 7 ngày gần nhất rồi GHI ĐÈ sao kê của đơn. Đơn có dòng bán
// ngày này và dòng đảo / hoàn hơn một tuần sau → sao kê chỉ còn dòng đảo.
//
// Chạy trên DB dev với một gian tự dựng; API sao kê của sàn thay bằng bản giả
// (lọc theo ngày và theo trade_order_id như sàn). Cần cột lineDayKeys (migration
// 20261002220000); DB dev chưa áp thì cả file tự bỏ qua.
// ============================================================

import "./load-env";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelName } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { createStockFixture, type StockFixture } from "./fixtures";

interface FakeLine {
  order_no: string;
  fee_name: string;
  amount: string;
  transaction_date: string;
}

const api = vi.hoisted(() => ({
  lines: [] as { order_no: string; fee_name: string; amount: string; transaction_date: string }[],
  /** Các lượt gọi đọc theo MÃ ĐƠN (trade_order_id), theo thứ tự. */
  orderCalls: [] as string[],
  /** Lượt gọi đọc theo cửa sổ ngày (không lọc đơn). */
  windowCalls: 0,
  /** Giả lập sàn lỗi khi đọc theo mã đơn. */
  failOrderRead: false,
}));
vi.mock("../lazada/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lazada/client")>();
  return {
    ...real,
    getTransactionDetails: async (p: { startTime: string; endTime: string; offset?: number; tradeOrderId?: string }) => {
      if (p.tradeOrderId) {
        api.orderCalls.push(p.tradeOrderId);
        if (api.failOrderRead) throw new Error("giả lập: sàn lỗi đọc theo đơn");
      } else {
        api.windowCalls += 1;
      }
      if ((p.offset ?? 0) > 0) return [];
      const dayOf = (s: string) => new Date(`${s} UTC`).toISOString().slice(0, 10);
      return api.lines.filter(
        (l) =>
          dayOf(l.transaction_date) >= p.startTime &&
          dayOf(l.transaction_date) <= p.endTime &&
          (!p.tradeOrderId || l.order_no === p.tradeOrderId)
      );
    },
  };
});

import { syncLazadaSettlements } from "../lazada/service";

const DAY_MS = 86_400_000;
/** Ngày giao dịch kiểu sàn trả ("02 Oct 2026") cách hôm nay N ngày. */
const dayAgo = (n: number) => new Date(Date.now() - n * DAY_MS).toUTCString().slice(5, 16);

const columnReady: boolean = await (async () => {
  try {
    const r = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM information_schema.columns
      WHERE table_name = 'lazada_order_settlements' AND column_name = 'lineDayKeys'`;
    return Number(r[0]?.n ?? 0) > 0;
  } catch {
    return false;
  }
})();

describe.skipIf(!columnReady)("Lazada — sao kê của đơn không bị lượt quét hẹp ghi đè", () => {
  let fx: StockFixture;
  let seq = 0;

  const channel = () => prisma.channel.findUniqueOrThrow({ where: { id: fx.channelId } });

  async function createOrder(daysAgo: number): Promise<{ id: string; code: string }> {
    seq += 1;
    const code = `9${Date.now()}${seq}`;
    const o = await prisma.order.create({
      data: {
        channelId: fx.channelId,
        orderCode: code,
        customerName: "Khách test",
        itemCount: 1,
        totalAmount: 248_000,
        shippingStatus: "DELIVERED",
        createdAt: new Date(Date.now() - daysAgo * DAY_MS),
        items: { create: { channelSku: `SKU-${seq}`, productName: "Áo test", quantity: 1, price: 248_000 } },
      },
    });
    return { id: o.id, code };
  }

  /** Dòng BÁN: tiền hàng 248.000 − hoa hồng 20.000 → về ví 228.000. */
  const saleLines = (code: string, daysAgo: number): FakeLine[] => [
    { order_no: code, fee_name: "Giá trị sản phẩm", amount: "248000", transaction_date: dayAgo(daysAgo) },
    { order_no: code, fee_name: "Phí hoa hồng", amount: "-20000", transaction_date: dayAgo(daysAgo) },
  ];
  /** Dòng ĐẢO khi khách trả hàng: đảo tiền hàng + trả lại hoa hồng + phí ship trả hàng 15.000. */
  const reversalLines = (code: string, daysAgo: number): FakeLine[] => [
    { order_no: code, fee_name: "Giá trị sản phẩm", amount: "-248000", transaction_date: dayAgo(daysAgo) },
    { order_no: code, fee_name: "Phí hoa hồng", amount: "20000", transaction_date: dayAgo(daysAgo) },
    { order_no: code, fee_name: "Phí khác của đơn trả", amount: "-15000", transaction_date: dayAgo(daysAgo) },
  ];

  const rowOf = (id: string) =>
    prisma.order.findUniqueOrThrow({ where: { id }, include: { lazadaSettlement: true } });

  beforeAll(async () => {
    fx = await createStockFixture("lzsettlemerge");
    await prisma.channel.update({
      where: { id: fx.channelId },
      data: {
        channelName: ChannelName.LAZADA,
        apiToken: "test-access-token",
        accessTokenExpireAt: new Date(Date.now() + 3_600_000),
      },
    });
  });

  beforeEach(() => {
    api.lines = [];
    api.orderCalls = [];
    api.windowCalls = 0;
    api.failOrderRead = false;
  });

  afterAll(async () => {
    await fx?.cleanup();
  });

  it("dòng bán 20 ngày trước, dòng đảo hôm qua: lượt 7 ngày đọc trọn giao dịch của đơn rồi mới ghi; lượt sau không đọc lại", async () => {
    const o = await createOrder(25);
    api.lines.push(...saleLines(o.code, 20));

    // Lượt đầu (cửa sổ rộng lúc nối gian): mới có dòng bán.
    await syncLazadaSettlements(await channel(), { daysBack: 30 });
    let row = await rowOf(o.id);
    expect(Number(row.actualPayout)).toBe(228_000);
    expect(row.lazadaSettlement?.lineDayKeys).toEqual([`${dayAgo(20)}#2`]);
    expect(api.orderCalls).toEqual([]); // mọi dòng nằm trong cửa sổ → không cần đọc theo đơn

    // Khách trả hàng: dòng đảo rơi vào hôm qua; lượt nhịp giờ chỉ thấy các dòng này.
    api.lines.push(...reversalLines(o.code, 1));
    await syncLazadaSettlements(await channel(), { daysBack: 7 });

    expect(api.orderCalls).toEqual([o.code]);
    row = await rowOf(o.id);
    const st = row.lazadaSettlement!;
    expect(Number(st.itemRevenue)).toBe(0); // 248.000 − 248.000, dòng bán CÒN NGUYÊN
    expect(Number(st.actualPayout)).toBe(-15_000);
    expect(Number(row.actualPayout)).toBe(-15_000); // không phải −243.000
    expect(st.lineDayKeys).toEqual([`${dayAgo(1)}#3`, `${dayAgo(20)}#2`].sort());

    // Lượt giờ kế: không có dòng mới → không đọc theo đơn, sao kê giữ nguyên.
    api.orderCalls = [];
    await syncLazadaSettlements(await channel(), { daysBack: 7 });
    expect(api.orderCalls).toEqual([]);
    expect(Number((await rowOf(o.id)).actualPayout)).toBe(-15_000);
  });

  it("mọi dòng của đơn đều nằm trong cửa sổ (kể cả sàn ghi thêm dòng cùng ngày) → ghi một lượt, không đọc theo đơn", async () => {
    const o = await createOrder(5);
    api.lines.push(...saleLines(o.code, 3));
    await syncLazadaSettlements(await channel(), { daysBack: 7 });
    expect(Number((await rowOf(o.id)).actualPayout)).toBe(228_000);

    api.lines.push({ order_no: o.code, fee_name: "Phí khác", amount: "-3000", transaction_date: dayAgo(3) });
    await syncLazadaSettlements(await channel(), { daysBack: 7 });

    expect(api.orderCalls).toEqual([]);
    const row = await rowOf(o.id);
    expect(Number(row.actualPayout)).toBe(225_000);
    expect(row.lazadaSettlement?.lineDayKeys).toEqual([`${dayAgo(3)}#3`]);
  });

  it("sao kê ghi kiểu cũ (chưa có danh sách ngày), đang chỉ còn dòng đảo → đọc trọn theo đơn và sửa đúng", async () => {
    const o = await createOrder(25);
    await prisma.lazadaOrderSettlement.create({
      data: { orderId: o.id, itemRevenue: -248_000, actualPayout: -243_000, settledAt: new Date(Date.now() - DAY_MS) },
    });
    await prisma.order.update({ where: { id: o.id }, data: { isSettled: true, actualPayout: -243_000 } });
    api.lines.push(...saleLines(o.code, 20), ...reversalLines(o.code, 1));

    await syncLazadaSettlements(await channel(), { daysBack: 7 });

    expect(api.orderCalls).toEqual([o.code]);
    const row = await rowOf(o.id);
    expect(Number(row.actualPayout)).toBe(-15_000);
    expect(row.lazadaSettlement?.lineDayKeys).toHaveLength(2);
  });

  it("sàn lỗi khi đọc theo đơn → KHÔNG ghi nửa chừng, giữ sao kê đang lưu; lượt sau sàn ổn thì cộng đủ", async () => {
    const o = await createOrder(25);
    api.lines.push(...saleLines(o.code, 20));
    await syncLazadaSettlements(await channel(), { daysBack: 30 });

    api.lines.push(...reversalLines(o.code, 1));
    api.failOrderRead = true;
    await syncLazadaSettlements(await channel(), { daysBack: 7 });
    let row = await rowOf(o.id);
    expect(Number(row.actualPayout)).toBe(228_000); // vẫn là sao kê cũ
    expect(row.lazadaSettlement?.lineDayKeys).toEqual([`${dayAgo(20)}#2`]);

    api.failOrderRead = false;
    await syncLazadaSettlements(await channel(), { daysBack: 7 });
    row = await rowOf(o.id);
    expect(Number(row.actualPayout)).toBe(-15_000);
  });
});
