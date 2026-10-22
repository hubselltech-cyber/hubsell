// ============================================================
// ĐỒNG BỘ LÔ CHỈ GHI KHI KHÁC (12/10/2026 — docs/BANG-THONG-WORKER-CO-VIEC-THI-GOI.md)
//
// Đo prod: tầng nhanh order-auto-sync ghi lại mọi đơn trong cửa sổ 2 ngày mỗi
// 10 phút dù không đổi (UPDATE Order 7,7 triệu / 12 ngày), và `updated` đếm
// mọi đơn đọc lại nên gian không bao giờ giãn nhịp. Ba nhóm kiểm chứng:
//   1. PLANNER THUẦN 3 sàn: đơn giống hệt → bản ghi rỗng; mỗi cột đổi → đúng
//      cột ấy; các luật cũ giữ nguyên (mốc giao ghi một lần, hãng không ghi đè
//      chọn tay, cờ hoàn chỉ tiến NONE → AWAITING, đơn TikTok đã đối soát không
//      ghi đè trợ giá); SYNC_WRITE_ALWAYS=1 trả đủ cột (đường lui).
//   2. ĐỒNG BỘ LÔ SHOPEE trên DB thật, tầng gọi sàn mock: lượt 2 trả y nguyên
//      → updated = 0, unchanged = n, không UPDATE; đơn đổi trạng thái → đúng 1.
//   3. Điền bù ảnh: chỉ đơn tạo trước mốc 08/09/2026.
// ============================================================
import "./load-env";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Carrier, ChannelName, Prisma, ReturnStatus, ShippingStatus } from "@prisma/client";

vi.mock("../shopee/client", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../shopee/client")>();
  return { ...mod, getOrderList: vi.fn(), getOrderDetail: vi.fn() };
});

import { prisma } from "../../lib/prisma";
import { getOrderDetail, getOrderList, type ShopeeOrderDetail } from "../shopee/client";
import {
  planShopeeOrderUpdate,
  syncShopeeOrders,
  type ShopeeExistingOrder,
} from "../shopee/service";
import { planTiktokOrderUpdate, type TiktokExistingOrder } from "../tiktok/service";
import {
  lazadaShipDetailDiffers,
  planLazadaOrderUpdate,
  type LazadaExistingOrder,
} from "../lazada/service";
import type { TikTokOrder } from "../tiktok/client";
import type { LazadaOrder, LazadaOrderItem } from "../lazada/client";
import { ORDER_ITEM_IMAGE_SINCE, needsItemImageBackfill } from "../order-sync-write";

const NOW = new Date("2026-10-12T10:00:00+07:00");
const dec = (n: number) => new Prisma.Decimal(n);

afterEach(() => {
  delete process.env.SYNC_WRITE_ALWAYS;
});

// ---------- 1a. Shopee ----------

function shopeeExisting(over: Partial<ShopeeExistingOrder> = {}): ShopeeExistingOrder {
  return {
    id: "o1",
    orderCode: "SN1",
    cancelRequestedAt: null,
    createdAt: new Date("2026-10-10T08:00:00+07:00"),
    shippingStatus: ShippingStatus.SHIPPING,
    paymentStatus: "PAID",
    totalAmount: dec(150000),
    shippingCarrierName: "SPX Express",
    carrier: Carrier.SPX,
    deliveredAt: null,
    returnStatus: ReturnStatus.NONE,
    returnRequestedAt: null,
    ...over,
  };
}

function shopeeOrder(over: Partial<ShopeeOrderDetail> = {}): ShopeeOrderDetail {
  return {
    order_sn: "SN1",
    order_status: "SHIPPED",
    total_amount: 150000,
    shipping_carrier: "SPX Express",
    update_time: Math.floor(new Date("2026-10-11T09:00:00+07:00").getTime() / 1000),
    ...over,
  };
}

