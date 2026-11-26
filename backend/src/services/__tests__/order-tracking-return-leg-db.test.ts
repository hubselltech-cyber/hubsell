// ============================================================
// LƯU MỐC HÃNG TRẢ KIỆN GIAO THẤT BẠI (26/11/2026) — getReturnLegForOrders trên Postgres thật,
// hành trình lấy từ dữ liệu mẫu (ORDER_TRACKING_FAKE=1, không gọi sàn):
//   · hãng báo đã trả → ghi Order.returnCarrierReturnedAt đúng một lần;
//   · đơn đã có mốc → trả từ cột, KHÔNG hỏi hành trình nữa, mốc không bị ghi đè;
//   · kiện đang về / chưa có mốc hoàn → không ghi gì;
//   · đơn không thuộc diện (kho đã nhận, khách trả hàng, đơn của shop khác) → không hỏi, không ghi.
// Tự tạo gian + đơn riêng rồi xóa; không nối được DB → cả file tự BỎ QUA.
// docs/DOI-SOAT-DON-HOAN-HANG-LOAT-VA-THAT-THU.md mục 19
// ============================================================

import "../../integrations/__tests__/load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChannelName, ReturnStatus, ShippingStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { CANCELLED_AFTER_SHIP } from "../../integrations/cancelled-after-ship";
import { returnShippingFilterOf } from "../../lib/return-shipping";
import { getReturnLegForOrders } from "../order-tracking";

