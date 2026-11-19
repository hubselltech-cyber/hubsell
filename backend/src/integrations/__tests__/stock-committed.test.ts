// ============================================================
// BỘ ĐẾM "ĐANG GIỮ CHO ĐƠN" + MỐC HÀNG RỜI KHO — kho chuẩn quốc tế, lát 1 chạy bóng (12/11/2026;
// thiết kế lại 19/11/2026: MỘT dấu stockCommittedAt, xóa lúc rời kho)
// Thiết kế: docs/QUAN-LY-KHO-CHUAN-QUOC-TE.md mục 13 (danh sách ca ở 13.6) + mục 14 (14.7).
//
// Chạy trên DB dev thật qua đúng các hàm của webhook (order-stock.ts) và của worker
// (services/stock-committed.ts). Điều phải giữ ở MỌI ca: sổ (quantityInStock) và holdQuantity
// đi y như trước khi có lát này — bộ đếm chỉ là số chạy song song.
// ============================================================
import "./load-env";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { ShippingStatus, type Channel } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { createApp } from "../../app";
import { signToken } from "../../middleware/auth";
import { upsertShopeeOrderTx } from "../shopee/service";
import type { ShopeeOrderDetail } from "../shopee/client";
import { deductStockTx, holdStockTx, releaseCommittedTx, restoreStockTx, shipStockTx } from "../order-stock";
import { createRootLocationTx, transferStockTx } from "../../services/stock-ledger";
import {
  CHECK_JOB_KEY,
  checkCommitted,
  clearShippedMarks,
  cutoverCommittedBatch,
  hardMismatch,
  nextStreak,
  pickSweepCandidates,
  releaseCommittedOfChannel,
  runCommittedCheck,
  shipOrdersTx,
  sweepShippedBatch,
  type CommittedCheckRecord,
} from "../../services/stock-committed";
import { createStockFixture, type StockFixture } from "./fixtures";

let fx: StockFixture;
let dead: StockFixture;
let loc: StockFixture;

const deduct = (orderId: string) => prisma.$transaction((tx) => deductStockTx(tx, orderId, "test giữ"));
const ship = (orderId: string) => prisma.$transaction((tx) => shipStockTx(tx, orderId, "PLATFORM"));
const restore = (orderId: string) => prisma.$transaction((tx) => restoreStockTx(tx, orderId, "test giữ"));
const release = (orderId: string) => prisma.$transaction((tx) => releaseCommittedTx(tx, orderId));
const setStatus = (orderId: string, shippingStatus: ShippingStatus) =>
  prisma.order.update({ where: { id: orderId }, data: { shippingStatus } });
const productOf = (id: string) =>
  prisma.product.findUniqueOrThrow({
    where: { id },
    select: { quantityInStock: true, holdQuantity: true, committedQuantity: true },
  });
const orderOf = (id: string) =>
  prisma.order.findUniqueOrThrow({
    where: { id },
    select: { stockCommittedAt: true, stockShippedAt: true, stockShipSource: true, stockRestoredAt: true },
  });
/** Quét bù tới khi hết việc (DB dev có thể có đơn của tệp test khác đang chờ quét). */
async function sweepAll() {
  for (let i = 0; i < 50; i++) {
    const r = await sweepShippedBatch(200);
    if (r.picked < 200) return;
  }
}

beforeAll(async () => {
  fx = await createStockFixture("commit");
  dead = await createStockFixture("commit-dead");
  loc = await createStockFixture("commit-loc");
});

afterEach(() => {
  delete process.env.STOCK_COMMITTED_OFF;
});

afterAll(async () => {
  await fx.cleanup();
  await dead.cleanup();
  await loc.cleanup();
});

