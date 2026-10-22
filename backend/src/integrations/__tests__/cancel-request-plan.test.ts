// Cờ "khách xin hủy, chờ shop quyết" (23/10/2026) — ba planner thuần của ba sàn.
// Luật chung: trục riêng, KHÔNG đổi shippingStatus; bật cờ khi sàn báo chờ, hạ
// khi sàn chốt; idempotent (cùng yêu cầu không ghi lại, không rung chuông lần 2).
import { describe, expect, it } from "vitest";
import { Carrier, Prisma, ReturnStatus, ShippingStatus } from "@prisma/client";
import { planShopeeOrderUpdate, type ShopeeExistingOrder } from "../shopee/service";
import type { ShopeeOrderDetail } from "../shopee/client";
import { planTiktokCancelFlag } from "../tiktok/cancel-requests";
import { planLazadaCancelRequest } from "../lazada/returns-sync";
import type { LazadaReverseOrder } from "../lazada/client";

const NOW = new Date("2026-10-23T09:00:00+07:00");

// ---------- Shopee: IN_CANCEL ----------

function shopeeExisting(over: Partial<ShopeeExistingOrder> = {}): ShopeeExistingOrder {
  return {
    id: "o1",
    orderCode: "SN1",
    createdAt: new Date("2026-10-22T08:00:00+07:00"),
    shippingStatus: ShippingStatus.PROCESSED,
    paymentStatus: "PAID",
    totalAmount: new Prisma.Decimal(150000),
    shippingCarrierName: "SPX Express",
    carrier: Carrier.SPX,
    deliveredAt: null,
    returnStatus: ReturnStatus.NONE,
    returnRequestedAt: null,
    cancelRequestedAt: null,
    ...over,
  };
}

function shopeeOrder(over: Partial<ShopeeOrderDetail> = {}): ShopeeOrderDetail {
  return {
    order_sn: "SN1",
    order_status: "PROCESSED",
    total_amount: 150000,
    shipping_carrier: "SPX Express",
    ...over,
  };
}

describe("Shopee IN_CANCEL → cờ khách xin hủy", () => {
  it("đơn ĐÃ chuẩn bị hàng: giữ Đã xử lý, bật cờ kèm lý do + hạn ~2 ngày", () => {
    const data = planShopeeOrderUpdate(
      shopeeExisting(),
      shopeeOrder({ order_status: "IN_CANCEL", buyer_cancel_reason: "Đặt nhầm size" }),
      NOW
    );
    expect(data.shippingStatus).toBeUndefined();
    expect(data.cancelRequestedAt).toEqual(NOW);
    expect(data.cancelRequestReason).toBe("Đặt nhầm size");
    expect(data.cancelRequestRef).toBeNull();
    expect(data.cancelRequestDueAt).toEqual(new Date(NOW.getTime() + 2 * 24 * 3600 * 1000));
  });

  it("đã có cờ, sàn vẫn IN_CANCEL → không ghi gì (idempotent)", () => {
    const data = planShopeeOrderUpdate(
      shopeeExisting({ cancelRequestedAt: new Date("2026-10-23T08:00:00+07:00") }),
      shopeeOrder({ order_status: "IN_CANCEL" }),
      NOW
    );
    expect(data).toEqual({});
  });

  it("shop TỪ CHỐI: sàn trả PROCESSED → hạ cờ, trạng thái không đổi", () => {
    const data = planShopeeOrderUpdate(
      shopeeExisting({ cancelRequestedAt: NOW }),
      shopeeOrder({ order_status: "PROCESSED" }),
      NOW
    );
    expect(data).toEqual({
      cancelRequestedAt: null,
      cancelRequestReason: null,
      cancelRequestRef: null,
      cancelRequestDueAt: null,
    });
  });

  it("shop CHẤP NHẬN: sàn trả CANCELLED → Đã hủy + hạ cờ", () => {
    const data = planShopeeOrderUpdate(
      shopeeExisting({ cancelRequestedAt: NOW }),
      shopeeOrder({ order_status: "CANCELLED" }),
      NOW
    );
    expect(data.shippingStatus).toBe(ShippingStatus.CANCELLED);
    expect(data.cancelRequestedAt).toBeNull();
  });
});

// ---------- TikTok: cancellations/search ----------

