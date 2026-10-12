// ============================================================
// ƯỚC TÍNH PHÍ ESCROW SHOPEE: HỎI THEO TÍN HIỆU, SO TRƯỚC KHI GHI (lát B, 12/10/2026)
//
// Anh Trung chốt: đơn đã có số chỉ hỏi lại khi đổi trạng thái giao/hoàn; đơn
// chưa có số hỏi mỗi lượt; lưới đỡ 1 lần/ngày cho đơn đã giao chưa quyết toán;
// mọi lần hỏi so với số đang lưu, khác mới ghi. Căn cứ prod 30 ngày: 98% số
// ước tính cuối = số quyết toán đúng từng đồng. Ba nhóm kiểm:
//   1. rowDiffers/normalizeCell: Decimal ↔ số, Date, JSON đổi thứ tự khóa.
//   2. claimDailyEscrowSweep: đúng một lần mỗi ngày VN cho mỗi gian.
//   3. syncShopeePendingEscrowEstimates trên DB dev, sàn mock: phạm vi "new" /
//      mã đơn đổi trạng thái / "delivered" / "all" chọn đúng đơn; số giống →
//      không ghi; số khác → ghi.
// ============================================================
import "./load-env";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ChannelName, Prisma, ShippingStatus } from "@prisma/client";

vi.mock("../shopee/client", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../shopee/client")>();
  return { ...mod, getEscrowDetail: vi.fn() };
});

import { prisma } from "../../lib/prisma";
import { getEscrowDetail, type ShopeeOrderIncome } from "../shopee/client";
import {
  claimDailyEscrowSweep,
  escrowEstimateData,
  syncShopeePendingEscrowEstimates,
} from "../shopee/settlements";
import { normalizeCell, rowDiffers } from "../order-sync-write";

const escrow = vi.mocked(getEscrowDetail);

// ---------- 1. rowDiffers ----------

describe("rowDiffers / normalizeCell — so dòng đang lưu với bản sắp ghi", () => {
  it("Decimal đang lưu bằng số sắp ghi → không khác; lệch 1 đồng → khác", () => {
    const stored = { fixedFee: new Prisma.Decimal("12000.00"), expectedPayout: new Prisma.Decimal(88000) };
    expect(rowDiffers(stored, { fixedFee: 12000, expectedPayout: 88000 })).toBe(false);
    expect(rowDiffers(stored, { fixedFee: 12001, expectedPayout: 88000 })).toBe(true);
  });

  it("JSON cùng nội dung khác thứ tự khóa → không khác; null/undefined coi như nhau; thiếu cột → khác", () => {
    expect(rowDiffers({ expectedIncome: { a: 1, b: 2 } }, { expectedIncome: { b: 2, a: 1 } })).toBe(false);
    expect(rowDiffers({ expectedIncome: { a: 1 } }, { expectedIncome: { a: 2 } })).toBe(true);
    expect(rowDiffers({ settledAt: null }, { settledAt: undefined })).toBe(false);
    expect(rowDiffers({ x: 1 }, { x: 1, y: 2 })).toBe(true);
    expect(rowDiffers(null, { x: 1 })).toBe(true);
  });

  it("Date so theo mili-giây; mảng so theo nội dung", () => {
    const t = new Date("2026-10-12T03:00:00Z");
    expect(normalizeCell(t)).toBe(t.getTime());
    expect(rowDiffers({ at: new Date(t) }, { at: new Date(t.getTime()) })).toBe(false);
    expect(rowDiffers({ statementIds: ["a", "b"] }, { statementIds: ["a", "b"] })).toBe(false);
    expect(rowDiffers({ statementIds: ["a"] }, { statementIds: ["a", "b"] })).toBe(true);
  });
});

// ---------- 2. claimDailyEscrowSweep ----------

describe("claimDailyEscrowSweep — một lần mỗi ngày VN mỗi gian", () => {
  it("lượt đầu trong ngày true, lượt sau false, sang ngày VN mới lại true; gian khác độc lập", () => {
    const store = new Map<string, string>();
    const d1 = new Date("2026-10-12T02:00:00Z"); // 09:00 VN 12/10
    const d1b = new Date("2026-10-12T16:30:00Z"); // 23:30 VN 12/10
    const d2 = new Date("2026-10-12T17:30:00Z"); // 00:30 VN 13/10
    expect(claimDailyEscrowSweep("ch1", d1, store)).toBe(true);
    expect(claimDailyEscrowSweep("ch1", d1b, store)).toBe(false);
    expect(claimDailyEscrowSweep("ch2", d1b, store)).toBe(true);
    expect(claimDailyEscrowSweep("ch1", d2, store)).toBe(true);
  });
});

// ---------- 3. Phạm vi chọn đơn + so trước khi ghi (DB dev) ----------