describe("Bộ đếm đang giữ — từng đơn", () => {
  it("đơn chốt: sổ trừ như cũ, bộ đếm giữ cộng đúng số đó, đơn có mốc giữ", async () => {
    const p = await fx.createProduct(44);
    const o1 = await fx.createOrder(p, 7);
    const o2 = await fx.createOrder(p, 3);
    await deduct(o1);
    await deduct(o2);
    expect(await productOf(p)).toEqual({ quantityInStock: 34, holdQuantity: 0, committedQuantity: 10 });
    const o = await orderOf(o1);
    expect(o.stockCommittedAt).not.toBeNull();
    expect(o.stockShippedAt).toBeNull();
    // Trừ lại (webhook bắn lại) không cộng bộ đếm lần hai.
    await deduct(o1);
    expect((await productOf(p)).committedQuantity).toBe(10);
  });

  it("hàng rời kho: bộ đếm trừ, sổ đứng yên; báo lại lần hai không trừ nữa", async () => {
    const p = await fx.createProduct(20);
    const o1 = await fx.createOrder(p, 2);
    const o2 = await fx.createOrder(p, 5);
    await deduct(o1);
    await deduct(o2);
    expect((await ship(o1)).shipped).toBe(2);
    expect(await productOf(p)).toEqual({ quantityInStock: 13, holdQuantity: 0, committedQuantity: 5 });
    const o = await orderOf(o1);
    expect(o.stockShippedAt).not.toBeNull();
    expect(o.stockShipSource).toBe("PLATFORM");
    // Một dấu duy nhất: rời kho là XÓA dấu giữ; đơn chưa rời kho còn nguyên dấu.
    expect(o.stockCommittedAt).toBeNull();
    expect((await orderOf(o2)).stockCommittedAt).not.toBeNull();

    expect((await ship(o1)).shipped).toBe(0);
    expect((await productOf(p)).committedQuantity).toBe(5);
  });

  it("dấu còn sót của bản hai cột (đã có mốc rời kho mà dấu chưa xóa): không đường nào trừ bộ đếm lần hai; đối chiếu đếm được; gỡ một lần là sạch", async () => {
    const p = await fx.createProduct(40);
    const mkStale = async (qty: number) => {
      const o = await fx.createOrder(p, qty);
      await deduct(o);
      await ship(o);
      // Dựng lại đúng trạng thái bản 12/11 để lại: mốc rời kho có, dấu giữ vẫn còn.
      const row = await prisma.order.findUniqueOrThrow({ where: { id: o }, select: { stockDeductedAt: true } });
      await prisma.order.update({ where: { id: o }, data: { stockCommittedAt: row.stockDeductedAt } });
      return o;
    };
    const byShip = await mkStale(2);
    const byRelease = await mkStale(3);
    const byBatch = await mkStale(4);
    const bySweep = await mkStale(5);
    const byCleanup = await mkStale(6);
    const live = await fx.createOrder(p, 7);
    await deduct(live);
    expect(await productOf(p)).toEqual({ quantityInStock: 13, holdQuantity: 0, committedQuantity: 7 });

    const before = await checkCommitted();
    expect(before.shippedStillMarked).toBeGreaterThanOrEqual(5);
    expect(hardMismatch(before)).toBeGreaterThanOrEqual(5);

    expect((await ship(byShip)).shipped).toBe(0);
    expect((await orderOf(byShip)).stockCommittedAt).toBeNull();
    expect((await release(byRelease)).released).toBe(0);
    expect((await orderOf(byRelease)).stockCommittedAt).toBeNull();
    expect(await prisma.$transaction((tx) => shipOrdersTx(tx, [byBatch, live], "HANDOVER"))).toBe(1);
    await setStatus(bySweep, ShippingStatus.DELIVERED);
    expect((await pickSweepCandidates(1000)).map((c) => c.id)).not.toContain(bySweep);
    await sweepAll();
    // Chỉ đơn `live` (7) rời kho qua biên bản; năm đơn dấu sót không trừ thêm lần nào.
    expect((await productOf(p)).committedQuantity).toBe(0);

    expect(await clearShippedMarks()).toBeGreaterThanOrEqual(3);
    for (const o of [byBatch, bySweep, byCleanup]) expect((await orderOf(o)).stockCommittedAt).toBeNull();
    expect((await orderOf(byCleanup)).stockShippedAt).not.toBeNull();
    const after = await checkCommitted();
    expect(after.shippedStillMarked).toBe(0);
    expect(await productOf(p)).toEqual({ quantityInStock: 13, holdQuantity: 0, committedQuantity: 0 });
  });

  it("đơn chưa thanh toán rồi mới chốt: giữ tạm (holdQuantity) nhả như cũ, bộ đếm chỉ nhận lúc chốt", async () => {
    const p = await fx.createProduct(10);
    const o = await fx.createOrder(p, 3);
    await prisma.$transaction((tx) => holdStockTx(tx, o));
    expect(await productOf(p)).toEqual({ quantityInStock: 10, holdQuantity: 3, committedQuantity: 0 });
    await deduct(o);
    expect(await productOf(p)).toEqual({ quantityInStock: 7, holdQuantity: 0, committedQuantity: 3 });
  });

  it("hủy khi hàng CHƯA rời kho: sổ cộng lại như cũ, bộ đếm về 0, mốc giữ bị xóa; hủy lần hai không đổi gì", async () => {
    const p = await fx.createProduct(10);
    const o = await fx.createOrder(p, 4);
    await deduct(o);
    await restore(o);
    expect(await productOf(p)).toEqual({ quantityInStock: 10, holdQuantity: 0, committedQuantity: 0 });
    expect((await orderOf(o)).stockCommittedAt).toBeNull();
    await restore(o);
    await release(o);
    expect(await productOf(p)).toEqual({ quantityInStock: 10, holdQuantity: 0, committedQuantity: 0 });
  });

  it("hủy SAU khi hàng rời kho: bộ đếm đã về 0 từ lúc rời kho, không âm; sổ vẫn cộng lại như hôm nay (lát 2 mới đổi)", async () => {
    const p = await fx.createProduct(10);
    const o = await fx.createOrder(p, 4);
    await deduct(o);
    await ship(o);
    await restore(o);
    expect(await productOf(p)).toEqual({ quantityInStock: 10, holdQuantity: 0, committedQuantity: 0 });
    const row = await orderOf(o);
    expect(row.stockShippedAt).not.toBeNull();
    expect(row.stockRestoredAt).not.toBeNull();
  });

  it("nhả giữ riêng (đường hủy tay / nhận hàng hoàn gọi trước khi tự cộng sổ): đúng một lần, không đụng sổ", async () => {
    const p = await fx.createProduct(10);
    const o = await fx.createOrder(p, 6);
    await deduct(o);
    expect((await release(o)).released).toBe(6);
    expect((await release(o)).released).toBe(0);
    expect(await productOf(p)).toEqual({ quantityInStock: 4, holdQuantity: 0, committedQuantity: 0 });
    // Đã nhả rồi thì "rời kho" tới sau cũng không trừ nữa.
    expect((await ship(o)).shipped).toBe(0);
    expect((await productOf(p)).committedQuantity).toBe(0);
  });

  it("đơn nhiều mã: mỗi mã một phần đúng; dòng đơn chưa nối SKU (không có nhật ký trừ) không vào bộ đếm, không có mốc", async () => {
    const a = await fx.createProduct(10);
    const b = await fx.createProduct(10);
    const o = await fx.createOrder(a, 2);
    await prisma.orderItem.create({
      data: { orderId: o, productId: b, channelSku: `X-${Date.now()}`, productName: "dòng 2", quantity: 3, price: 1 },
    });
    await deduct(o);
    expect((await productOf(a)).committedQuantity).toBe(2);
    expect((await productOf(b)).committedQuantity).toBe(3);
    await ship(o);
    expect((await productOf(a)).committedQuantity).toBe(0);
    expect((await productOf(b)).committedQuantity).toBe(0);

    const unlinked = await fx.createOrder(a, 1);
    await prisma.orderItem.updateMany({ where: { orderId: unlinked }, data: { productId: null } });
    await deduct(unlinked);
    const row = await prisma.order.findUniqueOrThrow({ where: { id: unlinked } });
    expect(row.stockDeductedAt).not.toBeNull();
    expect(row.stockCommittedAt).toBeNull();
  });

  it("hai lượt báo rời kho song song cho cùng một đơn chỉ trừ bộ đếm một lần; hai đơn song song cùng mã cộng đủ", async () => {
    const p = await fx.createProduct(50);
    const orders = await Promise.all([1, 2, 3, 4].map(() => fx.createOrder(p, 5)));
    await Promise.all(orders.map((o) => deduct(o)));
    expect(await productOf(p)).toEqual({ quantityInStock: 30, holdQuantity: 0, committedQuantity: 20 });
    const results = await Promise.all([ship(orders[0]), ship(orders[0]), ship(orders[0])]);
    expect(results.map((r) => r.shipped).sort()).toEqual([0, 0, 5]);
    expect((await productOf(p)).committedQuantity).toBe(15);
  });

  it("công tắc khẩn STOCK_COMMITTED_OFF=1: sổ chạy như cũ, bộ đếm và mốc không đụng tới", async () => {
    const p = await fx.createProduct(10);
    const o = await fx.createOrder(p, 2);
    process.env.STOCK_COMMITTED_OFF = "1";
    await deduct(o);
    expect(await productOf(p)).toEqual({ quantityInStock: 8, holdQuantity: 0, committedQuantity: 0 });
    expect((await orderOf(o)).stockCommittedAt).toBeNull();
    expect((await ship(o)).shipped).toBe(0);
    await restore(o);
    expect(await productOf(p)).toEqual({ quantityInStock: 10, holdQuantity: 0, committedQuantity: 0 });
  });
});