describe("planShopeeOrderUpdate — chỉ cột khác", () => {
  it("sàn trả y nguyên → bản ghi rỗng", () => {
    expect(planShopeeOrderUpdate(shopeeExisting(), shopeeOrder(), NOW)).toEqual({});
  });

  it("đổi trạng thái giao → đúng cột trạng thái, kèm mốc giao của sàn (ghi một lần)", () => {
    const data = planShopeeOrderUpdate(shopeeExisting(), shopeeOrder({ order_status: "COMPLETED" }), NOW);
    expect(data).toEqual({
      shippingStatus: ShippingStatus.DELIVERED,
      deliveredAt: new Date("2026-10-11T09:00:00+07:00"),
    });
    // Đã có mốc giao đúng → lượt sau không ghi lại.
    const again = planShopeeOrderUpdate(
      shopeeExisting({ shippingStatus: ShippingStatus.DELIVERED, deliveredAt: new Date("2026-10-11T09:00:00+07:00") }),
      shopeeOrder({ order_status: "COMPLETED" }),
      NOW
    );
    expect(again).toEqual({});
  });

  it("tổng tiền / tên hãng đổi → đúng cột ấy; Decimal so bằng số", () => {
    expect(planShopeeOrderUpdate(shopeeExisting(), shopeeOrder({ total_amount: 160000 }), NOW)).toEqual({
      totalAmount: 160000,
    });
    expect(planShopeeOrderUpdate(shopeeExisting(), shopeeOrder({ shipping_carrier: "GHTK" }), NOW)).toEqual({
      shippingCarrierName: "GHTK",
    });
  });

  it("hãng (enum) chỉ điền khi trống — không ghi đè lựa chọn tay của kho", () => {
    expect(planShopeeOrderUpdate(shopeeExisting({ carrier: Carrier.GHN }), shopeeOrder(), NOW)).toEqual({});
    expect(planShopeeOrderUpdate(shopeeExisting({ carrier: null }), shopeeOrder(), NOW)).toEqual({
      carrier: Carrier.SPX,
    });
  });

  it("cờ hoàn chỉ TIẾN NONE → AWAITING kèm mốc; kho đã xử lý thì không đụng", () => {
    expect(planShopeeOrderUpdate(shopeeExisting(), shopeeOrder({ order_status: "TO_RETURN" }), NOW)).toEqual({
      shippingStatus: ShippingStatus.DELIVERED,
      deliveredAt: new Date("2026-10-11T09:00:00+07:00"),
      returnStatus: ReturnStatus.AWAITING,
      returnRequestedAt: NOW,
    });
    const done = shopeeExisting({
      shippingStatus: ShippingStatus.DELIVERED,
      deliveredAt: new Date("2026-10-11T09:00:00+07:00"),
      returnStatus: ReturnStatus.RECEIVED_INTACT,
      returnRequestedAt: new Date("2026-10-11T10:00:00+07:00"),
    });
    expect(planShopeeOrderUpdate(done, shopeeOrder({ order_status: "TO_RETURN" }), NOW)).toEqual({});
  });

  it("SYNC_WRITE_ALWAYS=1 → trả đủ cột như trước (đường lui)", () => {
    process.env.SYNC_WRITE_ALWAYS = "1";
    expect(planShopeeOrderUpdate(shopeeExisting(), shopeeOrder(), NOW)).toEqual({
      shippingStatus: ShippingStatus.SHIPPING,
      paymentStatus: "PAID",
      totalAmount: 150000,
      shippingCarrierName: "SPX Express",
    });
  });
});

// ---------- 1b. TikTok ----------

function tiktokExisting(over: Partial<TiktokExistingOrder> = {}): TiktokExistingOrder {
  return {
    id: "o2",
    orderCode: "TT1",
    cancelRequestedAt: null,
    createdAt: new Date("2026-10-10T08:00:00+07:00"),
    shippingStatus: ShippingStatus.SHIPPING,
    paymentStatus: "PAID",
    totalAmount: dec(99000),
    platformSubsidy: dec(5000),
    trackingCode: "JT123",
    platformPackageId: "PKG1",
    deliveredAt: null,
    carrier: Carrier.JT,
    shippingCarrierName: "Standard shipping · J&T Express",
    isSettled: false,
    ...over,
  };
}

