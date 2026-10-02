// ============================================================
// TEST QUYẾT ĐỊNH GẮN/HẠ CỜ ĐƠN HOÀN SHOPEE (Returns API) — logic thuần, KHÔNG DB.
//
// Bất biến sống còn: planReturnUpdate CHỈ đổi qua lại NONE ↔ AWAITING.
// Đơn kho đã xử lý (RECEIVED trở đi) tuyệt đối không bị đụng — regress cờ ở
// đây là phá tiến độ nhập kho, tệ nhất là mở lại đường cộng kho trùng.
// ============================================================

import { describe, expect, it } from "vitest";
import { ReturnSolution, ReturnStatus } from "@prisma/client";
import {
  isDeadReturn,
  isShopeeReturnParcelDelivered,
  latestAliveReturn,
  planReturnUpdate,
  returnSolutionOf,
  type ReturnFlagState,
} from "../shopee/returns-sync";

const NOW_SEC = 1_755_000_000;

const noneOrder: ReturnFlagState = {
  returnStatus: ReturnStatus.NONE,
  returnRequestedAt: null,
  returnTrackingCode: null,
};

describe("isDeadReturn", () => {
  it("CANCELLED/CLOSED là yêu cầu chết, kể cả viết thường", () => {
    expect(isDeadReturn("CANCELLED")).toBe(true);
    expect(isDeadReturn("closed")).toBe(true);
  });
  it("REQUESTED/PROCESSING/ACCEPTED còn sống; thiếu status coi như còn sống", () => {
    expect(isDeadReturn("REQUESTED")).toBe(false);
    expect(isDeadReturn("PROCESSING")).toBe(false);
    expect(isDeadReturn(undefined)).toBe(false);
  });
});

describe("planReturnUpdate — gắn cờ", () => {
  it("đơn NONE có yêu cầu sống → AWAITING, mốc = create_time THẬT của sàn", () => {
    const plan = planReturnUpdate(
      [
        {
          return_sn: "R1",
          status: "REQUESTED",
          create_time: NOW_SEC - 3600,
          update_time: NOW_SEC - 100,
          tracking_number: "SPXVN123",
        },
      ],
      noneOrder,
      NOW_SEC
    );
    expect(plan.flagged).toBe(true);
    expect(plan.data.returnStatus).toBe(ReturnStatus.AWAITING);
    expect(plan.data.returnRequestedAt).toEqual(new Date((NOW_SEC - 3600) * 1000));
    expect(plan.data.returnTrackingCode).toBe("SPXVN123");
    expect(plan.trackingSaved).toBe(true);
  });

  it("nhiều yêu cầu: mốc lấy yêu cầu SỚM nhất còn sống, tracking lấy yêu cầu MỚI nhất có mã", () => {
    const plan = planReturnUpdate(
      [
        // Yêu cầu cũ bị hủy — không được dùng mốc/mã của nó
        {
          status: "CANCELLED",
          create_time: NOW_SEC - 9999,
          update_time: NOW_SEC - 5000,
          tracking_number: "DEAD-TRACK",
        },
        {
          status: "REQUESTED",
          create_time: NOW_SEC - 4000,
          update_time: NOW_SEC - 3000,
        },
        {
          status: "PROCESSING",
          create_time: NOW_SEC - 2000,
          update_time: NOW_SEC - 100,
          tracking_number: "SPXVN999",
        },
      ],
      noneOrder,
      NOW_SEC
    );
    expect(plan.data.returnRequestedAt).toEqual(new Date((NOW_SEC - 4000) * 1000));
    expect(plan.data.returnTrackingCode).toBe("SPXVN999");
  });

  it("đơn AWAITING thiếu mốc báo hoàn → chỉ điền mốc, không đổi trạng thái", () => {
    const plan = planReturnUpdate(
      [{ status: "REQUESTED", create_time: NOW_SEC - 600 }],
      { ...noneOrder, returnStatus: ReturnStatus.AWAITING },
      NOW_SEC
    );
    expect(plan.flagged).toBe(false);
    expect(plan.data.returnStatus).toBeUndefined();
    expect(plan.data.returnRequestedAt).toEqual(new Date((NOW_SEC - 600) * 1000));
  });

  it("tracking đã lưu đúng rồi thì không ghi lại (idempotent)", () => {
    const plan = planReturnUpdate(
      [{ status: "REQUESTED", create_time: NOW_SEC, tracking_number: "SPXVN123" }],
      {
        returnStatus: ReturnStatus.AWAITING,
        returnRequestedAt: new Date(),
        returnTrackingCode: "SPXVN123",
        platformReturnStatus: "REQUESTED",
      },
      NOW_SEC
    );
    expect(plan.trackingSaved).toBe(false);
    expect(plan.data).toEqual({});
  });
});

