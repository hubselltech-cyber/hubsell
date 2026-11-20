// ============================================================
// THẤT THU HÀNG MẤT/HỎNG — chạy thẳng trên Postgres (DB dev).
//   1. Luật SQL (trạng thái + số tiền) kiểm bằng bảng VALUES — không phụ thuộc dữ liệu.
//   2. ledgerDamagedLoss trên đơn thật tự tạo: KỲ GHI NHẬN = NGÀY KHO BÁO HỎNG (anh Trung
//      chốt 20/11/2026), biên ngày theo giờ VN, đơn cũ chưa có mốc lùi về lúc kho nhận kiện
//      rồi ngày tạo đơn, phần đã nằm trong giá vốn tách theo ngày tạo đơn, lọc theo gian.
// Không nối được DB / chưa có sổ cái / chưa có cột returnDamagedAt → cả file tự BỎ QUA.
// docs/DOI-SOAT-DON-HOAN-HANG-LOAT-VA-THAT-THU.md mục 5.7 + 10 + 17
// ============================================================

import "./load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma, ReturnStatus, ShippingStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { damagedLossAmountSql, damagedLossWhereSql } from "../../lib/damaged-loss";
import { parseDateRange } from "../../lib/date-range";
import { drainLedgerOnce, ledgerDamagedLoss } from "../../services/order-ledger";
import { createStockFixture, type StockFixture } from "./fixtures";

const dbReady: boolean = await (async () => {
  try {
    const r = await prisma.$queryRaw<{ ledger: string | null; col: number }[]>`
      SELECT to_regclass('order_ledger')::text AS ledger,
             (SELECT count(*)::int FROM information_schema.columns
              WHERE table_name = 'Order' AND column_name = 'returnDamagedAt') AS col`;
    return r[0]?.ledger != null && r[0]?.col === 1;
  } catch {
    return false;
  }
})();
if (!dbReady) {
  console.log("[damaged-loss-db.test] BỎ QUA: DB dev chưa có order_ledger hoặc cột Order.returnDamagedAt");
}

/** [mã ca, returnStatus, returnType, costSnapshot, returnLossCost] */
const CASES: [string, string, string | null, number, number][] = [
  ["hong-ca-don", "DAMAGED", "FULL_RETURN", 140_000, 140_000],
  // Trả một phần: chỉ phần bị trả (45k), không tính phần khách giữ và đã trả tiền.
  ["hong-mot-phan", "DAMAGED", "PARTIAL_RETURN", 90_000, 45_000],
  // Đơn sàn đã hủy (giao thất bại) kiện về hỏng: sổ không bóc thất thu đơn hủy → cả đơn.
  ["hong-don-san-huy", "DAMAGED", null, 130_000, 0],
  ["xoa-so", "WRITTEN_OFF", "FULL_RETURN", 80_000, 80_000],
  // Không phải thất thu: nguyên vẹn, đang chờ về, đã nhận, đã được đền, đơn thường.
  ["nhap-kho", "RECEIVED_INTACT", "FULL_RETURN", 0, 0],
  ["cho-ve", "AWAITING", "FULL_RETURN", 70_000, 70_000],
  ["da-nhan", "RECEIVED", "FULL_RETURN", 0, 0],
  ["da-den", "CLAIM_SETTLED", "FULL_RETURN", 0, 0],
  ["don-thuong", "NONE", null, 60_000, 0],
];