function tiktokOrder(over: Partial<TikTokOrder> = {}): TikTokOrder {
  return {
    id: "TT1",
    status: "IN_TRANSIT",
    payment: { total_amount: "99000", platform_discount: "5000" } as TikTokOrder["payment"],
    tracking_number: "JT123",
    packages: [{ id: "PKG1" }] as TikTokOrder["packages"],
    delivery_option_name: "Standard shipping",
    shipping_provider: "J&T Express",
    ...over,
  };
}

describe("planTiktokOrderUpdate — chỉ cột khác", () => {
  it("sàn trả y nguyên → bản ghi rỗng", () => {
    expect(planTiktokOrderUpdate(tiktokExisting(), tiktokOrder())).toEqual({});
  });

  it("giao thành công → trạng thái + mốc giao của sàn (ghi một lần)", () => {
    const deliveredSec = Math.floor(new Date("2026-10-12T08:00:00+07:00").getTime() / 1000);
    expect(planTiktokOrderUpdate(tiktokExisting(), tiktokOrder({ status: "DELIVERED", delivery_time: deliveredSec }))).toEqual({
      shippingStatus: ShippingStatus.DELIVERED,
      deliveredAt: new Date(deliveredSec * 1000),
    });
    expect(
      planTiktokOrderUpdate(
        tiktokExisting({ shippingStatus: ShippingStatus.DELIVERED, deliveredAt: new Date(deliveredSec * 1000) }),
        tiktokOrder({ status: "DELIVERED", delivery_time: deliveredSec })
      )
    ).toEqual({});
  });

  it("đơn đã đối soát: trợ giá sàn đổi cũng KHÔNG ghi đè (số bản kê là sự thật)", () => {
    const o = tiktokOrder({ payment: { total_amount: "99000", platform_discount: "7000" } as TikTokOrder["payment"] });
    expect(planTiktokOrderUpdate(tiktokExisting({ isSettled: true }), o)).toEqual({});
    expect(planTiktokOrderUpdate(tiktokExisting(), o)).toEqual({ platformSubsidy: 7000 });
  });

  it("vận đơn / kiện: sàn trống thì giữ mã đang có; sàn có mã khác thì ghi", () => {
    expect(planTiktokOrderUpdate(tiktokExisting(), tiktokOrder({ tracking_number: "", packages: [] }))).toEqual({});
    expect(planTiktokOrderUpdate(tiktokExisting({ trackingCode: null }), tiktokOrder())).toEqual({ trackingCode: "JT123" });
  });
});

// ---------- 1c. Lazada ----------

function lazadaExisting(over: Partial<LazadaExistingOrder> = {}): LazadaExistingOrder {
  return {
    id: "o3",
    orderCode: "LZ1",
    cancelRequestedAt: null,
    createdAt: new Date("2026-10-10T08:00:00+07:00"),
    shippingStatus: ShippingStatus.SHIPPING,
    paymentStatus: "PAID",
    totalAmount: dec(200000),
    trackingCode: "LEX1",
    carrier: Carrier.KHAC, // "LEX VN" không khớp hãng nào → KHAC (services/shipping.ts)
    shippingCarrierName: "LEX VN",
    deliveredAt: null,
    returnStatus: ReturnStatus.NONE,
    returnRequestedAt: null,
    lazadaSettlement: { shipFee: dec(30000), shipFeeCustomer: dec(15000), shipDiscountPlatform: dec(-15000), shipDiscountSeller: dec(0) },
    ...over,
  };
}

