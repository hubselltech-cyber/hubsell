// Hỏi lại tên hãng đơn Shopee chưa rõ hãng (09/11/2026) — DB dev thật, lệnh gọi
// sàn + token được giả lập. Kiểm: chọn tên nào, ghi DB theo luật nào, lùi khi sàn
// từ chối trường checkout_shipping_carrier, trần 50 đơn một lệnh.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Carrier, ChannelName, ShippingStatus, type Channel } from "@prisma/client";

import { prisma } from "../../lib/prisma";
import type { ShopeeOrderCarrierInfo } from "../shopee/client";

const getNames = vi.fn<(token: string, shopId: string, sns: string[], withCheckout?: boolean) => Promise<ShopeeOrderCarrierInfo[]>>();

vi.mock("../shopee/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shopee/client")>()),
  getOrderCarrierNames: (token: string, shopId: string, sns: string[], withCheckout?: boolean) =>
    getNames(token, shopId, sns, withCheckout),
}));
vi.mock("../shopee/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shopee/service")>()),
  getValidShopeeAccessToken: async () => ({ accessToken: "t", shopId: "1" }),
}));

import { CARRIER_REFRESH_MAX, pickCarrierName, refreshShopeeCarrierNames } from "../shopee/carrier-names";

describe("pickCarrierName", () => {
  it("hãng sàn đã gán thắng kênh khách chọn", () => {
    expect(pickCarrierName({ shipping_carrier: " SPX Instant ", checkout_shipping_carrier: "Hỏa Tốc" })).toEqual({
      name: "SPX Instant",
      source: "carrier",
    });
  });

  it("hãng trống / còn 'đang điều phối' → lấy kênh khách chọn", () => {
    expect(pickCarrierName({ shipping_carrier: "", checkout_shipping_carrier: "Hỏa Tốc" })).toEqual({ name: "Hỏa Tốc", source: "checkout" });
    expect(pickCarrierName({ shipping_carrier: "Đang Điều Phối ĐVVC", checkout_shipping_carrier: "Nhanh" })).toEqual({
      name: "Nhanh",
      source: "checkout",
    });
  });

  it("cả hai trống / giữ chỗ → vẫn chưa rõ", () => {
    expect(pickCarrierName({})).toBeNull();
    expect(pickCarrierName({ shipping_carrier: "  ", checkout_shipping_carrier: "Đang Điều Phối ĐVVC" })).toBeNull();
  });
});