const ttOrder = {
  id: "o2",
  orderCode: "TT1",
  shippingStatus: ShippingStatus.PENDING,
  cancelRequestedAt: null as Date | null,
  cancelRequestRef: null as string | null,
};
const pendingReq = {
  cancel_id: "c9",
  order_id: "TT1",
  cancel_type: "BUYER_CANCEL",
  cancel_status: "CANCELLATION_REQUEST_PENDING",
  cancel_reason_text: "Đổi ý",
  create_time: Math.floor(new Date("2026-10-23T08:00:00+07:00").getTime() / 1000),
};

describe("TikTok planTiktokCancelFlag", () => {
  it("BUYER_CANCEL đang PENDING trên đơn Chờ xử lý → bật cờ với cancel_id, hạn 48 h từ lúc mở", () => {
    const plan = planTiktokCancelFlag(ttOrder, [pendingReq], NOW);
    expect(plan?.flagged).toBe(true);
    expect(plan?.data.cancelRequestRef).toBe("c9");
    expect(plan?.data.cancelRequestReason).toBe("Đổi ý");
    expect(plan?.data.cancelRequestedAt).toEqual(new Date("2026-10-23T08:00:00+07:00"));
    expect(plan?.data.cancelRequestDueAt).toEqual(new Date("2026-10-25T08:00:00+07:00"));
  });

  it("cùng cancel_id đã cờ → không ghi lại; yêu cầu CANCEL (seller/system) không bật cờ", () => {
    expect(planTiktokCancelFlag({ ...ttOrder, cancelRequestedAt: NOW, cancelRequestRef: "c9" }, [pendingReq], NOW)).toBeNull();
    expect(planTiktokCancelFlag(ttOrder, [{ ...pendingReq, cancel_type: "CANCEL" }], NOW)).toBeNull();
  });

  it("sàn chốt (SUCCESS) hoặc không còn yêu cầu → hạ cờ", () => {
    const flagged = { ...ttOrder, cancelRequestedAt: NOW, cancelRequestRef: "c9" };
    expect(planTiktokCancelFlag(flagged, [{ ...pendingReq, cancel_status: "CANCELLATION_REQUEST_SUCCESS" }], NOW)?.unflagged).toBe(true);
    expect(planTiktokCancelFlag(flagged, [], NOW)?.unflagged).toBe(true);
    expect(planTiktokCancelFlag(ttOrder, [], NOW)).toBeNull();
  });

  it("đơn đã sang Đã xử lý (AWAITING_COLLECTION) → khách hết quyền, không bật cờ", () => {
    expect(planTiktokCancelFlag({ ...ttOrder, shippingStatus: ShippingStatus.PROCESSED }, [pendingReq], NOW)).toBeNull();
  });
});

// ---------- Lazada: reverse order CANCEL ----------

const lzCancel: LazadaReverseOrder = {
  reverse_order_id: 777,
  trade_order_id: 123,
  request_type: "CANCEL",
  reverse_order_lines: [
    { reverse_status: "REQUEST_INITIATE", reason_text: "Không cần nữa", return_order_line_gmt_create: 1761181200 },
  ],
};

describe("Lazada planLazadaCancelRequest", () => {
  it("CANCEL còn sống → bật cờ với reverse_order_id, không hạn", () => {
    const plan = planLazadaCancelRequest([lzCancel], { cancelRequestedAt: null, cancelRequestRef: null }, NOW.getTime());
    expect(plan?.flagged).toBe(true);
    expect(plan?.data.cancelRequestRef).toBe("777");
    expect(plan?.data.cancelRequestReason).toBe("Không cần nữa");
    expect(plan?.data.cancelRequestDueAt).toBeNull();
  });

  it("yêu cầu RETURN không phải xin hủy; dòng CANCEL đã chết → hạ cờ", () => {
    expect(
      planLazadaCancelRequest([{ ...lzCancel, request_type: "RETURN" }], { cancelRequestedAt: null, cancelRequestRef: null }, NOW.getTime())
    ).toBeNull();
    const dead: LazadaReverseOrder = {
      ...lzCancel,
      reverse_order_lines: [{ reverse_status: "REQUEST_REJECT" }],
    };
    const plan = planLazadaCancelRequest([dead], { cancelRequestedAt: NOW, cancelRequestRef: "777" }, NOW.getTime());
    expect(plan?.unflagged).toBe(true);
  });

  it("cùng reverse_order_id đã cờ → không ghi lại", () => {
    expect(planLazadaCancelRequest([lzCancel], { cancelRequestedAt: NOW, cancelRequestRef: "777" }, NOW.getTime())).toBeNull();
  });
});