describe("Bộ đếm đang giữ — theo lô", () => {
  it("Biên bản bàn giao: cả lô rời kho; đơn đã rời kho hoặc chưa từng giữ thì bỏ qua êm", async () => {
    const p = await fx.createProduct(30);
    const o1 = await fx.createOrder(p, 1);
    const o2 = await fx.createOrder(p, 2);
    const o3 = await fx.createOrder(p, 4);
    const never = await fx.createOrder(p, 8); // chưa trừ kho
    await deduct(o1);
    await deduct(o2);
    await deduct(o3);
    await ship(o3);
    const n = await prisma.$transaction((tx) => shipOrdersTx(tx, [o1, o2, o3, never], "HANDOVER"));
    expect(n).toBe(2);
    expect(await productOf(p)).toEqual({ quantityInStock: 23, holdQuantity: 0, committedQuantity: 0 });
    expect((await orderOf(o1)).stockShipSource).toBe("HANDOVER");
    expect((await orderOf(o3)).stockShipSource).toBe("PLATFORM");
    // Webhook sàn tới SAU biên bản → thấy mốc, bỏ qua.
    expect((await ship(o1)).shipped).toBe(0);
  });

  it("quét bù: đơn đã sang Đang giao / Đã giao qua đường không đụng kho thì ra khỏi bộ đếm; đơn còn chờ thì ở lại", async () => {
    const p = await fx.createProduct(30);
    const shipping = await fx.createOrder(p, 2);
    const delivered = await fx.createOrder(p, 3);
    const waiting = await fx.createOrder(p, 4);
    await deduct(shipping);
    await deduct(delivered);
    await deduct(waiting);
    await setStatus(shipping, ShippingStatus.SHIPPING);
    await setStatus(delivered, ShippingStatus.DELIVERED);
    await setStatus(waiting, ShippingStatus.PROCESSED);
    await sweepAll();
    expect(await productOf(p)).toEqual({ quantityInStock: 21, holdQuantity: 0, committedQuantity: 4 });
    expect((await orderOf(shipping)).stockShipSource).toBe("PLATFORM");
    expect((await orderOf(shipping)).stockCommittedAt).toBeNull();
    expect((await orderOf(delivered)).stockShippedAt).not.toBeNull();
    expect((await orderOf(waiting)).stockShippedAt).toBeNull();
    expect((await orderOf(waiting)).stockCommittedAt).not.toBeNull();
    // Câu chọn của quét bù không trả đơn còn chờ, và không trả lại đơn vừa quét.
    const again = (await pickSweepCandidates(1000)).map((c) => c.id);
    for (const o of [shipping, delivered, waiting]) expect(again).not.toContain(o);
    // Quét lại không trừ nữa.
    await sweepAll();
    expect((await productOf(p)).committedQuantity).toBe(4);
  });

  it("quét bù: gian mất kết nối hoặc ngủ đông → đơn giữ của gian đó ra khỏi bộ đếm, ghi nguồn CHANNEL_INACTIVE", async () => {
    const p = await dead.createProduct(30);
    const o1 = await dead.createOrder(p, 6);
    await prisma.$transaction((tx) => deductStockTx(tx, o1, "test giữ"));
    await prisma.channel.update({ where: { id: dead.channelId }, data: { status: "DISCONNECTED" } });
    await sweepAll();
    expect(await productOf(p)).toEqual({ quantityInStock: 24, holdQuantity: 0, committedQuantity: 0 });
    expect((await orderOf(o1)).stockShipSource).toBe("CHANNEL_INACTIVE");

    await prisma.channel.update({ where: { id: dead.channelId }, data: { status: "ACTIVE", hibernatedAt: new Date() } });
    const o2 = await dead.createOrder(p, 5);
    await prisma.$transaction((tx) => deductStockTx(tx, o2, "test giữ"));
    expect((await productOf(p)).committedQuantity).toBe(5);
    await sweepAll();
    expect((await productOf(p)).committedQuantity).toBe(0);
    expect((await orderOf(o2)).stockShipSource).toBe("CHANNEL_INACTIVE");
    await prisma.channel.update({ where: { id: dead.channelId }, data: { hibernatedAt: null } });
  });

  it("xóa gian: đơn đang giữ của gian ra khỏi bộ đếm trước khi đơn bị xóa", async () => {
    const tmp = await createStockFixture("commit-del");
    try {
      const p = await tmp.createProduct(30);
      const o1 = await tmp.createOrder(p, 6);
      const o2 = await tmp.createOrder(p, 1);
      await prisma.$transaction((tx) => deductStockTx(tx, o1, "test giữ"));
      await prisma.$transaction((tx) => deductStockTx(tx, o2, "test giữ"));
      expect((await productOf(p)).committedQuantity).toBe(7);
      expect(await releaseCommittedOfChannel(tmp.channelId)).toBe(2);
      expect(await productOf(p)).toEqual({ quantityInStock: 23, holdQuantity: 0, committedQuantity: 0 });
      expect((await orderOf(o1)).stockCommittedAt).toBeNull();
      expect((await orderOf(o1)).stockShipSource).toBe("CHANNEL_INACTIVE");
      expect(await releaseCommittedOfChannel(tmp.channelId)).toBe(0);
    } finally {
      await tmp.cleanup();
    }
  });

  it("ngày chuyển: chỉ đơn đã trừ kho còn chờ giao của gian đang hoạt động vào bộ đếm; đã giao, đã hủy, gian chết thì không", async () => {
    const legacy = await createStockFixture("commit-cut");
    try {
      const p = await legacy.createProduct(100);
      const mk = async (qty: number) => {
        const o = await legacy.createOrder(p, qty);
        // Đơn trừ kho TRƯỚC khi có lát này: tắt công tắc để không cộng bộ đếm, không đánh mốc.
        process.env.STOCK_COMMITTED_OFF = "1";
        await prisma.$transaction((tx) => deductStockTx(tx, o, "test cũ"));
        delete process.env.STOCK_COMMITTED_OFF;
        return o;
      };
      const pending = await mk(3);
      const processed = await mk(4);
      const shippingOld = await mk(5);
      const cancelled = await mk(6);
      // Đã bàn giao cho vận chuyển (có mốc rời kho) nhưng sàn chưa đổi trạng thái: KHÔNG được
      // giữ lại khi dựng lại bộ đếm — đơn đã rời kho không bao giờ quay lại bộ đếm.
      const handedOver = await mk(2);
      await setStatus(processed, ShippingStatus.PROCESSED);
      await setStatus(shippingOld, ShippingStatus.SHIPPING);
      await setStatus(handedOver, ShippingStatus.PROCESSED);
      await prisma.order.update({ where: { id: handedOver }, data: { stockShippedAt: new Date(), stockShipSource: "HANDOVER" } });
      await prisma.$transaction((tx) => restoreStockTx(tx, cancelled, "test cũ"));
      expect((await productOf(p)).committedQuantity).toBe(0);

      // DB dev có thể còn đơn chờ giao cũ của dữ liệu khác → chạy tới khi hết.
      for (let i = 0; i < 200; i++) if ((await cutoverCommittedBatch(200)).picked < 200) break;

      expect(await productOf(p)).toEqual({ quantityInStock: 86, holdQuantity: 0, committedQuantity: 7 });
      expect((await orderOf(handedOver)).stockCommittedAt).toBeNull();
      const row = await prisma.order.findUniqueOrThrow({ where: { id: pending } });
      expect(row.stockCommittedAt?.getTime()).toBe(row.stockDeductedAt?.getTime());
      expect((await orderOf(shippingOld)).stockCommittedAt).toBeNull();
      expect((await orderOf(cancelled)).stockCommittedAt).toBeNull();
      // Chạy lại không cộng lần hai.
      expect((await cutoverCommittedBatch(200)).committed).toBe(0);
      expect((await productOf(p)).committedQuantity).toBe(7);
      // Đơn vừa chuyển đi tiếp vòng đời bình thường.
      await prisma.$transaction((tx) => shipStockTx(tx, pending, "PLATFORM"));
      expect((await productOf(p)).committedQuantity).toBe(4);
    } finally {
      await legacy.cleanup();
    }
  });
});