function income(escrowAmount: number, commission = 10000): ShopeeOrderIncome {
  return {
    escrow_amount: escrowAmount,
    commission_fee: commission,
    service_fee: 5000,
    seller_transaction_fee: 3000,
    actual_shipping_fee: 20000,
    buyer_paid_shipping_fee: 20000,
  } as ShopeeOrderIncome;
}

describe("syncShopeePendingEscrowEstimates — hỏi đúng đơn, ghi khi khác", () => {
  const stamp = Date.now();
  let userId: string;
  let channelId: string;
  const code = (k: string) => `TEST-ESC-${stamp}-${k}`;
  /** Số sàn trả theo mã đơn: A 80.000, B 90.000 (= đang lưu), C 70.000 (khác đang lưu 75.000). */
  const platform: Record<string, ShopeeOrderIncome> = {
    [code("A")]: income(80000),
    [code("B")]: income(90000),
    [code("C")]: income(70000),
  };

  async function channel() {
    return prisma.channel.findUniqueOrThrow({ where: { id: channelId } });
  }
  async function row(k: string) {
    return prisma.order.findUniqueOrThrow({
      where: { channelId_orderCode: { channelId, orderCode: code(k) } },
      select: { expectedPayout: true, fixedFee: true, actualPayout: true },
    });
  }

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `test-esc-${stamp}@hubsell.test`, passwordHash: "x", fullName: "TEST escrow", role: "ADMIN" },
    });
    userId = user.id;
    const ch = await prisma.channel.create({
      data: {
        userId,
        channelName: ChannelName.SHOPEE,
        shopName: "TEST-ESCROW",
        externalShopId: `6${stamp}`,
        apiToken: "test-access-token",
        refreshToken: "test-refresh-token",
        accessTokenExpireAt: new Date(Date.now() + 6 * 3600_000),
        status: "ACTIVE",
      },
    });
    channelId = ch.id;
    const base = { channelId, customerName: "Khách test", totalAmount: 100000, paymentStatus: "PAID", itemCount: 1 };
    await prisma.order.createMany({
      data: [
        // A: chưa có số
        { ...base, orderCode: code("A"), shippingStatus: ShippingStatus.SHIPPING },
        // B: đã có số ĐÚNG bằng số sàn sẽ trả
        { ...base, orderCode: code("B"), shippingStatus: ShippingStatus.SHIPPING, ...escrowEstimateData(platform[code("B")]) },
        // C: đã giao, số đang lưu KHÁC số sàn sẽ trả
        {
          ...base,
          orderCode: code("C"),
          shippingStatus: ShippingStatus.DELIVERED,
          deliveredAt: new Date(),
          ...escrowEstimateData(income(75000)),
        },
      ],
    });
    escrow.mockReset();
    escrow.mockImplementation(async ({ orderSn }) => ({ response: { order_income: platform[orderSn] } }) as never);
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  });

  it('"new": chỉ hỏi đơn chưa có số (A) và ghi; lượt sau không còn gì để hỏi', async () => {
    const r1 = await syncShopeePendingEscrowEstimates(await channel(), { sweep: "new" });
    expect(r1).toMatchObject({ scanned: 1, updated: 1, unchanged: 0, errors: 0 });
    expect(escrow).toHaveBeenCalledTimes(1);
    expect(Number((await row("A")).expectedPayout)).toBe(80000);

    const r2 = await syncShopeePendingEscrowEstimates(await channel(), { sweep: "new" });
    expect(r2).toMatchObject({ scanned: 0 });
    expect(escrow).toHaveBeenCalledTimes(1);
  });

  it("mã đơn đổi trạng thái (B) → hỏi lại; số giống số đang lưu → không ghi", async () => {
    const r = await syncShopeePendingEscrowEstimates(await channel(), { sweep: "new", orderCodes: [code("B")] });
    expect(r).toMatchObject({ scanned: 1, updated: 0, unchanged: 1 });
    expect(escrow).toHaveBeenCalledTimes(2);
    expect(Number((await row("B")).expectedPayout)).toBe(90000);
  });

  it('"delivered" (lưới đỡ ngày): hỏi thêm đơn đã giao (C); số khác → ghi đè số mới của sàn', async () => {
    expect(Number((await row("C")).expectedPayout)).toBe(75000);
    const r = await syncShopeePendingEscrowEstimates(await channel(), { sweep: "delivered" });
    expect(r).toMatchObject({ scanned: 1, updated: 1, unchanged: 0 });
    expect(escrow).toHaveBeenCalledTimes(3);
    expect(Number((await row("C")).expectedPayout)).toBe(70000);
    expect(Number((await row("C")).actualPayout)).toBe(70000);
  });

  it('"all" (gian mới nạp lịch sử): hỏi cả ba, không đơn nào đổi số nữa', async () => {
    const r = await syncShopeePendingEscrowEstimates(await channel(), { sweep: "all" });
    expect(r).toMatchObject({ scanned: 3, updated: 0, unchanged: 3 });
    expect(escrow).toHaveBeenCalledTimes(6);
  });
});
