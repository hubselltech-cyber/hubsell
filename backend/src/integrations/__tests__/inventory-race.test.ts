// ============================================================
// KỊCH BẢN 1 — RACE CONDITION: 2 webhook đổ về CÙNG MỘT MILI-GIÂY
//
// Chốt an toàn được kiểm chứng ở đây là DATABASE ROW LOCK (SELECT ... FOR
// UPDATE trên dòng Order — xem lockOrderRow trong order-stock.ts) + phép
// increment/decrement NGUYÊN TỬ của Postgres trên dòng Product:
//
//   · Cùng MỘT đơn bị bắn 2 lần song song → transaction đến sau phải đợi
//     transaction trước commit, đọc được mốc stockDeductedAt/stockHeldAt vừa
//     ghi và BỎ QUA — kho chỉ bị tác động đúng một lần (test 1, 3).
//   · Hai đơn KHÁC NHAU tranh sản phẩm cuối cùng → mỗi đơn trừ đúng một lần,
//     không lost update. Đơn thứ hai KHÔNG thể bị "từ chối" — nó đã phát sinh
//     THẬT trên sàn rồi; cách chặn overselling đúng là: tồn âm PHƠI BÀY tình
//     trạng bán vượt (thay vì âm thầm nuốt), và tồn KHẢ DỤNG đẩy ngược lên
//     sàn bị kẹp về 0 (Math.max(0, ...) trong inventory-sync.ts) để không
//     khách nào mua thêm được nữa (test 2, 4).
//
// Test chạy transaction THẬT song song (Promise.all) trên DB dev.
// ============================================================
import "./load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../prisma";
import { deductStockTx, holdStockTx } from "../order-stock";
import { createStockFixture, type StockFixture } from "./fixtures";

/**
 * BARRIER 2 BÊN — ép "cùng một mili-giây" thành TẤT ĐỊNH thay vì hên xui:
 * cả hai transaction phải BEGIN xong và cùng chạm điểm hẹn rồi mới được đi
 * tiếp vào phần đọc/ghi. Không có barrier, transaction thứ nhất thường commit
 * xong trước khi transaction thứ hai kịp đọc — race không thực sự xảy ra và
 * test xanh giả tạo (đã kiểm chứng: tắt lock đi test vẫn xanh nếu thiếu barrier).
 */
function makeBarrier(parties: number): () => Promise<void> {
  let arrived = 0;
  let release: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return async () => {
    arrived += 1;
    if (arrived >= parties) release!();
    await gate;
  };
}