describe("planReturnUpdate — hạ cờ khi yêu cầu hủy", () => {
  it("mọi yêu cầu đều hủy + đơn đang AWAITING → về NONE, xoá mốc lẫn mã hoàn", () => {
    const plan = planReturnUpdate(
      [{ status: "CANCELLED", tracking_number: "SPXVN123" }],
      {
        returnStatus: ReturnStatus.AWAITING,
        returnRequestedAt: new Date(),
        returnTrackingCode: "SPXVN123",
      },
      NOW_SEC
    );
    expect(plan.unflagged).toBe(true);
    expect(plan.data.returnStatus).toBe(ReturnStatus.NONE);
    expect(plan.data.returnRequestedAt).toBeNull();
    expect(plan.data.returnTrackingCode).toBeNull();
  });

  it("mọi yêu cầu đều hủy nhưng đơn NONE → không có gì để làm", () => {
    const plan = planReturnUpdate([{ status: "CANCELLED" }], noneOrder, NOW_SEC);
    expect(plan.data).toEqual({});
    expect(plan.unflagged).toBe(false);
  });
});

describe("planReturnUpdate — KHÔNG đụng đơn kho đã xử lý", () => {
  const processed: ReturnStatus[] = [
    ReturnStatus.RECEIVED,
    ReturnStatus.RECEIVED_INTACT,
    ReturnStatus.DAMAGED,
    ReturnStatus.CLAIM_SETTLED,
    ReturnStatus.WRITTEN_OFF,
  ];

  it.each(processed)("yêu cầu sống không kéo đơn %s đi đâu cả", (status) => {
    const plan = planReturnUpdate(
      [{ status: "REQUESTED", create_time: NOW_SEC }],
      {
        returnStatus: status,
        returnRequestedAt: new Date(),
        returnTrackingCode: null,
      },
      NOW_SEC
    );
    expect(plan.data.returnStatus).toBeUndefined();
    expect(plan.flagged).toBe(false);
  });

  it.each(processed)("yêu cầu hủy cũng không hạ cờ đơn %s", (status) => {
    const plan = planReturnUpdate(
      [{ status: "CANCELLED" }],
      {
        returnStatus: status,
        returnRequestedAt: new Date(),
        returnTrackingCode: "SPXVN1",
      },
      NOW_SEC
    );
    expect(plan.data).toEqual({});
    expect(plan.unflagged).toBe(false);
  });

  it("đơn kho đã xử lý vẫn được CẬP NHẬT mã vận đơn hoàn (vô hại, giúp tra cứu)", () => {
    const plan = planReturnUpdate(
      [{ status: "PROCESSING", create_time: NOW_SEC, tracking_number: "SPXVN777" }],
      {
        returnStatus: ReturnStatus.RECEIVED,
        returnRequestedAt: new Date(),
        returnTrackingCode: null,
      },
      NOW_SEC
    );
    expect(plan.data.returnStatus).toBeUndefined();
    expect(plan.data.returnTrackingCode).toBe("SPXVN777");
  });
});