describe("refreshShopeeCarrierNames (DB dev + sàn giả lập)", () => {
  const stamp = Date.now().toString(36);
  let userId = "";
  let channel: Channel;

  const mk = (code: string, over: Record<string, unknown> = {}) =>
    prisma.order.create({
      data: {
        channelId: channel.id,
        orderCode: `${code}-${stamp}`,
        customerName: "TEST",
        totalAmount: 1,
        paymentStatus: "PAID",
        shippingStatus: ShippingStatus.PENDING,
        ...over,
      },
      select: { id: true, orderCode: true },
    });
  const row = (id: string) =>
    prisma.order.findUniqueOrThrow({ where: { id }, select: { shippingCarrierName: true, carrier: true } });

  beforeAll(async () => {
    const u = await prisma.user.create({
      data: { email: `test-carrier-names-${stamp}@hubsell.test`, passwordHash: "x", fullName: "TEST", role: "ADMIN" },
      select: { id: true },
    });
    userId = u.id;
    channel = await prisma.channel.create({
      data: { userId, channelName: ChannelName.SHOPEE, shopName: `TEST-carrier-${stamp}`, externalShopId: `92${stamp}`, status: "ACTIVE", refreshToken: "x" },
    });
  });

  beforeEach(async () => {
    getNames.mockReset();
    await prisma.order.deleteMany({ where: { channelId: channel.id } });
  });

  afterAll(async () => {
    await prisma.order.deleteMany({ where: { channelId: channel.id } });
    await prisma.channel.deleteMany({ where: { id: channel.id } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("ghi hãng sàn gán (kèm enum khi trống), ghi kênh khách chọn làm tên tạm, đơn sàn chưa trả tên thì để nguyên", async () => {
    const instant = await mk("A");
    const viaCheckout = await mk("B");
    const still = await mk("C");
    const handPicked = await mk("D", { carrier: Carrier.GHN });
    getNames.mockResolvedValue([
      { order_sn: instant.orderCode, shipping_carrier: "SPX Instant", checkout_shipping_carrier: "Hỏa Tốc" },
      { order_sn: viaCheckout.orderCode, shipping_carrier: "", checkout_shipping_carrier: "Hỏa Tốc" },
      { order_sn: still.orderCode, shipping_carrier: "Đang Điều Phối ĐVVC" },
      { order_sn: handPicked.orderCode, shipping_carrier: "SPX Express" },
    ]);
    const r = await refreshShopeeCarrierNames(channel, [instant, viaCheckout, still, handPicked]);

    expect(r.asked).toBe(4);
    expect(Object.fromEntries(r.names)).toEqual({
      [instant.id]: "SPX Instant",
      [viaCheckout.id]: "Hỏa Tốc",
      [handPicked.id]: "SPX Express",
    });
    expect(r).toMatchObject({ fromCarrier: 2, fromCheckout: 1 });
    expect(await row(instant.id)).toEqual({ shippingCarrierName: "SPX Instant", carrier: Carrier.SPX });
    // Kênh khách chọn chỉ là tên tạm: không suy ra enum hãng.
    expect(await row(viaCheckout.id)).toEqual({ shippingCarrierName: "Hỏa Tốc", carrier: null });
    expect(await row(still.id)).toEqual({ shippingCarrierName: null, carrier: null });
    // Kho đã chọn tay hãng → không đè enum.
    expect(await row(handPicked.id)).toEqual({ shippingCarrierName: "SPX Express", carrier: Carrier.GHN });
  });

  it("lượt đồng bộ chen giữa đã ghi hãng thật → tên tạm từ kênh khách chọn KHÔNG đè", async () => {
    const o = await mk("RACE");
    getNames.mockImplementation(async () => {
      await prisma.order.update({ where: { id: o.id }, data: { shippingCarrierName: "SPX Express" } });
      return [{ order_sn: o.orderCode, checkout_shipping_carrier: "Nhanh" }];
    });
    await refreshShopeeCarrierNames(channel, [o]);
    expect((await row(o.id)).shippingCarrierName).toBe("SPX Express");
  });

  it("sàn từ chối tham số → hỏi lại chỉ shipping_carrier; lỗi khác (429) ném ra cho làn bắt", async () => {
    const o = await mk("PARAM");
    getNames.mockRejectedValueOnce(new Error("Shopee get_order_detail: error_param — invalid response_optional_fields"));
    getNames.mockResolvedValueOnce([{ order_sn: o.orderCode, shipping_carrier: "Giao Hàng Nhanh" }]);
    const r = await refreshShopeeCarrierNames(channel, [o]);
    expect(getNames).toHaveBeenCalledTimes(2);
    expect(getNames.mock.calls[0][3]).toBe(true);
    expect(getNames.mock.calls[1][3]).toBe(false);
    expect(r.names.get(o.id)).toBe("Giao Hàng Nhanh");

    getNames.mockReset().mockRejectedValue(new Error("HTTP 429 Too Many Requests"));
    await expect(refreshShopeeCarrierNames(channel, [o])).rejects.toThrow("429");
    expect(getNames).toHaveBeenCalledTimes(1);
  });

  it("một lượt hỏi tối đa 50 đơn (một lệnh đọc); không có đơn thì không gọi sàn", async () => {
    getNames.mockResolvedValue([]);
    const many = Array.from({ length: CARRIER_REFRESH_MAX + 7 }, (_, i) => ({ id: `id${i}`, orderCode: `SN${i}` }));
    const r = await refreshShopeeCarrierNames(channel, many);
    expect(r.asked).toBe(CARRIER_REFRESH_MAX);
    expect(getNames).toHaveBeenCalledTimes(1);
    expect(getNames.mock.calls[0][2]).toHaveLength(CARRIER_REFRESH_MAX);

    getNames.mockClear();
    expect((await refreshShopeeCarrierNames(channel, [])).asked).toBe(0);
    expect(getNames).not.toHaveBeenCalled();
  });
});