function lazadaOrder(over: Partial<LazadaOrder> = {}): LazadaOrder {
  return { order_id: 1, order_number: "LZ1", price: "200000", statuses: ["shipped"], ...over } as LazadaOrder;
}

const lazadaItems: LazadaOrderItem[] = [
  {
    order_id: 1,
    sku: "SKU1",
    paid_price: "200000",
    tracking_code: "LEX1",
    shipment_provider: "LEX VN",
    shipping_fee_original: "30000",
    shipping_amount: "15000",
    shipping_fee_discount_platform: "15000",
    shipping_fee_discount_seller: "0",
  } as LazadaOrderItem,
];

describe("planLazadaOrderUpdate + lazadaShipDetailDiffers — chỉ cột khác", () => {
  it("sàn trả y nguyên → Order rỗng, chi tiết ship không khác", () => {
    expect(planLazadaOrderUpdate(lazadaExisting(), lazadaOrder(), lazadaItems, NOW)).toEqual({});
    expect(lazadaShipDetailDiffers(lazadaExisting(), lazadaOrder(), lazadaItems)).toBe(false);
  });

  it("trạng thái đổi sang giao thành công → cột trạng thái + mốc giao của sàn", () => {
    const o = lazadaOrder({ statuses: ["delivered"], updated_at: "2026-10-11T09:00:00+07:00" });
    expect(planLazadaOrderUpdate(lazadaExisting(), o, lazadaItems, NOW)).toEqual({
      shippingStatus: ShippingStatus.DELIVERED,
      deliveredAt: new Date("2026-10-11T09:00:00+07:00"),
    });
  });

  it("chi tiết ship đổi (sàn bù ship khác) → cần ghi dù Order không đổi; chưa có bản ghi ship → cần ghi", () => {
    const items = [{ ...lazadaItems[0], shipping_fee_discount_platform: "20000" }] as LazadaOrderItem[];
    expect(planLazadaOrderUpdate(lazadaExisting(), lazadaOrder(), items, NOW)).toEqual({});
    expect(lazadaShipDetailDiffers(lazadaExisting(), lazadaOrder(), items)).toBe(true);
    expect(lazadaShipDetailDiffers(lazadaExisting({ lazadaSettlement: null }), lazadaOrder(), lazadaItems)).toBe(true);
  });

  it("cờ hoàn chỉ tiến NONE → AWAITING; vận đơn không ghi đè bằng rỗng", () => {
    expect(planLazadaOrderUpdate(lazadaExisting(), lazadaOrder({ statuses: ["returned"] }), lazadaItems, NOW)).toMatchObject({
      returnStatus: ReturnStatus.AWAITING,
      returnRequestedAt: NOW,
    });
    const noTracking = [{ ...lazadaItems[0], tracking_code: undefined }] as LazadaOrderItem[];
    expect(planLazadaOrderUpdate(lazadaExisting(), lazadaOrder(), noTracking, NOW)).toEqual({});
  });
});

// ---------- 3. Điền bù ảnh theo mốc ----------

describe("needsItemImageBackfill", () => {
  it("chỉ đơn tạo trước 08/09/2026 (trước khi lưu ảnh lúc tạo đơn)", () => {
    expect(needsItemImageBackfill(new Date("2026-09-07T23:00:00+07:00"))).toBe(true);
    expect(needsItemImageBackfill(ORDER_ITEM_IMAGE_SINCE)).toBe(false);
    expect(needsItemImageBackfill(new Date("2026-10-01T00:00:00+07:00"))).toBe(false);
  });
});

// ---------- 2. Đồng bộ lô Shopee trên DB thật, sàn mock ----------