/** Chạy 2 thao tác kho trong 2 transaction MỞ ĐỒNG THỜI (qua barrier). */
function racePair<T>(
  run: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<T>,
  run2: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<T>
): Promise<[T, T]> {
  const barrier = makeBarrier(2);
  const wrap = (fn: typeof run) =>
    prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1`; // chắc chắn transaction đã BEGIN trên DB
      await barrier(); // đợi transaction bên kia cũng mở xong
      return fn(tx);
    });
  return Promise.all([wrap(run), wrap(run2)]);
}

const deductPair = (orderA: string, orderB: string) =>
  racePair(
    (tx) => deductStockTx(tx, orderA, "test race"),
    (tx) => deductStockTx(tx, orderB, "test race")
  );
const holdPair = (orderA: string, orderB: string) =>
  racePair(
    (tx) => holdStockTx(tx, orderA),
    (tx) => holdStockTx(tx, orderB)
  );

/** Tồn khả dụng sẽ được đẩy lên sàn — cùng công thức với inventory-sync.ts. */
async function pushedAvailable(productId: string): Promise<number> {
  const p = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
  return Math.max(0, p.quantityInStock - p.holdQuantity);
}

let fx: StockFixture;

beforeAll(async () => {
  fx = await createStockFixture("race");
});

afterAll(async () => {
  await fx.cleanup();
});

describe("Race condition — 2 webhook song song cùng mili-giây", () => {
  it("cùng MỘT đơn bị bắn 2 lần song song → Row Lock đảm bảo chỉ trừ kho đúng một lần", async () => {
    const productId = await fx.createProduct(1); // còn đúng 1 sản phẩm
    const orderId = await fx.createOrder(productId, 1);

    // Hai "webhook" xử lý cùng lúc — không có FOR UPDATE thì cả hai cùng đọc
    // stockDeductedAt = null và cùng trừ → tồn -1 (trừ đúp). Có lock: kẻ đến
    // sau đợi kẻ trước commit, thấy mốc đã ghi và bỏ qua.
    const [r1, r2] = await deductPair(orderId, orderId);

    const outcomes = [r1.outcome, r2.outcome].sort();
    expect(outcomes).toEqual(["already-deducted", "deducted"]);
    expect(r1.deducted + r2.deducted).toBe(1);

    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(product.quantityInStock).toBe(0); // KHÔNG phải -1

    // Đúng MỘT bút toán trừ kho được ghi.
    const deductionLogs = await prisma.inventoryLog.count({
      where: { productId, changeQuantity: { lt: 0 } },
    });
    expect(deductionLogs).toBe(1);
  });

  it("2 ĐƠN KHÁC NHAU tranh sản phẩm cuối cùng → không lost update, oversell bị phơi bày, sàn bị kẹp về 0", async () => {
    const productId = await fx.createProduct(1); // còn đúng 1 sản phẩm
    const [orderA, orderB] = await Promise.all([
      fx.createOrder(productId, 1),
      fx.createOrder(productId, 1),
    ]);

    const [rA, rB] = await deductPair(orderA, orderB);

    // Cả hai đơn đều ĐÃ phát sinh thật trên sàn — hệ thống ghi nhận đủ hai
    // lượt trừ, mỗi đơn đúng một lần (idempotent theo từng đơn).
    expect(rA.outcome).toBe("deducted");
    expect(rB.outcome).toBe("deducted");

    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    // -1 chứ KHÔNG phải 0: bằng 0 nghĩa là một lượt trừ bị NUỐT MẤT (lost
    // update) — kho ảo thừa 1 sản phẩm không có thật, tệ hơn cả oversell hiện
    // hình. Tồn âm là bằng chứng đối soát cho chủ shop xử lý (hủy 1 đơn/nhập thêm).
    expect(product.quantityInStock).toBe(-1);

    // Chốt chặn overselling với KHÁCH TIẾP THEO: tồn khả dụng đẩy lên sàn bị
    // kẹp về 0 — không ai đặt thêm được nữa.
    expect(await pushedAvailable(productId)).toBe(0);

    const deductionLogs = await prisma.inventoryLog.count({
      where: { productId, changeQuantity: { lt: 0 } },
    });
    expect(deductionLogs).toBe(2);
  });

  it("cùng MỘT đơn UNPAID bị bắn 2 lần song song → Hold Stock chỉ giữ đúng một lần", async () => {
    const productId = await fx.createProduct(1);
    const orderId = await fx.createOrder(productId, 1);

    const [r1, r2] = await holdPair(orderId, orderId);

    expect([r1.outcome, r2.outcome].sort()).toEqual(["already-held", "held"]);
    expect(r1.held + r2.held).toBe(1);

    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(product.quantityInStock).toBe(1); // hold KHÔNG trừ kho vật lý
    expect(product.holdQuantity).toBe(1); // và chỉ giữ đúng 1
    expect(await pushedAvailable(productId)).toBe(0); // sản phẩm cuối đã bị giữ
  });

  it("2 đơn UNPAID tranh sản phẩm cuối → giữ đủ cả hai, tồn khả dụng đẩy lên sàn kẹp về 0", async () => {
    const productId = await fx.createProduct(1);
    const [orderA, orderB] = await Promise.all([
      fx.createOrder(productId, 1),
      fx.createOrder(productId, 1),
    ]);

    const [rA, rB] = await holdPair(orderA, orderB);

    expect(rA.outcome).toBe("held");
    expect(rB.outcome).toBe("held");

    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(product.holdQuantity).toBe(2); // nhu cầu thật: 2 đơn cùng giữ
    // available = 1 − 2 = −1 → đẩy lên sàn 0: khách thứ ba không thể mua.
    expect(await pushedAvailable(productId)).toBe(0);
  });
});
