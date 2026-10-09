import { describe, expect, it } from "vitest";
import { shopeePendingAmount, tiktokUnsettledSum } from "../pending-income";

describe("shopeePendingAmount — ô Chưa thanh toán Shopee", () => {
  it("đọc total_income trong response (hình dạng prod 09/10/2026)", () => {
    expect(
      shopeePendingAmount({
        error: "",
        message: "",
        request_id: "x",
        response: {
          total_income: {
            pending_amount: 16069072,
            released_amount: 6158024875,
          },
        },
      }),
    ).toBe(16069072);
  });

  it("đọc total_income ngang hàng error (ví dụ trong docs)", () => {
    expect(
      shopeePendingAmount({
        error: "",
        message: "",
        request_id: "x",
        total_income: { pending_amount: 4010, released_amount: 1545 },
      }),
    ).toBe(4010);
  });

  it("gian mới chưa có đơn: pending_amount 0 vẫn là 0, không phải null", () => {
    expect(
      shopeePendingAmount({
        error: "",
        message: "",
        response: { total_income: { pending_amount: 0, released_amount: 0 } },
      }),
    ).toBe(0);
  });

  it("sàn không trả số → null (bảng hiện —, không bịa 0)", () => {
    expect(
      shopeePendingAmount({ error: "", message: "", response: {} }),
    ).toBeNull();
    expect(shopeePendingAmount({ error: "", message: "" })).toBeNull();
  });
});

describe("tiktokUnsettledSum — Σ ước tính chưa quyết toán TikTok", () => {
  it("chuỗi số của sàn → số", () => {
    expect(
      tiktokUnsettledSum({
        total_count: 2,
        sum_est_settlement_amount: "1234567.5",
      }),
    ).toBe(1234567.5);
  });

  it("không có trường → null; chuỗi rác → null", () => {
    expect(tiktokUnsettledSum({ total_count: 0 })).toBeNull();
    expect(tiktokUnsettledSum({ sum_est_settlement_amount: "abc" })).toBeNull();
  });
});
