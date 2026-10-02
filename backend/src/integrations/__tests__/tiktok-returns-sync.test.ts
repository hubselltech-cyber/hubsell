// ============================================================
// ĐƠN HOÀN TIKTOK — TEST PLANNER THUẦN (không API, không DB), 16/09/2026
//
// planTiktokReturnUpdate nhận nhóm yêu cầu hoàn của MỘT đơn + trạng thái hoàn
// hiện tại → quyết định cờ/số cần ghi. Kiểm 5 kịch bản theo quy ước Lazada:
//   1. Trả hàng còn sống → AWAITING + giải pháp RETURN_REFUND + tiền hoàn + SKU trả.
//   2. Chỉ hoàn tiền → KHÔNG cắm AWAITING (kho không đón kiện), refund đúng số.
//   3. Yêu cầu bị từ chối/hủy → hạ cờ, xóa mã hoàn, refund về 0.
//   4. Đổi hàng (REPLACEMENT) → hàng về (RETURN_REFUND), refund 0.
//   5. Idempotent: chạy lại với cùng trạng thái → không ghi gì.
// ============================================================
import { describe, expect, it } from "vitest";
import { ReturnSolution, ReturnStatus } from "@prisma/client";
import {
  isDeadTiktokReturn,
  isTiktokBuyerKeepsItem,
  planTiktokReturnUpdate,
  tiktokReturnSolutionOf,
} from "../tiktok/returns-sync";
import type { TikTokReturnOrder } from "../tiktok/client";

const NOW = 1_760_000_000_000;

function ro(over: Partial<TikTokReturnOrder>): TikTokReturnOrder {
  return {
    return_id: "R1",
    order_id: "O1",
    return_type: "RETURN_AND_REFUND",
    return_status: "AWAITING_BUYER_SHIP",
    create_time: 1_759_990_000,
    update_time: 1_759_995_000,
    refund_amount: { currency: "VND", refund_total: "150000" },
    return_line_items: [
      { return_line_item_id: "L1", seller_sku: "SKU-A" },
      { return_line_item_id: "L2", seller_sku: "SKU-A" },
    ],
    return_tracking_number: "RT123",
    ...over,
  };
}

const NONE = {
  returnStatus: ReturnStatus.NONE,
  returnRequestedAt: null,
  returnTrackingCode: null,
  returnSolution: null,
  platformRefundAmount: 0,
  platformReturnStatus: null,
};