const dbReady: boolean = await (async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const col = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_name = 'Order' AND column_name = 'returnCarrierReturnedAt'`;
    return (col[0]?.n ?? 0) > 0;
  } catch {
    return false;
  }
})();

const TAG = `rleg-${Date.now()}`;

/** Ca hành trình mẫu của order-tracking.ts: tổng mã ký tự % 3 — 0 chưa có mốc hoàn, 1 đang về, 2 hãng đã trả. */
function codeWithVariant(base: string, want: number): string {
  for (let d = 0; d < 10; d++) {
    const code = `${base}${d}`;
    if ([...code].reduce((s, c) => s + c.charCodeAt(0), 0) % 3 === want) return code;
  }
  throw new Error("không tìm được mã");
}

describe.skipIf(!dbReady)("Hỏi hãng kiện giao thất bại — lưu mốc hãng trả kiện", () => {
  const prevFake = process.env.ORDER_TRACKING_FAKE;
  let userId = "";
  let otherUserId = "";
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    process.env.ORDER_TRACKING_FAKE = "1";
    const user = await prisma.user.create({
      data: { email: `${TAG}@test.local`, passwordHash: "x", fullName: TAG },
      select: { id: true },
    });
    userId = user.id;
    const other = await prisma.user.create({
      data: { email: `${TAG}-khac@test.local`, passwordHash: "x", fullName: TAG },
      select: { id: true },
    });
    otherUserId = other.id;
    const channel = await prisma.channel.create({
      data: { userId, channelName: ChannelName.TIKTOK, shopName: TAG },
      select: { id: true },
    });
    const otherChannel = await prisma.channel.create({
      data: { userId: otherUserId, channelName: ChannelName.TIKTOK, shopName: `${TAG}-khac` },
      select: { id: true },
    });

    const mk = async (
      key: string,
      code: string,
      over: {
        channelId?: string;
        returnStatus?: ReturnStatus;
        platformReturnStatus?: string | null;
        returnCarrierReturnedAt?: Date | null;
      } = {}
    ) => {
      const o = await prisma.order.create({
        data: {
          channelId: over.channelId ?? channel.id,
          orderCode: code,
          customerName: "Khách thử",
          totalAmount: 100_000,
          shippingStatus: ShippingStatus.CANCELLED,
          trackingCode: `TRK-${key}`,
          returnStatus: over.returnStatus ?? ReturnStatus.AWAITING,
          platformReturnStatus:
            over.platformReturnStatus === undefined ? CANCELLED_AFTER_SHIP : over.platformReturnStatus,
          returnCarrierReturnedAt: over.returnCarrierReturnedAt ?? null,
        },
        select: { id: true },
      });
      ids[key] = o.id;
    };

    await mk("da-tra", codeWithVariant(`${TAG}-a`, 2));
    await mk("dang-ve", codeWithVariant(`${TAG}-b`, 1));
    await mk("chua-co-moc", codeWithVariant(`${TAG}-c`, 0));
    await mk("da-co-moc", codeWithVariant(`${TAG}-d`, 0), {
      returnCarrierReturnedAt: new Date("2026-11-20T03:00:00Z"),
    });
    // Không thuộc diện hỏi — hành trình mẫu của chúng đều là "hãng đã trả".
    await mk("kho-da-nhan", codeWithVariant(`${TAG}-e`, 2), { returnStatus: ReturnStatus.RECEIVED });
    await mk("khach-tra-hang", codeWithVariant(`${TAG}-f`, 2), { platformReturnStatus: "BUYER_SHIPPED_ITEM" });
    await mk("shop-khac", codeWithVariant(`${TAG}-g`, 2), { channelId: otherChannel.id });
  });

  afterAll(async () => {
    if (prevFake === undefined) delete process.env.ORDER_TRACKING_FAKE;
    else process.env.ORDER_TRACKING_FAKE = prevFake;
    for (const uid of [userId, otherUserId]) {
      if (!uid) continue;
      await prisma.order.deleteMany({ where: { channel: { userId: uid } } });
      await prisma.channel.deleteMany({ where: { userId: uid } });
      await prisma.user.deleteMany({ where: { id: uid } });
    }
  });

  const stored = async (key: string) =>
    (await prisma.order.findUniqueOrThrow({ where: { id: ids[key] }, select: { returnCarrierReturnedAt: true } }))
      .returnCarrierReturnedAt;

  it("hãng báo đã trả → ghi mốc; đang về / chưa có mốc hoàn → không ghi; ngoài diện → không hỏi, không ghi", async () => {
    const now = Date.now();
    const out = await getReturnLegForOrders({ ownerId: userId, orderIds: Object.values(ids), now });

    expect(Object.keys(out).sort()).toEqual(
      [ids["da-tra"], ids["dang-ve"], ids["chua-co-moc"], ids["da-co-moc"]].sort()
    );
    expect(out[ids["da-tra"]]).toMatchObject({ status: "ok", state: "RETURNED" });
    expect(out[ids["dang-ve"]]).toMatchObject({ status: "ok", state: "RETURNING" });
    expect(out[ids["chua-co-moc"]]).toMatchObject({ status: "ok", state: "NO_SIGNAL" });

    const at = await stored("da-tra");
    expect(at).not.toBeNull();
    // Hành trình mẫu ghi mốc "đã trả" trước hiện tại 30 phút.
    expect(at!.getTime()).toBe(now - 30 * 60_000);
    expect(await stored("dang-ve")).toBeNull();
    expect(await stored("chua-co-moc")).toBeNull();
    expect(await stored("kho-da-nhan")).toBeNull();
    expect(await stored("khach-tra-hang")).toBeNull();
    expect(await stored("shop-khac")).toBeNull();
  });

  it("đơn đã có mốc → trả từ cột (không hỏi hành trình: fetchedAt null), mốc cũ giữ nguyên", async () => {
    // Hành trình mẫu của đơn này là "chưa có mốc hoàn" — nếu còn hỏi sàn thì kết quả sẽ là NO_SIGNAL.
    const out = await getReturnLegForOrders({ ownerId: userId, orderIds: [ids["da-co-moc"]] });
    expect(out[ids["da-co-moc"]]).toEqual({
      status: "ok",
      state: "RETURNED",
      at: "2026-11-20T03:00:00.000Z",
      latest: null,
      fetchedAt: null,
    });
    expect((await stored("da-co-moc"))!.toISOString()).toBe("2026-11-20T03:00:00.000Z");
  });

  it("hỏi lại đơn vừa được ghi mốc → vẫn RETURNED đúng mốc lần đầu, không bị ghi đè bằng giờ mới", async () => {
    const first = await stored("da-tra");
    const out = await getReturnLegForOrders({ ownerId: userId, orderIds: [ids["da-tra"]], now: Date.now() + 3_600_000 });
    expect(out[ids["da-tra"]]).toMatchObject({ status: "ok", state: "RETURNED", at: first!.toISOString(), fetchedAt: null });
    expect((await stored("da-tra"))!.getTime()).toBe(first!.getTime());
  });

  it("đơn có mốc được bộ lọc xếp vào 'hoàn thành công', đơn chưa có mốc vẫn ở 'giao thất bại'", async () => {
    const rows = await prisma.order.findMany({
      where: { id: { in: [ids["da-tra"], ids["dang-ve"]] } },
      select: {
        id: true,
        returnStatus: true,
        returnedAt: true,
        returnDeliveredAt: true,
        platformReturnStatus: true,
        returnTrackingCode: true,
        returnCarrierReturnedAt: true,
      },
    });
    const by = Object.fromEntries(rows.map((r) => [r.id, returnShippingFilterOf(r)]));
    expect(by[ids["da-tra"]]).toBe("RETURNED");
    expect(by[ids["dang-ve"]]).toBe("FAILED_DELIVERY");
  });
});
