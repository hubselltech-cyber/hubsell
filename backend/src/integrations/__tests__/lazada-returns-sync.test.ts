// ============================================================
// TEST PLANNER ĐƠN HOÀN LAZADA (Reverse Order API) — logic thuần, KHÔNG DB.
//
// Cùng bất biến với Shopee: trục returnStatus CHỈ đổi NONE ↔ AWAITING; số của
// sàn (giải pháp/tiền hoàn/SKU trả) chỉ ghi khi đổi; request_type CANCEL bỏ
// qua hẳn (hủy đơn thuộc trục shippingStatus).
// ============================================================

import { describe, expect, it } from "vitest";
import { ReturnSolution, ReturnStatus } from "@prisma/client";
import {
  isDeadLazadaReturn,
  lazadaReturnSolutionOf,
  planLazadaReturnUpdate,
  type LazadaReturnFlagState,
} from "../lazada/returns-sync";

const NOW_MS = 1_755_600_000_000;

const noneOrder: LazadaReturnFlagState = {
  returnStatus: ReturnStatus.NONE,
  returnRequestedAt: null,
  returnTrackingCode: null,
};

/** Yêu cầu TRẢ HÀNG 2 dòng cùng SKU + 1 dòng SKU khác (mỗi dòng = 1 đơn vị). */
const returnRequest = {
  reverse_order_id: "900001",
  trade_order_id: "531234567890123",
  request_type: "RETURN",
  is_rtm: "true",
  reverse_order_lines: [
    {
      reverse_order_line_id: "1",
      seller_sku_id: "TB011",
      is_need_refund: "true",
      refund_amount: "159000",
      reverse_status: "REQUEST_INITIATE",
      tracking_number: "LZDVN123",
      return_order_line_gmt_create: String(NOW_MS - 3_600_000),
      return_order_line_gmt_modified: String(NOW_MS - 100_000),
    },
    {
      reverse_order_line_id: "2",
      seller_sku_id: "TB011",
      is_need_refund: "true",
      refund_amount: "159000",
      reverse_status: "REQUEST_INITIATE",
      return_order_line_gmt_create: String(NOW_MS - 3_600_000),
      return_order_line_gmt_modified: String(NOW_MS - 200_000),
    },
    {
      reverse_order_line_id: "3",
      seller_sku_id: "TB020",
      is_need_refund: "false",
      refund_amount: "0",
      reverse_status: "REQUEST_INITIATE",
      return_order_line_gmt_create: String(NOW_MS - 3_600_000),
      return_order_line_gmt_modified: String(NOW_MS - 300_000),
    },
  ],
};

describe("lazadaReturnSolutionOf / isDeadLazadaReturn", () => {
  it("RETURN → hàng về; ONLY_REFUND → khách giữ; CANCEL/lạ → null (không đoán)", () => {
    expect(lazadaReturnSolutionOf({ request_type: "RETURN" })).toBe(
      ReturnSolution.RETURN_REFUND
    );
    expect(lazadaReturnSolutionOf({ request_type: "ONLY_REFUND" })).toBe(
      ReturnSolution.REFUND_ONLY
    );
    expect(lazadaReturnSolutionOf({ request_type: "CANCEL" })).toBeNull();
    expect(lazadaReturnSolutionOf({ request_type: "SOMETHING_NEW" })).toBeNull();
  });
  it("dòng chết khi reverse_status/ofc_status chứa CANCEL/REJECT/CLOSED", () => {
    expect(isDeadLazadaReturn({ ofc_status: "RETURN_CANCELED" })).toBe(true);
    expect(isDeadLazadaReturn({ reverse_status: "REQUEST_REJECTED" })).toBe(true);
    expect(isDeadLazadaReturn({ reverse_status: "REQUEST_INITIATE" })).toBe(false);
    expect(isDeadLazadaReturn({})).toBe(false);
  });
});

