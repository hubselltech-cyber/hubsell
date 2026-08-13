// ============================================================
// TEST QUYẾT ĐỊNH GẮN/HẠ CỜ ĐƠN HOÀN SHOPEE (Returns API) — logic thuần, KHÔNG DB.
//
// Bất biến sống còn: planReturnUpdate CHỈ đổi qua lại NONE ↔ AWAITING.
// Đơn kho đã xử lý (RECEIVED trở đi) tuyệt đối không bị đụng — regress cờ ở
// đây là phá tiến độ nhập kho, tệ nhất là mở lại đường cộng kho trùng.
// ============================================================

import { describe, expect, it } from "vitest";
import { ReturnStatus } from "@prisma/client";
import {
  isDeadReturn,
  planReturnUpdate,
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