describe("syncShopeeOrders — lượt trả y nguyên không ghi, đơn đổi mới đếm updated", () => {
  const stamp = Date.now();
  let userId: string;
  let channelId: string;
  const mocked = { list: vi.mocked(getOrderList), detail: vi.mocked(getOrderDetail) };

  const details = (status: string): ShopeeOrderDetail[] =>
    ["A", "B", "C"].map((k) => ({
      order_sn: `TEST-SYNC-${stamp}-${k}`,
      order_status: status,
      total_amount: 120000,
      shipping_carrier: "SPX Express",
      create_time: Math.floor(stamp / 1000) - 3600,
      update_time: Math.floor(stamp / 1000) - 60,
      recipient_address: { name: "Khách test", phone: "0900000000" },
      item_list: [{ item_id: 1, model_id: 0, item_name: "SP test", model_quantity_purchased: 1, model_discounted_price: 120000 }],
    })) as ShopeeOrderDetail[];

  async function channel() {
    return prisma.channel.findUniqueOrThrow({ where: { id: channelId } });
  }

  function mockPlatform(status: string) {
    mocked.list.mockReset();
    mocked.detail.mockReset();
    mocked.list.mockResolvedValue({
      response: { order_list: details(status).map((d) => ({ order_sn: d.order_sn })), more: false },
    } as Awaited<ReturnType<typeof getOrderList>>);
    mocked.detail.mockResolvedValue(details(status));
  }

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `test-sync-write-${stamp}@hubsell.test`, passwordHash: "x", fullName: "TEST sync write", role: "ADMIN" },
    });
    userId = user.id;
    const ch = await prisma.channel.create({
      data: {
        userId,
        channelName: ChannelName.SHOPEE,
        shopName: "TEST-SYNC-WRITE",
        externalShopId: `9${stamp}`,
        apiToken: "test-access-token",
        refreshToken: "test-refresh-token",
        accessTokenExpireAt: new Date(Date.now() + 6 * 3600_000),
        status: "ACTIVE",
      },
    });
    channelId = ch.id;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  });

  it("lượt 1 tạo 3 đơn; lượt 2 y nguyên → 0 updated, 3 unchanged; lượt 3 đổi trạng thái → 3 updated", async () => {
    mockPlatform("SHIPPED");
    const r1 = await syncShopeeOrders(await channel(), { daysBack: 2, timeRangeField: "update_time" });
    expect(r1).toMatchObject({ fetched: 3, created: 3, updated: 0, unchanged: 0 });
    // Lát 1a (18/10/2026): dòng đơn mang id lá sàn — item_id 1, model_id 0 (sản phẩm đơn) → "1", ghi dù danh mục gian trống.
    const items = await prisma.orderItem.findMany({ where: { order: { channelId } }, select: { externalId: true, channelSku: true } });
    expect(items).toHaveLength(3);
    expect(items.every((it) => it.externalId === "1")).toBe(true);

    const r2 = await syncShopeeOrders(await channel(), { daysBack: 2, timeRangeField: "update_time" });
    expect(r2).toMatchObject({ fetched: 3, created: 0, updated: 0, unchanged: 3 });
    // Không có gì đổi trong DB.
    const rows = await prisma.order.findMany({ where: { channelId }, select: { shippingStatus: true, deliveredAt: true } });
    expect(rows.every((o) => o.shippingStatus === ShippingStatus.SHIPPING && o.deliveredAt === null)).toBe(true);

    mockPlatform("COMPLETED");
    const r3 = await syncShopeeOrders(await channel(), { daysBack: 2, timeRangeField: "update_time" });
    expect(r3).toMatchObject({ fetched: 3, created: 0, updated: 3, unchanged: 0 });
    const after = await prisma.order.findMany({ where: { channelId }, select: { shippingStatus: true, deliveredAt: true } });
    expect(after.every((o) => o.shippingStatus === ShippingStatus.DELIVERED && o.deliveredAt !== null)).toBe(true);

    // Lượt 4 y nguyên trạng thái đã giao → lại không ghi.
    const r4 = await syncShopeeOrders(await channel(), { daysBack: 2, timeRangeField: "update_time" });
    expect(r4).toMatchObject({ updated: 0, unchanged: 3 });
  });
});