describe("planLazadaReturnUpdate — trả hàng", () => {
  it("gắn AWAITING + số của sàn: refund = Σ dòng is_need_refund, SKU trả đếm theo dòng, tracking + mốc thật", () => {
    const plan = planLazadaReturnUpdate([returnRequest], noneOrder, NOW_MS);
    expect(plan.flagged).toBe(true);
    expect(plan.data.returnStatus).toBe(ReturnStatus.AWAITING);
    expect(plan.data.returnRequestedAt).toEqual(new Date(NOW_MS - 3_600_000));
    expect(plan.data.returnSolution).toBe(ReturnSolution.RETURN_REFUND);
    expect(plan.data.platformRefundAmount).toBe(318000);
    expect(plan.data.platformReturnStatus).toBe("REQUEST_INITIATE");
    expect(plan.data.returnTrackingCode).toBe("LZDVN123");
    expect(plan.itemReturns).toEqual(new Map([["TB011", 2], ["TB020", 1]]));
  });

  it("số của sàn không đổi → không ghi gì (idempotent)", () => {
    const plan = planLazadaReturnUpdate(
      [returnRequest],
      {
        returnStatus: ReturnStatus.AWAITING,
        returnRequestedAt: new Date(NOW_MS - 3_600_000),
        returnTrackingCode: "LZDVN123",
        returnSolution: ReturnSolution.RETURN_REFUND,
        platformRefundAmount: 318000,
        platformReturnStatus: "REQUEST_INITIATE",
      },
      NOW_MS
    );
    expect(plan.data).toEqual({});
  });

  it("đơn kho đã xử lý (RECEIVED) không bị kéo trạng thái, vẫn nhận số của sàn", () => {
    const plan = planLazadaReturnUpdate(
      [returnRequest],
      {
        returnStatus: ReturnStatus.RECEIVED,
        returnRequestedAt: new Date(),
        returnTrackingCode: null,
      },
      NOW_MS
    );
    expect(plan.data.returnStatus).toBeUndefined();
    expect(plan.flagged).toBe(false);
    expect(plan.data.platformRefundAmount).toBe(318000);
  });
});

describe("planLazadaReturnUpdate — chỉ hoàn tiền / hủy / chết", () => {
  const refundOnly = {
    reverse_order_id: "900002",
    trade_order_id: "531234567890123",
    request_type: "ONLY_REFUND",
    reverse_order_lines: [
      {
        seller_sku_id: "TB011",
        is_need_refund: "true",
        refund_amount: "50000",
        reverse_status: "REQUEST_INITIATE",
        tracking_number: "LZDVN999",
        return_order_line_gmt_create: String(NOW_MS - 1000),
      },
    ],
  };

  it("chỉ hoàn tiền: KHÔNG gắn AWAITING, không lưu tracking, SKU trả rỗng", () => {
    const plan = planLazadaReturnUpdate([refundOnly], noneOrder, NOW_MS);
    expect(plan.flagged).toBe(false);
    expect(plan.data.returnStatus).toBeUndefined();
    expect(plan.data.returnTrackingCode).toBeUndefined();
    expect(plan.data.returnSolution).toBe(ReturnSolution.REFUND_ONLY);
    expect(plan.data.platformRefundAmount).toBe(50000);
    expect(plan.itemReturns).toEqual(new Map());
  });

  it("đơn AWAITING mà sàn chốt chỉ hoàn tiền → hạ cờ", () => {
    const plan = planLazadaReturnUpdate(
      [refundOnly],
      {
        returnStatus: ReturnStatus.AWAITING,
        returnRequestedAt: new Date(),
        returnTrackingCode: "LZDVN1",
      },
      NOW_MS
    );
    expect(plan.unflagged).toBe(true);
    expect(plan.data.returnStatus).toBe(ReturnStatus.NONE);
  });

  it("có CẢ trả hàng lẫn chỉ hoàn tiền còn sống → ưu tiên TRẢ HÀNG (kho phải đón kiện)", () => {
    const plan = planLazadaReturnUpdate([refundOnly, returnRequest], noneOrder, NOW_MS);
    expect(plan.data.returnSolution).toBe(ReturnSolution.RETURN_REFUND);
    expect(plan.flagged).toBe(true);
    // Tiền hoàn cộng cả hai yêu cầu sống: 318k + 50k
    expect(plan.data.platformRefundAmount).toBe(368000);
  });

  it("request_type CANCEL bị bỏ qua hẳn — không cờ, không số", () => {
    const cancel = { ...returnRequest, reverse_order_id: "900003", request_type: "CANCEL" };
    const plan = planLazadaReturnUpdate([cancel], noneOrder, NOW_MS);
    expect(plan.data).toEqual({});
    expect(plan.itemReturns).toBeNull();
  });

  it("mọi dòng chết → hạ cờ + xoá số của sàn, status lưu nguyên văn dòng chết mới nhất", () => {
    const dead = {
      ...returnRequest,
      reverse_order_lines: returnRequest.reverse_order_lines.map((l) => ({
        ...l,
        ofc_status: "RETURN_CANCELED",
      })),
    };
    const plan = planLazadaReturnUpdate(
      [dead],
      {
        returnStatus: ReturnStatus.AWAITING,
        returnRequestedAt: new Date(),
        returnTrackingCode: "LZDVN123",
        returnSolution: ReturnSolution.RETURN_REFUND,
        platformRefundAmount: 318000,
        platformReturnStatus: "REQUEST_INITIATE",
      },
      NOW_MS
    );
    expect(plan.unflagged).toBe(true);
    expect(plan.data.returnStatus).toBe(ReturnStatus.NONE);
    expect(plan.data.returnSolution).toBeNull();
    expect(plan.data.platformRefundAmount).toBe(0);
    expect(plan.data.platformReturnStatus).toBe("RETURN_CANCELED");
  });
});