describe("Bộ đếm đang giữ — theo vị trí + đối chiếu", () => {
  it("shop dùng vị trí: đơn trừ rải hai vị trí thì mỗi vị trí giữ đúng phần của nó; rời kho thì cả hai về 0", async () => {
    const p = await loc.createProduct(6);
    const root = await prisma.$transaction((tx) => createRootLocationTx(tx, loc.userId));
    const kho2 = await prisma.stockLocation.create({ data: { userId: loc.userId, name: "Kho 2", sortOrder: 1 } });
    await prisma.$transaction((tx) =>
      transferStockTx(tx, { productId: p, fromLocationId: root.id, toLocationId: kho2.id, quantity: 4, reason: "test" })
    );
    // Gốc 2, Kho 2 4. Đơn 5 → trừ rải hai nơi.
    const o = await loc.createOrder(p, 5);
    await prisma.$transaction((tx) => deductStockTx(tx, o, "test giữ"));
    const levels = async () =>
      Object.fromEntries(
        (await prisma.productStockLevel.findMany({ where: { productId: p } })).map((l) => [
          l.locationId === root.id ? "root" : "kho2",
          { quantity: l.quantity, committed: l.committed },
        ])
      );
    const after = await levels();
    expect(after.root.committed + after.kho2.committed).toBe(5);
    expect(after.root.quantity + after.root.committed).toBe(2);
    expect(after.kho2.quantity + after.kho2.committed).toBe(4);
    expect(await productOf(p)).toEqual({ quantityInStock: 1, holdQuantity: 0, committedQuantity: 5 });

    const check = await checkCommitted();
    expect(check.counterMismatch).toBe(0);
    expect(check.levelMismatch).toBe(0);

    await prisma.$transaction((tx) => shipStockTx(tx, o, "HANDOVER"));
    const done = await levels();
    expect(done.root.committed).toBe(0);
    expect(done.kho2.committed).toBe(0);
    expect(done.root.quantity + done.kho2.quantity).toBe(1);
    expect((await productOf(p)).committedQuantity).toBe(0);
  });

  it("đối chiếu: bình thường lệch 0; bộ đếm bị ghi sai một mã là bắt được", async () => {
    const p = await fx.createProduct(10);
    const o = await fx.createOrder(p, 2);
    await deduct(o);
    const ok = await checkCommitted();
    expect(ok.counterMismatch).toBe(0);
    expect(ok.levelMismatch).toBe(0);
    expect(ok.counterTotal).toBe(ok.ordersTotal);

    await prisma.product.update({ where: { id: p }, data: { committedQuantity: { increment: 1 } } });
    const bad = await checkCommitted();
    expect(bad.counterMismatch).toBe(1);
    await prisma.product.update({ where: { id: p }, data: { committedQuantity: { decrement: 1 } } });
    expect((await checkCommitted()).counterMismatch).toBe(0);
  });
});

