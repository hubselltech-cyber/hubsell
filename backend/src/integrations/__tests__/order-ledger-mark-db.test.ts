// ============================================================
// SỔ CÁI ĐƠN trên DB dev: trigger đánh dấu "cần tính lại" của bảng bản kê
// (lazada_order_settlements, tiktok_order_settlements) không được DÒ CẢ BẢNG
// "Order" cho mỗi dòng bản kê. Trước migration 20260930280000, lý do đánh dấu
// ghép từ TG_TABLE_NAME (kiểu `name`, luật so chuỗi "C") làm câu tra "Order"
// theo mã đơn trong order_ledger_mark không dùng được chỉ mục khóa chính.
// Kiểm bằng bộ đếm lượt dò bảng của chính giao dịch (pg_stat_xact_user_tables).
// Bảng "Order" của DB dev quá nhỏ (dưới 50 trang) thì Postgres dò bảng cả khi có
// chỉ mục, phép kiểm không còn nghĩa → test tự bỏ qua. (Không ép enable_seqscan =
// off: khi đó bản lỗi chuyển sang quét TOÀN BỘ chỉ mục và bộ đếm dò bảng vẫn đứng yên.)
// Chưa áp migration sổ cái → BỎ QUA.
// ============================================================

import "./load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChannelName, type Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { createStockFixture, type StockFixture } from "./fixtures";

const ledgerReady: boolean = await (async () => {
  try {
    const r = await prisma.$queryRaw<{ r: string | null }[]>`SELECT to_regclass('order_ledger')::text AS r`;
    return r[0]?.r != null;
  } catch {
    return false;
  }
})();

describe.skipIf(!ledgerReady)("Sổ cái đơn — trigger bản kê đánh dấu sổ qua chỉ mục, không dò bảng đơn", () => {
  let fx: StockFixture;
  let orderId: string;

  beforeAll(async () => {
    fx = await createStockFixture("ledgermark");
    await prisma.channel.update({ where: { id: fx.channelId }, data: { channelName: ChannelName.TIKTOK } });
    const order = await prisma.order.create({
      data: {
        channelId: fx.channelId,
        orderCode: `TEST-${fx.suffix}-O1`,
        customerName: "Khách test",
        itemCount: 1,
        items: { create: { channelSku: `TEST-${fx.suffix}-A`, productName: "Dòng A", quantity: 1, price: 100_000, costPriceAtSale: 40_000 } },
        tiktokSettlement: { create: { estimated: true } },
        lazadaSettlement: { create: {} },
      },
    });
    orderId = order.id;
  });
  afterAll(async () => {
    await fx?.cleanup();
  });

  /** Số lượt dò cả bảng "Order" tính từ đầu giao dịch hiện tại. */
  const orderSeqScans = async (tx: Prisma.TransactionClient): Promise<number> => {
    const r = await tx.$queryRaw<{ n: number | null }[]>`
      SELECT seq_scan::int AS n FROM pg_stat_xact_user_tables WHERE relname = 'Order'`;
    return r[0]?.n ?? 0;
  };

  it.each(["tiktok_order_settlements", "lazada_order_settlements"])("sửa một dòng %s: sổ đơn bị đánh dấu bẩn, bảng đơn không bị dò", async (table) => {
    const size = await prisma.$queryRaw<{ pages: number }[]>`SELECT relpages::int AS pages FROM pg_class WHERE oid = '"Order"'::regclass`;
    if ((size[0]?.pages ?? 0) < 50) {
      console.log(`[order-ledger-mark-db.test] BỎ QUA: bảng "Order" chỉ có ${size[0]?.pages ?? 0} trang`);
      return;
    }
    await prisma.$executeRaw`UPDATE "order_ledger" SET "dirtyAt" = NULL, "dirtyReason" = NULL WHERE "orderId" = ${orderId}`;
    await prisma.$transaction(async (tx) => {
      const before = await orderSeqScans(tx);
      const changed = await tx.$executeRawUnsafe(`UPDATE "${table}" SET "orderId" = "orderId" WHERE "orderId" = $1`, orderId);
      expect(changed).toBe(1);
      expect(await orderSeqScans(tx), `dò cả bảng "Order" khi ghi ${table}`).toBe(before);
    });
    const ledger = await prisma.$queryRaw<{ dirtyReason: string | null }[]>`
      SELECT "dirtyReason" FROM "order_ledger" WHERE "orderId" = ${orderId}`;
    expect(ledger[0]?.dirtyReason).toBe(`settlement:${table}`);
  });
});