describe.skipIf(!dbReady)("Thất thu hàng mất/hỏng — luật SQL trên Postgres", () => {
  it("chỉ đơn kho báo hỏng / xóa sổ được tính; đúng số từng ca (có và không có bí danh bảng)", async () => {
    const values = Prisma.join(
      CASES.map(
        ([k, rs, rt, cost, loss]) =>
          Prisma.sql`(${k}, ${rs}, ${rt}::text, ${cost}::numeric, ${loss}::numeric)`
      )
    );
    for (const alias of ["", "t."]) {
      const rows = await prisma.$queryRaw<{ k: string; v: unknown }[]>(Prisma.sql`
        SELECT k, ${Prisma.raw(damagedLossAmountSql(alias))} AS v
        FROM (VALUES ${values}) AS t(k, "returnStatus", "returnType", "costSnapshot", "returnLossCost")
        WHERE ${Prisma.raw(damagedLossWhereSql(alias))}
        ORDER BY k
      `);
      expect(Object.fromEntries(rows.map((r) => [r.k, Number(r.v)])), `bí danh "${alias}"`).toEqual({
        "hong-ca-don": 140_000,
        "hong-don-san-huy": 130_000,
        "hong-mot-phan": 45_000,
        "xoa-so": 80_000,
      });
    }
  });
});

// ------------------------------------------------------------
// Đơn thật: mỗi đơn 1 dòng hàng, số lượng 1 → giá vốn đơn = giá vốn dòng.
// Mốc giờ viết UTC; ngày ghi trong chú thích là ngày GIỜ VN (UTC+7).
// ------------------------------------------------------------
interface Seed {
  code: string;
  cost: number;
  createdAt: string;
  shippingStatus: ShippingStatus;
  returnStatus: ReturnStatus;
  returnedAt?: string;
  returnDamagedAt?: string;
}
const D = ShippingStatus.DELIVERED;
const SEEDS: Seed[] = [
  // Tạo 21/10, báo hỏng 10:00 ngày 20/11 — đơn sàn không hủy, đang chờ khiếu nại.
  { code: "tao-t10-hong-20-11", cost: 130_000, createdAt: "2026-10-21T10:46:00Z", shippingStatus: D, returnStatus: ReturnStatus.DAMAGED, returnedAt: "2026-11-18T02:00:00Z", returnDamagedAt: "2026-11-20T03:00:00Z" },
  // Đơn sàn hủy, báo hỏng 23:59 ngày 20/11 (biên cuối ngày giờ VN).
  { code: "huy-hong-cuoi-ngay", cost: 126_000, createdAt: "2026-11-10T09:30:00Z", shippingStatus: ShippingStatus.CANCELLED, returnStatus: ReturnStatus.DAMAGED, returnDamagedAt: "2026-11-20T16:59:00Z" },
  // Báo hỏng 00:30 ngày 20/11 (biên đầu ngày giờ VN), đã chốt không được đền → vẫn là đơn tính doanh thu.
  { code: "xoa-so-dau-ngay", cost: 131_000, createdAt: "2026-11-08T05:50:00Z", shippingStatus: D, returnStatus: ReturnStatus.WRITTEN_OFF, returnDamagedAt: "2026-11-19T17:30:00Z" },
  // Đơn cũ chưa có mốc báo hỏng → lùi về lúc kho nhận kiện (04/10).
  { code: "cu-co-moc-nhan", cost: 23_000, createdAt: "2026-10-02T01:21:00Z", shippingStatus: D, returnStatus: ReturnStatus.DAMAGED, returnedAt: "2026-10-04T03:38:00Z" },
  // Đơn cũ không có cả hai mốc → lùi về ngày tạo đơn (07/09).
  { code: "cu-khong-moc", cost: 22_000, createdAt: "2026-09-07T04:29:00Z", shippingStatus: D, returnStatus: ReturnStatus.DAMAGED },
  // Không phải thất thu dù có mốc báo hỏng trong ngày: đã được đền bù; nguyên vẹn đã nhập kho.
  { code: "da-den-bu", cost: 50_000, createdAt: "2026-11-05T03:00:00Z", shippingStatus: D, returnStatus: ReturnStatus.CLAIM_SETTLED, returnDamagedAt: "2026-11-20T04:00:00Z" },
  { code: "nguyen-ven", cost: 40_000, createdAt: "2026-11-06T03:00:00Z", shippingStatus: D, returnStatus: ReturnStatus.RECEIVED_INTACT, returnedAt: "2026-11-20T04:00:00Z" },
];