// ============================================================
// SỐ CỦA SÀN (19/08, chốt anh Trung "không bịa giá"): giải pháp hoàn, tiền hoàn
// sàn báo, trạng thái yêu cầu, số lượng SKU trả — để Lãi/Lỗ không tạm tính
// hoàn full và thu hồi được giá vốn hàng đã về.
// ============================================================
describe("planReturnUpdate — số của sàn", () => {
  it("return_solution=0 (hàng về): ghi RETURN_REFUND + refund sàn báo + status + số lượng SKU trả", () => {
    const plan = planReturnUpdate(
      [
        {
          return_sn: "R1",
          status: "PROCESSING",
          create_time: NOW_SEC - 100,
          update_time: NOW_SEC,
          refund_amount: 269000,
          return_solution: 0,
          item: [
            { item_id: 17676715439, model_id: 0, item_sku: "TC025", amount: 1 },
            { item_id: 999, model_id: 5, variation_sku: "", amount: 2 },
          ],
        },
      ],
      noneOrder,
      NOW_SEC
    );
    expect(plan.flagged).toBe(true);
    expect(plan.data.returnSolution).toBe(ReturnSolution.RETURN_REFUND);
    expect(plan.data.platformRefundAmount).toBe(269000);
    expect(plan.data.platformReturnStatus).toBe("PROCESSING");
    expect(plan.itemReturns).toEqual(new Map([["TC025", 1], ["SPE-999-5", 2]]));
    expect(plan.latestAlive?.return_sn).toBe("R1");
  });

  it("return_solution=1 (chỉ hoàn tiền, khách giữ hàng): KHÔNG gắn AWAITING, không lưu tracking, số lượng trả = 0", () => {
    const plan = planReturnUpdate(
      [
        {
          return_sn: "R2",
          status: "ACCEPTED",
          create_time: NOW_SEC,
          refund_amount: 50000,
          return_solution: 1,
          tracking_number: "SPXVN999",
          item: [{ item_id: 1, item_sku: "A", amount: 1 }],
        },
      ],
      noneOrder,
      NOW_SEC
    );
    expect(plan.flagged).toBe(false);
    expect(plan.data.returnStatus).toBeUndefined();
    expect(plan.data.returnTrackingCode).toBeUndefined();
    expect(plan.data.returnSolution).toBe(ReturnSolution.REFUND_ONLY);
    expect(plan.data.platformRefundAmount).toBe(50000);
    expect(plan.itemReturns).toEqual(new Map());
  });

  it("đơn đã AWAITING mà sàn chốt chỉ hoàn tiền → hạ cờ (không có kiện nào về)", () => {
    const plan = planReturnUpdate(
      [{ status: "ACCEPTED", create_time: NOW_SEC, return_solution: 1, refund_amount: 1 }],
      {
        returnStatus: ReturnStatus.AWAITING,
        returnRequestedAt: new Date(),
        returnTrackingCode: "SPXVN1",
      },
      NOW_SEC
    );
    expect(plan.unflagged).toBe(true);
    expect(plan.data.returnStatus).toBe(ReturnStatus.NONE);
    expect(plan.data.returnTrackingCode).toBeNull();
  });

  it("thiếu return_solution thì suy từ needs_logistics; thiếu cả hai → null (không đoán)", () => {
    expect(returnSolutionOf({ needs_logistics: true })).toBe(ReturnSolution.RETURN_REFUND);
    expect(returnSolutionOf({ needs_logistics: false })).toBe(ReturnSolution.REFUND_ONLY);
    expect(returnSolutionOf({})).toBeNull();
  });

  it("số của sàn không đổi → không ghi lại (idempotent)", () => {
    const plan = planReturnUpdate(
      [{ status: "PROCESSING", create_time: NOW_SEC, return_solution: 0, refund_amount: 100 }],
      {
        returnStatus: ReturnStatus.AWAITING,
        returnRequestedAt: new Date(),
        returnTrackingCode: null,
        returnSolution: ReturnSolution.RETURN_REFUND,
        platformRefundAmount: 100,
        platformReturnStatus: "PROCESSING",
      },
      NOW_SEC
    );
    expect(plan.data).toEqual({});
  });

  it("mọi yêu cầu chết → xoá giải pháp + tiền sàn báo, status lưu CLOSED/CANCELLED", () => {
    const plan = planReturnUpdate(
      [{ status: "CLOSED", update_time: NOW_SEC }],
      {
        returnStatus: ReturnStatus.AWAITING,
        returnRequestedAt: new Date(),
        returnTrackingCode: "SPXVN1",
        returnSolution: ReturnSolution.RETURN_REFUND,
        platformRefundAmount: 269000,
        platformReturnStatus: "PROCESSING",
      },
      NOW_SEC
    );
    expect(plan.unflagged).toBe(true);
    expect(plan.data.returnSolution).toBeNull();
    expect(plan.data.platformRefundAmount).toBe(0);
    expect(plan.data.platformReturnStatus).toBe("CLOSED");
  });

  it("đơn kho đã xử lý: yêu cầu chết mà chưa từng có số của sàn → không ghi gì (giữ bất biến)", () => {
    const plan = planReturnUpdate(
      [{ status: "CANCELLED" }],
      { returnStatus: ReturnStatus.RECEIVED, returnRequestedAt: new Date(), returnTrackingCode: "X" },
      NOW_SEC
    );
    expect(plan.data).toEqual({});
  });
});