describe("planTiktokReturnUpdate", () => {
  it("phân loại giải pháp + nhận diện yêu cầu chết", () => {
    expect(tiktokReturnSolutionOf({ return_type: "REFUND" })).toBe(ReturnSolution.REFUND_ONLY);
    expect(tiktokReturnSolutionOf({ return_type: "RETURN_AND_REFUND" })).toBe(ReturnSolution.RETURN_REFUND);
    expect(tiktokReturnSolutionOf({ return_type: "REPLACEMENT" })).toBe(ReturnSolution.RETURN_REFUND);
    expect(tiktokReturnSolutionOf({ return_type: undefined })).toBeNull();
    expect(isDeadTiktokReturn({ return_status: "REFUND_OR_RETURN_REQUEST_REJECT" })).toBe(true);
    expect(isDeadTiktokReturn({ return_status: "RETURN_OR_REFUND_REQUEST_CANCEL" })).toBe(true);
    expect(isDeadTiktokReturn({ return_status: "BUYER_SHIPPED_ITEM" })).toBe(false);
  });

  it("trả hàng còn sống → cắm AWAITING, ghi giải pháp/tiền hoàn/tracking, đếm SKU trả", () => {
    const plan = planTiktokReturnUpdate([ro({})], NONE, NOW);
    expect(plan.flagged).toBe(true);
    expect(plan.data.returnStatus).toBe(ReturnStatus.AWAITING);
    expect(plan.data.returnRequestedAt?.getTime()).toBe(1_759_990_000 * 1000);
    expect(plan.data.returnSolution).toBe(ReturnSolution.RETURN_REFUND);
    expect(plan.data.platformRefundAmount).toBe(150000);
    expect(plan.data.platformReturnStatus).toBe("AWAITING_BUYER_SHIP");
    expect(plan.data.returnTrackingCode).toBe("RT123");
    expect(plan.trackingSaved).toBe(true);
    expect(plan.itemReturns?.get("SKU-A")).toBe(2);
  });

  it("chỉ hoàn tiền → không cắm AWAITING, refund đúng số, map SKU rỗng", () => {
    const plan = planTiktokReturnUpdate(
      [ro({ return_type: "REFUND", return_tracking_number: undefined })],
      NONE,
      NOW
    );
    expect(plan.flagged).toBe(false);
    expect(plan.data.returnStatus).toBeUndefined();
    expect(plan.data.returnSolution).toBe(ReturnSolution.REFUND_ONLY);
    expect(plan.data.platformRefundAmount).toBe(150000);
    expect(plan.itemReturns?.size).toBe(0);
  });

  it("yêu cầu bị từ chối → hạ cờ, xóa mã hoàn, refund về 0", () => {
    const plan = planTiktokReturnUpdate(
      [ro({ return_status: "REFUND_OR_RETURN_REQUEST_REJECT" })],
      {
        ...NONE,
        returnStatus: ReturnStatus.AWAITING,
        returnTrackingCode: "RT123",
        returnSolution: ReturnSolution.RETURN_REFUND,
        platformRefundAmount: 150000,
        platformReturnStatus: "AWAITING_BUYER_SHIP",
      },
      NOW
    );
    expect(plan.unflagged).toBe(true);
    expect(plan.data.returnStatus).toBe(ReturnStatus.NONE);
    expect(plan.data.returnTrackingCode).toBeNull();
    expect(plan.data.returnSolution).toBeNull();
    expect(plan.data.platformRefundAmount).toBe(0);
    expect(plan.data.platformReturnStatus).toBe("REFUND_OR_RETURN_REQUEST_REJECT");
  });

  it("đổi hàng → hàng về (RETURN_REFUND), refund 0", () => {
    const plan = planTiktokReturnUpdate(
      [ro({ return_type: "REPLACEMENT", refund_amount: { refund_total: "0" }, return_line_items: [{ seller_sku: "SKU-B" }] })],
      NONE,
      NOW
    );
    expect(plan.data.returnStatus).toBe(ReturnStatus.AWAITING);
    expect(plan.data.returnSolution).toBe(ReturnSolution.RETURN_REFUND);
    expect(plan.data.platformRefundAmount).toBeUndefined(); // 0 = không đổi so với hiện tại
    expect(plan.itemReturns?.get("SKU-B")).toBe(1);
  });

  it("trả hàng đã COMPLETE → ghi mốc kiện về tay (returnDeliveredAt) một lần", () => {
    const plan = planTiktokReturnUpdate(
      [ro({ return_status: "RETURN_OR_REFUND_REQUEST_COMPLETE", update_time: 1_759_999_000 })],
      NONE,
      NOW
    );
    expect(plan.delivered).toBe(true);
    expect(plan.data.returnDeliveredAt?.getTime()).toBe(1_759_999_000 * 1000);
    // Đã có mốc → không ghi lại
    const again = planTiktokReturnUpdate(
      [ro({ return_status: "RETURN_OR_REFUND_REQUEST_COMPLETE" })],
      { ...NONE, returnDeliveredAt: new Date(1) },
      NOW
    );
    expect(again.delivered).toBe(false);
    expect(again.data.returnDeliveredAt).toBeUndefined();
    // Chỉ hoàn tiền → không có kiện về, không ghi mốc
    const refundOnly = planTiktokReturnUpdate(
      [ro({ return_type: "REFUND", return_status: "RETURN_OR_REFUND_REQUEST_COMPLETE" })],
      NONE,
      NOW
    );
    expect(refundOnly.delivered).toBe(false);
  });

  // ---- 02/10/2026: sàn cho khách GIỮ HÀNG (can_buyer_keep_item) ----
  it("trả hàng nhưng sàn cho khách giữ hàng → coi như chỉ hoàn tiền: không AWAITING, không mốc kiện về", () => {
    expect(tiktokReturnSolutionOf({ return_type: "RETURN_AND_REFUND", can_buyer_keep_item: true })).toBe(
      ReturnSolution.REFUND_ONLY
    );
    expect(tiktokReturnSolutionOf({ return_type: "REPLACEMENT", can_buyer_keep_item: true })).toBe(
      ReturnSolution.REFUND_ONLY
    );
    // Cờ tắt / không có → giữ nguyên là hàng về
    expect(tiktokReturnSolutionOf({ return_type: "RETURN_AND_REFUND", can_buyer_keep_item: false })).toBe(
      ReturnSolution.RETURN_REFUND
    );
    expect(isTiktokBuyerKeepsItem({ return_type: "REFUND", can_buyer_keep_item: true })).toBe(false);

    const plan = planTiktokReturnUpdate(
      [ro({ return_status: "RETURN_OR_REFUND_REQUEST_COMPLETE", can_buyer_keep_item: true })],
      NONE,
      NOW
    );
    expect(plan.keptByBuyer).toBe(true);
    expect(plan.flagged).toBe(false);
    expect(plan.delivered).toBe(false);
    expect(plan.data.returnStatus).toBeUndefined();
    expect(plan.data.returnDeliveredAt).toBeUndefined();
    expect(plan.data.returnSolution).toBe(ReturnSolution.REFUND_ONLY);
    expect(plan.data.platformRefundAmount).toBe(150000);
    expect(plan.itemReturns?.size).toBe(0);
  });

  it("khách giữ hàng mà bản cũ đã ghi 'trả hàng, kiện đã về' → gỡ mốc kiện về, hạ cờ chờ hàng", () => {
    const plan = planTiktokReturnUpdate(
      [ro({ return_status: "RETURN_OR_REFUND_REQUEST_COMPLETE", can_buyer_keep_item: true })],
      {
        ...NONE,
        returnStatus: ReturnStatus.AWAITING,
        returnRequestedAt: new Date(1_759_990_000 * 1000),
        returnTrackingCode: "RT123",
        returnSolution: ReturnSolution.RETURN_REFUND,
        platformRefundAmount: 150000,
        platformReturnStatus: "RETURN_OR_REFUND_REQUEST_COMPLETE",
        returnDeliveredAt: new Date(1_759_999_000 * 1000),
      },
      NOW
    );
    expect(plan.data.returnSolution).toBe(ReturnSolution.REFUND_ONLY);
    expect(plan.data.returnDeliveredAt).toBeNull();
    expect(plan.unflagged).toBe(true);
    expect(plan.data.returnStatus).toBe(ReturnStatus.NONE);
  });

  it("một yêu cầu khách giữ hàng + một yêu cầu trả hàng thật → vẫn là hàng về", () => {
    const plan = planTiktokReturnUpdate(
      [
        ro({ return_id: "R1", can_buyer_keep_item: true, return_line_items: [{ seller_sku: "SKU-A" }] }),
        ro({ return_id: "R2", return_line_items: [{ seller_sku: "SKU-B" }] }),
      ],
      NONE,
      NOW
    );
    expect(plan.keptByBuyer).toBe(true);
    expect(plan.data.returnSolution).toBe(ReturnSolution.RETURN_REFUND);
    expect(plan.flagged).toBe(true);
    // Chỉ đếm SKU của yêu cầu có hàng về
    expect(plan.itemReturns?.get("SKU-B")).toBe(1);
    expect(plan.itemReturns?.has("SKU-A")).toBe(false);
  });

  // ---- 02/10/2026: quét bù lịch sử theo mã đơn ----
  it("quét bù: trả hàng ĐÃ XONG từ trước → ghi giải pháp + mốc kiện về + SKU trả, KHÔNG cắm AWAITING", () => {
    const plan = planTiktokReturnUpdate(
      [ro({ return_status: "RETURN_OR_REFUND_REQUEST_COMPLETE", update_time: 1_759_999_000 })],
      NONE,
      NOW,
      { historical: true }
    );
    expect(plan.flagged).toBe(false);
    expect(plan.data.returnStatus).toBeUndefined();
    expect(plan.data.returnRequestedAt).toBeUndefined();
    expect(plan.data.returnSolution).toBe(ReturnSolution.RETURN_REFUND);
    expect(plan.delivered).toBe(true);
    expect(plan.data.returnDeliveredAt?.getTime()).toBe(1_759_999_000 * 1000);
    expect(plan.data.platformRefundAmount).toBe(150000);
    expect(plan.itemReturns?.get("SKU-A")).toBe(2);
  });

  it("quét bù: trả hàng CÒN ĐANG ĐI → vẫn cắm AWAITING để kho đón kiện", () => {
    const plan = planTiktokReturnUpdate([ro({ return_status: "BUYER_SHIPPED_ITEM" })], NONE, NOW, {
      historical: true,
    });
    expect(plan.flagged).toBe(true);
    expect(plan.data.returnStatus).toBe(ReturnStatus.AWAITING);
    expect(plan.delivered).toBe(false);
  });

  it("quét bù: chỉ hoàn tiền → giải pháp REFUND_ONLY, không mốc kiện về (mất giá vốn như cũ)", () => {
    const plan = planTiktokReturnUpdate(
      [ro({ return_type: "REFUND", return_status: "RETURN_OR_REFUND_REQUEST_COMPLETE" })],
      NONE,
      NOW,
      { historical: true }
    );
    expect(plan.data.returnSolution).toBe(ReturnSolution.REFUND_ONLY);
    expect(plan.delivered).toBe(false);
    expect(plan.flagged).toBe(false);
  });

  it("idempotent: trạng thái đã khớp → không ghi gì", () => {
    const plan = planTiktokReturnUpdate(
      [ro({})],
      {
        returnStatus: ReturnStatus.AWAITING,
        returnRequestedAt: new Date(1_759_990_000 * 1000),
        returnTrackingCode: "RT123",
        returnSolution: ReturnSolution.RETURN_REFUND,
        platformRefundAmount: 150000,
        platformReturnStatus: "AWAITING_BUYER_SHIP",
      },
      NOW
    );
    expect(Object.keys(plan.data)).toHaveLength(0);
    expect(plan.flagged).toBe(false);
    expect(plan.trackingSaved).toBe(false);
  });
});