describe.skipIf(!dbReady)("ledgerDamagedLoss — kỳ ghi nhận là ngày kho báo hỏng", () => {
  let fx: StockFixture;
  const orderIds: string[] = [];
  const scope = () => ({ userId: fx.userId });
  const range = (from: string, to: string) => parseDateRange({ from, to })!;

  beforeAll(async () => {
    fx = await createStockFixture("damaged-loss");
    const productId = await fx.createProduct(100);
    for (const s of SEEDS) {
      const id = await fx.createOrder(productId, 1, `TEST-${fx.suffix}-${s.code}`);
      orderIds.push(id);
      await prisma.orderItem.updateMany({ where: { orderId: id }, data: { costPriceAtSale: s.cost } });
      await prisma.order.update({
        where: { id },
        data: {
          createdAt: new Date(s.createdAt),
          shippingStatus: s.shippingStatus,
          returnStatus: s.returnStatus,
          returnedAt: s.returnedAt ? new Date(s.returnedAt) : null,
          returnDamagedAt: s.returnDamagedAt ? new Date(s.returnDamagedAt) : null,
        },
      });
    }
    for (let i = 0; i < 10; i++) {
      const r = await drainLedgerOnce(100, { scope: scope() });
      if (r.claimed === 0) break;
    }
  });

  afterAll(async () => {
    // Dọn cả dòng sổ (DB local có thể không xóa theo đơn — bẫy "sổ cái mồ côi" 19/11/2026).
    if (orderIds.length) {
      await prisma.orderLineLedger.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.orderLedger.deleteMany({ where: { orderId: { in: orderIds } } });
    }
    await fx?.cleanup();
  });

  it("kỳ Hôm nay (20/11): đủ 3 đơn báo hỏng trong ngày dù tạo từ tháng 10 / đầu tháng 11", async () => {
    const d = await ledgerDamagedLoss(scope(), range("2026-11-20", "2026-11-20"));
    expect(d.total).toBe(130_000 + 126_000 + 131_000);
    expect(d.orderCount).toBe(3);
    // Không đơn nào TẠO hôm nay → không có gì để tách khỏi dòng Giá vốn.
    expect(d.inActive).toBe(0);
    expect(d.outside).toBe(387_000);
  });

  it("ngày liền trước / liền sau không dính đơn ở hai biên 00:30 và 23:59 giờ VN", async () => {
    expect((await ledgerDamagedLoss(scope(), range("2026-11-19", "2026-11-19"))).total).toBe(0);
    expect((await ledgerDamagedLoss(scope(), range("2026-11-21", "2026-11-21"))).total).toBe(0);
  });

  it("tháng 11: thất thu 3 đơn; đơn xóa sổ tạo 08/11 tách khỏi Giá vốn nên chỉ trừ thêm phần còn lại", async () => {
    const d = await ledgerDamagedLoss(scope(), range("2026-11-01", "2026-11-30"), {
      byDaySince: "2026-11-01",
    });
    expect(d.total).toBe(387_000);
    expect(d.inActive).toBe(131_000);
    expect(d.outside).toBe(256_000);
    expect([...d.inActiveByChannelName]).toEqual([["SHOPEE", 131_000]]);
    expect(Object.fromEntries(d.outsideByDay)).toEqual({
      "2026-11-08": -131_000,
      "2026-11-20": 387_000,
    });
  });

  it("kỳ chỉ chứa ngày TẠO đơn xóa sổ (08/11): dòng Thất thu 0, Giá vốn được bớt lại", async () => {
    const d = await ledgerDamagedLoss(scope(), range("2026-11-08", "2026-11-08"));
    expect(d.total).toBe(0);
    expect(d.inActive).toBe(131_000);
    expect(d.outside).toBe(-131_000);
  });

  it("tháng 10: đơn tạo 21/10 KHÔNG còn nằm ở đây; đơn cũ chưa có mốc lùi về ngày kho nhận kiện", async () => {
    const d = await ledgerDamagedLoss(scope(), range("2026-10-01", "2026-10-31"));
    expect(d.total).toBe(23_000);
    expect(d.orderCount).toBe(1);
    expect(d.inActive).toBe(0);
  });

  it("đơn cũ không có cả mốc báo hỏng lẫn mốc nhận kiện lùi về ngày tạo đơn", async () => {
    expect((await ledgerDamagedLoss(scope(), range("2026-09-07", "2026-09-07"))).total).toBe(22_000);
  });

  it("không lọc kỳ: mỗi đơn hỏng được tính đúng một lần; đã đền bù / nguyên vẹn không tính", async () => {
    const d = await ledgerDamagedLoss(scope(), undefined);
    expect(d.total).toBe(387_000 + 23_000 + 22_000);
    expect(d.orderCount).toBe(5);
    expect(d.inActive).toBe(131_000);
  });

  it("vừa báo hỏng, sổ chưa kịp tính lại (đơn tạo ngoài kỳ đang xem) → lượt đọc tự tính nốt, không báo thiếu", async () => {
    const productId = await fx.createProduct(10);
    const id = await fx.createOrder(productId, 1, `TEST-${fx.suffix}-vua-bao-hong`);
    orderIds.push(id);
    await prisma.orderItem.updateMany({ where: { orderId: id }, data: { costPriceAtSale: 77_000 } });
    await prisma.order.update({
      where: { id },
      data: { createdAt: new Date("2026-10-15T03:00:00Z"), shippingStatus: D, returnStatus: ReturnStatus.AWAITING },
    });
    for (let i = 0; i < 10; i++) {
      if ((await drainLedgerOnce(100, { scope: scope() })).claimed === 0) break;
    }
    // Kho báo hỏng lúc 09:00 ngày 22/11 — trigger đánh bẩn dòng sổ, CHƯA ai tính lại.
    await prisma.order.update({
      where: { id },
      data: { returnStatus: ReturnStatus.DAMAGED, returnDamagedAt: new Date("2026-11-22T02:00:00Z") },
    });
    expect((await prisma.orderLedger.findFirst({ where: { orderId: id } }))!.dirtyAt).not.toBeNull();
    const d = await ledgerDamagedLoss(scope(), range("2026-11-22", "2026-11-22"));
    expect(d.total).toBe(77_000);
    expect(d.orderCount).toBe(1);
    expect((await prisma.orderLedger.findFirst({ where: { orderId: id } }))!.dirtyAt).toBeNull();
  });

  it("lọc theo gian: đúng gian thì đủ số, gian khác / danh sách rỗng / sai sàn thì 0", async () => {
    const today = range("2026-11-20", "2026-11-20");
    expect((await ledgerDamagedLoss({ userId: fx.userId, id: fx.channelId }, today)).total).toBe(387_000);
    expect((await ledgerDamagedLoss({ userId: fx.userId, id: { in: [fx.channelId] } }, today)).total).toBe(387_000);
    expect((await ledgerDamagedLoss({ userId: fx.userId, id: "khong-co-gian-nay" }, today)).total).toBe(0);
    expect((await ledgerDamagedLoss({ userId: fx.userId, id: { in: [] } }, today)).total).toBe(0);
    expect((await ledgerDamagedLoss({ userId: fx.userId, channelName: "TIKTOK" }, today)).total).toBe(0);
    expect((await ledgerDamagedLoss({ userId: fx.userId, channelName: "SHOPEE" }, today)).total).toBe(387_000);
    expect((await ledgerDamagedLoss({ userId: "khong-co-chu-shop-nay" }, today)).total).toBe(0);
  });
});