// ---- 02/10/2026: quét bù lịch sử theo mã đơn ----
describe("planReturnUpdate — quét bù (skipAwaiting)", () => {
  const done = {
    return_sn: "R9",
    status: "ACCEPTED",
    return_solution: 0,
    refund_amount: 249000,
    create_time: NOW_SEC - 30 * 86400,
    update_time: NOW_SEC - 25 * 86400,
    tracking_number: "SPXVN9",
    item: [{ item_id: 1, model_id: 2, amount: 1 }],
  };

  it("skipAwaiting: vẫn ghi giải pháp / tiền hoàn / trạng thái / SKU trả, KHÔNG cắm AWAITING", () => {
    const plan = planReturnUpdate([done], noneOrder, NOW_SEC, { skipAwaiting: true });
    expect(plan.flagged).toBe(false);
    expect(plan.data.returnStatus).toBeUndefined();
    expect(plan.data.returnRequestedAt).toBeUndefined();
    expect(plan.data.returnSolution).toBe(ReturnSolution.RETURN_REFUND);
    expect(plan.data.platformRefundAmount).toBe(249000);
    expect(plan.data.platformReturnStatus).toBe("ACCEPTED");
    expect(plan.itemReturns?.size).toBe(1);
    expect(plan.latestAlive?.return_sn).toBe("R9");
  });

  it("không có skipAwaiting → hành vi cũ: cắm AWAITING", () => {
    const plan = planReturnUpdate([done], noneOrder, NOW_SEC);
    expect(plan.flagged).toBe(true);
    expect(plan.data.returnStatus).toBe(ReturnStatus.AWAITING);
  });

  it("latestAliveReturn bỏ yêu cầu chết, lấy cái cập nhật mới nhất", () => {
    expect(
      latestAliveReturn([
        { return_sn: "A", status: "CANCELLED", update_time: 30 },
        { return_sn: "B", status: "ACCEPTED", update_time: 10 },
        { return_sn: "C", status: "PROCESSING", update_time: 20 },
      ])?.return_sn
    ).toBe("C");
    expect(latestAliveReturn([{ status: "CLOSED" }])).toBeNull();
  });

  it("isShopeeReturnParcelDelivered: nhận cả ba tên trường, chỉ DELIVERY_DONE / Delivered là đã về", () => {
    expect(isShopeeReturnParcelDelivered({ reverse_logistics_status: "LOGISTICS_DELIVERY_DONE" })).toBe(true);
    expect(isShopeeReturnParcelDelivered({ reverse_logistic_status: "Delivered" })).toBe(true);
    expect(isShopeeReturnParcelDelivered({ logistics_status: "LOGISTICS_DELIVERY_DONE" })).toBe(true);
    expect(isShopeeReturnParcelDelivered({ reverse_logistics_status: "LOGISTICS_LOST" })).toBe(false);
    expect(isShopeeReturnParcelDelivered({})).toBe(false);
    expect(isShopeeReturnParcelDelivered(null)).toBe(false);
  });
});