describe("Rời kho theo sự kiện — tại chỗ ghi trạng thái (mục 14.4)", () => {
  it("Shopee ghi đơn qua hàm dùng chung (đường quét lô / làn đọc con trỏ, KHÔNG qua webhook kho): sàn báo SHIPPED → đơn đang giữ ra khỏi bộ đếm ngay, sổ đứng yên; đơn còn chờ thì ở lại", async () => {
    const p = await fx.createProduct(20);
    const code = `EVT-${Date.now()}`;
    const o = await fx.createOrder(p, 3, code);
    const waiting = await fx.createOrder(p, 4, `${code}-W`);
    await deduct(o);
    await deduct(waiting);
    expect(await productOf(p)).toEqual({ quantityInStock: 13, holdQuantity: 0, committedQuantity: 7 });
    const channel: Channel = await prisma.channel.findUniqueOrThrow({ where: { id: fx.channelId } });
    const detail = (order_sn: string, order_status: string): ShopeeOrderDetail => ({
      order_sn,
      order_status,
      total_amount: 0,
      update_time: Math.floor(Date.now() / 1000),
      item_list: [],
    });

    await prisma.$transaction((tx) => upsertShopeeOrderTx(tx, channel, detail(`${code}-W`, "PROCESSED"), 0));
    expect((await orderOf(waiting)).stockCommittedAt).not.toBeNull();
    expect((await productOf(p)).committedQuantity).toBe(7);

    await prisma.$transaction((tx) => upsertShopeeOrderTx(tx, channel, detail(code, "SHIPPED"), 0));
    const row = await orderOf(o);
    expect(row.stockShippedAt).not.toBeNull();
    expect(row.stockShipSource).toBe("PLATFORM");
    expect(row.stockCommittedAt).toBeNull();
    expect(await productOf(p)).toEqual({ quantityInStock: 13, holdQuantity: 0, committedQuantity: 4 });
    // Quét bù không còn gì để bắt ở đơn này.
    expect((await pickSweepCandidates(1000)).map((c) => c.id)).not.toContain(o);

    // Sàn bắn lại / sang COMPLETED: không trừ lần hai.
    await prisma.$transaction((tx) => upsertShopeeOrderTx(tx, channel, detail(code, "COMPLETED"), 0));
    expect((await productOf(p)).committedQuantity).toBe(4);
  });

  it("đổi trạng thái tay qua PATCH /api/orders/:id/status sang Đang giao: ra khỏi bộ đếm, nguồn MANUAL, sổ đứng yên", async () => {
    const p = await fx.createProduct(10);
    const o = await fx.createOrder(p, 2);
    await deduct(o);
    let server!: Server;
    await new Promise<void>((resolve) => {
      server = createApp().listen(0, "127.0.0.1", () => resolve());
    });
    try {
      const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const call = (shippingStatus: string) =>
        fetch(`${baseUrl}/api/orders/${o}/status`, {
          method: "PATCH",
          headers: { "content-type": "application/json", authorization: `Bearer ${signToken(fx.userId)}` },
          body: JSON.stringify({ shippingStatus }),
        });
      // Đã xử lý: hàng còn trong kho → vẫn giữ.
      expect((await call("PROCESSED")).status).toBe(200);
      expect((await productOf(p)).committedQuantity).toBe(2);
      expect((await orderOf(o)).stockCommittedAt).not.toBeNull();

      expect((await call("SHIPPING")).status).toBe(200);
      const row = await orderOf(o);
      expect(row.stockShipSource).toBe("MANUAL");
      expect(row.stockCommittedAt).toBeNull();
      expect(await productOf(p)).toEqual({ quantityInStock: 8, holdQuantity: 0, committedQuantity: 0 });

      expect((await call("DELIVERED")).status).toBe(200);
      expect((await productOf(p)).committedQuantity).toBe(0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("Đối chiếu — chuỗi tự đếm (mục 14.5)", () => {
  const now = new Date("2026-11-20T10:00:00Z");
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();

  it("nextStreak (nhịp 24 giờ): lệch cứng → 0; lần đầu → 1; liên tiếp → +1; bỏ nhịp quá 26 giờ → đếm lại từ 1; chạy lại quá gần → không cộng; dòng của bản cũ (không có streak) → 1", () => {
    expect(nextStreak({ at: hoursAgo(24), streak: 5 }, 2, now, 24)).toBe(0);
    expect(nextStreak(null, 0, now, 24)).toBe(1);
    expect(nextStreak({ at: hoursAgo(24), streak: 3 }, 0, now, 24)).toBe(4);
    expect(nextStreak({ at: hoursAgo(23.9), streak: 3 }, 0, now, 24)).toBe(4);
    expect(nextStreak({ at: hoursAgo(26), streak: 3 }, 0, now, 24)).toBe(4);
    expect(nextStreak({ at: hoursAgo(27), streak: 3 }, 0, now, 24)).toBe(1);
    expect(nextStreak({ at: hoursAgo(121), streak: 3 }, 0, now, 24)).toBe(1);
    expect(nextStreak({ at: hoursAgo(24) }, 0, now, 24)).toBe(1);
    expect(nextStreak({ at: "không phải ngày", streak: 3 }, 0, now, 24)).toBe(1);
    // Sau một lần lệch, lần sạch kế tiếp bắt đầu lại từ 1.
    expect(nextStreak({ at: hoursAgo(24), streak: 0 }, 0, now, 24)).toBe(1);
    // Chạy lại quá gần (chạy tay, hoặc hai tiến trình worker cùng đối chiếu): một đêm chỉ tính một lần.
    expect(nextStreak({ at: hoursAgo(0.01), streak: 3 }, 0, now, 24)).toBe(3);
    expect(nextStreak({ at: hoursAgo(11), streak: 3 }, 0, now, 24)).toBe(3);
    expect(nextStreak({ at: hoursAgo(1), streak: 0 }, 0, now, 24)).toBe(1);
    // …nhưng lệch cứng ở lần chạy lại vẫn đưa chuỗi về 0.
    expect(nextStreak({ at: hoursAgo(1), streak: 3 }, 1, now, 24)).toBe(0);
  });

  it("runCommittedCheck ghi dòng đối chiếu kèm chuỗi và mốc lệch gần nhất; chạy hai lần liền thì chuỗi KHÔNG cộng hai lần", async () => {
    // Dòng đối chiếu của DB dev là dòng dùng chung → cất lại, xong trả về nguyên trạng.
    const saved = await prisma.maintenanceJob.findUnique({ where: { key: CHECK_JOB_KEY } });
    try {
      await prisma.maintenanceJob.deleteMany({ where: { key: CHECK_JOB_KEY } });
      const first = await runCommittedCheck();
      const hard1 = hardMismatch(first);
      expect(first.streak).toBe(hard1 === 0 ? 1 : 0);
      expect(first.lastMismatchAt === null).toBe(hard1 === 0);

      const second = await runCommittedCheck();
      const hard2 = hardMismatch(second);
      // Lần hai chạy ngay sau lần một: một đêm chỉ tính một lần → chuỗi không cộng thêm.
      expect(second.streak).toBe(hard2 === 0 ? Math.max(first.streak, 1) : 0);

      const row = await prisma.maintenanceJob.findUniqueOrThrow({ where: { key: CHECK_JOB_KEY } });
      const stored = JSON.parse(row.cursor!) as CommittedCheckRecord;
      expect(stored.streak).toBe(second.streak);
      expect(stored.shippedStillMarked).toBe(second.shippedStillMarked);
      expect(row.processed).toBe(hard2);
    } finally {
      await prisma.maintenanceJob.deleteMany({ where: { key: CHECK_JOB_KEY } });
      if (saved) await prisma.maintenanceJob.create({ data: saved });
    }
  });
});
